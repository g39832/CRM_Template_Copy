const express = require('express');
const bcrypt = require('bcryptjs');
const { getClient } = require('./db-v2');
const { asyncHandler, assertObject, parseStringField, AppError } = require('./request-utils');

const router = express.Router();

function normalizeHost(req) {
  var raw = String(
    req.headers['x-forwarded-host'] ||
    req.headers.host ||
    req.hostname ||
    ''
  )
    .split(',')[0]
    .trim()
    .toLowerCase();

  if (!raw) return '';
  return raw.replace(/:\d+$/, '').replace(/\.$/, '');
}

function hostVariants(host) {
  var base = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (!base) return [];
  var variants = [base];
  if (base.startsWith('www.')) variants.push(base.slice(4));
  else variants.push('www.' + base);
  return Array.from(new Set(variants));
}

async function getTenantByHost(supabase, host) {
  var variants = hostVariants(host);
  if (variants.length === 0) return null;

  // Query for a company matching slug or contact_email
  for (var i = 0; i < variants.length; i++) {
    var variant = variants[i];
    var { data: companies, error } = await supabase
      .from('companies')
      .select('*')
      .or('slug.eq.' + variant + ',contact_email.eq.' + variant)
      .limit(1);

    if (error) throw new AppError(500, 'Failed to resolve tenant: ' + error.message);
    if (companies && companies.length > 0) return companies[0];
  }

  // Fallback: if only one company exists, return it (development convenience)
  var { count, error: countErr } = await supabase
    .from('companies')
    .select('id', { count: 'exact', head: true });
  if (countErr) throw new AppError(500, 'Failed to check companies: ' + countErr.message);
  if (count === 1) {
    var { data: single } = await supabase.from('companies').select('*').limit(1).single();
    return single || null;
  }

  return null;
}

async function getCompanyAdminCount(supabase, companyId) {
  var { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('role', 'admin');

  if (error) throw new AppError(500, 'Failed to check admin status: ' + error.message);
  return count || 0;
}

async function getTenantStatus(supabase, host) {
  var tenant = await getTenantByHost(supabase, host);
  if (!tenant) {
    return {
      host: host,
      tenantExists: false,
      setupRequired: true,
      company: null
    };
  }

  var adminCount = await getCompanyAdminCount(supabase, tenant.id);
  return {
    host: host,
    tenantExists: true,
    setupRequired: adminCount === 0,
    adminCount: adminCount,
    company: {
      id: tenant.id,
      name: tenant.name || '',
      slug: tenant.slug || '',
      onboardingStep: tenant.onboarding_step || 0,
      contactEmail: tenant.contact_email || ''
    }
  };
}

// ============================================================
// POST /api/v2/auth/register
// First user to register becomes Admin with a new Company.
// All subsequent registrations become regular Users.
// ============================================================
router.post('/register', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const email = parseStringField(req.body.email, 'email', { minLength: 1, maxLength: 254 }).toLowerCase();
  const password = parseStringField(req.body.password, 'password', { minLength: 6, maxLength: 128 });
  const displayName = parseStringField(req.body.displayName, 'displayName', { required: false, defaultValue: '', maxLength: 200 });
  const companyNameInput = parseStringField(req.body.companyName || req.body.company_name || '', 'companyName', { required: false, defaultValue: '', maxLength: 200 });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) throw new AppError(400, 'Invalid email format');

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  const host = normalizeHost(req);
  if (!host) throw new AppError(400, 'Unable to determine tenant domain');

  // Check if email already taken
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing) throw new AppError(409, 'Email already registered');

  const passwordHash = bcrypt.hashSync(password, 10);
  var tenant = await getTenantByHost(supabase, host);
  var company = tenant;
  var adminCount = company ? await getCompanyAdminCount(supabase, company.id) : 0;
  if (company && adminCount > 0) {
    throw new AppError(409, 'This domain already has an admin. Please sign in.');
  }

  if (company && companyNameInput) {
    var { error: updateCompanyErr } = await supabase
      .from('companies')
      .update({
        name: companyNameInput,
        contact_email: email,
        updated_at: new Date().toISOString()
      })
      .eq('id', company.id);

    if (!updateCompanyErr) {
      company.name = companyNameInput;
      company.contact_email = email;
    }
  }

  if (!company) {
    var companyName = companyNameInput || displayName || host;
    var slug = host;
    var insertCompany = {
      name: companyName,
      slug: slug,
      contact_email: email
    };

    if (req.body.companyDomain || req.body.company_domain) {
      insertCompany.company_domain = String(req.body.companyDomain || req.body.company_domain).trim().toLowerCase();
    }

    var companyInsert = await supabase
      .from('companies')
      .insert(insertCompany)
      .select()
      .single();

    if (companyInsert.error) {
      var fallbackInsert = await supabase
        .from('companies')
        .insert({
          name: companyName,
          slug: slug,
          contact_email: email
        })
        .select()
        .single();
      if (fallbackInsert.error) {
        throw new AppError(500, 'Failed to create company: ' + fallbackInsert.error.message);
      }
      company = fallbackInsert.data;
    } else {
      company = companyInsert.data;
    }
  }

  var { data: user, error: userErr } = await supabase
    .from('users')
    .insert({
      email,
      password_hash: passwordHash,
      display_name: displayName || '',
      role: 'admin',
      company_id: company.id,
      onboarding_complete: false
    })
    .select()
    .single();

  if (userErr) {
    throw new AppError(500, 'Failed to create user: ' + userErr.message);
  }

  req.session.authenticated = true;
  req.session.user = {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: 'admin',
    companyId: company.id,
    companyName: company.name || companyNameInput || host,
    onboardingComplete: false
  };

  return res.json({
    success: true,
    role: 'admin',
    onboardingComplete: false,
    message: 'Welcome! You are the Admin. Please complete onboarding.'
  });
}));

// ============================================================
// POST /api/v2/auth/login
// ============================================================
router.post('/login', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const email = parseStringField(req.body.email, 'email', { minLength: 1, maxLength: 254 }).toLowerCase();
  const password = parseStringField(req.body.password, 'password', { minLength: 1, maxLength: 128 });

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  const host = normalizeHost(req);
  if (!host) throw new AppError(400, 'Unable to determine tenant domain');
  const tenant = await getTenantByHost(supabase, host);
  if (!tenant) throw new AppError(403, 'This domain is not set up yet. Create the first admin account.');

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .eq('company_id', tenant.id)
    .maybeSingle();

  if (!user) throw new AppError(401, 'Invalid email or password');

  const match = bcrypt.compareSync(password, user.password_hash);
  if (!match) throw new AppError(401, 'Invalid email or password');

  // Fetch the company's onboarding step for resume logic
  var onboardingStep = 0;
  if (user.company_id) {
    var { data: company } = await supabase
      .from('companies')
      .select('onboarding_step')
      .eq('id', user.company_id)
      .maybeSingle();
    onboardingStep = company ? (company.onboarding_step || 0) : 0;
  }

  req.session.authenticated = true;
  req.session.user = {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    companyId: user.company_id,
    companyName: tenant.name || '',
    onboardingComplete: user.onboarding_complete,
    onboardingStep: onboardingStep
  };

  res.json({
    success: true,
    role: user.role,
    onboardingComplete: user.onboarding_complete,
    onboardingStep: onboardingStep
  });
}));

// ============================================================
// GET /api/v2/auth/tenant-status
// Returns whether this host already has a company/admin.
// Used by the login screen to decide whether to show first-run setup.
// ============================================================
router.get('/tenant-status', asyncHandler(async (req, res) => {
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  const host = normalizeHost(req);
  const status = await getTenantStatus(supabase, host);
  res.json({ success: true, data: status });
}));

// ============================================================
// GET /api/v2/auth/me
// Returns current session user info (or unauthenticated status).
// ============================================================
router.get('/me', asyncHandler(async (req, res) => {
  if (!req.session.user) {
    return res.json({ success: false, authenticated: false });
  }
  res.json({ success: true, authenticated: true, user: req.session.user });
}));

// ============================================================
// PATCH /api/v2/auth/me
// Updates the current user's display name and/or password.
// ============================================================
router.patch('/me', asyncHandler(async (req, res) => {
  if (!req.session.user) {
    throw new AppError(401, 'Not authenticated');
  }

  assertObject(req.body);
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  const displayName = parseStringField(req.body.displayName, 'displayName', { required: false, defaultValue: '', maxLength: 200 });
  const currentPassword = parseStringField(req.body.currentPassword, 'currentPassword', { required: false, defaultValue: '', maxLength: 128 });
  const newPassword = parseStringField(req.body.newPassword, 'newPassword', { required: false, defaultValue: '', maxLength: 128 });
  const confirmPassword = parseStringField(req.body.confirmPassword, 'confirmPassword', { required: false, defaultValue: '', maxLength: 128 });

  const updates = {};
  if (typeof displayName === 'string') {
    updates.display_name = displayName.trim();
  }

  if (newPassword || confirmPassword || currentPassword) {
    if (!currentPassword || !newPassword) {
      throw new AppError(400, 'Current password and new password are required to change your password.');
    }
    if (newPassword !== confirmPassword) {
      throw new AppError(400, 'New passwords do not match.');
    }

    const { data: user } = await supabase
      .from('users')
      .select('id, password_hash')
      .eq('id', req.session.user.id)
      .maybeSingle();

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    const match = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!match) {
      throw new AppError(400, 'Current password is incorrect.');
    }

    updates.password_hash = bcrypt.hashSync(newPassword, 10);
  }

  if (Object.keys(updates).length === 0) {
    throw new AppError(400, 'No updates provided');
  }

  updates.updated_at = new Date().toISOString();

  const { data: updatedUser, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', req.session.user.id)
    .select('id, email, display_name, role, company_id, onboarding_complete')
    .single();

  if (error) {
    throw new AppError(500, 'Failed to update account: ' + error.message);
  }

  req.session.user.displayName = updatedUser.display_name;

  res.json({
    success: true,
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      displayName: updatedUser.display_name,
      role: updatedUser.role,
      companyId: updatedUser.company_id,
      onboardingComplete: updatedUser.onboarding_complete
    }
  });
}));

// ============================================================
// POST /api/v2/auth/logout
// ============================================================
router.post('/logout', asyncHandler(async (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
}));

module.exports = router;

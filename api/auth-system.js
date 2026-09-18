const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { getClient } = require('./db-v2');
const { asyncHandler, assertObject, parseStringField, AppError } = require('./request-utils');

const router = express.Router();

// Node's fetch buries the actual reason (DNS failure, TLS error,
// connection refused, etc.) inside `.cause` and only puts the generic
// "fetch failed" in `.message`. Surface the real cause so error
// messages are actually actionable instead of always saying the
// same unhelpful "fetch failed".
function describeSupabaseError(error) {
  var base = error && error.message ? error.message : String(error);
  var cause = error && error.cause;
  if (cause) {
    var causeMsg = cause.message || String(cause);
    var code = cause.code ? ' [' + cause.code + ']' : '';
    return base + ' — likely cause: ' + causeMsg + code +
      '. Run `node scripts/diagnose-connection.js` for a full network check.';
  }
  return base;
}

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const DEFAULT_COMPANY_NAME = process.env.BUSINESS_NAME || 'My Company';

// A plain anon-key client, used only to ask Supabase Auth "who does this
// access token belong to?". This never touches app data directly.
function getAuthVerifierClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}

// ============================================================
// Single-tenant helper: this template demos as one company, so
// we transparently reuse (or create once) a single companies row
// instead of asking anyone to configure multi-tenant setup.
// ============================================================
async function getOrCreateDefaultCompany(supabase) {
  const { data: existing, error } = await supabase
    .from('companies')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new AppError(500, 'Failed to look up company: ' + describeSupabaseError(error));
  if (existing) return existing;

  const { data: created, error: createErr } = await supabase
    .from('companies')
    .insert({
      name: DEFAULT_COMPANY_NAME,
      slug: 'default',
      contact_email: ''
    })
    .select()
    .single();

  if (createErr) throw new AppError(500, 'Failed to create company: ' + describeSupabaseError(createErr));
  return created;
}

async function getCompanyAdminCount(supabase, companyId) {
  const { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('role', 'admin');

  if (error) throw new AppError(500, 'Failed to check admin status: ' + describeSupabaseError(error));
  return count || 0;
}

function buildSessionUser(userRow, company) {
  return {
    id: userRow.id,
    email: userRow.email,
    displayName: userRow.display_name || '',
    pictureUrl: userRow.picture_url || '',
    role: userRow.role,
    companyId: userRow.company_id,
    companyName: company ? company.name || '' : '',
    onboardingComplete: true
  };
}

// ============================================================
// POST /api/v2/auth/google-session
//
// Called by the frontend right after Supabase Auth completes a
// Google OAuth sign-in in the browser. The browser sends us the
// access_token it received from Supabase; we verify that token
// directly with Supabase Auth (so a forged/expired token is
// rejected) and only then create our own server session.
//
// First person ever to sign in becomes the company's admin. Every
// subsequent Google sign-in becomes a regular user. An admin can
// promote/reassign users later from User Management.
// ============================================================
router.post('/google-session', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const accessToken = parseStringField(req.body.access_token, 'access_token', { minLength: 10, maxLength: 4000 });

  const verifier = getAuthVerifierClient();
  if (!verifier) throw new AppError(503, 'Google sign-in is not configured (SUPABASE_URL/SUPABASE_ANON_KEY missing).');

  const { data: authData, error: authErr } = await verifier.auth.getUser(accessToken);
  if (authErr || !authData || !authData.user) {
    throw new AppError(401, 'Could not verify Google sign-in. Please try again.');
  }

  const authUser = authData.user;
  const email = String(authUser.email || '').toLowerCase().trim();
  if (!email) throw new AppError(400, 'Google account has no email address.');

  const metadata = authUser.user_metadata || {};
  const displayName = String(metadata.full_name || metadata.name || '').trim();
  const pictureUrl = String(metadata.avatar_url || metadata.picture || '').trim();

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  const company = await getOrCreateDefaultCompany(supabase);

  // Look up an existing app user by auth_uid first (returning user),
  // then fall back to matching by email (links a pre-existing/legacy
  // user record to this Google identity on first sign-in).
  let { data: userRow } = await supabase
    .from('users')
    .select('*')
    .eq('auth_uid', authUser.id)
    .maybeSingle();

  if (!userRow) {
    const byEmail = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('company_id', company.id)
      .maybeSingle();
    userRow = byEmail.data || null;
  }

  if (userRow) {
    const { data: updated, error: updateErr } = await supabase
      .from('users')
      .update({
        auth_uid: authUser.id,
        display_name: displayName || userRow.display_name || '',
        picture_url: pictureUrl || userRow.picture_url || '',
        onboarding_complete: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', userRow.id)
      .select()
      .single();

    if (updateErr) throw new AppError(500, 'Failed to update user: ' + describeSupabaseError(updateErr));
    userRow = updated;
  } else {
    const adminCount = await getCompanyAdminCount(supabase, company.id);
    const role = adminCount === 0 ? 'admin' : 'user';

    const { data: created, error: createErr } = await supabase
      .from('users')
      .insert({
        email,
        password_hash: null,
        auth_uid: authUser.id,
        display_name: displayName,
        picture_url: pictureUrl,
        role,
        company_id: company.id,
        onboarding_complete: true
      })
      .select()
      .single();

    if (createErr) throw new AppError(500, 'Failed to create user: ' + describeSupabaseError(createErr));
    userRow = created;
  }

  req.session.authenticated = true;
  req.session.user = buildSessionUser(userRow, company);

  res.json({ success: true, user: req.session.user });
}));

// ============================================================
// GET /api/v2/auth/me
// ============================================================
router.get('/me', asyncHandler(async (req, res) => {
  if (!req.session.user) {
    return res.json({ success: false, authenticated: false });
  }
  res.json({ success: true, authenticated: true, user: req.session.user });
}));

// ============================================================
// PATCH /api/v2/auth/me
// Google sign-in owns the identity/password, so the only thing a
// signed-in user can change here is their display name.
// ============================================================
router.patch('/me', asyncHandler(async (req, res) => {
  if (!req.session.user) {
    throw new AppError(401, 'Not authenticated');
  }

  assertObject(req.body);
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  const displayName = parseStringField(req.body.displayName, 'displayName', { required: false, defaultValue: '', maxLength: 200 });
  if (!displayName) throw new AppError(400, 'displayName is required');

  const { data: updatedUser, error } = await supabase
    .from('users')
    .update({ display_name: displayName.trim(), updated_at: new Date().toISOString() })
    .eq('id', req.session.user.id)
    .select('id, email, display_name, role, company_id')
    .single();

  if (error) throw new AppError(500, 'Failed to update account: ' + describeSupabaseError(error));

  req.session.user.displayName = updatedUser.display_name;

  res.json({
    success: true,
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      displayName: updatedUser.display_name,
      role: updatedUser.role,
      companyId: updatedUser.company_id
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

// ============================================================
// POST /api/v2/auth/test-login  (TEST-ONLY, never available outside
// NODE_ENV=test)
//
// Real users always sign in with Google. This endpoint exists purely
// so automated tests can create a session for a chosen role/email
// without driving a real browser through Google's OAuth consent
// screen. It behaves like a normal 404 in any non-test environment,
// so it cannot be discovered or used in the demo/production app.
// ============================================================
router.post('/test-login', asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    throw new AppError(404, 'Not found');
  }

  assertObject(req.body);
  const email = parseStringField(req.body.email, 'email', { minLength: 1, maxLength: 254 }).toLowerCase();
  const requestedRole = req.body.role === 'admin' ? 'admin' : 'user';
  const displayName = parseStringField(req.body.displayName || '', 'displayName', { required: false, defaultValue: '', maxLength: 200 });

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  const company = await getOrCreateDefaultCompany(supabase);

  let { data: userRow } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .eq('company_id', company.id)
    .maybeSingle();

  if (!userRow) {
    const { data: created, error: createErr } = await supabase
      .from('users')
      .insert({
        email,
        password_hash: null,
        display_name: displayName,
        role: requestedRole,
        company_id: company.id,
        onboarding_complete: true
      })
      .select()
      .single();
    if (createErr) throw new AppError(500, 'Failed to create test user: ' + describeSupabaseError(createErr));
    userRow = created;
  } else if (userRow.role !== requestedRole) {
    const { data: updated, error: updateErr } = await supabase
      .from('users')
      .update({ role: requestedRole })
      .eq('id', userRow.id)
      .select()
      .single();
    if (updateErr) throw new AppError(500, 'Failed to update test user role: ' + describeSupabaseError(updateErr));
    userRow = updated;
  }

  req.session.authenticated = true;
  req.session.user = buildSessionUser(userRow, company);

  res.json({ success: true, user: req.session.user });
}));

module.exports = router;

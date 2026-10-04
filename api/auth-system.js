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
// Access is invitation-only. A valid Google account is NOT enough:
//   - a returning user is matched by their Google identity (auth_uid);
//   - an invited user is matched by the email an admin added in User
//     Management, and linked to their Google identity on first sign-in;
//   - anyone else is refused (403) and no user row is created.
// The very first admin of a new deployment is the one exception: while the
// company has no admin at all, an email listed in ADMIN_EMAILS (Render
// environment) is created as admin. Once an admin exists, ADMIN_EMAILS
// grants nothing — every further person must be added by an admin.
// ============================================================
function adminBootstrapEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Only identities Google itself verified. Without this, an email/password
// account created in Supabase Auth with someone else's address (if that
// provider were ever switched on) could be linked to their CRM user.
function isVerifiedGoogleUser(authUser) {
  const appMeta = authUser.app_metadata || {};
  const providers = [].concat(appMeta.provider || [], appMeta.providers || []);
  (authUser.identities || []).forEach((identity) => providers.push(identity && identity.provider));
  const confirmed = Boolean(authUser.email_confirmed_at || authUser.confirmed_at);
  return providers.includes('google') && confirmed;
}

// PostgREST ilike pattern that matches the text exactly (case-insensitively).
function exactIlike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => '\\' + ch);
}

const NOT_INVITED_MESSAGE =
  'This Google account does not have access to this CRM. Ask your administrator to add your email address.';

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
  if (!isVerifiedGoogleUser(authUser)) {
    throw new AppError(403, 'Please sign in with a Google account.');
  }

  const metadata = authUser.user_metadata || {};
  const displayName = String(metadata.full_name || metadata.name || '').trim();
  const pictureUrl = String(metadata.avatar_url || metadata.picture || '').trim();

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  const company = await getOrCreateDefaultCompany(supabase);

  // Look up an existing app user by auth_uid first (returning user),
  // then fall back to matching by email (an invited user, or a
  // pre-existing/legacy record, linked to this Google identity now).
  const byUid = await supabase
    .from('users')
    .select('*')
    .eq('auth_uid', authUser.id)
    .maybeSingle();
  if (byUid.error) throw new AppError(500, 'Failed to look up user: ' + describeSupabaseError(byUid.error));
  let userRow = byUid.data || null;

  if (!userRow) {
    const byEmail = await supabase
      .from('users')
      .select('*')
      .ilike('email', exactIlike(email))
      .eq('company_id', company.id)
      .limit(1);
    if (byEmail.error) throw new AppError(500, 'Failed to look up user: ' + describeSupabaseError(byEmail.error));
    userRow = (byEmail.data && byEmail.data[0]) || null;
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
    // Not invited. The only way in is the first-admin bootstrap.
    const adminCount = await getCompanyAdminCount(supabase, company.id);
    if (adminCount > 0 || !adminBootstrapEmails().includes(email)) {
      console.warn('[auth] Refused sign-in for an email that has not been added to the CRM.');
      throw new AppError(403, NOT_INVITED_MESSAGE);
    }
    const role = 'admin';

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

  // Fresh session id at sign-in (prevents session fixation).
  await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
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
async function signInTestUser(req, { email, role, displayName }) {
  const requestedRole = role === 'admin' ? 'admin' : 'user';
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
  return req.session.user;
}

router.post('/test-login', asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    throw new AppError(404, 'Not found');
  }

  assertObject(req.body);
  const email = parseStringField(req.body.email, 'email', { minLength: 1, maxLength: 254 }).toLowerCase();
  const displayName = parseStringField(req.body.displayName || '', 'displayName', { required: false, defaultValue: '', maxLength: 200 });
  const user = await signInTestUser(req, { email, role: req.body.role, displayName });
  res.json({ success: true, user });
}));

// ============================================================
// GET /api/v2/auth/preview-login?email=...&role=admin|user
// (LOCAL PREVIEW ONLY — npm run dev:local)
//
// A clickable version of test-login so the local preview can print links
// that sign you straight in. Only exists when BOTH NODE_ENV=test and
// LOCAL_PREVIEW=1 are set, which only scripts/dev-local.js does (and it
// refuses to start unless the database is the local mock). Everywhere else
// it is a plain 404.
// ============================================================
router.get('/preview-login', asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV !== 'test' || process.env.LOCAL_PREVIEW !== '1') {
    throw new AppError(404, 'Not found');
  }
  const email = parseStringField(req.query.email, 'email', { minLength: 1, maxLength: 254 }).toLowerCase();
  await signInTestUser(req, { email, role: req.query.role, displayName: '' });
  req.session.save(() => res.redirect('/main'));
}));

module.exports = router;

/**
 * verify-guard-enhanced.js — Enhanced Registration Guard Verification
 *
 * USAGE:
 *   npm run verify-guard-enhanced
 *
 * Or directly:
 *   node scripts/verify-guard-enhanced.js
 *
 * This enhanced test:
 *   1. Resets the database via Supabase admin client
 *   2. Starts a test server and runs guard checks
 *   3. Completes actual registration via the API
 *   4. Verifies the guard no longer redirects after registration
 *   5. Tests admin_claimed flag persistence
 *
 * Prerequisites:
 *   - .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   - No server running on the test port (3098)
 */

require('dotenv').config();

var { createClient } = require('@supabase/supabase-js');
var assert = require('assert');

var BASE_URL = 'http://127.0.0.1:3098';
var TEST_EMAIL = 'guard-test-' + Date.now() + '@example.com';
var TEST_PASSWORD = 'GuardTestPass123!';
var COMPANY_SLUG = 'guardtest-' + Date.now();

var supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
var supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('  Missing Supabase credentials in .env');
  process.exit(1);
}

var supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

async function waitForServer(timeoutMs) {
  timeoutMs = timeoutMs || 25000;
  var start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      var r = await fetch(BASE_URL + '/health');
      if (r.status >= 200 && r.status < 500) return;
    } catch (_) {}
    await sleep(400);
  }
  throw new Error('Server did not start within ' + timeoutMs + 'ms');
}

async function api(path, opts) {
  opts = opts || {};
  var url = BASE_URL + path;
  var headers = opts.headers || {};
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  var res = await fetch(url, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body || null,
    redirect: 'manual'
  });
  var text = await res.text();
  var json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { res: res, text: text, json: json };
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return '';
  return setCookieHeader.split(';')[0];
}

function pass(label, detail) {
  console.log('  [PASS] ' + label + (detail ? ' — ' + detail : ''));
}

function fail(label, detail) {
  console.log('  [FAIL] ' + label + (detail ? ' — ' + detail : ''));
  process.exitCode = 1;
}

function check(label, condition, detail) {
  if (condition) {
    pass(label, detail);
  } else {
    fail(label, detail);
  }
}

async function run() {
  console.log('');
  console.log('  ===== ENHANCED REGISTRATION GUARD VERIFICATION =====');
  console.log('');

  // ---- Phase 0: Reset database ----
  console.log('  [PHASE 0] Resetting database...');
  await supabase.from('company_components').delete().neq('id', 0);
  await supabase.from('users').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('companies').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('settings').upsert({ key: 'admin_claimed', value: 'false' }, { onConflict: 'key' });
  console.log('  [OK]   Database reset (admin_claimed = false)');

  // ---- Phase 1: Start test server ----
  console.log('  [PHASE 1] Starting test server...');
  process.env.PORT = '3098';
  process.env.DISABLE_AUTH = 'false';
  process.env.ENABLE_DB_BACKUPS = 'false';

  var { resetCache } = require('../api/admin-guard');
  resetCache();

  var { startServer } = require('../server');
  var server = startServer(3098);
  await waitForServer();
  console.log('  [OK]   Server running on port 3098');

  var adminCookie = '';

  try {
    // ---- Phase 2: Verify guard BEFORE registration ----
    console.log('');
    console.log('  [PHASE 2] Guard behavior BEFORE registration...');

    var rootBefore = await api('/');
    check('Root redirects to /register',
      rootBefore.res.status === 302 || rootBefore.res.status === 307,
      'Status: ' + rootBefore.res.status
    );
    var location = rootBefore.res.headers.get('location') || '';
    check('Redirect target is /register',
      location === '/register' || location.endsWith('/register'),
      'Location: ' + location
    );

    var mainBefore = await api('/main');
    check('/main redirects to /register',
      mainBefore.res.status === 302 || mainBefore.res.status === 307,
      'Status: ' + mainBefore.res.status
    );

    var registerPage = await api('/register');
    check('/register page accessible',
      registerPage.res.status === 200,
      'Status: ' + registerPage.res.status
    );

    var healthPage = await api('/health');
    check('/health accessible (excluded path)',
      healthPage.res.status === 200,
      'Status: ' + healthPage.res.status
    );

    // ---- Phase 3: Register admin ----
    console.log('');
    console.log('  [PHASE 3] Registering admin...');
    var regRes = await api('/api/v2/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        displayName: 'Guard Test Admin',
        companyName: 'Guard Test Company',
        slug: COMPANY_SLUG
      })
    });

    check('Registration succeeds',
      regRes.res.status === 200 && regRes.json && regRes.json.success === true,
      'Status: ' + regRes.res.status
    );

    adminCookie = extractCookie(regRes.res.headers.get('set-cookie'));
    check('Session cookie set',
      adminCookie.length > 0,
      'Cookie: ' + adminCookie.substring(0, 30) + '...'
    );

    // ---- Phase 4: Verify admin_claimed in database ----
    console.log('');
    console.log('  [PHASE 4] Verifying admin_claimed persistence...');
    var { data: settingsData } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'admin_claimed')
      .maybeSingle();

    check('admin_claimed = true in database',
      settingsData && settingsData.value === 'true',
      'Value: ' + (settingsData ? settingsData.value : 'null')
    );

    var { data: company } = await supabase
      .from('companies')
      .select('id, name, slug')
      .eq('slug', COMPANY_SLUG)
      .maybeSingle();

    check('Company exists in database',
      company !== null && company.name === 'Guard Test Company',
      'Company: ' + (company ? company.name : 'null')
    );

    // ---- Phase 5: Verify guard AFTER registration ----
    console.log('');
    console.log('  [PHASE 5] Guard behavior AFTER registration...');

    // Clear the guard's cache to force re-read
    resetCache();
    await sleep(500);

    var rootAfter = await api('/');
    check('Root does NOT redirect after registration',
      rootAfter.res.status !== 302 && rootAfter.res.status !== 307,
      'Status: ' + rootAfter.res.status
    );

    var mainAfter = await api('/main');
    check('/main does NOT redirect after registration',
      mainAfter.res.status !== 302 && mainAfter.res.status !== 307,
      'Status: ' + mainAfter.res.status
    );

    // ---- Phase 6: Verify authenticated session works ----
    console.log('');
    console.log('  [PHASE 6] Authenticated session...');
    var sessionRes = await api('/api/v2/auth/session', {
      headers: { 'Cookie': adminCookie }
    });

    if (sessionRes.res.status === 200 && sessionRes.json) {
      check('Session returns user data',
        sessionRes.json.success === true && sessionRes.json.user !== undefined,
        'User email: ' + (sessionRes.json.user ? sessionRes.json.user.email : 'N/A')
      );
    } else {
      fail('Session endpoint', 'Status: ' + sessionRes.res.status);
    }

    // ---- Phase 7: Test registration on already-claimed system ----
    console.log('');
    console.log('  [PHASE 7] Second registration attempt (should be blocked)...');
    var secondRegRes = await api('/api/v2/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'second-' + TEST_EMAIL,
        password: TEST_PASSWORD,
        displayName: 'Second Admin',
        companyName: 'Second Company',
        slug: COMPANY_SLUG + '-2'
      })
    });

    // The guard allows registration page, but the API handler should block
    // a second admin registration due to the unique index
    check('Second registration blocked',
      secondRegRes.res.status !== 200 || (secondRegRes.json && secondRegRes.json.success === false),
      'Status: ' + secondRegRes.res.status + ' Success: ' + (secondRegRes.json ? secondRegRes.json.success : 'N/A')
    );

    console.log('');
    console.log('  ===== ALL ENHANCED TESTS COMPLETED =====');
    console.log('');

    if (process.exitCode) {
      console.log('  Some tests FAILED. Check [FAIL] markers above.');
    } else {
      console.log('  All tests PASSED. Registration guard is functioning correctly.');
    }
    console.log('');

  } catch (err) {
    console.error('');
    console.error('  TEST FAILED:', err.message);
    console.error('');
    process.exitCode = 1;
  } finally {
    await new Promise(function (r) { server.close(r); });
    console.log('  Server shut down.');
  }
}

run();

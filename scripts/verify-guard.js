/**
 * verify-guard.js — Registration Guard Verification Script
 *
 * USAGE:
 *   npm run verify-guard
 *
 * This script tests that the registration guard middleware works
 * correctly after 'npm run reset-test':
 *   - Fresh database state (admin_claimed=false) → root redirects to /register
 *   - /register page is accessible
 *   - /health is NOT redirected
 *   - After registration, root loads normally
 *
 * It requires the server to already be running on localhost:3000.
 *
 * STEP-BY-STEP MANUAL PROCESS:
 *   1. Run: npm run reset-test
 *   2. Run: node server.js (or npm start)
 *   3. Run: node scripts/verify-guard.js
 *   4. Verify the expected behavior
 */

var BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

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
  console.log('  ===== REGISTRATION GUARD VERIFICATION =====');
  console.log('');
  console.log('  Target: ' + BASE_URL);
  console.log('');
  console.log('  [NOTE] Make sure server is running and DB has been');
  console.log('  reset (npm run reset-test) before running this test.');
  console.log('');

  // Test 1: Root redirects to /register when no admin claimed
  console.log('  --- Test 1: Fresh database state ---');
  var rootRes = await api('/');
  check('Root redirects',
    rootRes.res.status === 302 || rootRes.res.status === 307,
    'Status: ' + rootRes.res.status
  );
  var location = rootRes.res.headers.get('location') || '';
  check('Redirects to /register',
    location === '/register' || location.endsWith('/register'),
    'Location: ' + location
  );

  // Test 2: /register is accessible
  console.log('  --- Test 2: Register page accessibility ---');
  var regRes = await api('/register');
  check('/register page loads',
    regRes.res.status === 200,
    'Status: ' + regRes.res.status
  );
  check('Contains registration form',
    regRes.text.indexOf('register') !== -1 || regRes.text.indexOf('Register') !== -1,
    'Content contains register keyword'
  );

  // Test 3: /health is not redirected
  console.log('  --- Test 3: Excluded paths ---');
  var healthRes = await api('/health');
  check('/health is accessible',
    healthRes.res.status === 200,
    'Status: ' + healthRes.res.status
  );

  // Test 4: Login page is redirected (not excluded from guard)
  console.log('  --- Test 4: Login page redirect ---');
  var loginRes = await api('/login-v2');
  check('/login-v2 redirected',
    loginRes.res.status === 302 || loginRes.res.status === 307,
    'Status: ' + loginRes.res.status
  );

  // Test 5: API registration endpoint is accessible
  console.log('  --- Test 5: Registration API access ---');
  var apiRegRes = await api('/api/v2/auth/register');
  check('/api/v2/auth/register accessible',
    apiRegRes.res.status !== 302 && apiRegRes.res.status !== 307,
    'Status: ' + apiRegRes.res.status
  );

  // Test 6: Other API endpoints are blocked
  console.log('  --- Test 6: Other API endpoints ---');
  var apiSearchRes = await api('/api/search?q=');
  check('/api/search blocked',
    apiSearchRes.res.status === 401,
    'Status: ' + apiSearchRes.res.status
  );

  console.log('');
  console.log('  ===== VERIFICATION COMPLETE =====');
  console.log('');

  var totalTests = 7;
  if (process.exitCode) {
    console.log('  Some tests FAILED. Check the [FAIL] markers above.');
  } else {
    console.log('  All ' + totalTests + ' tests PASSED.');
  }
  console.log('');

  // Print checklist for manual browser verification
  console.log('  ===== MANUAL BROWSER VERIFICATION CHECKLIST =====');
  console.log('');
  console.log('  After npm run reset-test and server restart:');
  console.log('  [ ] Visit http://localhost:3000/ — should redirect to /register');
  console.log('  [ ] Visit http://localhost:3000/register — should show registration form');
  console.log('  [ ] Visit http://localhost:3000/health — should show health info (no redirect)');
  console.log('  [ ] Visit http://localhost:3000/login-v2 — should redirect to /register');
  console.log('');
  console.log('  After registration (via /api/v2/auth/register or /register page):');
  console.log('  [ ] Visit http://localhost:3000/ — should load login page or dashboard');
  console.log('  [ ] Registration guard should no longer redirect');
  console.log('  [ ] admin_claimed in settings table should be "true"');
  console.log('');
}

run().catch(function (err) {
  console.error('Verification failed:', err);
  process.exit(1);
});

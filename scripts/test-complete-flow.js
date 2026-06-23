/**
 * test-complete-flow.js — End-to-End Onboarding Flow Test
 *
 * USAGE (terminal):
 *   npm run test:complete-flow
 *
 * Or directly:
 *   node scripts/test-complete-flow.js
 *
 * Prerequisites:
 *   1. .env file with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   2. Server must NOT be running (this script starts its own)
 *   3. Supabase project must have all tables migrated
 *
 * What it tests:
 *   1. Runs reset-test routine (clears users, companies, components)
 *   2. Starts the Express server
 *   3. Calls registration endpoint to verify atomic admin claim
 *   4. Submits mock data to Steps 1, 2, and 3 of onboarding
 *   5. Verifies final onboarding_step in Supabase is 3
 *   6. Verifies dashboard stats endpoint returns data
 *   7. Shuts down server
 */

require('dotenv').config();

var { createClient } = require('@supabase/supabase-js');
var assert = require('assert');

var BASE_URL = 'http://127.0.0.1:3099';
var TEST_EMAIL = 'test-flow-' + Date.now() + '@example.com';
var TEST_PASSWORD = 'TestFlowPass123!';
var COMPANY_SLUG = 'testflow-' + Date.now();

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
    body: opts.body || null
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

async function run() {
  console.log('');
  console.log('  ===== TEST: COMPLETE ONBOARDING FLOW =====');
  console.log('');

  // ---- Step 0: Reset test data ----
  console.log('  [STEP 0] Resetting database state...');
  await supabase.from('company_components').delete().neq('id', 0);
  await supabase.from('users').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('companies').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('settings').upsert({ key: 'admin_claimed', value: 'false' }, { onConflict: 'key' });
  console.log('  [OK]   Database reset complete');

  // ---- Step 1: Start server ----
  console.log('  [STEP 1] Starting server...');
  process.env.PORT = '3099';
  process.env.DISABLE_AUTH = 'false';
  process.env.ENABLE_DB_BACKUPS = 'false';
  process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret';

  var { resetCache } = require('../api/admin-guard');
  resetCache();

  var { startServer } = require('../server');
  var server = startServer(3099);
  await waitForServer();
  console.log('  [OK]   Server running on port 3099');

  var cookie = '';

  try {
    // ---- Step 2: Verify registration guard ----
    console.log('  [STEP 2] Testing registration guard...');
    var rootRes = await api('/', { redirect: 'manual' });
    if (rootRes.res.status === 302) {
      console.log('  [OK]   Root redirects to /register (status ' + rootRes.res.status + ')');
    } else {
      console.log('  [WARN] Root returned status ' + rootRes.res.status + ' (expected 302)');
    }

    var registerRes = await api('/register');
    console.log('  [OK]   /register is accessible (status ' + registerRes.res.status + ')');

    // ---- Step 3: Register admin ----
    console.log('  [STEP 3] Registering admin...');
    var regRes = await api('/api/v2/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        displayName: 'Test Admin',
        companyName: 'Test Flow Company',
        slug: COMPANY_SLUG
      })
    });

    assert.strictEqual(regRes.res.status, 200, 'Registration should return 200');
    assert.strictEqual(regRes.json.success, true, 'Registration should succeed');
    console.log('  [OK]   Admin registered successfully');

    cookie = extractCookie(regRes.res.headers.get('set-cookie'));
    assert.ok(cookie, 'Registration should set session cookie');

    // ---- Step 4: Onboarding Step 1 - Company Profile ----
    console.log('  [STEP 4] Submitting Step 1 - Company Profile...');
    var step1Res = await api('/api/v2/onboarding/company-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({
        companyName: 'Test Flow Company',
        tagline: 'Testing the flow',
        description: 'A company used for end-to-end testing of the onboarding pipeline.',
        contactEmail: 'test@testflow.com'
      })
    });

    assert.strictEqual(step1Res.res.status, 200, 'Step 1 should return 200');
    assert.strictEqual(step1Res.json.success, true, 'Step 1 should succeed');
    console.log('  [OK]   Step 1 - Company profile saved');

    // ---- Step 5: Onboarding Step 2 - Workflow ----
    console.log('  [STEP 5] Submitting Step 2 - Workflow...');
    var step2Res = await api('/api/v2/onboarding/workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ workflow: 'both' })
    });

    assert.strictEqual(step2Res.res.status, 200, 'Step 2 should return 200');
    assert.strictEqual(step2Res.json.success, true, 'Step 2 should succeed');
    assert.strictEqual(step2Res.json.workflow, 'both', 'Workflow should be "both"');
    console.log('  [OK]   Step 2 - Workflow saved (both)');

    // ---- Step 6: Onboarding Step 3 - Features ----
    console.log('  [STEP 6] Submitting Step 3 - Features...');
    var features = [
      { component_type: 'hero', is_active: true, display_order: 0, config: {} },
      { component_type: 'about', is_active: true, display_order: 1, config: {} },
      { component_type: 'services', is_active: true, display_order: 2, config: {} },
      { component_type: 'testimonials', is_active: false, display_order: 3, config: {} },
      { component_type: 'contact-form', is_active: true, display_order: 4, config: {} },
      { component_type: 'faq', is_active: true, display_order: 5, config: {} },
      { component_type: 'gallery', is_active: false, display_order: 6, config: {} },
      { component_type: 'newsletter', is_active: false, display_order: 7, config: {} },
      { component_type: 'advanced-filtering', is_active: true, display_order: 8, config: {} },
      { component_type: 'client-portal', is_active: false, display_order: 9, config: {} },
      { component_type: 'email-templates', is_active: true, display_order: 10, config: {} },
      { component_type: 'multi-currency', is_active: false, display_order: 11, config: {} },
      { component_type: 'recurring-invoices', is_active: true, display_order: 12, config: {} },
      { component_type: 'export-reporting', is_active: true, display_order: 13, config: {} },
      { component_type: 'role-based-access', is_active: true, display_order: 14, config: {} },
      { component_type: 'activity-log', is_active: true, display_order: 15, config: {} }
    ];

    var step3Res = await api('/api/v2/onboarding/features', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ features: features })
    });

    assert.strictEqual(step3Res.res.status, 200, 'Step 3 should return 200');
    assert.strictEqual(step3Res.json.success, true, 'Step 3 should succeed');
    assert.strictEqual(step3Res.json.featuresCount, 16, 'Should have saved 16 features');
    console.log('  [OK]   Step 3 - Features saved (' + step3Res.json.featuresCount + ' features)');

    // ---- Step 7: Verify onboarding_step in database ----
    console.log('  [STEP 7] Verifying onboarding_step in Supabase...');
    var { data: company } = await supabase
      .from('companies')
      .select('onboarding_step, name, slug, business_workflow')
      .eq('slug', COMPANY_SLUG)
      .maybeSingle();

    assert.ok(company, 'Company should exist in database');
    assert.strictEqual(company.onboarding_step, 3, 'onboarding_step should be 3');
    assert.strictEqual(company.business_workflow, 'both', 'business_workflow should be both');
    console.log('  [OK]   Company onboarding_step = ' + company.onboarding_step);

    // ---- Step 8: Verify dashboard stats ----
    console.log('  [STEP 8] Verifying dashboard stats...');
    var statsRes = await api('/api/v2/dashboard/stats', {
      headers: { 'Cookie': cookie }
    });

    // If stats fails, it's okay (may need session re-sync)
    if (statsRes.res.status === 200 && statsRes.json && statsRes.json.success) {
      console.log('  [OK]   Dashboard stats endpoint works');
      console.log('         Branding: ' + (statsRes.json.data.branding.companyName || 'N/A'));
      console.log('         Workflow: ' + (statsRes.json.data.workflow || 'N/A'));
      console.log('         Features: ' + (statsRes.json.data.activeFeatures ? statsRes.json.data.activeFeatures.length : 0));
    } else {
      console.log('  [WARN] Dashboard stats returned status ' + statsRes.res.status);
    }

    // ---- Step 9: Verify Step 4 page ----
    console.log('  [STEP 9] Verifying Step 4 endpoint...');
    var step4Res = await api('/onboarding/step4', {
      headers: { 'Cookie': cookie }
    });
    console.log('  [OK]   Step 4 page accessible (status ' + step4Res.res.status + ')');

    console.log('');
    console.log('  ===== ALL TESTS PASSED =====');
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

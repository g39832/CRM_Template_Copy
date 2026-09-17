/**
 * test-rbac.js — Role-based access control verification
 *
 * Verifies (Section 3/8/11 of the CRM improvements spec):
 *   - Admin can see all clients; regular users see only their own.
 *   - A regular user cannot fetch another user's client by direct ID.
 *   - Financial fields (total_due, amount_paid, balance, job_cost) are
 *     never present in API responses served to a regular user.
 *   - A regular user cannot submit a payment / edit financial fields.
 *   - A regular user is blocked from the Financial Overview / export /
 *     margin-tracker endpoints.
 *   - Admin retains full access to all of the above.
 *
 * This drives the server exactly like a real client would (HTTP +
 * cookies) using the test-only /api/v2/auth/test-login route, which
 * only exists when NODE_ENV=test.
 *
 * USAGE:
 *   npm run test:rbac
 *
 * Requires network access to the configured Supabase project.
 */
const assert = require('assert');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3097';

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return '';
  return setCookieHeader.split(';')[0];
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/health`, { redirect: 'manual' });
      if (res.status >= 200 && res.status < 500) return;
    } catch (_) {}
    await sleep(300);
  }
  throw new Error('Server did not start in time');
}

async function req(pathname, { method = 'GET', body = null, cookie = '' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { res, json };
}

async function loginAs(email, role, displayName) {
  const { res, json } = await req('/api/v2/auth/test-login', {
    method: 'POST',
    body: { email, role, displayName }
  });
  assert.strictEqual(res.status, 200, `test-login for ${email} should succeed: ${JSON.stringify(json)}`);
  const cookie = extractCookie(res.headers.get('set-cookie'));
  assert.ok(cookie, `test-login for ${email} should set a session cookie`);
  return { cookie, user: json.user };
}

async function main() {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3097';
  const { startServer } = require('../server');
  const server = startServer(3097);

  let passed = 0;
  function ok(label) { passed++; console.log('  [PASS] ' + label); }

  try {
    await waitForServer();

    // ---- Set up an admin and two regular users ----
    const admin = await loginAs('rbac-admin@example.com', 'admin', 'RBAC Admin');
    ok('Admin can create a session via test-login');

    const userA = await loginAs('rbac-user-a@example.com', 'user', 'RBAC User A');
    const userB = await loginAs('rbac-user-b@example.com', 'user', 'RBAC User B');
    ok('Two regular users can create sessions');

    // ---- Admin creates two clients and assigns one to each user ----
    const createA = await req('/api/save-client', {
      method: 'POST',
      cookie: admin.cookie,
      body: { name: 'RBAC Client A', status: 'Lead', total_due: 5000 }
    });
    assert.strictEqual(createA.res.status, 200, 'admin should create client A');

    const createB = await req('/api/save-client', {
      method: 'POST',
      cookie: admin.cookie,
      body: { name: 'RBAC Client B', status: 'Lead', total_due: 7000 }
    });
    assert.strictEqual(createB.res.status, 200, 'admin should create client B');

    const adminSearch = await req('/api/search?q=RBAC', { cookie: admin.cookie });
    assert.strictEqual(adminSearch.res.status, 200);
    const clientA = adminSearch.json.find((c) => c.name === 'RBAC Client A');
    const clientB = adminSearch.json.find((c) => c.name === 'RBAC Client B');
    assert.ok(clientA && clientB, 'admin search should find both new clients');
    assert.ok('total_due' in clientA, 'admin responses should include financial fields');
    ok('Admin sees all clients, including financial fields');

    const assignA = await req(`/api/clients/${clientA.id}/assign`, {
      method: 'PUT',
      cookie: admin.cookie,
      body: { assigned_user_id: userA.user.id }
    });
    assert.strictEqual(assignA.res.status, 200, 'admin should be able to assign client A to user A');

    const assignB = await req(`/api/clients/${clientB.id}/assign`, {
      method: 'PUT',
      cookie: admin.cookie,
      body: { assigned_user_id: userB.user.id }
    });
    assert.strictEqual(assignB.res.status, 200, 'admin should be able to assign client B to user B');
    ok('Admin can assign clients to specific users');

    // A non-admin trying to assign a client should be rejected.
    const userAssignAttempt = await req(`/api/clients/${clientB.id}/assign`, {
      method: 'PUT',
      cookie: userA.cookie,
      body: { assigned_user_id: userA.user.id }
    });
    assert.strictEqual(userAssignAttempt.res.status, 403, 'regular user should not be able to reassign clients');
    ok('Regular user cannot reassign clients (403)');

    // ---- Regular user visibility ----
    const userASearch = await req('/api/search?q=RBAC', { cookie: userA.cookie });
    assert.strictEqual(userASearch.res.status, 200);
    const namesForA = userASearch.json.map((c) => c.name);
    assert.ok(namesForA.includes('RBAC Client A'), 'user A should see their own assigned client');
    assert.ok(!namesForA.includes('RBAC Client B'), 'user A should NOT see client B');
    ok('Regular user only sees their own assigned client(s) in /api/search');

    // ---- Direct-ID access to someone else's client must be blocked ----
    const userACannotSeeB = await req(`/api/clients/${clientB.id}/notes`, { cookie: userA.cookie });
    assert.strictEqual(userACannotSeeB.res.status, 403, 'user A must not access client B by direct ID');
    ok('Regular user cannot access another user\'s client via direct ID (403)');

    // ---- Financial fields must never be sent to a regular user ----
    const ownClient = userASearch.json.find((c) => c.name === 'RBAC Client A');
    for (const field of ['total_due', 'amount_paid', 'balance', 'job_cost']) {
      assert.ok(!(field in ownClient), `regular user response must not include ${field}`);
    }
    ok('Financial fields are absent from regular-user API responses');

    // ---- Regular user cannot enter a payment or edit financial fields ----
    const userPaymentAttempt = await req(`/api/clients/${clientA.id}/payment`, {
      method: 'PUT',
      cookie: userA.cookie,
      body: { payment: 500 }
    });
    assert.strictEqual(userPaymentAttempt.res.status, 403, 'regular user must not be able to record a payment');
    ok('Regular user cannot submit a payment (403)');

    // ---- Regular user cannot reach Financial Overview / exports / margin ----
    const financeAttempt = await req('/api/finance/summary', { cookie: userA.cookie });
    assert.strictEqual(financeAttempt.res.status, 403, 'regular user must not reach Financial Overview');
    ok('Regular user is blocked from /api/finance/summary (403)');

    const exportAttempt = await req('/api/v2/export/clients', { cookie: userA.cookie });
    assert.strictEqual(exportAttempt.res.status, 403, 'regular user must not reach CSV export');
    ok('Regular user is blocked from /api/v2/export/clients (403)');

    const marginAttempt = await req('/api/finance/margin/dashboard', { cookie: userA.cookie });
    assert.strictEqual(marginAttempt.res.status, 403, 'regular user must not reach margin tracker');
    ok('Regular user is blocked from the margin tracker (403)');

    // ---- Admin retains full access ----
    const adminFinance = await req('/api/finance/summary', { cookie: admin.cookie });
    assert.strictEqual(adminFinance.res.status, 200, 'admin should be able to view Financial Overview');
    ok('Admin can view Financial Overview');

    const adminPayment = await req(`/api/clients/${clientA.id}/payment`, {
      method: 'PUT',
      cookie: admin.cookie,
      body: { payment: 250 }
    });
    assert.strictEqual(adminPayment.res.status, 200, 'admin should be able to record a payment');
    ok('Admin can record a payment');

    // ---- Cleanup ----
    await req('/api/delete-client', { method: 'POST', cookie: admin.cookie, body: { id: clientA.id } });
    await req('/api/delete-client', { method: 'POST', cookie: admin.cookie, body: { id: clientB.id } });

    console.log('');
    console.log(`RBAC test passed (${passed} checks).`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error('RBAC test failed:', err);
  process.exit(1);
});

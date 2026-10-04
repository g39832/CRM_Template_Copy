// Security tests: invitation-only Google sign-in, removing users, admin-only
// settings, the public health check, file access and security headers.
// Runs against the in-memory Supabase stand-in (never the real project).
//
//   node --test tests/api/security.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { APP_ENV, assertLocalOnly, prepareUploads } = require('../local-env');

const MOCK_PORT = 54349;
const APP_PORT = 3243;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;
const UPLOAD_ROOT = path.join(os.tmpdir(), 'crm-security-test-uploads');
const ROOT = path.join(__dirname, '..', '..');
const BOOTSTRAP_ADMINS = 'first.admin@example.com, second.admin@example.com';

const children = [];
let app;

async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Timed out waiting for ' + url);
}

function start(args, env) {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'inherit'] });
  children.push(child);
  return child;
}

async function startApp() {
  const env = {
    ...APP_ENV,
    PORT: String(APP_PORT),
    SUPABASE_URL: MOCK,
    LOCAL_UPLOAD_ROOT: UPLOAD_ROOT,
    ADMIN_EMAILS: BOOTSTRAP_ADMINS
  };
  assertLocalOnly(env);
  const child = start(['server.js'], env);
  await waitFor(`${APP}/login.html`);
  return child;
}

// The sign-in endpoints are rate limited per app process (20 / 15 min), so
// tests that sign in a lot restart the app first.
async function restartApp() {
  if (app) {
    app.kill();
    await new Promise((r) => app.once('exit', r));
  }
  app = await startApp();
}

async function resetDb() {
  await fetch(`${MOCK}/__reset`, { method: 'POST' });
  await fetch(`${MOCK}/__migrate`, { method: 'POST', body: JSON.stringify({ on: true }) });
  prepareUploads(UPLOAD_ROOT);
}

async function dump() {
  return (await fetch(`${MOCK}/__dump`)).json();
}

function caller(cookie) {
  return async function call(method, url, body) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(APP + url, {
      method,
      redirect: 'manual',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const type = r.headers.get('content-type') || '';
    const data = type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
  };
}

const anonymous = caller(null);

// Real sign-in path: the browser hands the server a Supabase access token.
// The mock's /auth/v1/user accepts "google:<email>" / "password:<email>".
async function googleSignIn(email, provider = 'google') {
  const r = await fetch(`${APP}/api/v2/auth/google-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: `${provider}:${email}` })
  });
  const data = await r.json();
  const setCookie = r.headers.get('set-cookie');
  const cookie = setCookie ? setCookie.split(';')[0] : null;
  return { status: r.status, data, call: caller(cookie) };
}

async function testLogin(email, role) {
  const r = await fetch(`${APP}/api/v2/auth/test-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role })
  });
  assert.equal(r.status, 200, 'test login');
  return caller(r.headers.get('set-cookie').split(';')[0]);
}

test.before(async () => {
  start(['tests/mock-supabase/server.js', String(MOCK_PORT)], {});
  await waitFor(`${MOCK}/__dump`);
  await resetDb();
  await restartApp();
});

test.after(() => {
  for (const child of children) child.kill();
});

test.beforeEach(async () => {
  await resetDb();
});

// ---------------------------------------------------------------------------
// 1. Invitation-only sign-in
// ---------------------------------------------------------------------------
test('a Google account that was never invited is refused, gets no session, and no user is created', async () => {
  await restartApp();
  const before = (await dump()).tables.users.length;
  const stranger = await googleSignIn('stranger@gmail.com');
  assert.equal(stranger.status, 403);
  assert.match(stranger.data.error, /does not have access/);
  assert.equal((await dump()).tables.users.length, before, 'no user row created');
  assert.equal((await stranger.call('GET', '/api/search?q=')).status, 401, 'no API access');
  assert.equal((await stranger.call('GET', '/main')).status, 302, 'no page access');
});

test('a bad token, and an email/password identity using an invited address, are both refused', async () => {
  const bad = await fetch(`${APP}/api/v2/auth/google-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: 'not-a-real-token' })
  });
  assert.equal(bad.status, 401);
  const impostor = await googleSignIn('owner@example.com', 'password');
  assert.equal(impostor.status, 403, 'only Google-verified identities can be linked');
});

test('existing (invited) users still sign in; their Google identity is linked; the role comes from the CRM', async () => {
  await restartApp();
  const sam = await googleSignIn('sam@example.com');
  assert.equal(sam.status, 200);
  assert.equal(sam.data.user.role, 'user');
  const row = (await dump()).tables.users.find((u) => u.email === 'sam@example.com');
  assert.ok(row.auth_uid, 'auth_uid linked on first Google sign-in');
  const { status, data } = await sam.call('GET', '/api/search?q=');
  assert.equal(status, 200);
  assert.deepEqual(data.map((c) => c.name).sort(), ['Alice Legacy', 'Bob Both', 'Eve Closed']);

  // Returning user is matched by Google identity.
  const again = await googleSignIn('sam@example.com');
  assert.equal(again.status, 200);

  const owner = await googleSignIn('owner@example.com');
  assert.equal(owner.status, 200);
  assert.equal(owner.data.user.role, 'admin');
});

test('an admin invites a new person by email (no password needed); matching is case-insensitive', async () => {
  await restartApp();
  const owner = await googleSignIn('owner@example.com');
  const invite = await owner.call('POST', '/api/v2/admin/users', { email: 'New.Person@Example.com', role: 'user' });
  assert.equal(invite.status, 200, JSON.stringify(invite.data));
  assert.equal(invite.data.data.email, 'new.person@example.com');

  const newbie = await googleSignIn('new.person@example.com');
  assert.equal(newbie.status, 200);
  assert.equal(newbie.data.user.role, 'user');

  const notInvited = await owner.call('POST', '/api/v2/admin/users', { email: 'not-an-email', role: 'user' });
  assert.equal(notInvited.status, 400);
});

test('only admins can manage users', async () => {
  const sam = await testLogin('sam@example.com', 'user');
  assert.equal((await sam('GET', '/api/v2/admin/users')).status, 403);
  assert.equal((await sam('POST', '/api/v2/admin/users', { email: 'x@example.com' })).status, 403);
  assert.equal((await anonymous('GET', '/api/v2/admin/users')).status, 401);
});

// ---------------------------------------------------------------------------
// 2. Removing / demoting users
// ---------------------------------------------------------------------------
test('removing a user ends their open session and they cannot sign back in', async () => {
  await restartApp();
  const owner = await googleSignIn('owner@example.com');
  const riley = await googleSignIn('riley@example.com');
  assert.equal(riley.status, 200);
  assert.equal((await riley.call('GET', '/api/search?q=')).status, 200);

  const rileyId = (await dump()).tables.users.find((u) => u.email === 'riley@example.com').id;
  const removed = await owner.call('DELETE', `/api/v2/admin/users/${rileyId}`);
  assert.equal(removed.status, 200, 'delete by uuid works: ' + JSON.stringify(removed.data));
  assert.equal((await dump()).tables.users.some((u) => u.email === 'riley@example.com'), false);

  assert.equal((await riley.call('GET', '/api/search?q=')).status, 401, 'open session signed out');
  assert.equal((await riley.call('GET', '/main')).status, 302);
  const back = await googleSignIn('riley@example.com');
  assert.equal(back.status, 403, 'a removed user cannot recreate access');
});

test('a role change applies to an open session without signing out', async () => {
  await restartApp();
  const owner = await googleSignIn('owner@example.com');
  const riley = await googleSignIn('riley@example.com');
  const rileyId = (await dump()).tables.users.find((u) => u.email === 'riley@example.com').id;

  assert.equal((await owner.call('PUT', `/api/v2/admin/users/${rileyId}`, { role: 'admin' })).status, 200);
  assert.equal((await riley.call('GET', '/api/v2/admin/users')).status, 200, 'promotion applies');
  assert.equal((await owner.call('PUT', `/api/v2/admin/users/${rileyId}`, { role: 'user' })).status, 200);
  assert.equal((await riley.call('GET', '/api/v2/admin/users')).status, 403, 'demotion applies');
});

test('the last admin cannot be removed', async () => {
  const owner = await testLogin('owner@example.com', 'admin');
  const ownerId = (await dump()).tables.users.find((u) => u.email === 'owner@example.com').id;
  assert.equal((await owner('DELETE', `/api/v2/admin/users/${ownerId}`)).status, 400);
});

// ---------------------------------------------------------------------------
// 3. A brand-new deployment: the first admin comes only from ADMIN_EMAILS
// ---------------------------------------------------------------------------
test('new deployment: a random first sign-in does NOT become admin; only an ADMIN_EMAILS address can, and only once', async () => {
  await restartApp();
  // Empty the users table to simulate a fresh install.
  const users = (await dump()).tables.users;
  for (const u of users) {
    await fetch(`${MOCK}/rest/v1/users?id=eq.${u.id}`, { method: 'DELETE' });
  }
  assert.equal((await dump()).tables.users.length, 0);

  const first = await googleSignIn('random.person@gmail.com');
  assert.equal(first.status, 403, 'first random Google account is refused');
  assert.equal((await dump()).tables.users.length, 0);

  const admin = await googleSignIn('first.admin@example.com');
  assert.equal(admin.status, 200);
  assert.equal(admin.data.user.role, 'admin');

  const second = await googleSignIn('second.admin@example.com');
  assert.equal(second.status, 403, 'ADMIN_EMAILS only bootstraps while there is no admin');
});

// ---------------------------------------------------------------------------
// 4. Admin-only company settings
// ---------------------------------------------------------------------------
test('email (SMTP) settings: only admins can read or change them', async () => {
  const sam = await testLogin('sam@example.com', 'user');
  const owner = await testLogin('owner@example.com', 'admin');
  const smtp = { provider: 'custom', smtpHost: 'smtp.evil.example', smtpUser: 'attacker@evil.example', smtpPassword: 'pw123456', replyToEmail: 'attacker@evil.example' };

  assert.equal((await anonymous('POST', '/api/email-settings', smtp)).status, 401);
  assert.equal((await sam('GET', '/api/email-settings')).status, 403);
  assert.equal((await sam('POST', '/api/email-settings', smtp)).status, 403);
  const stored = (await dump()).tables.settings.find((s) => s.key === 'email_delivery_config');
  assert.ok(!stored || !String(stored.value).includes('evil.example'), 'regular user changed nothing');

  const ok = await owner('POST', '/api/email-settings', { ...smtp, smtpHost: 'smtp.company.example', smtpUser: 'office@company.example', replyToEmail: 'office@company.example' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.settings.smtpHost, 'smtp.company.example');
  assert.equal(ok.data.settings.smtpPassword, undefined, 'password never returned');
  assert.equal((await owner('GET', '/api/email-settings')).status, 200);
});

test('company profile: everyone signed in can read it, only admins can change it', async () => {
  const sam = await testLogin('sam@example.com', 'user');
  const owner = await testLogin('owner@example.com', 'admin');

  assert.equal((await anonymous('GET', '/api/company-profile')).status, 401);
  assert.equal((await sam('GET', '/api/company-profile')).status, 200);
  const hijack = await sam('POST', '/api/company-profile', { businessName: 'Scam Co', businessPhone: '555-6666' });
  assert.equal(hijack.status, 403);
  const after = await owner('GET', '/api/company-profile');
  assert.notEqual(after.data.settings.businessName, 'Scam Co');

  const ok = await owner('POST', '/api/company-profile', { businessName: 'Real Roofing', businessPhone: '555-0000' });
  assert.equal(ok.status, 200);
  assert.equal((await sam('GET', '/api/company-profile')).data.settings.businessName, 'Real Roofing');
});

test('branding/settings updates are admin-only', async () => {
  const sam = await testLogin('sam@example.com', 'user');
  assert.equal((await sam('GET', '/api/v2/admin/settings')).status, 403);
  assert.equal((await anonymous('GET', '/api/v2/branding/logo')).status, 401);
});

// ---------------------------------------------------------------------------
// 5. Health check
// ---------------------------------------------------------------------------
test('/health says only {"status":"ok"}; the database check is admin-only and has no business figures', async () => {
  const health = await anonymous('GET', '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.data, { status: 'ok' });

  assert.equal((await anonymous('GET', '/api/v2/admin/system-health')).status, 401);
  const sam = await testLogin('sam@example.com', 'user');
  assert.equal((await sam('GET', '/api/v2/admin/system-health')).status, 403);
  const owner = await testLogin('owner@example.com', 'admin');
  const sys = await owner('GET', '/api/v2/admin/system-health');
  assert.equal(sys.status, 200);
  assert.equal(sys.data.database, 'ok');
  assert.equal(JSON.stringify(sys.data).match(/client|payment|received|metrics/i), null);
});

// ---------------------------------------------------------------------------
// 6. Files
// ---------------------------------------------------------------------------
test('job files: no session -> 401, a user without access -> 403, the assigned user and admin -> the file', async () => {
  const url = '/api/job-files/1/1/download'; // job 1 belongs to Bob Both (Sam's client)
  assert.equal((await anonymous('GET', url)).status, 401);
  const riley = await testLogin('riley@example.com', 'user');
  assert.equal((await riley('GET', url)).status, 403);
  assert.equal((await riley('GET', '/api/job-files/1')).status, 403);
  const sam = await testLogin('sam@example.com', 'user');
  const mine = await sam('GET', url);
  assert.equal(mine.status, 200);
  assert.ok(mine.data.length > 0);
  const owner = await testLogin('owner@example.com', 'admin');
  assert.equal((await owner('GET', url)).status, 200);
});

test('legacy client files (/api/pdf) apply the same access rules', async () => {
  const url = '/api/pdf/file/1?name=1690000000000-signed-estimate.pdf'; // client 1 = Sam's
  assert.equal((await anonymous('GET', url)).status, 401);
  const riley = await testLogin('riley@example.com', 'user');
  assert.equal((await riley('GET', url)).status, 403);
  assert.equal((await riley('GET', '/api/pdf/list/1')).status, 403);
  assert.equal((await riley('GET', '/api/pdf/list/margin-2024')).status, 403, 'finance files are admin-only');
  const sam = await testLogin('sam@example.com', 'user');
  assert.equal((await sam('GET', url)).status, 200);
});

test('regular users can still upload to their own jobs; uploads to others are refused', async () => {
  async function cookieFor(email) {
    const r = await fetch(`${APP}/api/v2/auth/test-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role: 'user' }) });
    return r.headers.get('set-cookie').split(';')[0];
  }
  async function upload(cookie, jobId) {
    const form = new FormData();
    form.append('category', 'document');
    form.append('files', new Blob([Buffer.from('%PDF-1.4 %%EOF')], { type: 'application/pdf' }), 'note.pdf');
    const r = await fetch(`${APP}/api/job-files/${jobId}/upload`, { method: 'POST', headers: cookie ? { cookie } : {}, body: form });
    return r.status;
  }
  assert.equal(await upload(null, 1), 401);
  assert.equal(await upload(await cookieFor('sam@example.com'), 1), 200);
  assert.equal(await upload(await cookieFor('riley@example.com'), 1), 403);
});

// ---------------------------------------------------------------------------
// 7. Pages: headers, CSP nonce, no secrets in the browser, safe user data
// ---------------------------------------------------------------------------
test('pages send security headers and every <script> carries this response\'s CSP nonce', async () => {
  const owner = await testLogin('owner@example.com', 'admin');
  for (const [call, url] of [[anonymous, '/'], [anonymous, '/auth/callback'], [owner, '/main'], [owner, '/finance'], [owner, '/settings'], [owner, '/calendar']]) {
    const r = await call('GET', url);
    assert.equal(r.status, 200, url);
    const csp = r.headers.get('content-security-policy') || '';
    const nonce = (csp.match(/'nonce-([^']+)'/) || [])[1];
    assert.ok(nonce, `${url}: CSP has a nonce`);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, 'no unsafe-inline scripts');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(r.headers.get('referrer-policy'));
    const html = r.data.toString('utf8');
    const scripts = html.match(/<script\b[^>]*>/gi) || [];
    assert.ok(scripts.length > 0);
    for (const tag of scripts) assert.ok(tag.includes(`nonce="${nonce}"`), `${url}: ${tag}`);
  }
});

test('the browser never receives the server key, and a hostile display name cannot break out of the page script', async () => {
  const login = await anonymous('GET', '/');
  assert.ok(!login.data.toString('utf8').includes(APP_ENV.SUPABASE_SERVICE_ROLE_KEY));

  const sam = await testLogin('sam@example.com', 'user');
  const evil = '</script><script>alert(1)</script>';
  assert.equal((await sam('PATCH', '/api/v2/auth/me', { displayName: evil })).status, 200);
  const page = (await sam('GET', '/main')).data.toString('utf8');
  assert.ok(!page.includes(evil), 'raw markup not echoed into the page');
  assert.ok(page.includes('\\u003c/script\\u003e'), 'escaped inside the JSON');
  const cfg = (await sam('GET', '/api/supabase-config')).data;
  assert.ok(!JSON.stringify(cfg).includes(APP_ENV.SUPABASE_SERVICE_ROLE_KEY));
});

test('stray .html files and server files are not served', async () => {
  assert.equal((await anonymous('GET', '/index.html')).status, 302);
  assert.equal((await anonymous('GET', '/nope.html')).status, 404);
  for (const p of ['/.env', '/server.js', '/supabase-schema.sql', '/scripts/verify-security.js', '/api/db.js']) {
    assert.ok([401, 404].includes((await anonymous('GET', p)).status), p);
  }
});

test('Sign Out without a request body really signs out', async () => {
  const r = await fetch(`${APP}/api/v2/auth/test-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sam@example.com', role: 'user' }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const sam = caller(cookie);
  assert.equal((await sam('GET', '/api/search?q=')).status, 200);
  const out = await fetch(`${APP}/api/v2/auth/logout`, { method: 'POST', headers: { cookie } });
  assert.equal(out.status, 200);
  assert.equal((await sam('GET', '/api/search?q=')).status, 401);
});

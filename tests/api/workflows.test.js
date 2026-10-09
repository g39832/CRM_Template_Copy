// API tests for the client overview / + Job redesign, run against the
// in-memory Supabase stand-in (never the real project in .env).
//
//   npm run test:local:api        (node --test tests/api/)
//
// Starts its own mock database and app on separate ports, so it can run
// alongside a local dev server.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { APP_ENV, assertLocalOnly, prepareUploads } = require('../local-env');

const MOCK_PORT = 54339;
const APP_PORT = 3233;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;
const UPLOAD_ROOT = path.join(os.tmpdir(), 'crm-api-test-uploads');
const ROOT = path.join(__dirname, '..', '..');
const YEAR = new Date().getFullYear();

const children = [];

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

async function resetDb({ migrated = false } = {}) {
  await fetch(`${MOCK}/__reset`, { method: 'POST' });
  await fetch(`${MOCK}/__migrate`, { method: 'POST', body: JSON.stringify({ on: migrated }) });
  prepareUploads(UPLOAD_ROOT);
}

async function dump() {
  return (await fetch(`${MOCK}/__dump`)).json();
}

// One session per role per app process. The test-only sign-in helper is not
// rate limited under NODE_ENV=test; caching just avoids redundant logins.
const sessionCookies = new Map();

async function login(email, role) {
  const key = email + '|' + role;
  if (sessionCookies.has(key)) return makeCaller(sessionCookies.get(key));
  const res = await fetch(`${APP}/api/v2/auth/test-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role })
  });
  assert.equal(res.status, 200, 'test login');
  const cookie = res.headers.get('set-cookie').split(';')[0];
  sessionCookies.set(key, cookie);
  return makeCaller(cookie);
}

function makeCaller(cookie) {
  return async function call(method, url, body) {
    const r = await fetch(APP + url, {
      method,
      redirect: 'manual',
      headers: { cookie, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const type = r.headers.get('content-type') || '';
    const data = type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
  };
}

// Server-side schema checks are cached for a minute, so each migration state
// gets its own app process.
async function startApp() {
  const env = { ...APP_ENV, PORT: String(APP_PORT), SUPABASE_URL: MOCK, LOCAL_UPLOAD_ROOT: UPLOAD_ROOT };
  assertLocalOnly(env);
  sessionCookies.clear();
  const app = start(['server.js'], env);
  await waitFor(`${APP}/login.html`);
  return app;
}

async function stopApp(app) {
  app.kill();
  await new Promise((r) => app.once('exit', r));
}

let app;

test.before(async () => {
  start(['tests/mock-supabase/server.js', String(MOCK_PORT)], {});
  await waitFor(`${MOCK}/__dump`);
  await resetDb();
  app = await startApp();
});

test.after(() => {
  for (const child of children) child.kill();
});

test.beforeEach(async () => {
  await resetDb();
});

// ---------------------------------------------------------------------------
test('client list carries salesperson and technician; regular users see only their clients, without client-level money', async () => {
  const admin = await login('owner@example.com', 'admin');
  const { data: all } = await admin('GET', '/api/search?q=');
  assert.equal(all.length, 5);
  const bob = all.find((c) => c.name === 'Bob Both');
  assert.equal(bob.assigned_user_name, 'Sam Sales');
  assert.equal(bob.technician, '');
  assert.equal(bob.total_due, 1200, 'admin sees client-level money');

  const sam = await login('sam@example.com', 'user');
  const { data: mine } = await sam('GET', '/api/search?q=');
  assert.deepEqual(mine.map((c) => c.name).sort(), ['Alice Legacy', 'Bob Both', 'Eve Closed']);
  for (const c of mine) {
    assert.equal(c.total_due, undefined, 'client-level money stays hidden from regular users');
    assert.equal(c.job_cost, undefined);
    assert.equal(c.assigned_user_name, 'Sam Sales');
  }
});

test('saving the client page changes only the fields it sends (cost, scope and totals are kept)', async () => {
  const admin = await login('owner@example.com', 'admin');
  const before = (await dump()).tables.clients.find((c) => c.id === 1);
  const res = await admin('POST', '/api/update-project', { id: 1, phone: '555-9999', name: 'Alice Legacy' });
  assert.equal(res.status, 200);
  const after = (await dump()).tables.clients.find((c) => c.id === 1);
  assert.equal(after.phone, '555-9999');
  assert.equal(after.job_cost, before.job_cost, 'job cost untouched');
  assert.equal(after.scope_of_work, before.scope_of_work, 'scope untouched');
  assert.equal(after.total_due, before.total_due);
  assert.equal(after.amount_paid, before.amount_paid);
  assert.equal(after.email, before.email);
  assert.equal(after.address, before.address);
  assert.equal(after.status, before.status);
});

test('technician works before the migration (settings fallback) and after it (column), without losing values', async () => {
  const admin = await login('owner@example.com', 'admin');
  let res = await admin('POST', '/api/update-project', { id: 2, technician: 'Tom Tech' });
  assert.equal(res.status, 200);
  let db = await dump();
  assert.equal(db.tables.settings.find((s) => s.key === 'client_technician:2').value, 'Tom Tech');
  let { data } = await admin('GET', '/api/search?q=');
  assert.equal(data.find((c) => c.id === 2).technician, 'Tom Tech');

  // A regular user assigned to the client may set it too (not financial).
  const sam = await login('sam@example.com', 'user');
  res = await sam('POST', '/api/update-project', { id: 1, technician: 'Pat Roofer' });
  assert.equal(res.status, 200);
  // ...but not on someone else's client.
  res = await sam('POST', '/api/update-project', { id: 3, technician: 'Nope' });
  assert.equal(res.status, 403);

  // Run the migration: the old value is still read until overwritten.
  await fetch(`${MOCK}/__migrate`, { method: 'POST', body: JSON.stringify({ on: true }) });
  await stopApp(app);
  app = await startApp();
  const admin2 = await login('owner@example.com', 'admin');
  ({ data } = await admin2('GET', '/api/search?q='));
  assert.equal(data.find((c) => c.id === 2).technician, 'Tom Tech', 'pre-migration value still shown');
  res = await admin2('POST', '/api/update-project', { id: 2, technician: 'Jo Tech' });
  assert.equal(res.status, 200);
  db = await dump();
  assert.equal(db.tables.clients.find((c) => c.id === 2).technician, 'Jo Tech', 'stored in the new column');
  assert.equal(db.tables.settings.find((s) => s.key === 'client_technician:2'), undefined, 'old fallback copy cleared');
  ({ data } = await admin2('GET', '/api/search?q='));
  assert.equal(data.find((c) => c.id === 2).technician, 'Jo Tech');

  await fetch(`${MOCK}/__migrate`, { method: 'POST', body: JSON.stringify({ on: false }) });
  await stopApp(app);
  app = await startApp();
});

test('client notes list excludes job notes; job notes stay on their job', async () => {
  const admin = await login('owner@example.com', 'admin');
  const client = await admin('GET', '/api/notes/list/2');
  assert.deepEqual(client.data.notes.map((n) => n.content), ['Gate code 1234']);
  const job = await admin('GET', '/api/notes/job/1');
  assert.deepEqual(job.data.notes.map((n) => n.content), ['Dumpster arrives Monday']);
});

test('notes get a server-side creation time that editing and reloading keep', async () => {
  const admin = await login('owner@example.com', 'admin');

  // A new client note is timestamped by the server, not by the browser.
  const created = await admin('POST', '/api/notes/add/2', { note: 'Follow up Friday' });
  assert.equal(created.status, 200);
  const note = created.data.note;
  assert.ok(note.created_at, 'the new note has a created_at');
  const t1 = new Date(note.created_at).getTime();
  assert.ok(Number.isFinite(t1), 'created_at is a real timestamp');
  assert.ok(Math.abs(Date.now() - t1) < 60_000, 'created_at is server-now, not an invented date');

  // A client cannot backdate a note by sending its own created_at.
  const forged = await admin('POST', '/api/notes/add/2', { note: 'Backdated', created_at: '2001-01-01T00:00:00.000Z' });
  assert.ok(new Date(forged.data.note.created_at).getTime() > Date.now() - 60_000, 'a supplied created_at is ignored');

  // Editing the note must not reset its original creation time.
  const edited = await admin('PUT', `/api/notes/update/2/${note.id}`, { note: 'Follow up Monday' });
  assert.equal(edited.data.note.content, 'Follow up Monday');
  assert.equal(edited.data.note.created_at, note.created_at, 'an edit keeps the original creation time');

  // Re-reading the list returns the same, stable timestamp.
  const list = await admin('GET', '/api/notes/list/2');
  const again = list.data.notes.find((n) => n.id === note.id);
  assert.ok(again, 'the note is still listed');
  assert.equal(again.created_at, note.created_at, 'a reload returns the same creation time');

  // Job notes behave the same way.
  const jobNote = await admin('POST', '/api/notes/job/1', { note: 'Job note with a time' });
  assert.ok(jobNote.data.note.created_at, 'the new job note has a created_at');
  const jobEdit = await admin('PUT', `/api/notes/job/1/${jobNote.data.note.id}`, { note: 'Job note edited' });
  assert.equal(jobEdit.data.note.created_at, jobNote.data.note.created_at, 'a job-note edit keeps its creation time');

  // The existing access rules still apply: a user assigned to the client can
  // add and read notes (and never sees a timestamp they can set), while a
  // user with no access is refused everywhere.
  const sam = await login('sam@example.com', 'user');
  assert.equal((await sam('POST', '/api/notes/add/2', { note: 'Sam note' })).status, 200);
  assert.equal((await sam('GET', '/api/notes/list/2')).status, 200);

  const riley = await login('riley@example.com', 'user');
  assert.equal((await riley('GET', '/api/notes/list/2')).status, 403, 'no access to list another client\'s notes');
  assert.equal((await riley('POST', '/api/notes/add/2', { note: 'Nope' })).status, 403, 'no access to add to another client');
  assert.equal((await riley('POST', '/api/notes/job/1', { note: 'Nope' })).status, 403, 'no access to another client\'s job notes');
});

test('a job payment updates the job, lands in the payments ledger, and reaches Finance', async () => {
  const admin = await login('owner@example.com', 'admin');
  const before = await admin('GET', `/api/finance/summary?year=${YEAR}`);
  const res = await admin('POST', '/api/jobs/2/payment', { amount: 500 });
  assert.equal(res.status, 200);
  assert.equal(res.data.job.amount_paid, 500);
  assert.equal(res.data.job.balance, 1000);

  const db = await dump();
  const ledger = db.tables.payments.filter((p) => p.client_id === 2 && p.amount === 500);
  assert.equal(ledger.length, 1, 'exactly one ledger row, no duplicates');
  const after = await admin('GET', `/api/finance/summary?year=${YEAR}`);
  assert.equal(after.data.totalReceived - before.data.totalReceived, 500);
});

test('undo records a correction, never deletes, and cannot remove more than was received', async () => {
  const admin = await login('owner@example.com', 'admin');
  await admin('POST', '/api/jobs/2/payment', { amount: 300 });
  const undo = await admin('POST', '/api/jobs/2/payment/reverse', { amount: 300 });
  assert.equal(undo.status, 200);
  assert.equal(undo.data.job.amount_paid, 0);
  const db = await dump();
  const rows = db.tables.payments.filter((p) => p.client_id === 2 && Math.abs(p.amount) === 300);
  assert.deepEqual(rows.map((r) => r.amount).sort((a, b) => a - b), [-300, 300], 'payment kept + correction added');
  const tooMuch = await admin('POST', '/api/jobs/1/payment/reverse', { amount: 9999 });
  assert.equal(tooMuch.status, 400);
});

test('job payment history is available after the migration', async () => {
  await fetch(`${MOCK}/__migrate`, { method: 'POST', body: JSON.stringify({ on: true }) });
  await stopApp(app);
  app = await startApp();
  try {
    const admin = await login('owner@example.com', 'admin');
    await admin('POST', '/api/jobs/1/payment', { amount: 250 });
    const hist = await admin('GET', '/api/jobs/1/payments');
    assert.equal(hist.data.supported, true);
    assert.deepEqual(hist.data.payments.map((p) => p.amount), [250]);
    const db = await dump();
    assert.equal(db.tables.payments.find((p) => p.amount === 250).job_id, 1);
    // Deleting the job keeps the money in the ledger (job link cleared).
    await admin('DELETE', '/api/jobs/1');
    const after = await dump();
    const kept = after.tables.payments.find((p) => p.amount === 250);
    assert.ok(kept, 'payment row survives job deletion');
    assert.equal(kept.job_id, null);
  } finally {
    await fetch(`${MOCK}/__migrate`, { method: 'POST', body: JSON.stringify({ on: false }) });
    await stopApp(app);
    app = await startApp();
  }
});

test('before the migration, job payment history reports unsupported instead of failing', async () => {
  const admin = await login('owner@example.com', 'admin');
  const hist = await admin('GET', '/api/jobs/1/payments');
  assert.equal(hist.status, 200);
  assert.equal(hist.data.supported, false);
});

test('regular users see jobs and their services without any money, and cannot price, pay or open other clients', async () => {
  const sam = await login('sam@example.com', 'user');
  const jobs = await sam('GET', '/api/jobs/client/2');
  assert.equal(jobs.status, 200);
  for (const j of jobs.data.jobs) {
    for (const field of ['job_cost', 'total_due', 'amount_paid', 'balance']) {
      assert.equal(j[field], undefined, `${field} is admin-only`);
    }
    assert.equal(typeof j.title, 'string');
  }
  const items = await sam('GET', '/api/jobs/1/line-items');
  assert.equal(items.status, 200, 'service names stay visible (scope of work)');
  assert.equal(items.data.lineItems.length, 2);
  for (const i of items.data.lineItems) {
    assert.equal(i.unit_price, undefined, 'service prices are admin-only');
    assert.equal(i.amount, undefined);
    assert.ok(i.description);
  }
  assert.equal((await sam('POST', '/api/jobs/1/line-items', { description: 'x', unit_price: 1 })).status, 403);
  assert.equal((await sam('POST', '/api/jobs/1/line-items/bulk', { line_items: [{ description: 'x' }] })).status, 403);
  assert.equal((await sam('PUT', '/api/jobs/1/line-items/1', { unit_price: 1 })).status, 403);
  assert.equal((await sam('DELETE', '/api/jobs/1/line-items/1')).status, 403);
  assert.equal((await sam('POST', '/api/jobs/1/payment', { amount: 5 })).status, 403);
  assert.equal((await sam('POST', '/api/jobs/1/payment/reverse', { amount: 5 })).status, 403);
  assert.equal((await sam('GET', '/api/jobs/1/payments')).status, 403);
  assert.equal((await sam('GET', '/api/jobs/client/3')).status, 403, 'another rep\'s client');
  assert.equal((await sam('GET', '/api/jobs/4/line-items')).status, 403);
  assert.equal((await sam('GET', '/api/finance/summary')).status, 403);

  // Editing a job's text fields is still allowed; the price is not.
  const put = await sam('PUT', '/api/jobs/1', { title: 'Roof Replacement', scope_of_work: 'Updated scope', total_due: 1, job_cost: 1 });
  assert.equal(put.status, 200);
  const job = (await dump()).tables.jobs.find((j) => j.id === 1);
  assert.equal(job.scope_of_work, 'Updated scope');
  assert.equal(job.total_due, 2000);
  assert.equal(job.job_cost, 1200);
});

test('+ Job with services sets the total from them; regular users cannot price a new job', async () => {
  const admin = await login('owner@example.com', 'admin');
  const res = await admin('POST', '/api/jobs', {
    client_id: 3,
    title: 'October Maintenance',
    scope_of_work: 'Monthly maintenance visit',
    job_cost: 40,
    line_items: [{ description: 'Maintenance Visit', quantity: 1, unit_price: 120, category: 'Labor' }, { description: 'Filter', quantity: 2, unit_price: 15, category: 'Materials' }]
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.job.total_due, 150);
  assert.equal(res.data.job.balance, 150);
  assert.equal(res.data.job.job_cost, 40);
  const items = (await dump()).tables.job_line_items.filter((i) => i.job_id === res.data.job.id);
  assert.equal(items.length, 2);

  const sam = await login('sam@example.com', 'user');
  const userJob = await sam('POST', '/api/jobs', { client_id: 2, title: 'Rep job', total_due: 999, line_items: [{ description: 'x', unit_price: 500 }] });
  assert.equal(userJob.status, 200);
  assert.equal(userJob.data.job.total_due, undefined, 'regular users never receive job money');
  assert.equal((await dump()).tables.jobs.find((j) => j.id === userJob.data.job.id).total_due, 0);
  assert.equal((await dump()).tables.job_line_items.filter((i) => i.job_id === userJob.data.job.id).length, 0);
});

test('+ Service, edit and remove keep the job total in sync; defaults can be removed and replaced', async () => {
  const admin = await login('owner@example.com', 'admin');
  // Job 4 starts with its default "Maintenance Visit" service ($120).
  const add = await admin('POST', '/api/jobs/4/line-items/bulk', { line_items: [{ description: 'Gutter Cleaning', unit_price: 180, category: 'Labor' }] });
  assert.equal(add.status, 200);
  let job = (await admin('GET', '/api/jobs/4')).data.job;
  assert.equal(job.total_due, 300);

  const itemId = add.data.lineItems[0].id;
  await admin('PUT', `/api/jobs/4/line-items/${itemId}`, { quantity: 2 });
  job = (await admin('GET', '/api/jobs/4')).data.job;
  assert.equal(job.total_due, 480);

  // Remove every service (including the default), then add a replacement.
  await admin('DELETE', `/api/jobs/4/line-items/${itemId}`);
  await admin('DELETE', '/api/jobs/4/line-items/3');
  job = (await admin('GET', '/api/jobs/4')).data.job;
  assert.equal(job.total_due, 0);
  await admin('POST', '/api/jobs/4/line-items/bulk', { line_items: [{ description: 'Shingle Repair', unit_price: 400 }] });
  job = (await admin('GET', '/api/jobs/4')).data.job;
  assert.equal(job.total_due, 400);
  assert.equal(job.balance, 400);
  const items = (await admin('GET', '/api/jobs/4/line-items')).data.lineItems;
  assert.deepEqual(items.map((i) => i.description), ['Shingle Repair']);
});

test('Finance totals count client-level amounts plus approved jobs, by year', async () => {
  const admin = await login('owner@example.com', 'admin');
  const db = await dump();
  const yearOf = (v) => new Date(v).getFullYear();
  const clients = db.tables.clients.filter((c) => yearOf(c.created_at) === YEAR);
  // Only jobs whose status counts in Finance (job 2 is a Prospect).
  const jobs = db.tables.jobs.filter((j) => yearOf(j.created_at) === YEAR && ['Approved', 'Completed', 'Invoice', 'Closed'].includes(j.status));
  assert.deepEqual(jobs.map((j) => j.id).sort(), [1, 3, 4]);
  const expected = clients.reduce((s, c) => s + c.total_due, 0) + jobs.reduce((s, j) => s + j.total_due, 0);
  const remaining = clients.reduce((s, c) => s + c.balance, 0) + jobs.reduce((s, j) => s + j.balance, 0);

  // A change recalculates the stored totals for the year.
  await admin('PUT', '/api/jobs/2', { title: 'Gutter Job' });
  const summary = await admin('GET', `/api/finance/summary?year=${YEAR}`);
  assert.equal(summary.data.totalExpected, expected);
  assert.equal(summary.data.totalRemaining, remaining);
  assert.equal(typeof summary.data.avgMarginPct, 'number', 'average margin is calculated again');
});

test('client-level files: listed with view/download links, served, and access-checked', async () => {
  const admin = await login('owner@example.com', 'admin');
  const list = await admin('GET', '/api/pdf/list/1');
  assert.equal(list.status, 200);
  assert.equal(list.data.files.length, 2);
  const file = list.data.files[0];
  assert.match(file.viewUrl, /^\/api\/pdf\/file\/1\?name=/);
  const view = await admin('GET', file.viewUrl);
  assert.equal(view.status, 200);
  assert.ok(view.data.slice(0, 5).toString() === '%PDF-', 'PDF bytes served');
  const download = await admin('GET', file.downloadUrl);
  assert.match(download.headers.get('content-disposition') || '', /attachment/);

  const riley = await login('riley@example.com', 'user');
  assert.equal((await riley('GET', '/api/pdf/list/1')).status, 403);
  assert.equal((await riley('GET', file.viewUrl)).status, 403);
  assert.equal((await admin('GET', '/api/pdf/file/1?name=..%2F..%2Fserver.js')).status, 404, 'no path traversal');
});

test('job estimate and invoice still generate (scope blank falls back to services)', async () => {
  const admin = await login('owner@example.com', 'admin');
  const est = await admin('POST', '/api/jobs/2/estimate', {});
  assert.equal(est.status, 200);
  assert.equal(est.headers.get('content-type'), 'application/pdf');
  const inv = await admin('POST', '/api/jobs/1/invoice', {});
  assert.equal(inv.status, 200);
  const sam = await login('sam@example.com', 'user');
  assert.equal((await sam('POST', '/api/jobs/1/estimate', {})).status, 200, 'regular user may still download job PDFs');
  assert.equal((await sam('POST', '/api/send-invoice/1', {})).status, 403, 'client-level invoice stays admin-only');
});

test('existing client-level money APIs still work (Client account workspace)', async () => {
  const admin = await login('owner@example.com', 'admin');
  assert.equal((await admin('PUT', '/api/clients/1/total', { total_due: 5500 })).status, 200);
  assert.equal((await admin('PUT', '/api/clients/1/payment', { payment: 500 })).status, 200);
  let c = (await dump()).tables.clients.find((x) => x.id === 1);
  assert.equal(c.total_due, 5500);
  assert.equal(c.amount_paid, 2500);
  assert.equal(c.balance, 3000);
  assert.equal((await admin('PUT', '/api/clients/1/finance-state', { total_due: 5000, amount_paid: 2000 })).status, 200);
  c = (await dump()).tables.clients.find((x) => x.id === 1);
  assert.equal(c.total_due, 5000);
  assert.equal(c.amount_paid, 2000);
  assert.equal((await admin('POST', '/api/update-project', { id: 1, job_cost: 3600 })).status, 200);
  c = (await dump()).tables.clients.find((x) => x.id === 1);
  assert.equal(c.job_cost, 3600);
  assert.equal(c.total_due, 5000, 'cost-only save leaves totals alone');
  const sam = await login('sam@example.com', 'user');
  assert.equal((await sam('POST', '/api/update-project', { id: 1, job_cost: 1, total_due: 1 })).status, 200);
  c = (await dump()).tables.clients.find((x) => x.id === 1);
  assert.equal(c.job_cost, 3600, 'regular user cannot change client-level money');
  assert.equal(c.total_due, 5000);
});

test('recurring data is untouched: client_type preserved and the server-side recurring filter still works', async () => {
  const admin = await login('owner@example.com', 'admin');
  await admin('POST', '/api/update-project', { id: 3, name: 'Carla Jobs', technician: 'Tom' });
  const carla = (await dump()).tables.clients.find((c) => c.id === 3);
  assert.equal(carla.client_type, 'recurring');
  const filtered = await admin('GET', '/api/search/filtered?type=recurring');
  assert.deepEqual(filtered.data.map((c) => c.name), ['Carla Jobs'], 'server-side recurring filter still available');
});

// ---------------------------------------------------------------------------
// Custom job expense categories (v7)
// ---------------------------------------------------------------------------
async function migrateAll() {
  await fetch(`${MOCK}/__reset`, { method: 'POST', body: JSON.stringify({ migrated: true }) });
}

async function jobExpenses(admin, jobId) {
  return (await admin('GET', `/api/jobs/${jobId}/expenses`)).data;
}

test('expenses before the v7 migration: reported as unavailable, single job cost keeps working', async () => {
  const admin = await login('owner@example.com', 'admin');
  const cats = await admin('GET', '/api/v2/expense-categories');
  assert.equal(cats.status, 200);
  assert.equal(cats.data.supported, false);
  const list = await jobExpenses(admin, 1);
  assert.equal(list.supported, false);
  assert.equal((await admin('POST', '/api/jobs/1/expenses', { description: 'x', amount: 5 })).status, 409);
  const put = await admin('PUT', '/api/jobs/2', { job_cost: 750 });
  assert.equal(put.data.job.job_cost, 750);
});

test('itemized costs: add, edit, change category and delete keep job cost, breakdown and margin in step', async () => {
  await migrateAll();
  const admin = await login('owner@example.com', 'admin');
  const data = await jobExpenses(admin, 1);
  assert.equal(data.supported, true);
  assert.deepEqual(data.breakdown.map((b) => [b.name, b.total]), [['Labor', 500], ['Materials', 700]]);
  assert.equal(data.total, 1200);

  const add = await admin('POST', '/api/jobs/1/expenses', { description: 'Sales commission', amount: 400, category_id: 3 });
  assert.equal(add.status, 200);
  assert.equal(add.data.job.job_cost, 1600);
  assert.deepEqual(add.data.breakdown.map((b) => [b.name, b.total]), [['Labor', 500], ['Materials', 700], ['Commissions', 400]]);
  const newId = add.data.created_id;

  let res = await admin('PUT', `/api/jobs/1/expenses/${newId}`, { amount: 250, category_id: 4, description: 'Dump fee' });
  assert.equal(res.data.job.job_cost, 1450);
  assert.deepEqual(res.data.breakdown.map((b) => [b.name, b.total]), [['Labor', 500], ['Materials', 700], ['Miscellaneous Expenses', 250]]);

  // Job margin/profit use the same job_cost figure.
  const job = (await admin('GET', '/api/jobs/1')).data.job;
  assert.equal(job.total_due - job.job_cost, 550);

  res = await admin('DELETE', `/api/jobs/1/expenses/${newId}`);
  assert.equal(res.data.job.job_cost, 1200);
  assert.equal(res.data.expenses.length, 2);

  // A typed job cost can not drift from the itemized total.
  const put = await admin('PUT', '/api/jobs/1', { job_cost: 99 });
  assert.equal(put.data.job.job_cost, 1200);
});

test('first itemized cost keeps a typed-in job cost as an Uncategorized line', async () => {
  await migrateAll();
  const admin = await login('owner@example.com', 'admin');
  const res = await admin('POST', '/api/jobs/2/expenses', { description: 'Gutters', amount: 300, category_id: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.data.job.job_cost, 1000, '700 kept + 300 new');
  const kept = res.data.expenses.find((e) => e.category_id === null);
  assert.equal(kept.amount, 700);
  assert.equal(kept.category_name, 'Uncategorized');
  assert.deepEqual(res.data.breakdown.map((b) => b.name), ['Materials', 'Uncategorized']);
});

test('categories: add, rename in place, deactivate (hidden for new costs, history kept), delete only when unused', async () => {
  await migrateAll();
  const admin = await login('owner@example.com', 'admin');
  let cats = (await admin('GET', '/api/v2/expense-categories')).data.categories;
  assert.deepEqual(cats.map((c) => c.name), ['Labor', 'Materials', 'Commissions', 'Miscellaneous Expenses', 'Dumpsters']);
  const materials = cats.find((c) => c.name === 'Materials');
  assert.equal(materials.expense_count, 1);
  assert.equal(materials.expense_total, 700);

  // Add + duplicate protection (case-insensitive).
  const sub = await admin('POST', '/api/v2/expense-categories', { name: 'Subcontractors' });
  assert.equal(sub.status, 200);
  assert.equal((await admin('POST', '/api/v2/expense-categories', { name: 'subcontractors' })).status, 409);
  assert.equal((await admin('POST', '/api/jobs/4/expenses', { description: 'Sub crew', amount: 80, category_id: sub.data.category.id })).status, 200);

  // Rename: same id, every existing expense follows.
  const before = (await dump()).tables.job_expenses.length;
  await admin('PUT', `/api/v2/expense-categories/${materials.id}`, { name: 'Roofing Materials' });
  const data = await jobExpenses(admin, 1);
  assert.equal(data.expenses.find((e) => e.description === 'Shingles').category_name, 'Roofing Materials');
  assert.equal((await dump()).tables.job_expenses.length, before, 'no records created or removed by a rename');

  // Deactivate Labor: not offered for new costs, existing cost kept + editable.
  await admin('PUT', '/api/v2/expense-categories/1', { is_active: false });
  assert.equal((await admin('POST', '/api/jobs/1/expenses', { description: 'More labor', amount: 10, category_id: 1 })).status, 400);
  const edit = await admin('PUT', '/api/jobs/1/expenses/2', { amount: 550 });
  assert.equal(edit.status, 200);
  const labor = edit.data.expenses.find((e) => e.id === 2);
  assert.equal(labor.category_name, 'Labor');
  assert.equal(labor.category_active, false);
  assert.equal(edit.data.job.job_cost, 1250);

  // In-use categories can not be deleted; unused ones can.
  assert.equal((await admin('DELETE', '/api/v2/expense-categories/1')).status, 409);
  assert.ok((await dump()).tables.job_expenses.find((e) => e.id === 2), 'expense survives');
  const temp = await admin('POST', '/api/v2/expense-categories', { name: 'Typo Category' });
  assert.equal((await admin('DELETE', `/api/v2/expense-categories/${temp.data.category.id}`)).status, 200);

  cats = (await admin('GET', '/api/v2/expense-categories')).data.categories;
  assert.deepEqual(cats.map((c) => [c.name, c.is_active]), [
    ['Labor', false], ['Roofing Materials', true], ['Commissions', true], ['Miscellaneous Expenses', true], ['Dumpsters', false], ['Subcontractors', true]
  ]);
});

test('a business with no categories yet gets the four defaults', async () => {
  await migrateAll();
  await fetch(`${MOCK}/rest/v1/job_expenses?id=gt.0`, { method: 'DELETE' });
  await fetch(`${MOCK}/rest/v1/expense_categories?id=gt.0`, { method: 'DELETE' });
  const admin = await login('owner@example.com', 'admin');
  const cats = (await admin('GET', '/api/v2/expense-categories')).data.categories;
  assert.deepEqual(cats.map((c) => c.name), ['Labor', 'Materials', 'Commissions', 'Miscellaneous Expenses']);
});

test('duplicating a job copies its costs (retired categories become Uncategorized); deleting a job removes only its costs', async () => {
  await migrateAll();
  const admin = await login('owner@example.com', 'admin');
  const res = await admin('POST', '/api/jobs', {
    client_id: 5,
    title: 'Porch Roof (copy)',
    expenses: [{ description: 'Dumpster rental', amount: 350, category_id: 5 }, { description: 'Labor', amount: 100, category_id: 1 }]
  });
  assert.equal(res.data.job.job_cost, 450);
  const copied = await jobExpenses(admin, res.data.job.id);
  assert.deepEqual(copied.expenses.map((e) => [e.category_name, e.amount]), [['Uncategorized', 350], ['Labor', 100]]);

  await admin('DELETE', `/api/jobs/${res.data.job.id}`);
  const db = await dump();
  assert.equal(db.tables.job_expenses.filter((e) => e.job_id === res.data.job.id).length, 0);
  assert.ok(db.tables.job_expenses.find((e) => e.id === 3), 'the original job keeps its costs');
});

test('regular users cannot see or change costs or categories (job cost stays admin-only)', async () => {
  await migrateAll();
  const sam = await login('sam@example.com', 'user');
  assert.equal((await sam('GET', '/api/jobs/1/expenses')).status, 403);
  assert.equal((await sam('POST', '/api/jobs/1/expenses', { description: 'x', amount: 1 })).status, 403);
  assert.equal((await sam('PUT', '/api/jobs/1/expenses/1', { amount: 1 })).status, 403);
  assert.equal((await sam('DELETE', '/api/jobs/1/expenses/1')).status, 403);
  assert.equal((await sam('GET', '/api/v2/expense-categories')).status, 403);
  assert.equal((await sam('POST', '/api/v2/expense-categories', { name: 'x' })).status, 403);
  assert.equal((await sam('PUT', '/api/v2/expense-categories/1', { name: 'x' })).status, 403);
  assert.equal((await sam('DELETE', '/api/v2/expense-categories/4')).status, 403);
  const jobs = (await sam('GET', '/api/jobs/client/2')).data.jobs;
  assert.ok(jobs.every((j) => j.job_cost === undefined));
});

test('client-level cost and Finance margin include itemized job costs', async () => {
  await migrateAll();
  const admin = await login('owner@example.com', 'admin');
  await admin('POST', '/api/jobs/1/expenses', { description: 'Extra', amount: 100, category_id: 4 });
  const jobs = (await admin('GET', '/api/jobs/client/2')).data.jobs;
  assert.equal(jobs.reduce((s, j) => s + j.job_cost, 0), 1300 + 700);
  const summary = await admin('GET', `/api/finance/summary?year=${YEAR}`);
  assert.equal(typeof summary.data.avgMarginPct, 'number');
});

// ---------------------------------------------------------------------------
// Second round of changes
// ---------------------------------------------------------------------------

// Text drawn on a pdfkit page: inflate every content stream and decode the
// hex glyph strings in drawing order (kerned text is split into pieces, so
// the pieces of each TJ array are joined).
function pdfText(buffer) {
  const zlib = require('zlib');
  const raw = buffer.toString('latin1');
  let out = '';
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(raw))) {
    let content;
    try { content = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch (e) { continue; }
    const pieces = content.match(/\[[^\]]*\]\s*TJ|<[0-9a-fA-F]*>\s*Tj/g) || [];
    for (const piece of pieces) {
      const hex = (piece.match(/<([0-9a-fA-F]*)>/g) || []).map((h) => h.slice(1, -1)).join('');
      out += Buffer.from(hex, 'hex').toString('latin1') + '\n';
    }
  }
  return out;
}

test('customer PDFs show the scope and one total — no cost breakdown, categories, quantities or unit prices; commas in totals', async () => {
  const admin = await login('owner@example.com', 'admin');
  // Job 1: scope "Tear off and replace roof", services Tear-off labor (Labor,
  // 1 x 800) and Shingles (Materials, 30 x 40) = $2,000.
  for (const mode of ['estimate', 'invoice']) {
    const res = await admin('POST', `/api/jobs/1/${mode}`, {});
    assert.equal(res.status, 200);
    const text = pdfText(res.data);
    assert.match(text, /Tear off and replace roof/, `${mode}: scope of work printed`);
    assert.match(text, /2,000\.00/, `${mode}: total with a thousands comma`);
    for (const hidden of ['COST BREAKDOWN', 'DESCRIPTION', 'CATEGORY', 'UNIT PRICE', 'QTY', 'Materials', 'Labor', 'Shingles', '40.00', '800.00']) {
      assert.ok(!text.includes(hidden), `${mode}: must not show "${hidden}"`);
    }
  }
  // Blank scope: the services are listed as the scope — names only.
  await admin('PUT', '/api/jobs/1', { scope_of_work: '' });
  const text = pdfText((await admin('POST', '/api/jobs/1/estimate', {})).data);
  assert.match(text, /Tear-off labor/);
  assert.match(text, /Shingles/);
  assert.ok(!text.includes('Materials') && !text.includes('40.00'), 'no category or unit price for listed services');
  // Large amounts get commas: 150000 -> 150,000.00
  await admin('PUT', '/api/jobs/2', { total_due: 150000 });
  assert.match(pdfText((await admin('POST', '/api/jobs/2/invoice', {})).data), /150,000\.00/);
});

test('with itemized costs available, a job cost can only change through Job Costs', async () => {
  await migrateAll();
  const admin = await login('owner@example.com', 'admin');
  // Job 2 has an older typed-in cost ($700) and no itemized costs.
  let put = await admin('PUT', '/api/jobs/2', { job_cost: 9999, title: 'Gutter Job' });
  assert.equal(put.status, 200);
  assert.equal(put.data.job.job_cost, 700, 'direct job_cost edit ignored; old cost kept');
  // Job 1 is itemized ($1,200).
  put = await admin('PUT', '/api/jobs/1', { job_cost: 5 });
  assert.equal(put.data.job.job_cost, 1200);
  // The older cost moves into the list as an Uncategorized line, same total.
  const moved = await admin('POST', '/api/jobs/2/expenses/itemize-existing', {});
  assert.equal(moved.status, 200);
  assert.deepEqual(moved.data.expenses.map((e) => [e.description, e.amount, e.category_name]),
    [['Cost entered before itemized expenses', 700, 'Uncategorized']]);
  assert.equal(moved.data.job.job_cost, 700);
  // Running it again adds nothing; editing the line changes the job cost.
  assert.equal((await admin('POST', '/api/jobs/2/expenses/itemize-existing', {})).data.expenses.length, 1);
  const edited = await admin('PUT', `/api/jobs/2/expenses/${moved.data.expenses[0].id}`, { amount: 725.5, category_id: 2 });
  assert.equal(edited.data.job.job_cost, 725.5);
  const overview = (await admin('GET', `/api/finance/overview?year=${YEAR}`)).data;
  // Job 2 is a Prospect, so its cost is not in Finance (its own cost is kept).
  assert.equal(overview.totals.cost, 3500 + 400 + 1200 + 40 + 40);
  // A job with no cost: nothing to move.
  assert.equal((await admin('POST', '/api/jobs/3/expenses/itemize-existing', {})).data.expenses.length, 1, 'job 3 keeps its $40 as one line');
  const sam = await login('sam@example.com', 'user');
  assert.equal((await sam('POST', '/api/jobs/2/expenses/itemize-existing', {})).status, 403);
});

test('Finance overview: revenue, cost, profit, months, salespeople and cost categories add up (admin only)', async () => {
  await migrateAll();
  const admin = await login('owner@example.com', 'admin');
  const res = await admin('GET', `/api/finance/overview?year=${YEAR}`);
  assert.equal(res.status, 200);
  const d = res.data;
  // Clients created this year: Alice 5000/3500, Bob 1200/400; approved jobs
  // 1, 3, 4 (job 2 is a Prospect: its $1,500 / $700 cost do not count).
  assert.equal(d.totals.revenue, 5000 + 1200 + 2000 + 120 + 120);
  assert.equal(d.totals.cost, 3500 + 400 + 1200 + 40 + 40);
  assert.equal(d.totals.profit, d.totals.revenue - d.totals.cost);
  assert.equal(d.totals.received, 3200);
  assert.equal(d.monthly.reduce((s, m) => s + m.received, 0), d.totals.received);
  assert.equal(d.monthly[1].received, 2000);
  assert.equal(d.salespeople.reduce((s, p) => s + p.revenue, 0), d.totals.revenue);
  assert.deepEqual(d.salespeople.map((p) => p.name), ['Sam Sales', 'Riley Rep']);
  const cats = Object.fromEntries(d.costByCategory.map((c) => [c.name, c.amount]));
  assert.deepEqual(cats, { Materials: 700, Labor: 500, 'Client account costs': 3900, 'Job costs not itemized': 80 });
  assert.equal(d.costByCategory.reduce((s, c) => s + c.amount, 0), d.totals.cost);
  // Last year: Eve Closed and her job.
  const last = (await admin('GET', `/api/finance/overview?year=${YEAR - 1}`)).data;
  assert.equal(last.totals.revenue, 800 + 900);
  assert.deepEqual(last.costByCategory.map((c) => c.name), ['Dumpsters', 'Client account costs']);
  const sam = await login('sam@example.com', 'user');
  assert.equal((await sam('GET', `/api/finance/overview?year=${YEAR}`)).status, 403);
  // Before the v7 migration it still works (no itemized categories).
  await resetDb();
  const before = (await admin('GET', `/api/finance/overview?year=${YEAR}`)).data;
  assert.equal(before.totals.cost, d.totals.cost);
});

test('a client can be created without an email (and still with one)', async () => {
  const admin = await login('owner@example.com', 'admin');
  let res = await admin('POST', '/api/save-client', { fName: 'No', lName: 'Email', phone: '555-0199', address: '', email: '', status: 'Lead' });
  assert.equal(res.status, 200);
  res = await admin('POST', '/api/save-client', { fName: 'Missing', lName: 'Field', phone: '555-0198', status: 'Lead' });
  assert.equal(res.status, 200, 'email may be left out entirely');
  res = await admin('POST', '/api/save-client', { fName: 'Has', lName: 'Email', phone: '555-0197', email: 'has@example.com', status: 'Lead' });
  assert.equal(res.status, 200);
  const sam = await login('sam@example.com', 'user');
  assert.equal((await sam('POST', '/api/save-client', { fName: 'User', lName: 'Made', phone: '1' })).status, 200);
  const clients = (await dump()).tables.clients;
  assert.equal(clients.find((c) => c.name === 'No Email').email, '');
  assert.equal(clients.find((c) => c.name === 'Missing Field').email, '');
  assert.equal(clients.find((c) => c.name === 'Has Email').email, 'has@example.com');
  assert.equal(clients.find((c) => c.name === 'Alice Legacy').email, 'alice@example.com', 'existing emails untouched');
});

test('job uploads: several files at once, wrong types rejected before anything is stored, existing files kept', async () => {
  const admin = await login('owner@example.com', 'admin');
  const cookie = sessionCookies.get('owner@example.com|admin');
  const { PDF_BYTES, PNG_BYTES } = require('../local-env');
  async function upload(category, files) {
    const form = new FormData();
    form.append('category', category);
    for (const [name, bytes, type] of files) form.append('files', new Blob([bytes], { type }), name);
    const r = await fetch(`${APP}/api/job-files/1/upload`, { method: 'POST', headers: { cookie }, body: form });
    return { status: r.status, data: await r.json() };
  }
  let res = await upload('document', [['a.pdf', PDF_BYTES, 'application/pdf'], ['b.pdf', PDF_BYTES, 'application/pdf']]);
  assert.equal(res.status, 200);
  assert.equal(res.data.files.length, 2);
  res = await upload('photo', [['c.png', PNG_BYTES, 'image/png']]);
  assert.equal(res.status, 200);
  const before = (await dump()).tables.job_files.length;
  res = await upload('document', [['ok.pdf', PDF_BYTES, 'application/pdf'], ['notes.txt', Buffer.from('hi'), 'text/plain']]);
  assert.equal(res.status, 400);
  assert.match(res.data.error, /notes\.txt/);
  res = await upload('photo', [['scan.pdf', PDF_BYTES, 'application/pdf']]);
  assert.equal(res.status, 400);
  const files = (await dump()).tables.job_files;
  assert.equal(files.length, before, 'a rejected batch stores nothing');
  assert.ok(files.find((f) => f.file_name === 'contract.pdf') && files.find((f) => f.file_name === 'before.png'), 'existing files kept');
  const docs = (await admin('GET', '/api/job-files/1?category=document')).data.files.map((f) => f.file_name);
  assert.deepEqual(docs.sort(), ['a.pdf', 'b.pdf', 'contract.pdf']);
});

test('Operational Model saves and reloads (stored preference)', async () => {
  const admin = await login('owner@example.com', 'admin');
  const save = await admin('PATCH', '/api/v2/admin/settings', { company: { business_workflow: 'returning' } });
  assert.equal(save.status, 200);
  const got = await admin('GET', '/api/v2/admin/settings');
  assert.equal(got.data.data.company.business_workflow, 'returning');
  assert.equal((await admin('PATCH', '/api/v2/admin/settings', { company: { business_workflow: 'bogus' } })).status, 400);
});

// ---------------------------------------------------------------------------
// Job scheduling / Calendar (v9): the schedule lives on the job.
test('calendar before the v9 migration: reported as unavailable; saving a job still works', async () => {
  const admin = await login('owner@example.com', 'admin');
  const sched = await admin('GET', '/api/jobs/schedule');
  assert.equal(sched.status, 200, JSON.stringify(sched.data));
  assert.equal(sched.data.supported, false);
  const res = await admin('PUT', '/api/jobs/1', { title: 'Roof Replacement', scheduled_start: '2026-10-10', duration_days: 3 });
  assert.equal(res.status, 200, 'schedule fields are ignored, not an error');
  assert.equal(res.data.job.title, 'Roof Replacement');
});

test('an approved job with a start date and duration is on the calendar and follows every change to the job', async () => {
  await resetDb({ migrated: true });
  const admin = await login('owner@example.com', 'admin');
  const events = async (q = '') => (await admin('GET', '/api/jobs/schedule' + q)).data.events;

  // Older job with no schedule: works as before, not on the calendar.
  assert.deepEqual(await events(), []);
  const plain = await admin('GET', '/api/jobs/1');
  assert.equal(plain.data.job.scheduled_start, null);

  // Job 2 is a Prospect: dates are saved but it isn't on the calendar yet.
  let res = await admin('PUT', '/api/jobs/2', { scheduled_start: '2026-10-10', duration_days: 3 });
  assert.equal(res.status, 200);
  assert.equal(res.data.job.scheduled_start, '2026-10-10');
  assert.deepEqual(await events(), []);

  // Approved -> on the calendar Oct 10-12.
  res = await admin('PUT', '/api/jobs/2', { status: 'Approved' });
  assert.equal(res.data.job.status, 'Approved');
  let ev = await events();
  assert.equal(ev.length, 1);
  assert.deepEqual(
    { job: ev[0].job_id, client: ev[0].client_name, title: ev[0].title, start: ev[0].start, end: ev[0].end, days: ev[0].duration_days },
    { job: 2, client: 'Bob Both', title: 'Gutter Job', start: '2026-10-10', end: '2026-10-12', days: 3 }
  );

  // Move the start date, then change the duration.
  await admin('PUT', '/api/jobs/2', { scheduled_start: '2026-10-20' });
  ev = await events();
  assert.deepEqual([ev[0].start, ev[0].end], ['2026-10-20', '2026-10-22']);
  await admin('PUT', '/api/jobs/2', { duration_days: 5 });
  ev = await events();
  assert.deepEqual([ev[0].start, ev[0].end, ev[0].duration_days], ['2026-10-20', '2026-10-24', 5]);

  // Renaming the job keeps it the same calendar entry.
  await admin('PUT', '/api/jobs/2', { title: 'Gutter Replacement' });
  ev = await events();
  assert.deepEqual([ev[0].job_id, ev[0].title], [2, 'Gutter Replacement']);

  // Range filter: only jobs overlapping the requested days.
  assert.equal((await events('?from=2026-10-24&to=2026-10-31')).length, 1, 'overlaps its last day');
  assert.equal((await events('?from=2026-10-25&to=2026-10-31')).length, 0, 'ended before the range');
  assert.equal((await events('?from=2026-10-01&to=2026-10-19')).length, 0, 'starts after the range');

  // Leaves Approved -> off the calendar, dates kept; approved again -> back.
  await admin('PUT', '/api/jobs/2', { status: 'Completed' });
  assert.deepEqual(await events(), []);
  const kept = (await admin('GET', '/api/jobs/2')).data.job;
  assert.deepEqual([kept.scheduled_start, kept.duration_days], ['2026-10-20', 5]);
  await admin('PUT', '/api/jobs/2', { status: 'Approved' });
  assert.equal((await events()).length, 1);

  // Clearing either field takes it off the calendar.
  await admin('PUT', '/api/jobs/2', { duration_days: null });
  assert.deepEqual(await events(), []);
  await admin('PUT', '/api/jobs/2', { duration_days: 2 });
  assert.equal((await events()).length, 1);

  // Deleting the job removes it from the calendar (nothing separate to clean up).
  assert.equal((await admin('DELETE', '/api/jobs/2')).status, 200);
  assert.deepEqual(await events(), []);
});

test('overlapping jobs are all returned; bad dates and durations change nothing', async () => {
  await resetDb({ migrated: true });
  const admin = await login('owner@example.com', 'admin');
  await admin('PUT', '/api/jobs/1', { scheduled_start: '2026-11-02', duration_days: 4 });
  await admin('PUT', '/api/jobs/2', { status: 'Approved', scheduled_start: '2026-11-03', duration_days: 1 });
  await admin('PUT', '/api/jobs/3', { status: 'Approved', scheduled_start: '2026-11-01', duration_days: 10 });
  const ev = (await admin('GET', '/api/jobs/schedule?from=2026-11-01&to=2026-11-30')).data.events;
  assert.deepEqual(ev.map((e) => e.job_id).sort(), [1, 2, 3]);

  for (const body of [{ scheduled_start: '2026-02-30' }, { scheduled_start: 'next week' }, { duration_days: 0 }, { duration_days: 400 }, { duration_days: 'abc' }]) {
    const res = await admin('PUT', '/api/jobs/1', { title: 'Changed', ...body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const job = (await admin('GET', '/api/jobs/1')).data.job;
  assert.deepEqual([job.title, job.scheduled_start, job.duration_days], ['Roof Replacement', '2026-11-02', 4], 'a rejected save changes nothing');
  assert.equal(job.total_due, 2000, 'money untouched');
});

test('regular users see only scheduled jobs of their own clients', async () => {
  await resetDb({ migrated: true });
  const admin = await login('owner@example.com', 'admin');
  await admin('PUT', '/api/jobs/1', { scheduled_start: '2026-12-01', duration_days: 2 });       // Bob Both (Sam)
  await admin('PUT', '/api/jobs/3', { status: 'Approved', scheduled_start: '2026-12-01', duration_days: 2 }); // Carla (Riley)
  const sam = await login('sam@example.com', 'user');
  const ev = (await sam('GET', '/api/jobs/schedule')).data.events;
  assert.deepEqual(ev.map((e) => e.client_name), ['Bob Both']);
  assert.equal((await sam('PUT', '/api/jobs/1', { scheduled_start: '2026-12-05' })).status, 200, 'can schedule their own job');
  assert.equal((await sam('PUT', '/api/jobs/3', { scheduled_start: '2026-12-05' })).status, 403, "not someone else's");
});

// ---------------------------------------------------------------------------
// Line-item pricing on estimates/invoices (v10): a per-job display choice.
// The services stay the only prices; the toggle never changes any money.
// ---------------------------------------------------------------------------
function jobMoney(job) {
  return [job.total_due, job.amount_paid, job.balance, job.job_cost].map(Number);
}

test('line-item pricing before the v10 migration: ignored, documents keep one total', async () => {
  const admin = await login('owner@example.com', 'admin');
  const res = await admin('PUT', '/api/jobs/1', { show_line_item_prices: true });
  assert.equal(res.status, 200);
  assert.ok(!('show_line_item_prices' in res.data.job), 'no column, nothing saved');
  const text = pdfText((await admin('POST', '/api/jobs/1/estimate', {})).data);
  assert.match(text, /2,000\.00/);
  assert.ok(!text.includes('Shingles') && !text.includes('1,200.00'), 'still one total');
});

test('existing jobs default to one total; both formats show the same total and never change the job money', async () => {
  await resetDb({ migrated: true });
  const admin = await login('owner@example.com', 'admin');
  const before = (await admin('GET', '/api/jobs/1')).data.job;
  assert.equal(before.show_line_item_prices, false, 'existing job keeps the original format');
  const services = (await admin('GET', '/api/jobs/1/line-items')).data.lineItems;
  const paymentsBefore = (await dump()).tables.payments.length;

  // One total (default): scope and the total, no service prices.
  for (const mode of ['estimate', 'invoice']) {
    const text = pdfText((await admin('POST', `/api/jobs/1/${mode}`, {})).data);
    assert.match(text, /Tear off and replace roof/);
    assert.match(text, /2,000\.00/);
    for (const hidden of ['SERVICES', 'Shingles', '1,200.00', '800.00']) assert.ok(!text.includes(hidden), `${mode}: no "${hidden}"`);
  }

  // Line-item pricing: each service and its amount, then the total.
  let res = await admin('PUT', '/api/jobs/1', { show_line_item_prices: true });
  assert.equal(res.data.job.show_line_item_prices, true);
  assert.deepEqual(jobMoney(res.data.job), jobMoney(before), 'toggle changes no money');
  const est = pdfText((await admin('POST', '/api/jobs/1/estimate', {})).data);
  for (const shown of ['Tear off and replace roof', 'SERVICES', 'Tear-off labor', '800.00', 'Shingles', '1,200.00', 'Total', '2,000.00']) {
    assert.ok(est.includes(shown), `estimate shows "${shown}"`);
  }
  for (const hidden of ['Materials', '40.00', 'ESTIMATE TOTAL']) assert.ok(!est.includes(hidden), `estimate: no "${hidden}"`);
  const inv = pdfText((await admin('POST', '/api/jobs/1/invoice', {})).data);
  for (const shown of ['Tear-off labor', '800.00', 'Shingles', '1,200.00', 'Contract Price', '2,000.00', 'Amount Paid', '500.00', 'Balance Due', '1,500.00']) {
    assert.ok(inv.includes(shown), `invoice shows "${shown}"`);
  }

  // Back to one total, without recreating anything.
  res = await admin('PUT', '/api/jobs/1', { show_line_item_prices: false });
  assert.equal(res.data.job.show_line_item_prices, false);
  const off = pdfText((await admin('POST', '/api/jobs/1/invoice', {})).data);
  assert.ok(!off.includes('Shingles') && !off.includes('1,200.00') && off.includes('2,000.00'));

  const after = (await admin('GET', '/api/jobs/1')).data.job;
  assert.deepEqual(jobMoney(after), jobMoney(before), 'job total, payments, balance and cost unchanged');
  assert.deepEqual((await admin('GET', '/api/jobs/1/line-items')).data.lineItems, services, 'service prices unchanged');
  assert.equal((await dump()).tables.payments.length, paymentsBefore, 'no payments created');
});

test('a commercial job: every service and its price, totals stay right as services are added, edited and removed', async () => {
  await resetDb({ migrated: true });
  const admin = await login('owner@example.com', 'admin');
  const created = await admin('POST', '/api/jobs', {
    client_id: 2, title: 'Commercial roof', scope_of_work: '',
    line_items: [
      { description: 'Roof repair', quantity: 1, unit_price: 2500, category: 'Labor' },
      { description: 'Materials', quantity: 1, unit_price: 1200, category: 'Materials' },
      { description: 'Labor', quantity: 1, unit_price: 1800, category: 'Labor' }
    ]
  });
  assert.equal(created.status, 200);
  const job = created.data.job;
  assert.equal(Number(job.total_due), 5500, 'job total is the services sum');
  assert.equal(job.show_line_item_prices, false, 'new jobs start with one total');
  const items = (await admin('GET', `/api/jobs/${job.id}/line-items`)).data.lineItems;
  assert.deepEqual(items.map((i) => [i.description, i.amount]), [['Roof repair', 2500], ['Materials', 1200], ['Labor', 1800]]);

  async function docs() {
    return {
      estimate: pdfText((await admin('POST', `/api/jobs/${job.id}/estimate`, {})).data),
      invoice: pdfText((await admin('POST', `/api/jobs/${job.id}/invoice`, {})).data)
    };
  }
  function expectItemized(texts, lines, total) {
    for (const [mode, text] of Object.entries(texts)) {
      assert.ok(text.includes('SERVICES'), `${mode}: service price list`);
      for (const [name, amount] of lines) {
        assert.ok(text.includes(name) && text.includes(amount), `${mode}: ${name} ${amount}`);
      }
      assert.ok(text.includes(total), `${mode}: total ${total}`);
    }
  }
  function expectOneTotal(texts, amounts, total) {
    for (const [mode, text] of Object.entries(texts)) {
      assert.ok(text.includes(total), `${mode}: total ${total}`);
      for (const amount of amounts) assert.ok(!text.includes(amount), `${mode}: no "${amount}"`);
      assert.ok(!text.includes('SERVICES'), `${mode}: no service price list`);
    }
  }

  // One total: blank scope lists the service names, but no prices.
  let texts = await docs();
  expectOneTotal(texts, ['2,500.00', '1,200.00', '1,800.00'], '5,500.00');
  assert.ok(texts.estimate.includes('Roof repair'), 'names still listed as the scope');

  await admin('PUT', `/api/jobs/${job.id}`, { show_line_item_prices: true });
  texts = await docs();
  expectItemized(texts, [['Roof repair', '2,500.00'], ['Materials', '1,200.00'], ['Labor', '1,800.00']], '5,500.00');
  assert.ok(!texts.estimate.includes('SCOPE OF WORK'), 'scope that only repeats service names is not printed twice');
  assert.equal(texts.estimate.split('Roof repair').length - 1, 1, 'each service listed once');

  // Edit a price, remove one service, add one.
  const labor = items.find((i) => i.description === 'Labor');
  const materials = items.find((i) => i.description === 'Materials');
  assert.equal((await admin('PUT', `/api/jobs/${job.id}/line-items/${labor.id}`, { unit_price: 2000 })).status, 200);
  assert.equal((await admin('DELETE', `/api/jobs/${job.id}/line-items/${materials.id}`)).status, 200);
  assert.equal((await admin('POST', `/api/jobs/${job.id}/line-items`, { description: 'Permit', quantity: 2, unit_price: 150, category: 'Permits' })).status, 200);
  assert.equal(Number((await admin('GET', `/api/jobs/${job.id}`)).data.job.total_due), 4800);

  texts = await docs();
  expectItemized(texts, [['Roof repair', '2,500.00'], ['Labor', '2,000.00'], ['Permit', '300.00']], '4,800.00');
  assert.ok(!texts.invoice.includes('1,200.00') && !texts.invoice.includes('Materials'), 'removed service gone');
  assert.ok(!texts.invoice.includes('150.00'), 'unit price is never shown, only the amount');

  await admin('PUT', `/api/jobs/${job.id}`, { show_line_item_prices: false });
  expectOneTotal(await docs(), ['2,500.00', '2,000.00', '300.00'], '4,800.00');
  assert.equal(Number((await admin('GET', `/api/jobs/${job.id}`)).data.job.total_due), 4800, 'total unchanged by the toggle');
});

test('line-item pricing: own scope text is kept, bad values change nothing, regular users can set it on their own jobs', async () => {
  await resetDb({ migrated: true });
  const admin = await login('owner@example.com', 'admin');
  await admin('PUT', '/api/jobs/1', { scope_of_work: 'Tear off and replace roof\n- Shingles', show_line_item_prices: true });
  const text = pdfText((await admin('POST', '/api/jobs/1/estimate', {})).data);
  assert.ok(text.includes('Tear off and replace roof'), 'custom scope text still printed');
  assert.equal(text.split('Shingles').length - 1, 1, 'a scope line that is a service name is not repeated');

  for (const value of ['yes', 1, null, 'true']) {
    const res = await admin('PUT', '/api/jobs/1', { title: 'Changed', show_line_item_prices: value });
    assert.equal(res.status, 400, JSON.stringify(value));
  }
  const job = (await admin('GET', '/api/jobs/1')).data.job;
  assert.deepEqual([job.title, job.show_line_item_prices, Number(job.total_due)], ['Roof Replacement', true, 2000], 'a rejected save changes nothing');
  assert.equal((await admin('POST', '/api/jobs', { client_id: 2, show_line_item_prices: 'yes' })).status, 400);
  const copy = await admin('POST', '/api/jobs', { client_id: 2, title: 'Copy', show_line_item_prices: true });
  assert.equal(copy.data.job.show_line_item_prices, true, 'a duplicated job keeps the choice');

  const sam = await login('sam@example.com', 'user');
  assert.equal((await sam('PUT', '/api/jobs/1', { show_line_item_prices: false })).status, 200, 'own job');
  assert.equal((await sam('PUT', '/api/jobs/3', { show_line_item_prices: true })).status, 403, "not someone else's");
  assert.equal(Number((await admin('GET', '/api/jobs/1')).data.job.total_due), 2000);
});

// ---------------------------------------------------------------------------
// Configurable job-status names: renaming a label must never change behavior.
// ---------------------------------------------------------------------------
test('job status names: readable by everyone, editable by admins only, and renaming never changes Finance or the workflow', async () => {
  const admin = await login('owner@example.com', 'admin');
  const sam = await login('sam@example.com', 'user');

  let res = await admin('GET', '/api/job-statuses');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.statuses.map((s) => s.id), ['Prospect', 'Approved', 'Completed', 'Invoice', 'Closed', 'Cancelled']);
  assert.deepEqual(res.data.financeStatuses, ['Approved', 'Completed', 'Invoice', 'Closed']);
  assert.equal(res.data.scheduledStatus, 'Approved');
  // Every job view needs the names, so any signed-in user can read them...
  assert.equal((await sam('GET', '/api/job-statuses')).status, 200);
  // ...but only admins may rename.
  assert.equal((await sam('PUT', '/api/job-statuses', { labels: { Approved: 'Accepted' } })).status, 403);

  // `calculated` always reflects the rules; matchesRecords compares it with the
  // stored year row (which a hand-typed override may deliberately differ from).
  const financeOf = async () => {
    const r = await admin('GET', `/api/finance/summary?year=${YEAR}`);
    assert.equal(r.status, 200);
    return r.data.calculated;
  };
  const before = await financeOf();

  // Rename Approved -> Accepted and Cancelled -> Dropped.
  res = await admin('PUT', '/api/job-statuses', { labels: { Approved: 'Accepted', Cancelled: 'Dropped' } });
  assert.equal(res.status, 200);
  const approved = res.data.statuses.find((s) => s.id === 'Approved');
  assert.deepEqual([approved.label, approved.countsInFinance], ['Accepted', true], 'eligibility follows the id, not the name');
  assert.equal(res.data.statuses.find((s) => s.id === 'Cancelled').label, 'Dropped');

  // Validation: empty, unknown, duplicate and over-long names are refused.
  assert.equal((await admin('PUT', '/api/job-statuses', { labels: { Approved: '   ' } })).status, 400);
  assert.equal((await admin('PUT', '/api/job-statuses', { labels: { Nope: 'x' } })).status, 400);
  assert.equal((await admin('PUT', '/api/job-statuses', { labels: { Approved: 'Dropped' } })).status, 400, 'two statuses cannot share a name');
  assert.equal((await admin('PUT', '/api/job-statuses', { labels: { Approved: 'x'.repeat(31) } })).status, 400);

  // Finance is unchanged, jobs keep the internal id, and the label map is stored.
  const after = await financeOf();
  assert.deepEqual(after, before, 'renaming labels changes no money');
  const db = await dump();
  assert.ok(db.tables.jobs.some((j) => j.status === 'Approved'), 'jobs still store the fixed id');
  const stored = JSON.parse(db.tables.settings.find((s) => s.key === 'job_status_labels').value);
  assert.deepEqual(stored, { Approved: 'Accepted', Cancelled: 'Dropped' });

  // The saved names are re-read from the database.
  const readBack = (await admin('GET', '/api/job-statuses')).data.statuses;
  assert.equal(readBack.find((s) => s.id === 'Approved').label, 'Accepted');

  // Resetting to the default name simply stores nothing for that status.
  await admin('PUT', '/api/job-statuses', { labels: { Approved: 'Approved', Cancelled: 'Cancelled' } });
  const cleared = JSON.parse((await dump()).tables.settings.find((s) => s.key === 'job_status_labels').value);
  assert.deepEqual(cleared, {});
  assert.equal((await admin('GET', '/api/job-statuses')).data.statuses.find((s) => s.id === 'Approved').label, 'Approved');
});

// ---------------------------------------------------------------------------
// Calendar activities (v11): appointments/reminders that are NOT jobs.
// ---------------------------------------------------------------------------
test('calendar activities before the v11 migration: reported as unavailable, never an error', async () => {
  const admin = await login('owner@example.com', 'admin');
  const list = await admin('GET', '/api/clients/1/activities');
  assert.equal(list.status, 200);
  assert.equal(list.data.supported, false);
  assert.deepEqual(list.data.activities, []);
  assert.equal((await admin('GET', '/api/activities?from=2026-10-01&to=2026-10-31')).data.supported, false);
  assert.equal((await admin('POST', '/api/activities', { client_id: 1, title: 'x', activity_date: '2026-10-20' })).status, 409);
  assert.equal((await admin('GET', '/api/jobs/1/activities')).data.supported, false);
});

test('calendar activities: create, read, edit, complete, admin-only delete, access control, and no effect on jobs or money', async () => {
  await resetDb({ migrated: true });
  const admin = await login('owner@example.com', 'admin');
  const sam = await login('sam@example.com', 'user');
  const financeBefore = (await admin('GET', `/api/finance/summary?year=${YEAR}`)).data.calculated;

  // Create on client 2 (Bob Both — Sam's client): a time and a note, no job.
  let res = await admin('POST', '/api/activities', { client_id: 2, title: 'Send quote', activity_date: '2026-10-20', start_time: '18:45', notes: 'Email it' });
  assert.equal(res.status, 200);
  const a = res.data.activity;
  assert.deepEqual([a.client_id, a.client_name, a.title, a.activity_date, a.start_time, a.end_time, a.status], [2, 'Bob Both', 'Send quote', '2026-10-20', '18:45', null, 'pending']);
  assert.equal(a.job_id, null);

  // Read it three ways: by client, by range, by id.
  assert.equal((await admin('GET', '/api/clients/2/activities')).data.activities.length, 1);
  assert.equal((await admin('GET', '/api/activities?from=2026-10-01&to=2026-10-31')).data.activities.length, 1);
  assert.equal((await admin('GET', `/api/activities/${a.id}`)).data.activity.title, 'Send quote');
  assert.equal((await admin('GET', '/api/activities?from=2026-10-01&to=2026-10-31')).data.activities[0].client_name, 'Bob Both');

  // Edit text, complete it (stamps completed_at), then reopen.
  res = await admin('PUT', `/api/activities/${a.id}`, { notes: 'Sent', status: 'completed' });
  assert.equal(res.data.activity.notes, 'Sent');
  assert.ok(res.data.activity.completed_at, 'completing stamps completed_at');
  res = await admin('PUT', `/api/activities/${a.id}`, { status: 'pending' });
  assert.equal(res.data.activity.completed_at, null, 'reopening clears it');

  // Validation: title, real date, 24-hour time, end after start, status, client.
  const bad = [
    { client_id: 2, title: '', activity_date: '2026-10-20' },
    { client_id: 2, title: 'x', activity_date: '2026-02-30' },
    { client_id: 2, title: 'x', activity_date: '2026-10-20', start_time: '25:00' },
    { client_id: 2, title: 'x', activity_date: '2026-10-20', end_time: '10:00' },
    { client_id: 2, title: 'x', activity_date: '2026-10-20', start_time: '10:00', end_time: '09:00' },
    { client_id: 2, title: 'x', activity_date: '2026-10-20', status: 'nope' }
  ];
  for (const body of bad) assert.equal((await admin('POST', '/api/activities', body)).status, 400, JSON.stringify(body));
  assert.equal((await admin('POST', '/api/activities', { client_id: 999, title: 'x', activity_date: '2026-10-20' })).status, 404);

  // A linked job must belong to the same client (the schema enforces it too).
  assert.equal((await admin('POST', '/api/activities', { client_id: 2, job_id: 3, title: 'x', activity_date: '2026-10-20' })).status, 400, "job 3 belongs to another client");
  res = await admin('POST', '/api/activities', { client_id: 2, job_id: 2, title: 'Meet adjuster', activity_date: '2026-10-21' });
  assert.equal(res.status, 200);
  assert.deepEqual([res.data.activity.job_id, res.data.activity.job_title], [2, 'Gutter Job']);
  const linkedId = res.data.activity.id;

  // Access: Sam sees his client's activities, not another rep's.
  assert.equal((await sam('GET', '/api/clients/2/activities')).status, 200);
  assert.equal((await sam('GET', '/api/clients/3/activities')).status, 403);
  const samAdd = await sam('POST', '/api/activities', { client_id: 2, title: 'Call customer', activity_date: '2026-10-22' });
  assert.equal(samAdd.status, 200, 'a regular user can add on their own client');
  // ...but only admins delete.
  assert.equal((await sam('DELETE', `/api/activities/${samAdd.data.activity.id}`)).status, 403);
  assert.equal((await sam('DELETE', `/api/activities/${a.id}`)).status, 403);
  // Someone else's activity is invisible (same 404 as "not found").
  const riley = await login('riley@example.com', 'user');
  const rileyAct = await riley('POST', '/api/activities', { client_id: 3, title: 'R Call', activity_date: '2026-10-23' });
  assert.equal(rileyAct.status, 200);
  assert.equal((await sam('GET', `/api/activities/${rileyAct.data.activity.id}`)).status, 404);

  // None of this touched a job, the schedule or any money.
  const schedule = (await admin('GET', '/api/jobs/schedule')).data;
  const jobsBefore = (await admin('GET', '/api/jobs/client/2')).data.jobs.length;
  const expectedBefore = financeBefore.totalExpected;
  const financeAfter = (await admin('GET', `/api/finance/summary?year=${YEAR}`)).data.calculated;
  assert.equal(schedule.supported, true);
  assert.equal((await admin('GET', '/api/jobs/2')).data.job.status, 'Prospect', 'the job is untouched by its activity');
  assert.equal(jobsBefore, 2, 'no job was created');
  assert.equal(financeAfter.totalExpected, expectedBefore, 'activities never change Expected Earnings');
  assert.equal(financeAfter.totalRemaining, financeBefore.totalRemaining);

  // Admin delete works. Deleting a job clears the link but keeps the activity.
  assert.equal((await admin('DELETE', `/api/activities/${a.id}`)).status, 200);
  await admin('DELETE', '/api/jobs/2');
  const kept = (await admin('GET', '/api/clients/2/activities')).data.activities.find((x) => x.id === linkedId);
  assert.ok(kept, 'the activity survives its job');
  assert.equal(kept.job_id, null, 'the job link is cleared');
  // Deleting the client removes its activities (cascade).
  assert.equal((await admin('POST', '/api/delete-client', { id: 2 })).status, 200);
  assert.equal((await dump()).tables.calendar_activities.filter((x) => x.client_id === 2).length, 0);
  // ...and a regular user cannot delete a client at all.
  assert.equal((await sam('POST', '/api/delete-client', { id: 5 })).status, 403);
});

// ---------------------------------------------------------------------------
// Finance eligibility is driven by approval, and every figure reconciles.
// ---------------------------------------------------------------------------
test('Finance: only approved jobs count; approving, cancelling, paying off and refunds all reconcile with the drill-down', async () => {
  await resetDb({ migrated: true });
  const admin = await login('owner@example.com', 'admin');

  const summaryOf = () => admin('GET', `/api/finance/summary?year=${YEAR}`);
  const financeOf = async () => (await summaryOf()).data.calculated;

  // A brand-new job is a Prospect: it counts for nothing yet.
  const created = await admin('POST', '/api/jobs', { client_id: 2, title: 'Finance test job', total_due: 1000 });
  assert.equal(created.status, 200);
  const jobId = created.data.job.id;
  assert.equal(created.data.job.counts_in_finance, false, 'a Prospect is not counted in Finance');
  const base = await financeOf();

  // Approve it: its total and balance count from that moment, and the change
  // refreshes the stored year row so it agrees with the records again.
  await admin('PUT', `/api/jobs/${jobId}`, { status: 'Approved' });
  let f = await financeOf();
  assert.equal(f.totalExpected, base.totalExpected + 1000);
  assert.equal(f.totalRemaining, base.totalRemaining + 1000);
  assert.equal((await summaryOf()).data.matchesRecords, true, 'the stored year row was refreshed');

  // The Expected drill-down lists it and its rows add up to the card.
  let bd = (await admin('GET', `/api/finance/breakdown?year=${YEAR}&metric=expected`)).data;
  assert.equal(bd.total, f.totalExpected);
  assert.equal(bd.rows.filter((r) => r.job_id === jobId).length, 1);
  assert.ok(Math.abs(bd.rows.reduce((s, r) => s + r.total, 0) - bd.total) < 0.005, 'Expected rows add up to the card');

  // The Received and Clients drill-downs reconcile with their cards too.
  const receivedBd = (await admin('GET', `/api/finance/breakdown?year=${YEAR}&metric=received`)).data;
  assert.equal(receivedBd.total, f.totalReceived);
  assert.ok(Math.abs(receivedBd.rows.reduce((s, r) => s + r.amount, 0) - receivedBd.total) < 0.005, 'payment rows add up');
  const clientsBd = (await admin('GET', `/api/finance/breakdown?year=${YEAR}&metric=clients`)).data;
  assert.equal(clientsBd.total, f.totalClients);
  assert.equal(clientsBd.rows.length, f.totalClients, 'one row per client added this year');
  assert.equal((await admin('GET', `/api/finance/breakdown?year=${YEAR}&metric=bogus`)).status, 400);

  // Pay it off: Remaining drops to base, Expected is unchanged.
  await admin('POST', `/api/jobs/${jobId}/payment`, { amount: 1000 });
  f = await financeOf();
  assert.equal(f.totalExpected, base.totalExpected + 1000, 'receiving money does not change Expected');
  assert.equal(f.totalRemaining, base.totalRemaining, 'a fully paid job adds nothing to Remaining');
  bd = (await admin('GET', `/api/finance/breakdown?year=${YEAR}&metric=remaining`)).data;
  assert.equal(bd.rows.filter((r) => r.job_id === jobId).length, 0, 'fully paid jobs are not in Remaining');
  const receivedAfterPay = f.totalReceived;

  // A refund lowers Money Received and makes the balance owed again.
  await admin('POST', `/api/jobs/${jobId}/payment/reverse`, { amount: 400 });
  f = await financeOf();
  assert.equal(f.totalReceived, receivedAfterPay - 400, 'a refund lowers Money Received');
  assert.equal(f.totalRemaining, base.totalRemaining + 400, 'and the amount is owed again');

  // Back to Prospect: drops out of Expected and Remaining, but payments stay.
  await admin('PUT', `/api/jobs/${jobId}`, { status: 'Prospect' });
  f = await financeOf();
  assert.equal(f.totalExpected, base.totalExpected);
  assert.equal(f.totalRemaining, base.totalRemaining);
  assert.equal(f.totalReceived, receivedAfterPay - 400, 'payment history is never hidden');

  // Cancelled counts for nothing too...
  await admin('PUT', `/api/jobs/${jobId}`, { status: 'Cancelled' });
  f = await financeOf();
  assert.equal(f.totalExpected, base.totalExpected);
  assert.equal(f.totalRemaining, base.totalRemaining);
  assert.equal((await admin('GET', `/api/jobs/${jobId}`)).data.job.counts_in_finance, false);

  // ...and approving again brings it straight back, keeping its own figures.
  await admin('PUT', `/api/jobs/${jobId}`, { status: 'Approved' });
  f = await financeOf();
  assert.equal(f.totalExpected, base.totalExpected + 1000);
  assert.equal(f.totalRemaining, base.totalRemaining + 400, 'the refunded amount is owed again');

  // No double counting: Expected is exactly client accounts + counted jobs.
  const db = await dump();
  const countedStatuses = ['Approved', 'Completed', 'Invoice', 'Closed'];
  const inYear = (v) => new Date(v).getFullYear() === YEAR;
  const clientAccounts = db.tables.clients.filter((c) => inYear(c.created_at)).reduce((s, c) => s + Number(c.total_due || 0), 0);
  const countedJobs = db.tables.jobs.filter((j) => inYear(j.created_at) && countedStatuses.includes(j.status)).reduce((s, j) => s + Number(j.total_due || 0), 0);
  assert.equal(f.totalExpected, clientAccounts + countedJobs);
  const remainingAccounts = db.tables.clients.filter((c) => inYear(c.created_at)).reduce((s, c) => s + Number(c.balance || 0), 0);
  const remainingJobs = db.tables.jobs.filter((j) => inYear(j.created_at) && countedStatuses.includes(j.status)).reduce((s, j) => s + Number(j.balance || 0), 0);
  assert.equal(f.totalRemaining, remainingAccounts + remainingJobs);

  // Year boundaries: this year's changes never move last year's totals.
  const last = (await admin('GET', `/api/finance/overview?year=${YEAR - 1}`)).data;
  assert.equal(last.totals.revenue, 800 + 900);
});

// ---------------------------------------------------------------------------
// Admin-only deletions: a regular user is refused even on a client they can
// open, and never by relying on the frontend hiding the button.
// ---------------------------------------------------------------------------
test('admin-only deletions: regular users get 403 on every delete endpoint, and the same deletes work for an admin', async () => {
  await resetDb({ migrated: true });
  const admin = await login('owner@example.com', 'admin');
  const sam = await login('sam@example.com', 'user');

  // Sam is assigned clients 1 and 2, so access is not the limiting factor here.
  assert.equal((await sam('DELETE', '/api/v2/clients/1/services/1')).status, 403, 'remove a client service');
  assert.equal((await sam('DELETE', '/api/clients/2/notes/2')).status, 403, 'client note');
  assert.equal((await sam('DELETE', '/api/notes/delete/2/2')).status, 403, 'standalone note');
  assert.equal((await sam('DELETE', '/api/job-files/1/1')).status, 403, 'job file');
  assert.equal((await sam('DELETE', '/api/jobs/1')).status, 403, 'job');
  assert.equal((await sam('POST', '/api/delete-client', { id: 1 })).status, 403, 'client');

  // A client-level PDF (client 1) — the name comes from the list the user can read.
  const files = (await admin('GET', '/api/pdf/list/1')).data.files;
  assert.ok(files.length, 'seed has client-level PDFs');
  const nameParam = new URLSearchParams(files[0].viewUrl.split('?')[1]).get('name');
  assert.equal((await sam('DELETE', `/api/pdf/delete/1/${encodeURIComponent(nameParam)}`)).status, 403, 'client PDF');

  // Nothing was actually removed for the regular user.
  let db = await dump();
  assert.equal(db.tables.client_service.some((s) => s.id === 1), true);
  assert.equal(db.tables.notes.some((n) => n.id === 2), true);
  assert.equal(db.tables.job_files.some((f) => f.id === 1), true);

  // The same operations succeed for an admin (the gate is role-based, not broken).
  assert.equal((await admin('DELETE', '/api/notes/delete/1/1')).status, 200);
  assert.equal((await admin('DELETE', '/api/clients/2/notes/2')).status, 200);
  assert.equal((await admin('DELETE', '/api/job-files/1/1')).status, 200);
  assert.equal((await admin('DELETE', `/api/pdf/delete/1/${encodeURIComponent(nameParam)}`)).status, 200);
  assert.equal((await admin('DELETE', '/api/v2/clients/1/services/1')).status, 200);
  db = await dump();
  assert.equal(db.tables.notes.some((n) => n.id === 1), false);
  assert.equal(db.tables.notes.some((n) => n.id === 2), false);
  assert.equal(db.tables.job_files.some((f) => f.id === 1), false);
  assert.equal(db.tables.client_service.some((s) => s.id === 1), false);
});

// ---------------------------------------------------------------------------
// Download authorization — reads, not deletes. The route must scope the file
// to a client (or a job's client) the session is allowed to see, so guessing
// an id never helps.
// ---------------------------------------------------------------------------
test('client file downloads: an assigned user reads them, another user is denied, and guessing an id does not help', async () => {
  await resetDb({ migrated: true });
  const admin = await login('owner@example.com', 'admin');
  const sam = await login('sam@example.com', 'user');     // assigned clients 1, 2, 5
  const riley = await login('riley@example.com', 'user');  // assigned client 3

  // sam is assigned client 1: listing, viewing and downloading all work.
  const list = (await sam('GET', '/api/pdf/list/1')).data.files;
  assert.ok(list.length, 'assigned user can list the client’s files');
  assert.equal((await sam('GET', list[0].viewUrl)).status, 200);
  const dl = await sam('GET', list[0].downloadUrl);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition') || '', /attachment/);

  // riley is not assigned client 1: denied on list, view and by raw name+id.
  assert.equal((await riley('GET', '/api/pdf/list/1')).status, 403);
  assert.equal((await riley('GET', list[0].viewUrl)).status, 403);
  assert.equal((await riley('GET', '/api/pdf/file/1?name=' + encodeURIComponent('1690000000000-signed-estimate.pdf'))).status, 403);

  // A client sam is not assigned (3) stays denied however it is requested...
  assert.equal((await sam('GET', '/api/pdf/file/3?name=x.pdf')).status, 403);
  assert.equal((await sam('GET', '/api/pdf/list/3')).status, 403);
  // ...while a client sam IS assigned (2) is allowed.
  assert.equal((await sam('GET', '/api/pdf/list/2')).status, 200);

  // No path traversal: a name is reduced to its basename and cannot escape.
  assert.equal((await sam('GET', '/api/pdf/file/1?name=' + encodeURIComponent('../server.js'))).status, 404);
  // Only signed-in sessions may reach the route at all.
  assert.equal((await fetch(APP + '/api/pdf/list/1', { redirect: 'manual' })).status, 401);
  // The admin can still read every client's files.
  assert.equal((await admin('GET', '/api/pdf/list/3')).status, 200);
});

test('job-file downloads: only a user who can access the job’s client may download, and a file id cannot be paired with another job', async () => {
  await resetDb({ migrated: true });
  const admin = await login('owner@example.com', 'admin');
  const sam = await login('sam@example.com', 'user');     // assigned client 2 (jobs 1, 2)
  const riley = await login('riley@example.com', 'user');  // assigned client 3 (jobs 3, 4)

  // The seed stores files on job 1 (client 2). sam can list and download them.
  const files = (await sam('GET', '/api/job-files/1')).data.files;
  assert.equal(files.length, 2);
  const pdf = files.find((f) => f.file_name === 'contract.pdf');
  assert.ok(pdf, 'contract.pdf is on job 1');
  const dl = await sam('GET', `/api/job-files/1/${pdf.id}/download`);
  assert.equal(dl.status, 200);
  assert.equal(dl.data.slice(0, 5).toString(), '%PDF-', 'real file bytes are served');

  // riley cannot reach client 2's job at all — not even by id.
  assert.equal((await riley('GET', '/api/job-files/1')).status, 403);
  assert.equal((await riley('GET', `/api/job-files/1/${pdf.id}/download`)).status, 403);

  // A file id from job 1 paired with another job sam CAN access (job 2) is
  // scoped to the job, so it is not found — never served across jobs.
  assert.equal((await sam('GET', `/api/job-files/2/${pdf.id}/download`)).status, 404);
  // A job whose client sam cannot access keeps the whole route denied.
  assert.equal((await sam('GET', '/api/job-files/3/1/download')).status, 403);
  // Guessed, nonexistent ids are 404 (job) and 404 (file), never a leak.
  assert.equal((await sam('GET', '/api/job-files/999/1/download')).status, 404);
  assert.equal((await sam('GET', `/api/job-files/1/999/download`)).status, 404);

  // Upload/view parity: a regular user may read a permitted job's file but not
  // remove it — the admin-only delete gate still holds.
  assert.equal((await sam('DELETE', `/api/job-files/1/${pdf.id}`)).status, 403);
  assert.equal((await admin('DELETE', `/api/job-files/1/${pdf.id}`)).status, 200);
});

// ---------------------------------------------------------------------------
// Persistent manual Finance overrides. A saved override is administrator
// intent: recalculation must move the recorded figures without replacing it.
// ---------------------------------------------------------------------------
test('manual Finance overrides persist across job and payment changes while the calculated figures keep updating', async () => {
  await resetDb({ migrated: true });
  const admin = await login('owner@example.com', 'admin');
  const summaryOf = () => admin('GET', `/api/finance/summary?year=${YEAR}`);

  // Fresh seed: the stored year row (7000) is shown, but it is NOT a manual
  // override, and the records add up to 8,440.
  let s = (await summaryOf()).data;
  assert.equal(s.totalExpected, 7000, 'the seeded year row is displayed');
  assert.equal(s.hasOverride, false, 'no manual override is active yet');
  assert.equal(s.override, null);
  assert.equal(s.calculated.totalExpected, 8440, 'records add up to 8,440');

  // An admin saves a manual override.
  const save = await admin('POST', '/api/finance/save', { year: YEAR, totalExpected: 7000, totalReceived: 3200, totalRemaining: 3000, totalClients: 4 });
  assert.equal(save.status, 200);
  s = (await summaryOf()).data;
  assert.equal(s.hasOverride, true);
  assert.equal(s.totalExpected, 7000);
  assert.deepEqual(s.override, { totalClients: 4, totalExpected: 7000, totalReceived: 3200, totalRemaining: 3000 }, 'the API separates override from calculated');

  // A job change keeps the override selected while the calculated value moves.
  const created = await admin('POST', '/api/jobs', { client_id: 2, title: 'Override persistence job', total_due: 1000 });
  const jobId = created.data.job.id;
  await admin('PUT', `/api/jobs/${jobId}`, { status: 'Approved' });
  s = (await summaryOf()).data;
  assert.equal(s.totalExpected, 7000, 'the manual override survives a job change');
  assert.equal(s.hasOverride, true);
  assert.equal(s.calculated.totalExpected, 9440, 'the records figure still updates');
  assert.equal(s.matchesRecords, false, 'a displayed override differs from the records');

  // ...and a payment change keeps it too (client payments are a PUT).
  assert.equal((await admin('PUT', '/api/clients/2/payment', { payment: 250 })).status, 200);
  s = (await summaryOf()).data;
  assert.equal(s.totalExpected, 7000, 'the manual override survives a payment change');
  assert.equal(s.hasOverride, true);

  // Recalculation does not replace the override, but the stored snapshot moves.
  const rec = await admin('POST', '/api/finance/recalculate', { year: YEAR });
  assert.equal(rec.status, 200);
  assert.equal(rec.data.totals.total_expected, 9440, 'the stored snapshot tracks the records');
  s = (await summaryOf()).data;
  assert.equal(s.totalExpected, 7000, 'recalculate never overwrites the override');

  // Clearing returns the year to the calculated figures.
  const clear = await admin('POST', '/api/finance/save', { year: YEAR, clear: true });
  assert.equal(clear.status, 200);
  assert.equal(clear.data.cleared, true);
  s = (await summaryOf()).data;
  assert.equal(s.hasOverride, false);
  assert.equal(s.totalExpected, s.calculated.totalExpected, 'the cleared year shows the calculated figures');
  assert.equal(s.matchesRecords, true);
});

test('manual Finance overrides: only admins may set or clear them', async () => {
  await resetDb({ migrated: true });
  const sam = await login('sam@example.com', 'user');
  assert.equal((await sam('POST', '/api/finance/save', { year: YEAR, totalExpected: 1 })).status, 403, 'a regular user cannot set an override');
  assert.equal((await sam('POST', '/api/finance/save', { year: YEAR, clear: true })).status, 403, 'a regular user cannot clear an override');
  const db = await dump();
  assert.equal(db.tables.settings.some((row) => String(row.key).startsWith('finance_override:')), false, 'nothing was written');
});

test('the Finance drill-down discloses an active manual override and keeps the calculated rows', async () => {
  await resetDb({ migrated: true });
  const admin = await login('owner@example.com', 'admin');
  await admin('POST', '/api/finance/save', { year: YEAR, totalExpected: 7000, totalReceived: 3200, totalRemaining: 3000, totalClients: 4 });

  const bd = (await admin('GET', `/api/finance/breakdown?year=${YEAR}&metric=expected`)).data;
  assert.equal(bd.total, 8440, 'the rows still add up to the records figure');
  assert.equal(bd.stored, 7000, 'the active override is disclosed');

  // Client counts stay counts, not money.
  const clientsBd = (await admin('GET', `/api/finance/breakdown?year=${YEAR}&metric=clients`)).data;
  assert.equal(clientsBd.total, clientsBd.rows.length);
  assert.equal(typeof clientsBd.total, 'number');
});

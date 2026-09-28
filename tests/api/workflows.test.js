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

// One session per role per app process — the login endpoint is rate
// limited (20 attempts / 15 min). Cleared whenever the app restarts.
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

test('regular users keep their permissions: view job services/totals, but no prices, payments, cost or other clients', async () => {
  const sam = await login('sam@example.com', 'user');
  const jobs = await sam('GET', '/api/jobs/client/2');
  assert.equal(jobs.status, 200);
  for (const j of jobs.data.jobs) {
    assert.equal(j.job_cost, undefined, 'job cost stays admin-only');
    assert.equal(typeof j.total_due, 'number');
  }
  const items = await sam('GET', '/api/jobs/1/line-items');
  assert.equal(items.status, 200, 'services visible (they are on the PDFs sam can download)');
  assert.equal(items.data.lineItems.length, 2);
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
  assert.equal(userJob.data.job.total_due, 0);
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

test('Finance totals count client-level amounts plus jobs, by year', async () => {
  const admin = await login('owner@example.com', 'admin');
  const db = await dump();
  const yearOf = (v) => new Date(v).getFullYear();
  const clients = db.tables.clients.filter((c) => yearOf(c.created_at) === YEAR);
  const jobs = db.tables.jobs.filter((j) => yearOf(j.created_at) === YEAR);
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

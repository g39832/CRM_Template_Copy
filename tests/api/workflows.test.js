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
  assert.equal(overview.totals.cost, 3500 + 400 + 1200 + 725.5 + 40 + 40);
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
  // Clients created this year: Alice 5000/3500, Bob 1200/400; jobs 1-4.
  assert.equal(d.totals.revenue, 5000 + 1200 + 2000 + 1500 + 120 + 120);
  assert.equal(d.totals.cost, 3500 + 400 + 1200 + 700 + 40 + 40);
  assert.equal(d.totals.profit, d.totals.revenue - d.totals.cost);
  assert.equal(d.totals.received, 3200);
  assert.equal(d.monthly.reduce((s, m) => s + m.received, 0), d.totals.received);
  assert.equal(d.monthly[1].received, 2000);
  assert.equal(d.salespeople.reduce((s, p) => s + p.revenue, 0), d.totals.revenue);
  assert.deepEqual(d.salespeople.map((p) => p.name), ['Sam Sales', 'Riley Rep']);
  const cats = Object.fromEntries(d.costByCategory.map((c) => [c.name, c.amount]));
  assert.deepEqual(cats, { Materials: 700, Labor: 500, 'Client account costs': 3900, 'Job costs not itemized': 780 });
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

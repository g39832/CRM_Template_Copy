// End-to-end tests for the client overview + "+ Job" workspace redesign.
//
// These create, edit and delete records, so they only run against the
// in-memory Supabase stand-in:  npm run test:local
// (playwright.config.js — the real-project suite — ignores this file.)
//
// The database is reset to the seed before every test (tests/mock-supabase/
// seed.js), so each test starts from the same realistic data.
const { test, expect } = require('@playwright/test');
const { MOCK_URL, prepareUploads, PDF_BYTES, PNG_BYTES } = require('./local-env');
const { findLowContrast } = require('./contrast-audit');

test.skip(process.env.CRM_LOCAL_MOCK !== '1', 'Writes data — runs only against the local mock (npm run test:local).');

const DESKTOP = 'desktop-1440';
// Heavy data flows run on a few representative devices; layout checks run on all.
const onlyOn = (names) => test.skip(!names.includes(test.info().project.name), `Runs on ${names.join(', ')}`);

// Default state matches production today (optional migrations not run);
// expense-category tests reset with { migrated: true }.
async function resetDb({ migrated = false } = {}) {
  const res = await fetch(`${MOCK_URL}/__reset`, { method: 'POST', body: JSON.stringify({ migrated }) });
  if (!res.ok) throw new Error('mock reset failed');
  prepareUploads();
}

async function dump() {
  return (await fetch(`${MOCK_URL}/__dump`)).json();
}

// One session per role for the whole run — the login endpoint is rate
// limited (20 attempts / 15 min). Sessions live in the server's memory, so
// they stay valid when the database is reset between tests.
const sessions = new Map();
async function loginAs(page, email, role) {
  const key = email + '|' + role;
  if (sessions.has(key)) {
    await page.context().clearCookies();
    await page.context().addCookies(sessions.get(key));
    return;
  }
  const res = await page.request.post('/api/v2/auth/test-login', { data: { email, role } });
  expect(res.ok(), `test-login ${res.status()}`).toBeTruthy();
  sessions.set(key, (await page.context().storageState()).cookies);
}

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 500 && r.url().includes('/api/')) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return errors;
}

async function openClient(page, name) {
  await page.goto('/main', { waitUntil: 'networkidle' });
  await page.locator('.client-card', { hasText: name }).first().click();
  const panel = page.locator('#projectPanel');
  await expect(panel.locator('#p-address')).toBeVisible();
  await expect(panel.locator('#jobs-list .jobs-empty', { hasText: 'Loading' })).toHaveCount(0);
  return panel;
}

async function openJob(page, title) {
  await page.locator('#jobs-list .job-row', { hasText: title }).click();
  const job = page.locator('#jobPanelOverlay');
  await expect(job).toBeVisible();
  await expect(job.locator('#job-line-items-list', { hasText: 'Loading services' })).toHaveCount(0);
  return job;
}

async function closeJob(page) {
  await page.locator('#closeJobPanel').click();
  await expect(page.locator('#jobPanelOverlay')).toHaveCount(0);
}

const tileValue = (page, id) => page.locator(`#${id} .total-tile-value`);

test.beforeEach(async ({ page }) => {
  await resetDb();
  page.on('dialog', (d) => d.accept());
});

// ---------------------------------------------------------------------------
test.describe('homepage', () => {
  test('sort by salesperson / technician / year; filters replace min/max revenue; no One-off/Recurring wording', async ({ page }) => {
    const errors = trackErrors(page);
    await loginAs(page, 'owner@example.com', 'admin');
    await page.goto('/main', { waitUntil: 'networkidle' });

    await expect(page.locator('#filterRevenueMin, #filterRevenueMax, #filterType')).toHaveCount(0);
    await expect(page.locator('.sidebar')).not.toContainText(/one-off|recurring/i);
    await expect(page.locator('.client-card')).toHaveCount(5);

    await page.selectOption('#sortClients', 'salesperson');
    const headers = page.locator('.client-group-header');
    await expect(headers).toHaveText([/Riley Rep\s*1/, /Sam Sales\s*3/, /Unassigned\s*1/]);

    await page.selectOption('#sortClients', 'year');
    const year = new Date().getFullYear();
    await expect(headers.first()).toContainText(String(year));
    await expect(page.locator('.client-card').last()).toHaveAttribute('data-name', 'Eve Closed');

    await page.locator('#filterToggleBtn').click();
    await page.selectOption('#filterSalesperson', 'Sam Sales');
    await expect(page.locator('.client-card')).toHaveCount(3);
    await page.selectOption('#filterYear', String(year - 1));
    await expect(page.locator('.client-card')).toHaveCount(1);
    await expect(page.locator('#filterToggleBtn')).toHaveClass(/has-active-filters/);
    await page.locator('#clearFilterBtn').click();
    await expect(page.locator('.client-card')).toHaveCount(5);
    expect(errors).toEqual([]);
  });

  test('technician set on a client shows on its card and can be sorted and filtered', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390']);
    await loginAs(page, 'owner@example.com', 'admin');
    const panel = await openClient(page, 'Bob Both');
    await panel.locator('#p-technician').fill('Tom Tech');
    await expect(panel.locator('#saveStatus')).toHaveText('Unsaved changes');
    await panel.locator('#closeBtn').click();
    await expect(panel).toBeHidden();

    await expect(page.locator('.client-card', { hasText: 'Bob Both' })).toContainText('Tom Tech');
    await page.selectOption('#sortClients', 'technician');
    await expect(page.locator('.client-group-header').first()).toContainText('Tom Tech');
    await page.locator('#filterToggleBtn').click();
    await page.selectOption('#filterTechnician', 'Tom Tech');
    await expect(page.locator('.client-card')).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
test.describe('client overview', () => {
  test('condensed page: rolled-up totals, people, jobs with + Job last, and no job-level tools', async ({ page }) => {
    const errors = trackErrors(page);
    await loginAs(page, 'owner@example.com', 'admin');
    const panel = await openClient(page, 'Bob Both');

    // Jobs 2000 + 1500 plus 1200 recorded on the client itself.
    await expect(tileValue(page, 'totalDueTile')).toHaveText('$4,700.00');
    await expect(tileValue(page, 'receivedTile')).toHaveText('$1,700.00');
    await expect(tileValue(page, 'balanceTile')).toHaveText('$3,000.00');
    await expect(tileValue(page, 'costTile')).toHaveText('$2,300.00');

    await expect(panel.locator('#p-assigned-user')).toHaveValue(/.+/);
    await expect(panel.locator('#p-assigned-user option:checked')).toHaveText('Sam Sales');
    await expect(panel.locator('#p-technician')).toBeVisible();

    const rows = panel.locator('#jobs-list > *');
    await expect(rows.last()).toHaveId('quick-add-job-btn');
    await expect(rows.last()).toHaveText('+ Job');
    await expect(panel.locator('#jobs-list .job-row[data-job-id]')).toHaveCount(2);
    await expect(panel.locator('#jobs-list [data-client-account]')).toContainText('Client account');

    // Detailed tools moved into jobs / client account.
    for (const sel of ['#pdf-drop-zone', '#pdf-upload-btn', '#totalDueInput', '#paymentInput', '#jobCostInput', '#add-scope-service-btn', '#estimateBtn', '#invoiceBtn']) {
      await expect(panel.locator(sel)).toHaveCount(0);
    }
    await expect(panel).not.toContainText(/one-off|recurring/i);
    expect(errors).toEqual([]);
  });

  test('client with no jobs and no client-level data shows just + Job', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'owner@example.com', 'admin');
    const panel = await openClient(page, 'Dan Lead');
    await expect(panel.locator('#jobs-list [data-client-account]')).toHaveCount(0);
    await expect(panel.locator('#jobs-list .jobs-empty')).toContainText('No jobs yet');
    await expect(tileValue(page, 'totalDueTile')).toHaveText('$0.00');
  });

  test('editing client info saves on X and survives reopening', async ({ page }) => {
    onlyOn([DESKTOP, 'tablet-768']);
    await loginAs(page, 'owner@example.com', 'admin');
    let panel = await openClient(page, 'Dan Lead');
    await panel.locator('#p-name').fill('Dan Lead-Smith');
    await panel.locator('#p-phone').fill('555-7777');
    await panel.locator('#p-status').selectOption('Prospect');
    await panel.locator('#closeBtn').click();
    await expect(panel).toBeHidden();

    const db = await dump();
    const dan = db.tables.clients.find((c) => c.id === 4);
    expect(dan.name).toBe('Dan Lead-Smith');
    expect(dan.phone).toBe('555-7777');
    expect(dan.status).toBe('Prospect');

    panel = await openClient(page, 'Dan Lead-Smith');
    await expect(panel.locator('#p-phone')).toHaveValue('555-7777');
  });

  test('client notes are collapsed, work, and do not include job notes', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'owner@example.com', 'admin');
    const panel = await openClient(page, 'Bob Both');
    const details = panel.locator('#client-notes-details');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(details.locator('summary')).toContainText('(1)');
    await details.locator('summary').click();
    await expect(panel.locator('#notes-list')).toContainText('Gate code 1234');
    await expect(panel.locator('#notes-list')).not.toContainText('Dumpster arrives Monday');

    await panel.locator('#new-note-input').fill('Call before arriving');
    await panel.locator('#add-note-btn').click();
    await expect(panel.locator('#notes-list')).toContainText('Call before arriving');
    await expect(details.locator('summary')).toContainText('(2)');
  });

  test('notes show when they were created; editing keeps the original time', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'owner@example.com', 'admin');
    const panel = await openClient(page, 'Bob Both');
    await panel.locator('#client-notes-details summary').click();

    // The seeded note shows an exact, machine-readable creation time.
    const seeded = panel.locator('#notes-list .note-timestamp').first();
    await expect(seeded).toBeVisible();
    await expect(seeded).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
    await expect(seeded).toContainText(/\d{4}/);

    // A new note is timestamped automatically by the server.
    await panel.locator('#new-note-input').fill('Timestamped note');
    await panel.locator('#add-note-btn').click();
    const row = panel.locator('#notes-list > div', { hasText: 'Timestamped note' });
    const stamp = row.locator('.note-timestamp');
    await expect(stamp).toBeVisible();
    // A note created just now also gets the relative hint.
    await expect(row.locator('.note-relative')).toBeVisible();
    const iso = await stamp.getAttribute('datetime');
    expect(Number.isFinite(new Date(iso).getTime())).toBeTruthy();

    // Editing never resets the creation time. (Once editing starts the text
    // lives in a textarea, so target the editor directly instead of hasText.)
    await row.locator('button', { hasText: 'Edit' }).click();
    const editor = panel.locator('#notes-list textarea');
    await editor.fill('Timestamped note edited');
    await panel.locator('#notes-list button', { hasText: 'Save' }).click();
    const edited = panel.locator('#notes-list > div', { hasText: 'Timestamped note edited' });
    await expect(edited.locator('.note-timestamp')).toHaveAttribute('datetime', iso);

    // A note with no usable timestamp renders safely (never "Invalid Date").
    const blank = await page.evaluate(() => (typeof formatNoteTimestamp === 'function'
      ? [formatNoteTimestamp(''), formatNoteTimestamp(null), formatNoteTimestamp('not-a-date')]
      : 'MISSING'));
    expect(blank).toEqual(['', '', '']);
  });
});

// ---------------------------------------------------------------------------
test.describe('+ Job workspace', () => {
  test('recurring work: + Job copying last month suggests the next month and brings its services', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390']);
    const errors = trackErrors(page);
    await loginAs(page, 'owner@example.com', 'admin');
    const panel = await openClient(page, 'Carla Jobs');
    await panel.locator('#quick-add-job-btn').click();
    const modal = page.locator('#newJobModalOverlay');
    await expect(modal).toBeVisible();
    await modal.locator('#new-job-copy-from').selectOption({ label: 'Copy of: September Maintenance' });
    await expect(modal.locator('#new-job-title')).toHaveValue('October Maintenance');
    await expect(modal.locator('#new-job-source-summary')).toContainText('Maintenance Visit');
    await modal.locator('#createJobBtn').click();

    const job = page.locator('#jobPanelOverlay');
    await expect(job.locator('#job-title')).toHaveValue('October Maintenance');
    await expect(job.locator('#job-total-display')).toHaveText('$120.00');
    await expect(job.locator('.job-service-row')).toHaveCount(1);
    await closeJob(page);

    await expect(panel.locator('#jobs-list .job-row', { hasText: 'October Maintenance' })).toBeVisible();
    await expect(tileValue(page, 'totalDueTile')).toHaveText('$360.00');
    const db = await dump();
    expect(db.tables.jobs.filter((j) => j.title === 'October Maintenance')).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('services: + Service, inline edit, remove, custom line item — total, profit and margin follow', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390', 'tablet-768']);
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Carla Jobs');
    const job = await openJob(page, 'September Maintenance');
    await expect(job.locator('#job-total-display')).toHaveText('$120.00');
    await expect(job.locator('#job-total')).toHaveJSProperty('readOnly', true);

    await job.locator('#job-add-service-btn').click();
    const picker = page.locator('#servicePresetPickerOverlay');
    await picker.locator('label', { hasText: 'Gutter Cleaning' }).click();
    await picker.locator('#presetPickerConfirm').click();
    await expect(picker).toHaveCount(0);
    await expect(job.locator('#job-total-display')).toHaveText('$300.00');

    const gutter = job.locator('.job-service-row', { has: page.locator('input[value="Gutter Cleaning"]') });
    await gutter.locator('[data-field="quantity"]').fill('2');
    await gutter.locator('[data-field="quantity"]').blur();
    await expect(job.locator('#job-total-display')).toHaveText('$480.00');

    await job.locator('#job-add-line-btn').click();
    await job.locator('#li-description').fill('Disposal fee');
    await job.locator('#li-unit-price').fill('20');
    await job.locator('#li-add-btn').click();
    await expect(job.locator('#job-total-display')).toHaveText('$500.00');

    await job.locator('.job-service-row', { has: page.locator('input[value="Disposal fee"]') }).locator('.li-remove').click();
    await expect(job.locator('#job-total-display')).toHaveText('$480.00');

    await job.locator('#job-cost').fill('180');
    await expect(job.locator('#job-profit-display')).toHaveText('$300.00');
    await expect(job.locator('#job-margin-display')).toHaveText('Margin 63%');
    await closeJob(page);

    const db = await dump();
    const saved = db.tables.jobs.find((j) => j.id === 4);
    expect(saved.total_due).toBe(480);
    expect(saved.job_cost).toBe(180);
    expect(db.tables.job_line_items.filter((i) => i.job_id === 4).map((i) => [i.description, i.quantity])).toEqual([
      ['Maintenance Visit', 1], ['Gutter Cleaning', 2]
    ]);
  });

  test('default services can be removed and replaced through + Service', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Carla Jobs');
    const job = await openJob(page, 'September Maintenance');
    await job.locator('.job-service-row .li-remove').click();
    await expect(job.locator('.job-service-row')).toHaveCount(0);
    await expect(job.locator('#job-total-display')).toHaveText('$0.00');
    await job.locator('#job-add-service-btn').click();
    await page.locator('#servicePresetPickerOverlay label', { hasText: 'Shingle Repair' }).click();
    await page.locator('#presetPickerConfirm').click();
    await expect(job.locator('#job-total-display')).toHaveText('$400.00');
    await closeJob(page);
    const db = await dump();
    expect(db.tables.job_line_items.filter((i) => i.job_id === 4).map((i) => i.description)).toEqual(['Shingle Repair']);
    expect(db.tables.jobs.find((j) => j.id === 4).total_due).toBe(400);
  });

  test('Manage Presets opens on top of the service picker and new presets appear in it', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Bob Both');
    const job = await openJob(page, 'Gutter Job');
    await job.locator('#job-add-service-btn').click();
    await page.locator('#presetPickerManage').click();
    const manage = page.locator('#manageServicesOverlay');
    await expect(manage).toBeVisible();
    await manage.locator('#newSvcName').fill('Roof Wash');
    await manage.locator('#newSvcRate').fill('75');
    await manage.locator('#addSvcBtn').click(); // clickable → it is the top layer
    await expect(manage.locator('#manageServicesList')).toContainText('Roof Wash');
    await manage.locator('#manageServicesDoneBtn').click();
    await expect(page.locator('#servicePresetPickerOverlay')).toContainText('Roof Wash');
  });

  test('first service on a hand-priced job offers to keep the old total', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Bob Both');
    const job = await openJob(page, 'Gutter Job');
    await expect(job.locator('#job-total')).toHaveJSProperty('readOnly', false);
    await job.locator('#job-add-service-btn').click();
    await page.locator('#servicePresetPickerOverlay label', { hasText: 'Gutter Cleaning' }).click();
    await page.locator('#presetPickerConfirm').click(); // confirm() is accepted → keep $1,500
    await expect(job.locator('#job-total-display')).toHaveText('$1,680.00');
    await expect(job.locator('input[value="Job total (entered before services)"]')).toBeVisible();
  });

  test('payments: add and undo update Received/Balance and the client totals, with no duplicate records', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390']);
    await loginAs(page, 'owner@example.com', 'admin');
    const panel = await openClient(page, 'Bob Both');
    const job = await openJob(page, 'Gutter Job');
    await job.locator('#job-payment-input').fill('400');
    await job.locator('#job-add-payment-btn').click();
    await expect(job.locator('#job-paid-display')).toHaveText('$400.00');
    await expect(job.locator('#job-balance-display')).toHaveText('$1,100.00');
    await job.locator('#job-payment-input').fill('100');
    await job.locator('#job-add-payment-btn').click();
    await expect(job.locator('#job-paid-display')).toHaveText('$500.00');
    await job.locator('#job-undo-payment-btn').click();
    await expect(job.locator('#job-paid-display')).toHaveText('$400.00');
    await closeJob(page);

    await expect(tileValue(page, 'receivedTile')).toHaveText('$2,100.00');
    await expect(panel.locator('#jobs-list .job-row', { hasText: 'Gutter Job' })).toContainText('$400.00');
    const pays = (await dump()).tables.payments.filter((p) => p.client_id === 2).map((p) => p.amount);
    expect(pays.sort((a, b) => a - b)).toEqual([-100, 100, 400, 1200]);
  });

  test('X saves everything typed but not submitted — once — and closing again writes nothing new', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390', 'tablet-768']);
    await loginAs(page, 'owner@example.com', 'admin');
    const panel = await openClient(page, 'Bob Both');
    let job = await openJob(page, 'Gutter Job');
    await job.locator('#job-title').fill('Gutter Job (east side)');
    await job.locator('#job-status').selectOption('Approved');
    await job.locator('#job-scope').fill('Replace east gutters');
    await job.locator('#job-cost').fill('750');
    await job.locator('#job-payment-input').fill('250');
    await job.locator('#job-new-note-input').fill('Customer wants copper');
    await expect(job.locator('#jobSaveStatus')).toHaveText('Unsaved changes');
    await closeJob(page);

    await expect(panel.locator('#jobs-list .job-row', { hasText: 'Gutter Job (east side)' })).toBeVisible();
    let db = await dump();
    const saved = db.tables.jobs.find((j) => j.id === 2);
    expect(saved).toMatchObject({ title: 'Gutter Job (east side)', status: 'Approved', scope_of_work: 'Replace east gutters', job_cost: 750, amount_paid: 250 });
    expect(db.tables.payments.filter((p) => p.client_id === 2 && p.amount === 250)).toHaveLength(1);
    expect(db.tables.notes.filter((n) => n.job_id === 2 && n.content === 'Customer wants copper')).toHaveLength(1);
    const counts = { payments: db.tables.payments.length, notes: db.tables.notes.length, jobs: db.tables.jobs.length };

    job = await openJob(page, 'Gutter Job (east side)');
    await expect(job.locator('#job-notes-list')).toContainText('Customer wants copper');
    await expect(job.locator('#jobSaveStatus')).toHaveText('Saved');
    await closeJob(page);
    db = await dump();
    expect({ payments: db.tables.payments.length, notes: db.tables.notes.length, jobs: db.tables.jobs.length }).toEqual(counts);
  });

  test('if saving fails, the workspace stays open and nothing typed is lost', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Bob Both');
    const job = await openJob(page, 'Gutter Job');
    await job.locator('#job-scope').fill('Must not be lost');
    await page.route('**/api/jobs/2', (route) => route.request().method() === 'PUT'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Simulated outage"}' })
      : route.continue());
    await page.locator('#closeJobPanel').click();
    await expect(page.locator('.toast.error')).toContainText('still open');
    await expect(job).toBeVisible();
    await expect(job.locator('#job-scope')).toHaveValue('Must not be lost');
    await page.unroute('**/api/jobs/2');
    await closeJob(page);
    expect((await dump()).tables.jobs.find((j) => j.id === 2).scope_of_work).toBe('Must not be lost');
  });

  test('Escape closes the top layer first and saves', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'owner@example.com', 'admin');
    const panel = await openClient(page, 'Bob Both');
    const job = await openJob(page, 'Gutter Job');
    await job.locator('#job-add-service-btn').click();
    await expect(page.locator('#servicePresetPickerOverlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#servicePresetPickerOverlay')).toHaveCount(0);
    await expect(job).toBeVisible();
    await job.locator('#job-scope').fill('Saved by Escape');
    await page.keyboard.press('Escape');
    await expect(job).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect.poll(async () => (await dump()).tables.jobs.find((j) => j.id === 2).scope_of_work).toBe('Saved by Escape');
  });

  test('documents, PDFs and photos live in the job; older client PDFs stay reachable', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390']);
    const errors = trackErrors(page);
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Bob Both');
    const job = await openJob(page, 'Roof Replacement');
    await expect(job.locator('#job-documents-list')).toContainText('contract.pdf');
    await expect(job.locator('#job-photos-list img')).toHaveCount(1);
    const clientFiles = job.locator('#job-client-files');
    await expect(clientFiles).toContainText('old-quote.pdf');

    const viewHref = await clientFiles.locator('a.job-file-name').first().getAttribute('href');
    const view = await page.request.get(viewHref);
    expect(view.status()).toBe(200);
    expect((await view.body()).subarray(0, 5).toString()).toBe('%PDF-');

    await job.locator('#job-documents-input').setInputFiles({ name: 'permit.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES });
    await expect(job.locator('#job-documents-list')).toContainText('permit.pdf');
    await job.locator('#job-photos-input').setInputFiles({ name: 'after.png', mimeType: 'image/png', buffer: PNG_BYTES });
    await expect(job.locator('#job-photos-list img')).toHaveCount(2);

    const permitRow = job.locator('#job-documents-list .job-file-row', { hasText: 'permit.pdf' });
    const href = await permitRow.locator('a.job-file-name').getAttribute('href');
    expect((await page.request.get(href)).status()).toBe(200);
    await permitRow.locator('.job-file-delete-btn').click();
    await expect(job.locator('#job-documents-list')).not.toContainText('permit.pdf');

    const files = (await dump()).tables.job_files.filter((f) => f.job_id === 1).map((f) => f.file_name).sort();
    expect(files).toEqual(['after.png', 'before.png', 'contract.pdf']);
    expect(errors).toEqual([]);
  });

  test('job notes: add, edit, delete; an open edit is saved when the job closes', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Bob Both');
    let job = await openJob(page, 'Roof Replacement');
    await job.locator('#job-new-note-input').fill('Crew of four');
    await job.locator('#job-add-note-btn').click();
    await expect(job.locator('#job-notes-list')).toContainText('Crew of four');
    // Job notes carry their creation time too.
    await expect(job.locator('.job-note-row', { hasText: 'Crew of four' }).locator('.note-timestamp')).toBeVisible();

    const row = job.locator('.job-note-row', { hasText: 'Dumpster arrives Monday' });
    await row.locator('button', { hasText: 'Edit' }).click();
    await job.locator('.job-note-edit-textarea').fill('Dumpster arrives Tuesday');
    await closeJob(page);
    let notes = (await dump()).tables.notes.filter((n) => n.job_id === 1).map((n) => n.content).sort();
    expect(notes).toEqual(['Crew of four', 'Dumpster arrives Tuesday']);

    job = await openJob(page, 'Roof Replacement');
    await job.locator('.job-note-row', { hasText: 'Crew of four' }).locator('button', { hasText: 'Delete' }).click();
    await expect(job.locator('#job-notes-list')).not.toContainText('Crew of four');
    notes = (await dump()).tables.notes.filter((n) => n.job_id === 1).map((n) => n.content);
    expect(notes).toEqual(['Dumpster arrives Tuesday']);
  });

  test('duplicate creates next month\'s job; delete removes a job but keeps its payments', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'owner@example.com', 'admin');
    const panel = await openClient(page, 'Carla Jobs');
    const job = await openJob(page, 'August Maintenance');
    await job.locator('#job-duplicate-btn').click();
    await expect(page.locator('#jobPanelOverlay #job-title')).toHaveValue('September Maintenance');
    await closeJob(page);
    await expect(panel.locator('#jobs-list .job-row', { hasText: 'September Maintenance' })).toHaveCount(2);

    const aug = await openJob(page, 'August Maintenance');
    await aug.locator('#job-delete-btn').click();
    await expect(page.locator('#jobPanelOverlay')).toHaveCount(0);
    await expect(panel.locator('#jobs-list .job-row', { hasText: 'August Maintenance' })).toHaveCount(0);
    const db = await dump();
    expect(db.tables.jobs.find((j) => j.id === 3)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
test.describe('client account (client-level data before jobs)', () => {
  test('older client-level money, services and PDFs are all still editable', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390']);
    await loginAs(page, 'owner@example.com', 'admin');
    const panel = await openClient(page, 'Alice Legacy');
    await expect(tileValue(page, 'totalDueTile')).toHaveText('$5,000.00');
    await expect(tileValue(page, 'costTile')).toHaveText('$3,500.00');
    await panel.locator('[data-client-account]').click();
    const acct = page.locator('#clientAccountOverlay');
    await expect(acct.locator('#acct-total-display')).toHaveText('$5,000.00');
    await expect(acct.locator('#scope-services-list')).toContainText('Roof Inspection');
    await expect(acct.locator('#pdf-list')).toContainText('signed-estimate.pdf');

    await acct.locator('#paymentInput').fill('100');
    await acct.locator('#addPaymentBtn').click();
    await expect(acct.locator('#amountPaidDisplay')).toHaveText('$2,100.00');
    await acct.locator('#undoFinanceBtn').click();
    await expect(acct.locator('#amountPaidDisplay')).toHaveText('$2,000.00');

    await acct.locator('#add-scope-service-btn').click();
    await page.locator('#servicePickerOverlay label', { hasText: 'Maintenance Visit' }).click();
    await page.locator('#servicePickerSaveBtn').click();
    await expect(acct.locator('#scope-services-list')).toContainText('Maintenance Visit');
    await expect.poll(async () => (await dump()).tables.clients.find((c) => c.id === 1).scope_of_work).toContain('Maintenance Visit');

    await acct.locator('#jobCostInput').fill('3,400');
    await acct.locator('#closeClientAccount').click();
    await expect(acct).toHaveCount(0);
    await expect(tileValue(page, 'costTile')).toHaveText('$3,400.00');
    const alice = (await dump()).tables.clients.find((c) => c.id === 1);
    expect(alice).toMatchObject({ total_due: 5000, amount_paid: 2000, job_cost: 3400 });
  });

  test('new job can start from the client\'s saved services', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'owner@example.com', 'admin');
    const panel = await openClient(page, 'Alice Legacy');
    await panel.locator('#quick-add-job-btn').click();
    const modal = page.locator('#newJobModalOverlay');
    await expect(modal.locator('#new-job-copy-from')).toHaveValue('client');
    await expect(modal.locator('#new-job-source-summary')).toContainText('Roof Inspection');
    await modal.locator('#new-job-title').fill('Spring Inspection');
    await modal.locator('#createJobBtn').click();
    const job = page.locator('#jobPanelOverlay');
    await expect(job.locator('#job-total-display')).toHaveText('$430.00');
    await closeJob(page);
    await expect(tileValue(page, 'totalDueTile')).toHaveText('$5,430.00');
  });
});

// ---------------------------------------------------------------------------
test.describe('regular user', () => {
  test('sees only assigned clients; totals without cost; job workspace without prices or payments', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390']);
    const errors = trackErrors(page);
    await loginAs(page, 'sam@example.com', 'user');
    await page.goto('/main', { waitUntil: 'networkidle' });
    await expect(page.locator('.client-card')).toHaveCount(3);
    await expect(page.locator('.client-card', { hasText: 'Carla Jobs' })).toHaveCount(0);

    const panel = await openClient(page, 'Bob Both');
    await expect(tileValue(page, 'totalDueTile')).toHaveText('$3,500.00'); // jobs only — client-level money is admin-only
    await expect(page.locator('#costTile')).toHaveCount(0);
    await expect(panel.locator('#p-assigned-user-readout')).toHaveText('Sam Sales');

    const job = await openJob(page, 'Roof Replacement');
    for (const sel of ['#job-total', '#job-cost', '#job-payment-input', '#job-add-line-btn', '#job-profit-display']) {
      await expect(job.locator(sel)).toHaveCount(0);
    }
    await expect(job.locator('.job-services-table.is-readonly')).toContainText('Tear-off labor');
    await job.locator('#job-add-service-btn').click();
    await page.locator('#servicePresetPickerOverlay label', { hasText: 'Gutter Cleaning' }).click();
    await page.locator('#presetPickerConfirm').click();
    await expect(job.locator('#job-scope')).toHaveValue(/- Gutter Cleaning$/);
    await closeJob(page);
    const saved = (await dump()).tables.jobs.find((j) => j.id === 1);
    expect(saved.scope_of_work).toMatch(/- Gutter Cleaning$/);
    expect(saved.total_due).toBe(2000);
    expect(errors).toEqual([]);
  });

  test('client account shows services and files but not money', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'sam@example.com', 'user');
    const panel = await openClient(page, 'Alice Legacy');
    await panel.locator('[data-client-account]').click();
    const acct = page.locator('#clientAccountOverlay');
    await expect(acct.locator('#scope-services-list')).toContainText('Roof Inspection');
    await expect(acct.locator('#pdf-list')).toContainText('insurance-claim.pdf');
    await expect(acct.locator('#totalDueInput, #paymentInput, #estimateBtn')).toHaveCount(0);
    await acct.locator('#closeClientAccount').click();
    await expect(acct).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
test.describe('job costs with custom expense categories', () => {
  const costs = (page) => page.locator('#job-costs-section');
  const breakdown = (page) => costs(page).locator('.job-cost-cat');

  test('add, re-categorize, edit and remove costs; totals, profit, margin and client Cost follow', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390', 'tablet-768']);
    const errors = trackErrors(page);
    await resetDb({ migrated: true });
    await loginAs(page, 'owner@example.com', 'admin');
    const panel = await openClient(page, 'Bob Both');
    await expect(tileValue(page, 'costTile')).toHaveText('$2,300.00');
    const job = await openJob(page, 'Roof Replacement');
    await expect(breakdown(page)).toHaveText([/Labor\s*\$500\.00/, /Materials\s*\$700\.00/, /Total Cost\s*\$1,200\.00/]);
    // Money shows the cost read-only; it is changed only in Job Costs.
    await expect(job.locator('#job-cost-field')).toBeHidden();

    await costs(page).locator('#exp-description').fill('Sales commission');
    await costs(page).locator('#exp-category').selectOption({ label: 'Commissions' });
    await costs(page).locator('#exp-amount').fill('400');
    await costs(page).locator('#exp-add-btn').click();
    await expect(breakdown(page)).toHaveText([/Labor/, /Materials/, /Commissions\s*\$400\.00/, /Total Cost\s*\$1,600\.00/]);
    await expect(job.locator('#job-cost-display')).toHaveText('$1,600.00');
    await expect(job.locator('#job-profit-display')).toHaveText('$400.00');
    await expect(job.locator('#job-margin-display')).toHaveText('Margin 20%');

    const row = costs(page).locator('.job-expense-row', { has: page.locator('input[value="Sales commission"]') });
    await row.locator('[data-field="category_id"]').selectOption({ label: 'Miscellaneous Expenses' });
    await expect(breakdown(page)).toHaveText([/Labor/, /Materials/, /Miscellaneous Expenses\s*\$400\.00/, /Total Cost/]);
    await row.locator('[data-field="amount"]').fill('150');
    await row.locator('[data-field="amount"]').blur();
    await expect(costs(page).locator('#job-costs-total')).toHaveText('$1,350.00');
    await expect(job.locator('#job-margin-display')).toHaveText('Margin 33%');

    await costs(page).locator('.job-expense-row', { has: page.locator('input[value="Crew labor"]') }).locator('.exp-remove').click();
    await expect(costs(page).locator('#job-costs-total')).toHaveText('$850.00');
    await closeJob(page);

    await expect(tileValue(page, 'costTile')).toHaveText('$1,950.00'); // 850 + 700 + 400 client-level
    await expect(panel.locator('#jobs-list .job-row', { hasText: 'Roof Replacement' })).toContainText('Margin 57%');
    const db = await dump();
    expect(db.tables.jobs.find((j) => j.id === 1).job_cost).toBe(850);
    expect(db.tables.job_expenses.filter((e) => e.job_id === 1).map((e) => [e.description, e.amount, e.category_id]))
      .toEqual([['Shingles', 700, 2], ['Sales commission', 150, 4]]);
    expect(errors).toEqual([]);
  });

  test('a typed-but-unsaved cost is saved when the job closes', async ({ page }) => {
    onlyOn([DESKTOP]);
    await resetDb({ migrated: true });
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Carla Jobs');
    await openJob(page, 'September Maintenance');
    await costs(page).locator('#exp-description').fill('Fuel');
    await costs(page).locator('#exp-amount').fill('25');
    await closeJob(page);
    const db = await dump();
    expect(db.tables.job_expenses.filter((e) => e.job_id === 4).map((e) => [e.description, e.amount]))
      .toEqual([['Cost entered before itemized expenses', 40], ['Fuel', 25]]);
    expect(db.tables.jobs.find((j) => j.id === 4).job_cost).toBe(65);
  });

  test('Settings: add, rename and deactivate categories — jobs follow, history is kept', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390']);
    const errors = trackErrors(page);
    await resetDb({ migrated: true });
    await loginAs(page, 'owner@example.com', 'admin');
    await page.goto('/settings?tab=expenses', { waitUntil: 'networkidle' });
    const tab = page.locator('#tabExpenses');
    await expect(tab.locator('tr[data-id]')).toHaveCount(5);

    await tab.locator('#newExpenseCategory').fill('Subcontractors');
    await tab.locator('#addExpenseCategoryBtn').click();
    await expect(tab.locator('tr[data-id]')).toHaveCount(6);

    const materials = tab.locator('tr', { has: page.locator('input[data-original="Materials"]') });
    await materials.locator('.exp-cat-name').fill('Roofing Materials');
    await materials.locator('.exp-cat-rename').click();
    await expect(tab.locator('input[data-original="Roofing Materials"]')).toHaveCount(1);

    const labor = tab.locator('tr', { has: page.locator('input[data-original="Labor"]') });
    await labor.locator('.exp-cat-toggle').click();
    await expect(labor.locator('.expense-cat-status')).toHaveText('Deactivated');
    // In-use categories offer no Delete; unused ones do.
    await expect(labor.locator('.exp-cat-delete')).toHaveCount(0);
    const sub = tab.locator('tr', { has: page.locator('input[data-original="Subcontractors"]') });
    await sub.locator('.exp-cat-delete').click();
    await expect(tab.locator('tr[data-id]')).toHaveCount(5);

    await openClient(page, 'Bob Both');
    const job = await openJob(page, 'Roof Replacement');
    await expect(breakdown(page)).toHaveText([/Labor\s*\(inactive\)\s*\$500\.00/, /Roofing Materials\s*\$700\.00/, /Total Cost\s*\$1,200\.00/]);
    const picker = costs(page).locator('#exp-category option');
    await expect(picker).toHaveText(['Roofing Materials', 'Commissions', 'Miscellaneous Expenses']);
    const crew = costs(page).locator('.job-expense-row', { has: page.locator('input[value="Crew labor"]') });
    await expect(crew.locator('[data-field="category_id"] option:checked')).toHaveText('Labor (inactive)');
    await expect(job.locator('#job-cost-display')).toHaveText('$1,200.00');
    expect(errors).toEqual([]);
  });

  test('before the database update: notice in the job and Settings, single Job Cost still editable', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Bob Both');
    const job = await openJob(page, 'Gutter Job');
    await expect(costs(page)).toContainText('database update');
    await expect(job.locator('#job-cost')).toHaveJSProperty('readOnly', false);
    await job.locator('#job-cost').fill('800');
    await closeJob(page);
    expect((await dump()).tables.jobs.find((j) => j.id === 2).job_cost).toBe(800);
    await page.goto('/settings?tab=expenses', { waitUntil: 'networkidle' });
    await expect(page.locator('#expenseCategoriesNotice')).toBeVisible();
    await expect(page.locator('#addExpenseCategoryBtn')).toBeDisabled();
  });

  test('regular users see no costs or category settings', async ({ page }) => {
    onlyOn([DESKTOP]);
    await resetDb({ migrated: true });
    await loginAs(page, 'sam@example.com', 'user');
    await openClient(page, 'Bob Both');
    await openJob(page, 'Roof Replacement');
    await expect(page.locator('#job-costs-section')).toHaveCount(0);
    await page.goto('/settings', { waitUntil: 'networkidle' });
    await expect(page.locator('#expensesTabBtn')).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
test.describe('layout and themes', () => {
  test('client overview and job workspace fit the screen', async ({ page }) => {
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Bob Both');
    const card = page.locator('#projectPanel .detail-card');
    expect(await card.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    const job = await openJob(page, 'Roof Replacement');
    const jobCard = job.locator('#jobPanelCard');
    expect(await jobCard.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    const vw = page.viewportSize().width;
    for (const sel of ['#closeJobPanel', '#job-add-service-btn', '#job-save-btn']) {
      const box = await job.locator(sel).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
    }
    await closeJob(page);
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme} mode: every text, input and button is readable (WCAG AA 4.5:1)`, async ({ page }) => {
      onlyOn([DESKTOP, 'phone-390']);
      await page.addInitScript((t) => { try { localStorage.setItem('crm-theme', t); } catch (e) { /* ignore */ } }, theme);
      await loginAs(page, 'owner@example.com', 'admin');
      await page.goto('/main', { waitUntil: 'networkidle' });
      await page.locator('#filterToggleBtn').click();
      expect(await findLowContrast(page, { minRatio: 4.5 })).toEqual([]);
      await resetDb({ migrated: true }); // show the itemized Job Costs section too
      await openClient(page, 'Bob Both');
      await page.locator('#client-notes-details summary').click();
      expect(await findLowContrast(page, { minRatio: 4.5, scope: '#projectPanel' })).toEqual([]);
      const job = await openJob(page, 'Roof Replacement');
      await job.locator('#job-add-line-btn').click();
      expect(await findLowContrast(page, { minRatio: 4.5, scope: '#jobPanelOverlay' })).toEqual([]);
      await closeJob(page);
      await page.locator('[data-client-account]').click();
      expect(await findLowContrast(page, { minRatio: 4.5, scope: '#clientAccountOverlay' })).toEqual([]);
      await page.locator('#closeClientAccount').click();
      for (const path of ['/finance', '/settings', '/settings?tab=expenses']) {
        await page.goto(path, { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);
        expect(await findLowContrast(page, { minRatio: 4.5 }), path).toEqual([]);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Second round of changes
// ---------------------------------------------------------------------------
test.describe('second round: costs, services, inputs, uploads, settings, clients, finance, scrolling', () => {
  const costs = (page) => page.locator('#job-costs-section');

  test('Money shows Cost read-only; costs change only in Job Costs; an older cost is kept and can be moved into the list', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390']);
    const errors = trackErrors(page);
    await resetDb({ migrated: true });
    await loginAs(page, 'owner@example.com', 'admin');
    const panel = await openClient(page, 'Bob Both');
    const job = await openJob(page, 'Gutter Job'); // older job: typed-in cost $700, not itemized
    await expect(job.locator('#job-cost-field')).toBeHidden();
    await expect(job.locator('#job-cost-display')).toHaveText('$700.00');
    await expect(job.locator('#job-cost-source')).toHaveText('From Job Costs');
    await expect(job.locator('.job-money-inputs input:visible')).toHaveCount(1); // only Job Total
    await expect(costs(page).locator('.job-cost-legacy')).toContainText('$700.00');

    await costs(page).locator('#exp-itemize-legacy-btn').click();
    const row = costs(page).locator('.job-expense-row');
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-field="description"]')).toHaveValue('Cost entered before itemized expenses');
    await expect(row.locator('[data-field="category_id"] option:checked')).toHaveText('Uncategorized');
    await expect(job.locator('#job-cost-display')).toHaveText('$700.00');

    await row.locator('[data-field="category_id"]').selectOption({ label: 'Materials' });
    await expect(costs(page).locator('.job-cost-cat').first()).toContainText('Materials');
    await row.locator('[data-field="amount"]').fill('725.50');
    await row.locator('[data-field="amount"]').blur();
    await expect(job.locator('#job-cost-display')).toHaveText('$725.50');
    await expect(job.locator('#job-profit-display')).toHaveText('$774.50');
    await closeJob(page);
    await expect(tileValue(page, 'costTile')).toHaveText('$2,325.50'); // 1,200 + 725.50 + 400 client-level
    const db = await dump();
    expect(db.tables.jobs.find((j) => j.id === 2).job_cost).toBe(725.5);
    expect(errors).toEqual([]);
    void panel;
  });

  test('decimal typing is natural in cost, payment, total, quantity and price fields; values save as numbers', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390', 'tablet-768']);
    const errors = trackErrors(page);
    await resetDb({ migrated: true });
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Bob Both');
    let job = await openJob(page, 'Roof Replacement');

    // New cost typed key by key — never reformatted mid-typing.
    const amount = costs(page).locator('#exp-amount');
    await amount.click();
    const typed = [];
    for (const ch of '1250.50') {
      await page.keyboard.type(ch);
      typed.push(await amount.inputValue());
    }
    expect(typed).toEqual(['1', '12', '125', '1250', '1250.', '1250.5', '1250.50']);
    await costs(page).locator('#exp-description').click();
    await expect(amount).toHaveValue('1,250.50');
    await amount.click();
    await expect(amount).toHaveValue('1250.50'); // editable again, no commas
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expect(amount).toHaveValue('1250');
    await page.keyboard.type('.75');
    await expect(amount).toHaveValue('1250.75');
    await costs(page).locator('#exp-description').fill('Dumpster');
    await costs(page).locator('#exp-add-btn').click();
    await expect(job.locator('#job-cost-display')).toHaveText('$2,450.75');

    // Editing an existing value: 700 -> 700.5
    const shingles = costs(page).locator('.job-expense-row', { has: page.locator('input[value="Shingles"]') }).locator('[data-field="amount"]');
    await shingles.click();
    await expect(shingles).toHaveValue('700');
    await page.keyboard.press('End');
    await page.keyboard.type('.5');
    await expect(shingles).toHaveValue('700.5');
    await shingles.blur();
    await expect(shingles).toHaveValue('700.50');
    await expect(job.locator('#job-cost-display')).toHaveText('$2,451.25');

    // Payments: "0.50", replace, "10.5"
    const pay = job.locator('#job-payment-input');
    await pay.click();
    await page.keyboard.type('0.50');
    await expect(pay).toHaveValue('0.50');
    await pay.fill('');
    await pay.click();
    await page.keyboard.type('10.5');
    await expect(pay).toHaveValue('10.5');
    await job.locator('#job-add-payment-btn').click();
    await expect(job.locator('#job-paid-display')).toHaveText('$510.50');

    // Service quantity and price
    const tear = job.locator('.job-service-row', { has: page.locator('input[value="Tear-off labor"]') });
    const qty = tear.locator('[data-field="quantity"]');
    await qty.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('1.5');
    await expect(qty).toHaveValue('1.5');
    await qty.blur();
    await expect(qty).toHaveValue('1.5');
    const price = tear.locator('[data-field="unit_price"]');
    await price.click();
    await expect(price).toHaveValue('800');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('12500.50');
    await expect(price).toHaveValue('12500.50');
    await price.blur();
    await expect(price).toHaveValue('12,500.50');
    await expect(job.locator('#job-total-display')).toHaveText('$19,950.75'); // 1.5 x 12,500.50 + 1,200
    await closeJob(page);

    const db = await dump();
    expect(db.tables.job_expenses.find((e) => e.description === 'Dumpster').amount).toBe(1250.75);
    expect(db.tables.job_expenses.find((e) => e.description === 'Shingles').amount).toBe(700.5);
    expect(db.tables.payments.filter((p) => p.amount === 10.5)).toHaveLength(1);
    const li = db.tables.job_line_items.find((i) => i.description === 'Tear-off labor');
    expect([li.quantity, li.unit_price]).toEqual([1.5, 12500.5]);

    // A job total typed by hand (job without services).
    job = await openJob(page, 'Gutter Job');
    const total = job.locator('#job-total');
    await total.click();
    await expect(total).toHaveValue('1500');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('150000');
    await total.blur();
    await expect(total).toHaveValue('150,000.00');
    await expect(job.locator('#job-total-display')).toHaveText('$150,000.00');
    await closeJob(page);
    expect((await dump()).tables.jobs.find((j) => j.id === 2).total_due).toBe(150000);
    expect(errors).toEqual([]);
  });

  test('+ Service adds the service to the Scope of Work (saved right away); removing it takes the line out', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390']);
    const errors = trackErrors(page);
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Carla Jobs');
    const job = await openJob(page, 'September Maintenance');
    await expect(job.locator('#job-scope')).toHaveValue('Monthly maintenance visit');
    await job.locator('#job-add-service-btn').click();
    const picker = page.locator('#servicePresetPickerOverlay');
    await picker.locator('label', { hasText: 'Gutter Cleaning' }).click();
    await picker.locator('label', { hasText: 'Roof Inspection' }).click();
    await picker.locator('#presetPickerConfirm').click();
    await expect(job.locator('#job-scope')).toHaveValue('Monthly maintenance visit\n- Gutter Cleaning\n- Roof Inspection');
    await expect(job.locator('#job-total-display')).toHaveText('$550.00'); // 120 + 250 + 180
    await expect.poll(async () => (await dump()).tables.jobs.find((j) => j.id === 4).scope_of_work)
      .toBe('Monthly maintenance visit\n- Gutter Cleaning\n- Roof Inspection');
    await expect(job.locator('#jobSaveStatus')).toHaveText('Saved');

    // Adding the same service again doesn't duplicate its scope line.
    await job.locator('#job-add-service-btn').click();
    await picker.locator('label', { hasText: 'Gutter Cleaning' }).click();
    await picker.locator('#presetPickerConfirm').click();
    await expect(job.locator('.job-service-row')).toHaveCount(4);
    await expect(job.locator('#job-scope')).toHaveValue('Monthly maintenance visit\n- Gutter Cleaning\n- Roof Inspection');

    await job.locator('.job-service-row', { has: page.locator('input[value="Roof Inspection"]') }).locator('.li-remove').click();
    await expect(job.locator('#job-scope')).toHaveValue('Monthly maintenance visit\n- Gutter Cleaning');
    // One Gutter Cleaning removed, one left: its scope line stays.
    await job.locator('.job-service-row', { has: page.locator('input[value="Gutter Cleaning"]') }).first().locator('.li-remove').click();
    await expect(job.locator('#job-scope')).toHaveValue('Monthly maintenance visit\n- Gutter Cleaning');
    await closeJob(page);
    const saved = (await dump()).tables.jobs.find((j) => j.id === 4);
    expect(saved.scope_of_work).toBe('Monthly maintenance visit\n- Gutter Cleaning');
    expect(saved.total_due).toBe(300);
    expect(errors).toEqual([]);
  });

  test('drag and drop: PDFs into Documents, images into Photos, several at once; wrong types rejected; existing files kept', async ({ page }) => {
    onlyOn([DESKTOP, 'tablet-landscape-1024']);
    const errors = trackErrors(page);
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Bob Both');
    const job = await openJob(page, 'Roof Replacement');
    await expect(job.locator('#job-documents-list')).toContainText('contract.pdf');

    const makeTransfer = (files) => page.evaluateHandle((list) => {
      const dt = new DataTransfer();
      for (const [name, type, text] of list) dt.items.add(new File([text], name, { type }));
      return dt;
    }, files);
    const docs = job.locator('section', { has: page.locator('#job-documents-dropzone') });
    let dt = await makeTransfer([['dropped-one.pdf', 'application/pdf', '%PDF-1.4 a'], ['dropped-two.pdf', 'application/pdf', '%PDF-1.4 b']]);
    await docs.dispatchEvent('dragenter', { dataTransfer: dt });
    await expect(docs).toHaveClass(/is-dragover/);
    await docs.dispatchEvent('dragover', { dataTransfer: dt });
    await docs.dispatchEvent('drop', { dataTransfer: dt });
    await expect(docs).not.toHaveClass(/is-dragover/);
    await expect(job.locator('#job-documents-list')).toContainText('dropped-one.pdf');
    await expect(job.locator('#job-documents-list')).toContainText('dropped-two.pdf');
    await expect(job.locator('#job-documents-list')).toContainText('contract.pdf');

    const photos = job.locator('section', { has: page.locator('#job-photos-dropzone') });
    dt = await makeTransfer([['roof.png', 'image/png', 'png'], ['notes.txt', 'text/plain', 'hello']]);
    await photos.dispatchEvent('drop', { dataTransfer: dt });
    await expect(page.locator('.toast', { hasText: 'notes.txt' })).toBeVisible();
    await expect(job.locator('#job-photos-list .job-photo-thumb')).toHaveCount(2); // before.png + roof.png

    dt = await makeTransfer([['notes.txt', 'text/plain', 'hello']]);
    await docs.dispatchEvent('drop', { dataTransfer: dt });
    await expect(page.locator('.toast', { hasText: 'Only PDF, Word or Excel' })).toBeVisible();

    const files = (await dump()).tables.job_files.filter((f) => f.job_id === 1).map((f) => f.file_name).sort();
    expect(files).toEqual(['before.png', 'contract.pdf', 'dropped-one.pdf', 'dropped-two.pdf', 'roof.png']);
    // The upload buttons still open the file picker.
    const chooser = page.waitForEvent('filechooser');
    await job.locator('#job-documents-upload-btn').click();
    expect((await chooser).isMultiple()).toBe(true);
    expect(errors).toEqual([]);
  });

  test('Settings switches slide, change the setting and survive a reload (light and dark)', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390']);
    const errors = trackErrors(page);
    await loginAs(page, 'owner@example.com', 'admin');
    await page.request.patch('/api/v2/admin/settings', {
      data: { features: [{ component_type: 'hero', is_active: true }, { component_type: 'faq', is_active: false }] }
    });
    await page.goto('/settings', { waitUntil: 'networkidle' });
    const knob = (id) => page.evaluate((sel) => getComputedStyle(document.querySelector(sel).nextElementSibling, '::after').transform, id);
    const sw = (id) => page.locator(`label.toggle:has(${id})`);

    for (const id of ['#prefCompactLayout', '#prefEmailReminders']) {
      await expect(page.locator(id)).not.toBeChecked();
      expect(await knob(id)).toBe('none');
      await sw(id).click();
      await expect(page.locator(id)).toBeChecked();
      await expect.poll(() => knob(id)).not.toBe('none'); // the knob slid across
    }
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#prefCompactLayout')).toBeChecked();
    await expect(page.locator('#prefEmailReminders')).toBeChecked();
    await page.goto('/main', { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveClass(/crm-compact/);
    await page.goto('/settings', { waitUntil: 'networkidle' });
    await sw('#prefCompactLayout').click();
    await expect(page.locator('#prefCompactLayout')).not.toBeChecked();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#prefCompactLayout')).not.toBeChecked();
    await expect(page.locator('html')).not.toHaveClass(/crm-compact/);

    // Dark mode switch
    await sw('#prefDarkMode').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#prefDarkMode')).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => knob('#prefEmailReminders')).not.toBe('none'); // still drawn correctly in dark

    // Feature switches (saved to the database with Save Features)
    await page.locator('.tab-btn[data-tab="features"]').click();
    const faq = page.locator('.feature-item', { hasText: 'faq' });
    await expect(faq.locator('input')).not.toBeChecked();
    await faq.locator('.feature-toggle label').click();
    await expect(faq.locator('input')).toBeChecked();
    await page.locator('#saveFeaturesBtn').click();
    await expect(page.locator('#formFeedback')).toHaveText('Features saved');
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.tab-btn[data-tab="features"]').click();
    await expect(page.locator('.feature-item', { hasText: 'faq' }).locator('input')).toBeChecked();
    const rows = (await dump()).tables.company_components;
    expect(rows.find((r) => r.component_type === 'faq').is_active).toBe(true);

    // Operational Model: saved and shown after reload; described honestly.
    await page.locator('.tab-btn[data-tab="workflow"]').click();
    await expect(page.locator('#tabWorkflow')).toContainText('does not currently change');
    await page.selectOption('#workflowSelect', 'single');
    await page.locator('#saveWorkflowBtn').click();
    await expect(page.locator('#formFeedback')).toHaveText('Preference saved');
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#workflowSelect')).toHaveValue('single');

    await sw('#prefDarkMode').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(errors).toEqual([]);
  });

  test('a client can be added without an email, and with one', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390']);
    const errors = trackErrors(page);
    await loginAs(page, 'owner@example.com', 'admin');
    await page.goto('/main', { waitUntil: 'networkidle' });
    await expect(page.locator('#email')).not.toHaveAttribute('required', /.*/);
    await page.fill('#fName', 'Nora');
    await page.fill('#lName', 'Noemail');
    await page.fill('#phone', '555-0142');
    await page.locator('#clientIntakeForm button[type="submit"]').click();
    await expect(page.locator('.client-card', { hasText: 'Nora Noemail' })).toBeVisible();
    await page.fill('#fName', 'Wes');
    await page.fill('#lName', 'Withemail');
    await page.fill('#phone', '555-0143');
    await page.fill('#email', 'wes@example.com');
    await page.locator('#clientIntakeForm button[type="submit"]').click();
    await expect(page.locator('.client-card', { hasText: 'Wes Withemail' })).toBeVisible();
    const clients = (await dump()).tables.clients;
    expect(clients.find((c) => c.name === 'Nora Noemail').email).toBe('');
    expect(clients.find((c) => c.name === 'Wes Withemail').email).toBe('wes@example.com');

    // An existing client's email is kept and still shown as a link.
    const panel = await openClient(page, 'Alice Legacy');
    await expect(panel.locator('#p-email')).toHaveValue('alice@example.com');
    await expect(panel.locator('a[href^="mailto:"]')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('Finance overview draws KPI cards and charts from live data, in light and dark', async ({ page }) => {
    const errors = trackErrors(page);
    await resetDb({ migrated: true });
    await loginAs(page, 'owner@example.com', 'admin');
    for (const theme of ['light', 'dark']) {
      await page.addInitScript((t) => localStorage.setItem('crm-theme', t), theme);
      await page.goto('/finance', { waitUntil: 'networkidle' });
      await expect(page.locator('#foKpis .fo-kpi')).toHaveCount(5);
      await expect(page.locator('#foKpis')).toContainText('$7,000.00'); // same as Year Totals (override)
      await expect(page.locator('#foProfit')).toContainText('$9,940.00');
      await expect(page.locator('#foProfit')).toContainText('$5,880.00');
      await expect(page.locator('#foProfit')).toContainText('40.8%');
      await expect(page.locator('#foMonthly .fo-col')).toHaveCount(12);
      await expect(page.locator('#foSales')).toContainText('Sam Sales');
      await expect(page.locator('#foCosts')).toContainText('Materials');
      await expect(page.locator('#metricsBody input#input-expected')).toHaveValue('7,000.00'); // existing table still there
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    }
    // The year picker redraws the overview.
    await page.fill('#finance-year', String(new Date().getFullYear() - 1));
    await expect(page.locator('#foProfit')).toContainText('$1,700.00');
    expect(errors).toEqual([]);
  });

  test('mouse-wheel / trackpad scrolling works in small and split-screen windows', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'owner@example.com', 'admin');
    for (const [w, h] of [[1440, 700], [960, 700], [760, 700], [700, 640], [500, 700]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const path of ['/main', '/finance', '/settings']) {
        await page.goto(path, { waitUntil: 'networkidle' });
        const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 20);
        if (!scrollable) continue;
        await page.mouse.move(w / 2, h / 2);
        await page.mouse.wheel(0, 300);
        await expect.poll(() => page.evaluate(() => window.scrollY), { message: `${path} at ${w}x${h}` }).toBeGreaterThan(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${path} ${w}px sideways`).toBeLessThanOrEqual(1);
      }
    }
    // Inside an open job the wheel scrolls the job workspace.
    await page.setViewportSize({ width: 760, height: 640 });
    await openClient(page, 'Bob Both');
    const job = await openJob(page, 'Roof Replacement');
    const box = await job.locator('#jobPanelCard').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
    await page.mouse.wheel(0, 400);
    await expect.poll(() => job.locator('#jobPanelCard').evaluate((el) => {
      let n = el; while (n && n.scrollTop === 0) n = n.parentElement; return n ? n.scrollTop : 0;
    })).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Calendar (job scheduling)
// ---------------------------------------------------------------------------
test.describe('calendar', () => {
  const slot = (page, title) => page.locator('.cal-event-slot', { has: page.locator('.cal-event-title', { hasText: title }) });

  test('approve a job, give it a start date and duration: it shows on the calendar, opens the job, and follows every change', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390']);
    const errors = trackErrors(page);
    await resetDb({ migrated: true });
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Bob Both');
    let job = await openJob(page, 'Gutter Job');

    // Prospect: no schedule fields yet, just the hint.
    await expect(job.locator('#job-start')).toBeHidden();
    await expect(job.locator('#job-schedule-hint')).toContainText('Set the status to Approved');
    await job.locator('#job-status').selectOption('Approved');
    await expect(job.locator('#job-start')).toBeVisible();
    await job.locator('#job-start').fill('2026-10-10');
    await job.locator('#job-duration').fill('3');
    await expect(job.locator('#job-schedule-hint')).toContainText('Oct 10 – Oct 12, 2026 (3 days)');
    await closeJob(page);
    let db = await dump();
    expect(db.tables.jobs.find((j) => j.id === 2)).toMatchObject({ status: 'Approved', scheduled_start: '2026-10-10', duration_days: 3 });

    // Month view: Oct 10, 2026 is a Saturday, so Oct 10-12 is one day at the
    // end of one week row and two days at the start of the next.
    await page.goto('/calendar?view=month&date=2026-10-10', { waitUntil: 'networkidle' });
    await expect(page.locator('#calTitle')).toHaveText('October 2026');
    const parts = slot(page, 'Gutter Job');
    await expect(parts).toHaveCount(2);
    await expect(parts.first()).toContainText('Bob Both');
    expect(await parts.nth(0).getAttribute('style')).toContain('grid-column:7 / span 1');
    expect(await parts.nth(1).getAttribute('style')).toContain('grid-column:1 / span 2');
    await expect(parts.nth(0).locator('.cal-event')).toHaveClass(/cont-after/);

    // Week and day views.
    await page.locator('.cal-view-btn[data-view="week"]').click();
    await expect(page.locator('#calTitle')).toHaveText('Oct 4 – Oct 10, 2026');
    await expect(slot(page, 'Gutter Job')).toContainText('Oct 10 – Oct 12 · 3 days');
    await page.locator('#calNextBtn').click();
    await expect(page.locator('#calTitle')).toHaveText('Oct 11 – Oct 17, 2026');
    await expect(slot(page, 'Gutter Job').locator('.cal-event')).toHaveClass(/cont-before/);
    await page.locator('.cal-day-num[data-day="2026-10-11"]').click();
    await expect(page.locator('.cal-day-card')).toContainText('Day 2 of 3');

    // Clicking the job opens that job.
    await page.locator('.cal-day-card').click();
    await expect(page.locator('#jobPanelOverlay #job-title')).toHaveValue('Gutter Job');
    job = page.locator('#jobPanelOverlay');
    await expect(job.locator('#job-start')).toHaveValue('2026-10-10');

    // Move it and make it longer.
    await job.locator('#job-start').fill('2026-10-20');
    await job.locator('#job-duration').fill('5');
    await closeJob(page);
    await page.goto('/calendar?view=month&date=2026-10-10', { waitUntil: 'networkidle' });
    const bars = slot(page, 'Gutter Job');
    await expect(bars).toHaveCount(1); // Oct 20-24 is Tuesday to Saturday: one row
    expect(await bars.getAttribute('style')).toContain('grid-column:3 / span 5');
    await page.goto('/calendar?view=day&date=2026-10-24', { waitUntil: 'networkidle' });
    await expect(page.locator('.cal-day-card')).toContainText('Day 5 of 5');

    // Out of Approved: off the calendar, dates kept on the job.
    await openClient(page, 'Bob Both');
    job = await openJob(page, 'Gutter Job');
    await job.locator('#job-status').selectOption('Completed');
    await expect(job.locator('#job-schedule-hint')).toContainText('shows on the Calendar while the job is Approved');
    await closeJob(page);
    await page.goto('/calendar?view=month&date=2026-10-10', { waitUntil: 'networkidle' });
    await expect(page.locator('.cal-event')).toHaveCount(0);
    await expect(page.locator('.cal-empty-hint')).toBeVisible();
    db = await dump();
    expect(db.tables.jobs.find((j) => j.id === 2)).toMatchObject({ status: 'Completed', scheduled_start: '2026-10-20', duration_days: 5 });
    expect(errors).toEqual([]);
  });

  test('overlapping jobs each get their own row; deleting a job removes it; older jobs are unaffected', async ({ page }) => {
    onlyOn([DESKTOP]);
    await resetDb({ migrated: true });
    await loginAs(page, 'owner@example.com', 'admin');
    const put = (id, data) => page.request.put(`/api/jobs/${id}`, { data });
    await put(1, { scheduled_start: '2026-11-02', duration_days: 4 });
    await put(2, { status: 'Approved', scheduled_start: '2026-11-03', duration_days: 1 });
    await put(3, { status: 'Approved', scheduled_start: '2026-11-01', duration_days: 6 });
    await page.goto('/calendar?view=week&date=2026-11-03', { waitUntil: 'networkidle' });
    await expect(page.locator('.cal-event-slot')).toHaveCount(3);
    const rows = await page.locator('.cal-event-slot').evaluateAll((els) => els.map((e) => e.style.gridRow));
    expect(new Set(rows).size).toBe(3);

    // Older job without a schedule still opens and saves normally.
    await openClient(page, 'Carla Jobs');
    const job = await openJob(page, 'September Maintenance');
    await expect(job.locator('#job-start')).toBeHidden();
    await job.locator('#job-title').fill('September Visit');
    await closeJob(page);
    expect((await dump()).tables.jobs.find((j) => j.id === 4)).toMatchObject({ title: 'September Visit', scheduled_start: null });

    await page.request.delete('/api/jobs/2');
    await page.goto('/calendar?view=week&date=2026-11-03', { waitUntil: 'networkidle' });
    await expect(page.locator('.cal-event-slot')).toHaveCount(2);
  });

  test('before the database update: no schedule fields, and the calendar explains why', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Bob Both');
    const job = await openJob(page, 'Roof Replacement');
    await expect(job.locator('#job-start')).toHaveCount(0);
    await closeJob(page);
    await page.goto('/calendar', { waitUntil: 'networkidle' });
    await expect(page.locator('#calNotice')).toContainText('database update');
  });

  test('regular users can open the calendar and see their own clients’ jobs', async ({ page }) => {
    onlyOn([DESKTOP]);
    await resetDb({ migrated: true });
    await loginAs(page, 'owner@example.com', 'admin');
    await page.request.put('/api/jobs/1', { data: { scheduled_start: '2026-12-01', duration_days: 2 } });
    await page.request.put('/api/jobs/3', { data: { status: 'Approved', scheduled_start: '2026-12-01', duration_days: 2 } });
    await page.context().clearCookies();
    await loginAs(page, 'sam@example.com', 'user');
    await page.goto('/calendar?view=month&date=2026-12-01', { waitUntil: 'networkidle' });
    await expect(page.locator('.cal-event-client')).toHaveText(['Bob Both']);
    await expect(page.locator('#navFinanceLink')).toBeHidden();
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme} mode: the calendar is readable (WCAG AA 4.5:1)`, async ({ page }) => {
      onlyOn([DESKTOP, 'phone-390']);
      await page.addInitScript((t) => { try { localStorage.setItem('crm-theme', t); } catch (e) { /* ignore */ } }, theme);
      await resetDb({ migrated: true });
      await loginAs(page, 'owner@example.com', 'admin');
      await page.request.put('/api/jobs/1', { data: { scheduled_start: '2026-10-05', duration_days: 3 } });
      for (const view of ['month', 'week', 'day']) {
        await page.goto(`/calendar?view=${view}&date=2026-10-06`, { waitUntil: 'networkidle' });
        await expect(page.locator('.cal-event').first()).toBeVisible();
        expect(await findLowContrast(page, { minRatio: 4.5 }), view).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${view} has no sideways scroll`).toBeLessThanOrEqual(1);
      }
    });
  }
});

// ---------------------------------------------------------------------------
test.describe('estimate & invoice pricing display', () => {
  // Text drawn on a pdfkit page (same decoding as tests/api/workflows.test.js).
  function pdfText(buffer) {
    const zlib = require('zlib');
    const raw = buffer.toString('latin1');
    let out = '';
    const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let m;
    while ((m = re.exec(raw))) {
      let content;
      try { content = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch (e) { continue; }
      for (const piece of content.match(/\[[^\]]*\]\s*TJ|<[0-9a-fA-F]*>\s*Tj/g) || []) {
        const hex = (piece.match(/<([0-9a-fA-F]*)>/g) || []).map((h) => h.slice(1, -1)).join('');
        out += Buffer.from(hex, 'hex').toString('latin1') + '\n';
      }
    }
    return out;
  }
  async function downloadText(page, job, buttonId) {
    const download = page.waitForEvent('download');
    await job.locator(buttonId).click();
    const file = await (await download).path();
    return pdfText(require('fs').readFileSync(file));
  }
  const pricingBtn = (job, which) => job.locator(`[data-pricing="${which}"]`);

  test('switch between one total and line-item pricing; the PDFs follow and the job money never changes', async ({ page }) => {
    onlyOn([DESKTOP, 'phone-390']);
    const errors = trackErrors(page);
    await resetDb({ migrated: true });
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Bob Both');
    let job = await openJob(page, 'Roof Replacement');

    // Existing job: the original one-total format is selected.
    await expect(pricingBtn(job, 'total')).toHaveAttribute('aria-pressed', 'true');
    await expect(pricingBtn(job, 'items')).toHaveAttribute('aria-pressed', 'false');
    await expect(job.locator('#job-pricing-hint')).toHaveText('The estimate and invoice show only the total.');
    await expect(page.locator('#job-total-display')).toHaveText('$2,000.00');
    let text = await downloadText(page, job, '#job-estimate-btn');
    expect(text).toContain('2,000.00');
    expect(text).not.toContain('Shingles');

    // Line-item pricing: saved straight away, no money changes.
    await pricingBtn(job, 'items').click();
    await expect(pricingBtn(job, 'items')).toHaveAttribute('aria-pressed', 'true');
    await expect(job.locator('#job-pricing-hint')).toContainText('list each service with its price');
    await expect.poll(async () => (await dump()).tables.jobs.find((j) => j.id === 1).show_line_item_prices).toBe(true);
    await expect(page.locator('#job-total-display')).toHaveText('$2,000.00');
    text = await downloadText(page, job, '#job-estimate-btn');
    for (const shown of ['SERVICES', 'Tear-off labor', '800.00', 'Shingles', '1,200.00', 'Total', '2,000.00']) expect(text).toContain(shown);
    text = await downloadText(page, job, '#job-invoice-btn');
    for (const shown of ['Tear-off labor', '800.00', 'Shingles', '1,200.00', 'Balance Due', '1,500.00']) expect(text).toContain(shown);

    // The choice is kept when the job is reopened.
    await closeJob(page);
    job = await openJob(page, 'Roof Replacement');
    await expect(pricingBtn(job, 'items')).toHaveAttribute('aria-pressed', 'true');

    // Back to one total.
    await pricingBtn(job, 'total').click();
    text = await downloadText(page, job, '#job-invoice-btn');
    expect(text).toContain('2,000.00');
    expect(text).not.toContain('1,200.00');
    const row = (await dump()).tables.jobs.find((j) => j.id === 1);
    expect(row).toMatchObject({ show_line_item_prices: false, total_due: 2000, amount_paid: 500, balance: 1500 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('a job with no services says only the total is shown until services are added', async ({ page }) => {
    onlyOn([DESKTOP]);
    await resetDb({ migrated: true });
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Bob Both');
    const job = await openJob(page, 'Gutter Job');
    await pricingBtn(job, 'items').click();
    await expect(job.locator('#job-pricing-hint')).toContainText('Add services with “+ Service”');
  });

  test('before the database update the toggle is not shown', async ({ page }) => {
    onlyOn([DESKTOP]);
    await loginAs(page, 'owner@example.com', 'admin');
    await openClient(page, 'Bob Both');
    const job = await openJob(page, 'Roof Replacement');
    await expect(job.locator('[data-pricing]')).toHaveCount(0);
    await expect(job.locator('#job-estimate-btn')).toBeVisible();
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme} mode: the pricing toggle is readable (WCAG AA 4.5:1)`, async ({ page }) => {
      onlyOn([DESKTOP, 'phone-small-320']);
      await page.addInitScript((t) => { try { localStorage.setItem('crm-theme', t); } catch (e) { /* ignore */ } }, theme);
      await resetDb({ migrated: true });
      await loginAs(page, 'owner@example.com', 'admin');
      await openClient(page, 'Bob Both');
      const job = await openJob(page, 'Roof Replacement');
      const toggle = job.locator('.segmented-toggle');
      await toggle.scrollIntoViewIfNeeded();
      const box = await toggle.boundingBox();
      const vw = page.viewportSize().width;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vw);
      expect(await findLowContrast(page, { minRatio: 4.5, scope: '.job-pricing-display' })).toEqual([]);
      await pricingBtn(job, 'items').click();
      expect(await findLowContrast(page, { minRatio: 4.5, scope: '.job-pricing-display' })).toEqual([]);
    });
  }
});

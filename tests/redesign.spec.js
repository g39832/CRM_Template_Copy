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
    await expect(job.locator('#job-cost')).toHaveJSProperty('readOnly', true);

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

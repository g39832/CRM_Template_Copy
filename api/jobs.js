const express = require('express');
const db = require('./db');
const { getClient } = require('./db-v2');
const { asyncHandler, assertObject, parseIntField, parseNumberField, parseStringField, AppError } = require('./request-utils');
const {
  isAdmin,
  requireAdmin,
  canAccessClient,
  sanitizeJob,
  sanitizeJobs
} = require('./access-control');
const { refreshFinanceYearsFor } = require('./finance-totals');
const { hasPaymentJobId, hasExpenseTables, hasJobSchedule, hasJobPricingDisplay, markColumnAbsent, isMissingColumnError } = require('./schema-features');
const { itemizedJobCost, copyExpensesToJob } = require('./expenses');

const router = express.Router();

const VALID_STATUSES = ['Prospect', 'Approved', 'Completed', 'Invoice', 'Closed'];
const LINE_ITEM_CATEGORIES = ['Labor', 'Materials', 'Commissions', 'Meals/Drinks', 'Miscellaneous', 'Permits'];
const MAX_LINE_ITEMS_PER_REQUEST = 100;
// Payments are stored in cents-precision dollars; anything smaller than half
// a cent is rounding noise, not money.
const MONEY_EPSILON = 0.005;

async function loadClientOrThrow(clientId) {
  const { rows } = await db.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  if (!rows[0]) throw new AppError(404, 'Client not found');
  return rows[0];
}

// Loads a job and verifies the requesting session can access the job's
// parent client (admins always can; regular users only for their own
// assigned clients). Throws 404/403 as appropriate.
async function loadJobWithAccessCheck(req, jobId) {
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = rows[0];
  if (!job) throw new AppError(404, 'Job not found');
  const client = await loadClientOrThrow(job.client_id);
  if (!canAccessClient(req, client)) throw new AppError(403, 'You do not have access to this job');
  return { job, client };
}

function requireSupabase() {
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  return supabase;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// ======================================================
// LIST JOBS FOR A CLIENT
// ======================================================
router.get('/client/:clientId', asyncHandler(async (req, res) => {
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  await db.schemaReady;
  const client = await loadClientOrThrow(clientId);
  if (!canAccessClient(req, client)) throw new AppError(403, 'You do not have access to this client');

  const { rows } = await db.query(
    'SELECT * FROM jobs WHERE client_id = $1 ORDER BY created_at DESC',
    [clientId]
  );
  res.json({ jobs: sanitizeJobs(req, rows) });
}));

// ======================================================
// JOB SCHEDULE (v9) — the calendar
//
// A job's schedule lives on the job itself: jobs.scheduled_start (a date,
// "YYYY-MM-DD") and jobs.duration_days (whole days, 1-365). There is no
// separate calendar record: the calendar reads approved jobs that have both,
// so moving the date, changing the duration, changing the status or deleting
// the job shows up on the calendar immediately. A job that leaves Approved
// keeps its dates (they come back if it is approved again) but is no longer
// on the calendar.
// ======================================================
const MAX_DURATION_DAYS = 365;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value, field) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const s = String(value).trim().slice(0, 10);
  const d = new Date(s + 'T00:00:00Z');
  if (!DATE_ONLY.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new AppError(400, `${field} must be a date (YYYY-MM-DD)`);
  }
  return s;
}

function parseDuration(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  return parseIntField(value, 'duration_days', { min: 1, max: MAX_DURATION_DAYS });
}

// Last day a job covers: a 3-day job starting Oct 10 runs Oct 10-12.
function scheduleEnd(start, days) {
  const d = new Date(start + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days) - 1);
  return d.toISOString().slice(0, 10);
}

// Applies scheduled_start / duration_days from a request body to a job (only
// the ones sent). Returns the updated row, or null when nothing was sent or
// the schedule columns don't exist yet.
async function saveJobSchedule(req, job) {
  const sendsStart = req.body.scheduled_start !== undefined;
  const sendsDuration = req.body.duration_days !== undefined;
  if (!sendsStart && !sendsDuration) return null;
  if (!(await hasJobSchedule())) return null;
  const updates = {};
  if (sendsStart) updates.scheduled_start = parseDateOnly(req.body.scheduled_start, 'scheduled_start');
  if (sendsDuration) updates.duration_days = parseDuration(req.body.duration_days);
  const { data, error } = await requireSupabase().from('jobs').update(updates).eq('id', job.id).select().maybeSingle();
  if (error) throw new AppError(500, 'Failed to save the job schedule: ' + error.message);
  return data;
}

// show_line_item_prices (v10) only chooses how the job's estimate/invoice
// shows its price: each service with its amount, or one total. It is a
// display preference — nothing about the job's money depends on it.
function parsePricingDisplay(value) {
  if (value === true || value === false) return value;
  throw new AppError(400, 'show_line_item_prices must be true or false');
}

// Applies show_line_item_prices from a request body to a job. Returns the
// updated row, or null when it wasn't sent or the column doesn't exist yet.
async function saveJobPricingDisplay(req, jobId) {
  if (req.body.show_line_item_prices === undefined) return null;
  if (!(await hasJobPricingDisplay())) return null;
  const { data, error } = await requireSupabase().from('jobs')
    .update({ show_line_item_prices: parsePricingDisplay(req.body.show_line_item_prices) })
    .eq('id', jobId).select().maybeSingle();
  if (error) throw new AppError(500, 'Failed to save the pricing display: ' + error.message);
  return data;
}

// GET /api/jobs/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
// Approved jobs with a start date and duration that overlap the range, with
// their client's name. Regular users only get jobs of clients they can open.
router.get('/schedule', asyncHandler(async (req, res) => {
  await db.schemaReady;
  if (!(await hasJobSchedule())) {
    return res.json({ supported: false, message: 'Job scheduling needs the one-time database update (TEMPLATE UPGRADE v9 in supabase-schema.sql).', events: [] });
  }
  const from = parseDateOnly(req.query.from, 'from');
  const to = parseDateOnly(req.query.to, 'to');
  const supabase = requireSupabase();
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, client_id, title, status, scheduled_start, duration_days')
    .eq('status', 'Approved');
  if (error) throw new AppError(500, 'Failed to load the schedule: ' + error.message);

  const scheduled = (jobs || [])
    .filter((j) => j.scheduled_start && Number(j.duration_days) >= 1)
    .map((j) => {
      const start = String(j.scheduled_start).slice(0, 10);
      return { ...j, start, end: scheduleEnd(start, j.duration_days) };
    })
    .filter((j) => (!to || j.start <= to) && (!from || j.end >= from));

  const clientIds = [...new Set(scheduled.map((j) => Number(j.client_id)))];
  let clients = [];
  if (clientIds.length) {
    const { data, error: clientErr } = await supabase.from('clients').select('*').in('id', clientIds);
    if (clientErr) throw new AppError(500, 'Failed to load clients: ' + clientErr.message);
    clients = (data || []).filter((c) => canAccessClient(req, c));
  }
  const byId = new Map(clients.map((c) => [Number(c.id), c]));

  const events = scheduled
    .filter((j) => byId.has(Number(j.client_id)))
    .map((j) => ({
      job_id: Number(j.id),
      client_id: Number(j.client_id),
      client_name: byId.get(Number(j.client_id)).name || '',
      title: j.title || 'Untitled job',
      start: j.start,
      end: j.end,
      duration_days: Number(j.duration_days)
    }))
    .sort((a, b) => a.start.localeCompare(b.start) || b.duration_days - a.duration_days || a.job_id - b.job_id);

  res.json({ supported: true, events });
}));

// ======================================================
// GET SINGLE JOB
// ======================================================
router.get('/:jobId', asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  await db.schemaReady;
  const { job } = await loadJobWithAccessCheck(req, jobId);
  res.json({ job: sanitizeJob(req, job) });
}));

// ======================================================
// LINE ITEM HELPERS
// ======================================================
function normalizeLineItem(row) {
  return {
    id: row.id,
    job_id: row.job_id,
    description: row.description || '',
    quantity: Number(row.quantity || 0),
    unit_price: Number(row.unit_price || 0),
    category: row.category || 'Miscellaneous',
    sort_order: row.sort_order || 0,
    amount: Number(row.quantity || 0) * Number(row.unit_price || 0)
  };
}

// Validates one incoming line item (from a create/bulk request) into a row
// ready to insert. Throws a 400 naming the offending index.
function parseLineItemInput(item, index) {
  if (!item || typeof item !== 'object') throw new AppError(400, `line_items[${index}] must be an object`);
  const description = parseStringField(item.description ?? '', `line_items[${index}].description`, { required: false, maxLength: 500, defaultValue: '' });
  const quantity = parseNumberField(item.quantity ?? 1, `line_items[${index}].quantity`, { required: false, defaultValue: 1, min: 0 });
  const unitPrice = parseNumberField(item.unit_price ?? 0, `line_items[${index}].unit_price`, { required: false, defaultValue: 0, min: 0 });
  const category = LINE_ITEM_CATEGORIES.includes(item.category) ? item.category : 'Miscellaneous';
  return { description, quantity, unit_price: unitPrice, category };
}

async function nextLineItemSortOrder(supabase, jobId) {
  const { data } = await supabase
    .from('job_line_items')
    .select('sort_order')
    .eq('job_id', jobId)
    .order('sort_order', { ascending: false })
    .limit(1);
  return data && data.length ? Number(data[0].sort_order || 0) + 1 : 0;
}

async function insertLineItems(supabase, jobId, items) {
  if (!items.length) return [];
  const start = await nextLineItemSortOrder(supabase, jobId);
  const rows = items.map((item, i) => ({ job_id: jobId, ...item, sort_order: start + i }));
  const { data, error } = await supabase.from('job_line_items').insert(rows).select();
  if (error) throw new AppError(500, 'Failed to add line items: ' + error.message);
  return (data || []).map(normalizeLineItem);
}

async function recomputeJobTotalFromLineItems(supabase, jobId) {
  const { data: items, error } = await supabase
    .from('job_line_items')
    .select('quantity, unit_price')
    .eq('job_id', jobId);
  if (error) throw new AppError(500, 'Failed to total line items: ' + error.message);

  const total = (items || []).reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unit_price || 0), 0);

  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = rows[0];
  if (!job) return;
  const newBalance = total - Number(job.amount_paid || 0);
  // Bypass the db.js SQL-pattern shim (it only recognizes a fixed set of
  // exact query strings) and update directly via the Supabase client.
  const { error: updateErr } = await supabase
    .from('jobs')
    .update({ total_due: total, balance: newBalance })
    .eq('id', jobId);
  if (updateErr) throw new AppError(500, 'Failed to update job total: ' + updateErr.message);
}

// ======================================================
// CREATE JOB
//
// Optional `line_items` (admin only — they set the job's price) start the
// job with its services already listed, e.g. the client's saved services or
// a copy of a previous month's job for recurring work.
// ======================================================
router.post('/', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const clientId = parseIntField(req.body.client_id, 'client_id', { min: 1 });

  await db.schemaReady;
  const client = await loadClientOrThrow(clientId);
  if (!canAccessClient(req, client)) throw new AppError(403, 'You do not have access to this client');

  const title = parseStringField(req.body.title ?? 'New Job', 'title', { required: false, maxLength: 200, defaultValue: 'New Job' });
  const status = parseStringField(req.body.status ?? 'Prospect', 'status', { required: false, maxLength: 30, defaultValue: 'Prospect' });
  const scopeOfWork = parseStringField(req.body.scope_of_work ?? '', 'scope_of_work', { required: false, maxLength: 5000, defaultValue: '' });
  // total_due and job_cost are both admin-only to set — a regular user may
  // view a job's total/payments/balance but not change the total, and never
  // sees job_cost (it's used to compute margin, which stays admin-only).
  const totalDue = isAdmin(req) ? parseNumberField(req.body.total_due ?? 0, 'total_due', { required: false, defaultValue: 0 }) : 0;
  const jobCost = isAdmin(req) ? parseNumberField(req.body.job_cost ?? 0, 'job_cost', { required: false, defaultValue: 0 }) : 0;
  const createdAt = new Date().toISOString();
  if (req.body.show_line_item_prices !== undefined) parsePricingDisplay(req.body.show_line_item_prices);

  let lineItems = [];
  if (req.body.line_items !== undefined && isAdmin(req)) {
    if (!Array.isArray(req.body.line_items)) throw new AppError(400, 'line_items must be an array');
    if (req.body.line_items.length > MAX_LINE_ITEMS_PER_REQUEST) throw new AppError(400, 'Too many line items');
    lineItems = req.body.line_items.map(parseLineItemInput);
  }

  const { rows } = await db.query(
    `INSERT INTO jobs (client_id, title, status, scope_of_work, total_due, amount_paid, balance, job_cost, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8) RETURNING *`,
    [clientId, title, VALID_STATUSES.includes(status) ? status : 'Prospect', scopeOfWork, totalDue, totalDue, jobCost, createdAt]
  );
  let job = rows[0];
  if (!job) throw new AppError(500, 'Failed to create job');

  if (lineItems.length) {
    const supabase = requireSupabase();
    await insertLineItems(supabase, job.id, lineItems);
    await recomputeJobTotalFromLineItems(supabase, job.id);
  }
  // Itemized costs copied from another job (admin only — cost is admin-only).
  if (isAdmin(req) && Array.isArray(req.body.expenses) && req.body.expenses.length) {
    await copyExpensesToJob(req, job, req.body.expenses);
  }
  job = (await saveJobPricingDisplay(req, job.id)) || job;
  if (lineItems.length || (isAdmin(req) && Array.isArray(req.body.expenses) && req.body.expenses.length)) {
    const refreshed = await db.query('SELECT * FROM jobs WHERE id = $1', [job.id]);
    job = refreshed.rows[0] || job;
  }

  await refreshFinanceYearsFor(job.created_at, 'job create');
  res.json({ success: true, job: sanitizeJob(req, job) });
}));

// ======================================================
// UPDATE JOB
// ======================================================
router.put('/:jobId', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });

  await db.schemaReady;
  const { job } = await loadJobWithAccessCheck(req, jobId);

  const title = parseStringField(req.body.title ?? job.title, 'title', { required: false, maxLength: 200, defaultValue: job.title });
  const status = parseStringField(req.body.status ?? job.status, 'status', { required: false, maxLength: 30, defaultValue: job.status });
  const scopeOfWork = parseStringField(req.body.scope_of_work ?? job.scope_of_work, 'scope_of_work', { required: false, maxLength: 5000, defaultValue: job.scope_of_work });

  // total_due and job_cost (Section 8) are both admin-only to change. A
  // regular user can view total_due/amount_paid/balance but not edit them.
  const totalDue = isAdmin(req) && typeof req.body.total_due !== 'undefined'
    ? parseNumberField(req.body.total_due, 'total_due', { required: false, defaultValue: Number(job.total_due || 0) })
    : Number(job.total_due || 0);
  const amountPaid = Number(job.amount_paid || 0);
  const balance = totalDue - amountPaid;
  // A job with itemized expenses always costs exactly their sum. Once the
  // itemized cost list exists (v7), it is the only place a job's cost is
  // changed: a job_cost sent here is ignored and an older job's typed-in
  // cost is kept as-is (it becomes an Uncategorized cost line when the job
  // is first itemized). Before v7 the single Job Cost field still works.
  const itemized = await itemizedJobCost(jobId);
  const costIsItemizedOnly = itemized !== null || await hasExpenseTables();
  const jobCost = itemized !== null
    ? itemized
    : !costIsItemizedOnly && isAdmin(req) && typeof req.body.job_cost !== 'undefined'
      ? parseNumberField(req.body.job_cost, 'job_cost', { required: false, defaultValue: Number(job.job_cost || 0) })
      : Number(job.job_cost || 0);

  // Check the schedule first, so a bad date changes nothing.
  if (req.body.scheduled_start !== undefined) parseDateOnly(req.body.scheduled_start, 'scheduled_start');
  if (req.body.duration_days !== undefined) parseDuration(req.body.duration_days);
  if (req.body.show_line_item_prices !== undefined) parsePricingDisplay(req.body.show_line_item_prices);

  const { rows } = await db.query(
    `UPDATE jobs SET title=$1, status=$2, scope_of_work=$3, total_due=$4, balance=$5, job_cost=$6
     WHERE id=$7 RETURNING *`,
    [title, VALID_STATUSES.includes(status) ? status : job.status, scopeOfWork, totalDue, balance, jobCost, jobId]
  );
  const scheduled = await saveJobSchedule(req, job);
  const displayed = await saveJobPricingDisplay(req, jobId);

  await refreshFinanceYearsFor(job.created_at, 'job update');
  res.json({ success: true, job: sanitizeJob(req, displayed || scheduled || rows[0]) });
}));

// ======================================================
// JOB TAGS (Section 2/7) — separate from job.status and from the
// client's pipeline stage. Available to admins and the client's
// assigned regular user; never affects clients.status.
// ======================================================
router.put('/:jobId/tags', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const rawTags = req.body.tags;
  if (!Array.isArray(rawTags)) throw new AppError(400, 'tags must be an array of strings');
  const tags = rawTags
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((t) => t.slice(0, 40));

  await db.schemaReady;
  await loadJobWithAccessCheck(req, jobId);

  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('jobs')
    .update({ tags })
    .eq('id', jobId)
    .select()
    .maybeSingle();

  if (error) throw new AppError(500, 'Failed to update job tags: ' + error.message);
  res.json({ success: true, job: sanitizeJob(req, data) });
}));

// ======================================================
// JOB PAYMENTS (admin only — money received, Section 3/8)
//
// jobs.amount_paid is the job's running total. Every payment (and every
// correction) is also written to the `payments` ledger — dated, tied to the
// client, and tied to the job when payments.job_id exists (v6 migration) —
// so the Finance page, margin tracker and revenue figures include money
// received on jobs. Corrections are recorded as a negative ledger entry;
// payment records are never deleted.
// ======================================================
async function recordLedgerEntry(supabase, job, amount) {
  const row = {
    client_id: job.client_id,
    amount: roundMoney(amount),
    payment_date: new Date().toISOString()
  };
  if (await hasPaymentJobId()) {
    const { data, error } = await supabase.from('payments').insert({ ...row, job_id: job.id }).select().single();
    if (!error) return data;
    if (!isMissingColumnError(error)) throw new AppError(500, 'Failed to record payment: ' + error.message);
    markColumnAbsent('payments', 'job_id');
  }
  const { data, error } = await supabase.from('payments').insert(row).select().single();
  if (error) throw new AppError(500, 'Failed to record payment: ' + error.message);
  return data;
}

async function applyJobPayment(req, jobId, signedAmount) {
  await db.schemaReady;
  const { job } = await loadJobWithAccessCheck(req, jobId);
  const supabase = requireSupabase();

  const currentPaid = Number(job.amount_paid || 0);
  if (signedAmount < 0 && -signedAmount > currentPaid + MONEY_EPSILON) {
    throw new AppError(400, `Cannot remove more than the $${currentPaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} received on this job`);
  }

  const ledgerRow = await recordLedgerEntry(supabase, job, signedAmount);
  const newPaid = roundMoney(currentPaid + signedAmount);
  const newBalance = roundMoney(Number(job.total_due || 0) - newPaid);

  let updated;
  try {
    const { rows } = await db.query(
      'UPDATE jobs SET amount_paid=$1, balance=$2 WHERE id=$3 RETURNING *',
      [newPaid, newBalance, jobId]
    );
    updated = rows[0];
    if (!updated) throw new Error('job update returned no row');
  } catch (err) {
    // Keep the ledger and the job total in step: undo the entry we just added.
    if (ledgerRow && ledgerRow.id) await supabase.from('payments').delete().eq('id', ledgerRow.id);
    throw err instanceof AppError ? err : new AppError(500, 'Failed to update job payment total: ' + err.message);
  }

  await refreshFinanceYearsFor(job.created_at, 'job payment');
  return updated;
}

router.post('/:jobId/payment', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const amount = parseNumberField(req.body.amount, 'amount', { min: 0.01 });
  const job = await applyJobPayment(req, jobId, amount);
  res.json({ success: true, job });
}));

// Records a correction (refund / mistaken entry) against a job's payments.
router.post('/:jobId/payment/reverse', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const amount = parseNumberField(req.body.amount, 'amount', { min: 0.01 });
  const job = await applyJobPayment(req, jobId, -amount);
  res.json({ success: true, job });
}));

// Payment history for one job (needs payments.job_id from the v6 migration;
// before that, `supported: false` tells the page to show totals only).
router.get('/:jobId/payments', requireAdmin, asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  await db.schemaReady;
  await loadJobWithAccessCheck(req, jobId);
  if (!(await hasPaymentJobId())) return res.json({ supported: false, payments: [] });

  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('payments')
    .select('id, amount, payment_date')
    .eq('job_id', jobId)
    .order('payment_date', { ascending: false });
  if (error) {
    if (isMissingColumnError(error)) {
      markColumnAbsent('payments', 'job_id');
      return res.json({ supported: false, payments: [] });
    }
    throw new AppError(500, 'Failed to list payments: ' + error.message);
  }
  res.json({
    supported: true,
    payments: (data || []).map((p) => ({ id: p.id, amount: Number(p.amount || 0), payment_date: p.payment_date }))
  });
}));

// ======================================================
// DELETE JOB
// ======================================================
router.delete('/:jobId', asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  await db.schemaReady;
  const { job } = await loadJobWithAccessCheck(req, jobId);
  await db.query('DELETE FROM jobs WHERE id = $1', [jobId]);
  await refreshFinanceYearsFor(job.created_at, 'job delete');
  res.json({ success: true });
}));

// ======================================================
// JOB LINE ITEMS (services) — the priced list of work on a job's estimate/
// invoice, each with a category. Their sum is the job's total. Viewing is
// open to anyone who can open the job (the same prices already appear on
// the estimate/invoice PDFs they can download); adding, editing and removing
// change the job's price, so those stay admin-only.
// ======================================================
router.get('/:jobId/line-items', asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  await db.schemaReady;
  await loadJobWithAccessCheck(req, jobId);

  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('job_line_items')
    .select('*')
    .eq('job_id', jobId)
    .order('sort_order', { ascending: true });

  if (error) {
    if (/does not exist|relation/i.test(error.message || '')) return res.json({ lineItems: [], categories: LINE_ITEM_CATEGORIES });
    throw new AppError(500, 'Failed to fetch line items: ' + error.message);
  }

  res.json({ lineItems: (data || []).map(normalizeLineItem), categories: LINE_ITEM_CATEGORIES });
}));

router.post('/:jobId/line-items', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const item = parseLineItemInput(req.body, 0);

  await db.schemaReady;
  const { job } = await loadJobWithAccessCheck(req, jobId);
  const supabase = requireSupabase();

  let lineItem;
  if (req.body.sort_order !== undefined) {
    const { data, error } = await supabase
      .from('job_line_items')
      .insert({ job_id: jobId, ...item, sort_order: Number(req.body.sort_order) || 0 })
      .select()
      .single();
    if (error) throw new AppError(500, 'Failed to add line item: ' + error.message);
    lineItem = normalizeLineItem(data);
  } else {
    [lineItem] = await insertLineItems(supabase, jobId, [item]);
  }

  await recomputeJobTotalFromLineItems(supabase, jobId);
  await refreshFinanceYearsFor(job.created_at, 'line item add');
  res.json({ success: true, lineItem });
}));

// Adds several services at once (e.g. everything picked in "+ Service") with
// a single total recalculation.
router.post('/:jobId/line-items/bulk', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  if (!Array.isArray(req.body.line_items) || !req.body.line_items.length) {
    throw new AppError(400, 'line_items must be a non-empty array');
  }
  if (req.body.line_items.length > MAX_LINE_ITEMS_PER_REQUEST) throw new AppError(400, 'Too many line items');
  const items = req.body.line_items.map(parseLineItemInput);

  await db.schemaReady;
  const { job } = await loadJobWithAccessCheck(req, jobId);
  const supabase = requireSupabase();
  const lineItems = await insertLineItems(supabase, jobId, items);
  await recomputeJobTotalFromLineItems(supabase, jobId);
  await refreshFinanceYearsFor(job.created_at, 'line items add');
  res.json({ success: true, lineItems });
}));

router.put('/:jobId/line-items/:itemId', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const itemId = parseIntField(req.params.itemId, 'itemId', { min: 1 });

  await db.schemaReady;
  const { job } = await loadJobWithAccessCheck(req, jobId);
  const supabase = requireSupabase();

  const updates = { updated_at: new Date().toISOString() };
  if (req.body.description !== undefined) {
    updates.description = parseStringField(req.body.description ?? '', 'description', { required: false, maxLength: 500, defaultValue: '' });
  }
  if (req.body.quantity !== undefined) {
    updates.quantity = parseNumberField(req.body.quantity, 'quantity', { required: false, defaultValue: 1, min: 0 });
  }
  if (req.body.unit_price !== undefined) {
    updates.unit_price = parseNumberField(req.body.unit_price, 'unit_price', { required: false, defaultValue: 0, min: 0 });
  }
  if (req.body.category !== undefined) {
    updates.category = LINE_ITEM_CATEGORIES.includes(req.body.category) ? req.body.category : 'Miscellaneous';
  }
  if (req.body.sort_order !== undefined) {
    updates.sort_order = Number(req.body.sort_order) || 0;
  }

  const { data, error } = await supabase
    .from('job_line_items')
    .update(updates)
    .eq('id', itemId)
    .eq('job_id', jobId)
    .select()
    .maybeSingle();

  if (error) throw new AppError(500, 'Failed to update line item: ' + error.message);
  if (!data) throw new AppError(404, 'Line item not found');

  await recomputeJobTotalFromLineItems(supabase, jobId);
  await refreshFinanceYearsFor(job.created_at, 'line item update');
  res.json({ success: true, lineItem: normalizeLineItem(data) });
}));

router.delete('/:jobId/line-items/:itemId', requireAdmin, asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const itemId = parseIntField(req.params.itemId, 'itemId', { min: 1 });

  await db.schemaReady;
  const { job } = await loadJobWithAccessCheck(req, jobId);
  const supabase = requireSupabase();

  const { error } = await supabase
    .from('job_line_items')
    .delete()
    .eq('id', itemId)
    .eq('job_id', jobId);

  if (error) throw new AppError(500, 'Failed to delete line item: ' + error.message);

  await recomputeJobTotalFromLineItems(supabase, jobId);
  await refreshFinanceYearsFor(job.created_at, 'line item delete');
  res.json({ success: true });
}));

module.exports = router;

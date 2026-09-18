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

const router = express.Router();

const VALID_STATUSES = ['Prospect', 'Approved', 'Completed', 'Invoice', 'Closed'];
const LINE_ITEM_CATEGORIES = ['Labor', 'Materials', 'Commissions', 'Meals/Drinks', 'Miscellaneous', 'Permits'];

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
// GET SINGLE JOB
// ======================================================
router.get('/:jobId', asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  await db.schemaReady;
  const { job } = await loadJobWithAccessCheck(req, jobId);
  res.json({ job: sanitizeJob(req, job) });
}));

// ======================================================
// CREATE JOB
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
  // total_due is the job's quoted/contracted total — operational info any
  // assigned user may enter. job_cost is what the job actually costs (used
  // to compute margin against total_due) and stays admin-only.
  const totalDue = parseNumberField(req.body.total_due ?? 0, 'total_due', { required: false, defaultValue: 0 });
  const jobCost = isAdmin(req) ? parseNumberField(req.body.job_cost ?? 0, 'job_cost', { required: false, defaultValue: 0 }) : 0;
  const createdAt = new Date().toISOString();

  const { rows } = await db.query(
    `INSERT INTO jobs (client_id, title, status, scope_of_work, total_due, amount_paid, balance, job_cost, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8) RETURNING *`,
    [clientId, title, VALID_STATUSES.includes(status) ? status : 'Prospect', scopeOfWork, totalDue, totalDue, jobCost, createdAt]
  );

  res.json({ success: true, job: sanitizeJob(req, rows[0]) });
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

  // total_due (the job's quoted total) is editable by anyone with access to
  // the job. job_cost (Section 8) stays admin-only since it feeds margin.
  const totalDue = typeof req.body.total_due !== 'undefined'
    ? parseNumberField(req.body.total_due, 'total_due', { required: false, defaultValue: Number(job.total_due || 0) })
    : Number(job.total_due || 0);
  const amountPaid = Number(job.amount_paid || 0);
  const balance = totalDue - amountPaid;
  const jobCost = isAdmin(req) && typeof req.body.job_cost !== 'undefined'
    ? parseNumberField(req.body.job_cost, 'job_cost', { required: false, defaultValue: Number(job.job_cost || 0) })
    : Number(job.job_cost || 0);

  const { rows } = await db.query(
    `UPDATE jobs SET title=$1, status=$2, scope_of_work=$3, total_due=$4, balance=$5, job_cost=$6
     WHERE id=$7 RETURNING *`,
    [title, VALID_STATUSES.includes(status) ? status : job.status, scopeOfWork, totalDue, balance, jobCost, jobId]
  );

  res.json({ success: true, job: sanitizeJob(req, rows[0]) });
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

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

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
// ADD PAYMENT TO JOB (admin only — money received, Section 3/8)
// ======================================================
router.post('/:jobId/payment', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const amount = parseNumberField(req.body.amount, 'amount', { min: 0.01 });

  await db.schemaReady;
  const { job } = await loadJobWithAccessCheck(req, jobId);

  const newPaid = Number(job.amount_paid || 0) + amount;
  const newBalance = Number(job.total_due || 0) - newPaid;

  const { rows } = await db.query(
    'UPDATE jobs SET amount_paid=$1, balance=$2 WHERE id=$3 RETURNING *',
    [newPaid, newBalance, jobId]
  );

  res.json({ success: true, job: rows[0] });
}));

// ======================================================
// DELETE JOB
// ======================================================
router.delete('/:jobId', asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  await db.schemaReady;
  await loadJobWithAccessCheck(req, jobId);
  await db.query('DELETE FROM jobs WHERE id = $1', [jobId]);
  res.json({ success: true });
}));

// ======================================================
// JOB LINE ITEMS — estimate/invoice cost breakdown with categories
// (Section 1). Explicitly a "financial line item" per Section 8, so
// this entire surface (view, add, edit, delete) is admin-only.
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

router.get('/:jobId/line-items', requireAdmin, asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  await db.schemaReady;
  await loadJobWithAccessCheck(req, jobId);

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

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
  const description = parseStringField(req.body.description ?? '', 'description', { required: false, maxLength: 500, defaultValue: '' });
  const quantity = parseNumberField(req.body.quantity ?? 1, 'quantity', { required: false, defaultValue: 1, min: 0 });
  const unitPrice = parseNumberField(req.body.unit_price ?? 0, 'unit_price', { required: false, defaultValue: 0, min: 0 });
  const category = parseStringField(req.body.category ?? 'Miscellaneous', 'category', { required: false, defaultValue: 'Miscellaneous' });
  const finalCategory = LINE_ITEM_CATEGORIES.includes(category) ? category : 'Miscellaneous';

  await db.schemaReady;
  await loadJobWithAccessCheck(req, jobId);

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  const { data, error } = await supabase
    .from('job_line_items')
    .insert({
      job_id: jobId,
      description,
      quantity,
      unit_price: unitPrice,
      category: finalCategory,
      sort_order: Number(req.body.sort_order ?? 0)
    })
    .select()
    .single();

  if (error) throw new AppError(500, 'Failed to add line item: ' + error.message);

  await recomputeJobTotalFromLineItems(supabase, jobId);
  res.json({ success: true, lineItem: normalizeLineItem(data) });
}));

router.put('/:jobId/line-items/:itemId', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const itemId = parseIntField(req.params.itemId, 'itemId', { min: 1 });

  await db.schemaReady;
  await loadJobWithAccessCheck(req, jobId);

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

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
  res.json({ success: true, lineItem: normalizeLineItem(data) });
}));

router.delete('/:jobId/line-items/:itemId', requireAdmin, asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const itemId = parseIntField(req.params.itemId, 'itemId', { min: 1 });

  await db.schemaReady;
  await loadJobWithAccessCheck(req, jobId);

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  const { error } = await supabase
    .from('job_line_items')
    .delete()
    .eq('id', itemId)
    .eq('job_id', jobId);

  if (error) throw new AppError(500, 'Failed to delete line item: ' + error.message);

  await recomputeJobTotalFromLineItems(supabase, jobId);
  res.json({ success: true });
}));

module.exports = router;

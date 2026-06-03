const express = require('express');
const db = require('./db');
const { asyncHandler, assertObject, parseIntField, parseNumberField, parseStringField } = require('./request-utils');

const router = express.Router();

const VALID_STATUSES = ['Prospect', 'Approved', 'Completed', 'Invoice', 'Closed'];

// ======================================================
// LIST JOBS FOR A CLIENT
// ======================================================
router.get('/client/:clientId', asyncHandler(async (req, res) => {
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  await db.schemaReady;
  const { rows } = await db.query(
    'SELECT * FROM jobs WHERE client_id = $1 ORDER BY created_at DESC',
    [clientId]
  );
  res.json({ jobs: rows });
}));

// ======================================================
// GET SINGLE JOB
// ======================================================
router.get('/:jobId', asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  await db.schemaReady;
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  res.json({ job: rows[0] });
}));

// ======================================================
// CREATE JOB
// ======================================================
router.post('/', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const clientId = parseIntField(req.body.client_id, 'client_id', { min: 1 });
  const title = parseStringField(req.body.title ?? 'New Job', 'title', { required: false, maxLength: 200, defaultValue: 'New Job' });
  const status = parseStringField(req.body.status ?? 'Prospect', 'status', { required: false, maxLength: 30, defaultValue: 'Prospect' });
  const scopeOfWork = parseStringField(req.body.scope_of_work ?? '', 'scope_of_work', { required: false, maxLength: 5000, defaultValue: '' });
  const totalDue = parseNumberField(req.body.total_due ?? 0, 'total_due', { required: false, defaultValue: 0 });
  const jobCost = parseNumberField(req.body.job_cost ?? 0, 'job_cost', { required: false, defaultValue: 0 });
  const createdAt = new Date().toISOString();

  await db.schemaReady;
  const { rows } = await db.query(
    `INSERT INTO jobs (client_id, title, status, scope_of_work, total_due, amount_paid, balance, job_cost, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8) RETURNING *`,
    [clientId, title, VALID_STATUSES.includes(status) ? status : 'Prospect', scopeOfWork, totalDue, totalDue, jobCost, createdAt]
  );

  res.json({ success: true, job: rows[0] });
}));

// ======================================================
// UPDATE JOB
// ======================================================
router.put('/:jobId', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });

  await db.schemaReady;
  const existing = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  if (!existing.rows[0]) return res.status(404).json({ error: 'Job not found' });
  const job = existing.rows[0];

  const title = parseStringField(req.body.title ?? job.title, 'title', { required: false, maxLength: 200, defaultValue: job.title });
  const status = parseStringField(req.body.status ?? job.status, 'status', { required: false, maxLength: 30, defaultValue: job.status });
  const scopeOfWork = parseStringField(req.body.scope_of_work ?? job.scope_of_work, 'scope_of_work', { required: false, maxLength: 5000, defaultValue: job.scope_of_work });
  const totalDue = typeof req.body.total_due !== 'undefined'
    ? parseNumberField(req.body.total_due, 'total_due', { required: false, defaultValue: Number(job.total_due || 0) })
    : Number(job.total_due || 0);
  const amountPaid = Number(job.amount_paid || 0);
  const balance = totalDue - amountPaid;
  const jobCost = typeof req.body.job_cost !== 'undefined'
    ? parseNumberField(req.body.job_cost, 'job_cost', { required: false, defaultValue: Number(job.job_cost || 0) })
    : Number(job.job_cost || 0);

  const { rows } = await db.query(
    `UPDATE jobs SET title=$1, status=$2, scope_of_work=$3, total_due=$4, balance=$5, job_cost=$6
     WHERE id=$7 RETURNING *`,
    [title, VALID_STATUSES.includes(status) ? status : job.status, scopeOfWork, totalDue, balance, jobCost, jobId]
  );

  res.json({ success: true, job: rows[0] });
}));

// ======================================================
// ADD PAYMENT TO JOB
// ======================================================
router.post('/:jobId/payment', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const amount = parseNumberField(req.body.amount, 'amount', { min: 0.01 });

  await db.schemaReady;
  const existing = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  if (!existing.rows[0]) return res.status(404).json({ error: 'Job not found' });
  const job = existing.rows[0];

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
  await db.query('DELETE FROM jobs WHERE id = $1', [jobId]);
  res.json({ success: true });
}));

module.exports = router;

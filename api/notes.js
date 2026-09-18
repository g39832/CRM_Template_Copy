const express = require('express');
const db = require('./db');
const { getClient } = require('./db-v2');
const { asyncHandler, assertObject, parseIntField, parseStringField, AppError } = require('./request-utils');
const { canAccessClient } = require('./access-control');

const router = express.Router();

async function loadClientWithAccessCheck(req, id) {
  const { rows } = await db.query('SELECT * FROM clients WHERE id = $1', [id]);
  const client = rows[0];
  if (!client) throw new AppError(404, 'Client not found');
  if (!canAccessClient(req, client)) throw new AppError(403, 'You do not have access to this client');
  return client;
}

// Loads a job and verifies the requesting session can access its parent
// client (same ownership rule as everywhere else — admins always can,
// regular users only for clients assigned to them).
async function loadJobWithAccessCheck(req, jobId) {
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = rows[0];
  if (!job) throw new AppError(404, 'Job not found');
  await loadClientWithAccessCheck(req, job.client_id);
  return job;
}

// ======================================================
// LIST NOTES
// ======================================================
router.get('/list/:clientId', asyncHandler(async (req, res) => {
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  await db.schemaReady;
  await loadClientWithAccessCheck(req, clientId);
  const { rows } = await db.query(
    'SELECT id, content, created_at FROM notes WHERE client_id = $1 ORDER BY created_at ASC',
    [clientId]
  );
  res.json({ notes: rows });
}));

// ======================================================
// ADD NOTE (matches frontend)
// ======================================================
router.post('/add/:clientId', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const note = parseStringField(req.body.note, 'note', { minLength: 1, maxLength: 10000 });

  await db.schemaReady;
  await loadClientWithAccessCheck(req, clientId);
  const { rows } = await db.query(
    'INSERT INTO notes (client_id, content) VALUES ($1, $2) RETURNING id, content, created_at',
    [clientId, note]
  );

  res.json({ note: rows[0] });
}));

// ======================================================
// DELETE NOTE
// ======================================================
router.delete('/delete/:clientId/:noteId', asyncHandler(async (req, res) => {
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });

  await db.schemaReady;
  await loadClientWithAccessCheck(req, clientId);
  await db.query('DELETE FROM notes WHERE id = $1 AND client_id = $2', [noteId, clientId]);
  res.json({ success: true });
}));

// ======================================================
// UPDATE NOTE
// ======================================================
router.put('/update/:clientId/:noteId', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });
  const note = parseStringField(req.body.note, 'note', { minLength: 1, maxLength: 10000 });

  await db.schemaReady;
  await loadClientWithAccessCheck(req, clientId);
  await db.query(
    'UPDATE notes SET content = $1 WHERE id = $2 AND client_id = $3',
    [note, noteId, clientId]
  );

  const { rows } = await db.query(
    'SELECT id, content, created_at FROM notes WHERE id = $1',
    [noteId]
  );

  res.json({ note: rows[0] || null });
}));

// ======================================================
// JOB-SCOPED NOTES — same `notes` table, filtered by job_id instead of
// client_id, so the job details page has its own notes separate from the
// client-level notes above. client_id is still recorded (denormalized from
// the job) so nothing else about the table's shape has to change.
// ======================================================
// job-notes go straight through the real Supabase client — db.js's query()
// only recognizes a fixed set of exact SQL strings (see api/db.js), and
// notes.job_id is a new column that isn't one of them.
router.get('/job/:jobId', asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  await db.schemaReady;
  await loadJobWithAccessCheck(req, jobId);

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  const { data, error } = await supabase
    .from('notes')
    .select('id, content, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  if (error) throw new AppError(500, 'Failed to list job notes: ' + error.message);

  res.json({ notes: data || [] });
}));

router.post('/job/:jobId', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const note = parseStringField(req.body.note, 'note', { minLength: 1, maxLength: 10000 });

  await db.schemaReady;
  const job = await loadJobWithAccessCheck(req, jobId);

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  const { data, error } = await supabase
    .from('notes')
    .insert({ client_id: job.client_id, job_id: jobId, content: note })
    .select('id, content, created_at')
    .single();
  if (error) throw new AppError(500, 'Failed to add job note: ' + error.message);

  res.json({ note: data });
}));

router.put('/job/:jobId/:noteId', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });
  const note = parseStringField(req.body.note, 'note', { minLength: 1, maxLength: 10000 });

  await db.schemaReady;
  await loadJobWithAccessCheck(req, jobId);

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  const { data, error } = await supabase
    .from('notes')
    .update({ content: note })
    .eq('id', noteId)
    .eq('job_id', jobId)
    .select('id, content, created_at')
    .maybeSingle();
  if (error) throw new AppError(500, 'Failed to update job note: ' + error.message);

  res.json({ note: data || null });
}));

router.delete('/job/:jobId/:noteId', asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });

  await db.schemaReady;
  await loadJobWithAccessCheck(req, jobId);

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  const { error } = await supabase.from('notes').delete().eq('id', noteId).eq('job_id', jobId);
  if (error) throw new AppError(500, 'Failed to delete job note: ' + error.message);

  res.json({ success: true });
}));

module.exports = router;
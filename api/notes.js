const express = require('express');
const db = require('./db');
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

module.exports = router;
const express = require('express');
const router = express.Router();
const multer = require('multer');
const os = require('os');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { getClient } = require('./db-v2');
const { asyncHandler, parseIntField, AppError } = require('./request-utils');
const { canAccessClient } = require('./access-control');
const {
  isRemoteStorageEnabled,
  isLocalStorageEnabled,
  ensureRemoteBucket,
  remoteUploadFile,
  remoteSignedUrl,
  remoteDeleteByPath,
  localFilePathForObject
} = require('../services/storage');

const CATEGORIES = ['document', 'photo'];

const TMP_UPLOAD_DIR = path.join(os.tmpdir(), 'crm-uploads');
fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname || '')}`)
  }),
  limits: {
    fileSize: 150 * 1024 * 1024, // 150MB — large photo-report PDFs and multi-photo batches
    files: 20
  }
});

// Loads a job and verifies the requesting session can access its parent
// client (same ownership rule used everywhere else). Regular users may
// read/upload/delete a job's files as long as they're assigned to the
// client — this is operational job data, not the financial fields that
// stay admin-only.
async function loadJobWithAccess(req, jobId) {
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = rows[0];
  if (!job) throw new AppError(404, 'Job not found');
  const { rows: clientRows } = await db.query('SELECT * FROM clients WHERE id = $1', [job.client_id]);
  const client = clientRows[0];
  if (!client) throw new AppError(404, 'Client not found');
  if (!canAccessClient(req, client)) throw new AppError(403, 'You do not have access to this job');
  return { job, client };
}

async function cleanupTempFiles(files) {
  await Promise.all((files || []).map((f) => fs.promises.unlink(f.path).catch(() => {})));
}

function normalizeFileRow(row) {
  return {
    id: row.id,
    job_id: row.job_id,
    category: row.category,
    file_name: row.file_name,
    mime_type: row.mime_type || '',
    size_bytes: Number(row.size_bytes || 0),
    created_at: row.created_at
  };
}

// ======================================================
// UPLOAD — one category (document or photo) per request, so the two are
// never mixed together in the same batch.
// ======================================================
router.post('/:jobId/upload', upload.any(), asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const files = req.files || [];
  try {
    const { job } = await loadJobWithAccess(req, jobId);
    const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'document';
    if (!files.length) throw new AppError(400, 'No files uploaded.');
    if (!isRemoteStorageEnabled() && !isLocalStorageEnabled()) throw new AppError(500, 'File storage is not configured.');
    if (isRemoteStorageEnabled()) await ensureRemoteBucket();

    const supabase = getClient();
    if (!supabase) throw new AppError(503, 'Database not configured');

    const saved = [];
    for (const file of files) {
      const cleanName = path.basename(file.originalname || 'file');
      const objectPath = `jobs/${jobId}/${category}/${Date.now()}-${cleanName}`;

      let uploadedPath;
      try {
        uploadedPath = await remoteUploadFile(file, objectPath);
      } catch (err) {
        throw new AppError(502, `Failed to upload "${cleanName}": ${err.message}`);
      }

      const { data, error } = await supabase
        .from('job_files')
        .insert({
          job_id: jobId,
          client_id: job.client_id,
          category,
          file_name: cleanName,
          storage_path: uploadedPath,
          mime_type: file.mimetype || '',
          size_bytes: file.size || 0,
          uploaded_by: (req.session.user && req.session.user.id) || null
        })
        .select()
        .single();

      if (error) {
        // The bytes are already stored — surface a clear error rather than
        // silently losing track of an uploaded file.
        throw new AppError(500, `"${cleanName}" uploaded but could not be recorded: ${error.message}`);
      }
      saved.push(normalizeFileRow(data));
    }

    res.json({ success: true, files: saved });
  } finally {
    await cleanupTempFiles(files);
  }
}));

// ======================================================
// LIST (optionally filtered by category)
// ======================================================
router.get('/:jobId', asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  await loadJobWithAccess(req, jobId);

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  let query = supabase.from('job_files').select('*').eq('job_id', jobId).order('created_at', { ascending: false });
  if (CATEGORIES.includes(req.query.category)) query = query.eq('category', req.query.category);

  const { data, error } = await query;
  if (error) {
    if (/does not exist|relation/i.test(error.message || '')) return res.json({ files: [] });
    throw new AppError(500, 'Failed to list files: ' + error.message);
  }
  res.json({ files: (data || []).map(normalizeFileRow) });
}));

async function loadFileRowOrThrow(supabase, jobId, fileId) {
  const { data, error } = await supabase.from('job_files').select('*').eq('id', fileId).eq('job_id', jobId).maybeSingle();
  if (error) throw new AppError(500, 'Failed to look up file: ' + error.message);
  if (!data) throw new AppError(404, 'File not found');
  return data;
}

// ======================================================
// DOWNLOAD / VIEW — streams local-mode files directly; redirects to a
// signed URL when storage is remote (Supabase Storage).
// ======================================================
router.get('/:jobId/:fileId/download', asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const fileId = parseIntField(req.params.fileId, 'fileId', { min: 1 });
  await loadJobWithAccess(req, jobId);

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  const row = await loadFileRowOrThrow(supabase, jobId, fileId);

  if (isLocalStorageEnabled()) {
    const localPath = localFilePathForObject(row.storage_path);
    return res.sendFile(localPath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ success: false, error: 'File not found' });
    });
  }

  const url = await remoteSignedUrl(row.storage_path);
  if (!url) throw new AppError(404, 'File not found');
  res.redirect(url);
}));

// ======================================================
// DELETE
// ======================================================
router.delete('/:jobId/:fileId', asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const fileId = parseIntField(req.params.fileId, 'fileId', { min: 1 });
  await loadJobWithAccess(req, jobId);

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  const row = await loadFileRowOrThrow(supabase, jobId, fileId);

  await remoteDeleteByPath(row.storage_path);
  const { error: delErr } = await supabase.from('job_files').delete().eq('id', fileId);
  if (delErr) throw new AppError(500, 'Failed to delete file record: ' + delErr.message);

  res.json({ success: true });
}));

module.exports = router;

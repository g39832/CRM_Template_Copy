const express = require('express');
const router = express.Router();
const multer = require('multer');
const os = require('os');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const {
  asyncHandler,
  parseStringField,
  AppError
} = require('./request-utils');
const { canAccessClient, isAdmin } = require('./access-control');
const {
  isRemoteStorageEnabled,
  isLocalStorageEnabled,
  ensureRemoteBucket,
  remoteUploadFile,
  remoteListFiles,
  remoteDeleteFile
} = require('../services/storage');

// ======================================================
// STORAGE CONFIG
// Disk-backed temp storage instead of buffering whole files in process
// memory: large scanned/photo-report PDFs were failing (or risking OOM
// under concurrent uploads) against the old memoryStorage + 25MB cap.
// ======================================================
const TMP_UPLOAD_DIR = path.join(os.tmpdir(), 'crm-uploads');
fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname || '')}`)
  }),
  limits: {
    fileSize: 150 * 1024 * 1024, // 150MB — large photo-report PDFs
    files: 20
  }
});

async function loadClientOrThrow(clientId) {
  const { rows } = await db.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  if (!rows[0]) throw new AppError(404, 'Client not found');
  return rows[0];
}

// :key is either a numeric client id (the normal case — per-client files)
// or a free-form group key used only by the admin-only finance/margin
// tracker (e.g. "margin-2024"). Every request must resolve to someone
// actually allowed to see that data — previously this route had no access
// check at all, so any authenticated session could read/delete any other
// user's client files just by guessing an id.
async function checkKeyAccess(req, key) {
  if (/^\d+$/.test(key)) {
    await db.schemaReady;
    const client = await loadClientOrThrow(Number(key));
    if (!canAccessClient(req, client)) throw new AppError(403, 'You do not have access to this client');
    return;
  }
  if (!isAdmin(req)) throw new AppError(403, 'Admin access required');
}

async function cleanupTempFiles(files) {
  await Promise.all((files || []).map((f) => fs.promises.unlink(f.path).catch(() => {})));
}

// ======================================================
// UPLOAD FILE(S) BY KEY (clientId or groupKey)
// ======================================================
router.post('/upload/:key', upload.any(), asyncHandler(async (req, res) => {
  const files = req.files || [];
  const key = req.params.key;
  try {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      throw new AppError(400, 'Invalid upload key.');
    }
    await checkKeyAccess(req, key);
    if (!files.length) {
      throw new AppError(400, 'No files uploaded.');
    }

    if (!isRemoteStorageEnabled() && !isLocalStorageEnabled()) {
      throw new AppError(500, 'File storage is not configured.');
    }

    if (isRemoteStorageEnabled()) {
      await ensureRemoteBucket();
    }

    const saved = [];
    for (const file of files) {
      const cleanName = path.basename(file.originalname || 'file');
      const objectPath = `${key}/${Date.now()}-${cleanName}`;
      await remoteUploadFile(file, objectPath);
      saved.push({
        name: path.basename(objectPath),
        path: objectPath,
        url: '',
        ext: path.extname(objectPath).toLowerCase()
      });
    }

    res.json({
      success: true,
      files: saved
    });
  } finally {
    await cleanupTempFiles(files);
  }
}));

// ======================================================
// LIST FILES BY KEY (clientId or groupKey)
// ======================================================
router.get('/list/:key', asyncHandler(async (req, res) => {
  const key = parseStringField(req.params.key, 'key', { minLength: 1, maxLength: 128 });
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    throw new AppError(400, 'Invalid list key.');
  }
  await checkKeyAccess(req, key);

  if (!isRemoteStorageEnabled() && !isLocalStorageEnabled()) {
    throw new AppError(500, 'File storage is not configured.');
  }

  const isClientId = /^\d+$/.test(key);
  const files = (await remoteListFiles(key)).filter((file) => (isClientId ? true : file.ext === '.pdf'));

  res.json({ success: true, files });
}));

// ======================================================
// DELETE FILE BY CLIENT ID (existing)
// ======================================================
router.delete('/delete/:clientId/:fileName', asyncHandler(async (req, res) => {
  const clientId = parseStringField(req.params.clientId, 'clientId', { minLength: 1, maxLength: 128 });
  const fileName = parseStringField(req.params.fileName, 'fileName', { minLength: 1, maxLength: 512, trim: false });

  if (!clientId || !fileName) {
    throw new AppError(400, 'Missing clientId or fileName');
  }
  await checkKeyAccess(req, clientId);

  if (!isRemoteStorageEnabled() && !isLocalStorageEnabled()) {
    throw new AppError(500, 'File storage is not configured.');
  }

  const deleted = await remoteDeleteFile(clientId, fileName);
  if (!deleted) {
    throw new AppError(404, 'File not found');
  }

  res.json({ success: true, message: 'File deleted' });
}));

// ======================================================
// DELETE FILE BY GROUP-YEAR (FINANCE FIX)
// ======================================================
router.delete('/delete/:groupKey', asyncHandler(async (req, res) => {
  const groupKey = parseStringField(req.params.groupKey, 'groupKey', { minLength: 1, maxLength: 128 });
  const fileName = parseStringField(req.query.file, 'file', { minLength: 1, maxLength: 512, trim: false });

  if (!groupKey || !fileName) {
    throw new AppError(400, 'Missing groupKey or file name');
  }
  await checkKeyAccess(req, groupKey);

  const decodedFile = decodeURIComponent(fileName);
  if (!isRemoteStorageEnabled() && !isLocalStorageEnabled()) {
    throw new AppError(500, 'File storage is not configured.');
  }

  const deleted = await remoteDeleteFile(groupKey, decodedFile);
  if (!deleted) throw new AppError(404, 'File not found');

  res.json({ success: true });
}));

module.exports = router;

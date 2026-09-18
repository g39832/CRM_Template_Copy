const path = require('path');
const fs = require('fs/promises');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'crm-files';
const STORAGE_BACKEND = (process.env.STORAGE_BACKEND || 'auto').toLowerCase();
const LOCAL_UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })
  : null;

// TODO: If you want server-side uploads without a service-role key, switch this route to a signed-upload flow.

let remoteBucketReady = false;
let remoteBucketPromise = null;

function isRemoteStorageEnabled() {
  if (STORAGE_BACKEND === 'local') return false;
  if (STORAGE_BACKEND === 'supabase') return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function isLocalStorageEnabled() {
  return STORAGE_BACKEND === 'local' || !isRemoteStorageEnabled();
}

function safePrefix(prefix) {
  return String(prefix || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9_-]/g, '_'))
    .join(path.sep);
}

function safeFileName(fileName) {
  return path.basename(String(fileName || 'file')).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function localObjectPath(prefix, fileName) {
  const cleanPrefix = safePrefix(prefix);
  const cleanFile = safeFileName(fileName);
  return path.join(LOCAL_UPLOAD_ROOT, cleanPrefix, cleanFile);
}

function localPublicPath(prefix, fileName) {
  const cleanPrefix = safePrefix(prefix).replace(new RegExp(`\\${path.sep}`, 'g'), '/');
  const cleanFile = safeFileName(fileName);
  return `/uploads/${cleanPrefix ? `${cleanPrefix}/` : ''}${encodeURIComponent(cleanFile)}`;
}

async function ensureLocalBucket(prefix) {
  const dir = path.dirname(localObjectPath(prefix, 'placeholder.pdf'));
  await fs.mkdir(dir, { recursive: true });
}

function storageHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra
  };
}

async function ensureRemoteBucket() {
  if (!isRemoteStorageEnabled()) return;
  if (!supabase) {
    throw new Error('Supabase storage is not configured');
  }
  if (remoteBucketReady) return;
  if (!remoteBucketPromise) {
    remoteBucketPromise = (async () => {
      const { error } = await supabase.storage.createBucket(SUPABASE_STORAGE_BUCKET, {
        public: false
      });

      if (error && !/already exists/i.test(error.message || '')) {
        throw new Error(`Failed to ensure storage bucket: ${error.message}`);
      }

      remoteBucketReady = true;
    })().finally(() => {
      remoteBucketPromise = null;
    });
  }

  await remoteBucketPromise;
}

// `file` is a multer file object — either memoryStorage (has `.buffer`) or
// diskStorage (has `.path`, used for large uploads so the whole request
// body isn't held in memory while it's being received). Either shape works
// here; disk-backed files are read once, as a single bounded read, right
// before handing their bytes to the storage backend.
async function readFileBody(file) {
  if (file.buffer) return file.buffer;
  if (file.path) return fs.readFile(file.path);
  throw new Error('Uploaded file has neither a buffer nor a path');
}

async function remoteUploadFile(file, objectPath) {
  const body = await readFileBody(file);

  if (isLocalStorageEnabled()) {
    const prefix = path.dirname(objectPath);
    const fileName = path.basename(objectPath);
    await ensureLocalBucket(prefix);
    await fs.writeFile(localObjectPath(prefix, fileName), body);
    return objectPath;
  }

  await ensureRemoteBucket();
  if (!supabase) {
    throw new Error('Supabase storage is not configured');
  }

  const { error } = await supabase.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .upload(objectPath, body, {
      upsert: true,
      contentType: file.mimetype || 'application/octet-stream'
    });

  if (error) {
    console.error('Supabase upload error:', error);
    throw new Error(`Remote upload failed: ${error.message}`);
  }

  return objectPath;
}

// Signed URL / delete-by-exact-path variants for callers (job_files) that
// already know the precise storage path from a database row, instead of
// having to list a whole prefix first.
async function remoteSignedUrl(objectPath, expiresIn = 60 * 60) {
  if (isLocalStorageEnabled()) return null;
  await ensureRemoteBucket();
  if (!supabase) {
    throw new Error('Supabase storage is not configured');
  }
  const { data, error } = await supabase.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .createSignedUrl(objectPath, expiresIn);
  if (error) {
    throw new Error(`Remote signed URL failed: ${error.message}`);
  }
  return data?.signedUrl || null;
}

function localFilePathForObject(objectPath) {
  const prefix = path.dirname(objectPath);
  const fileName = path.basename(objectPath);
  return localObjectPath(prefix, fileName);
}

async function remoteDeleteByPath(objectPath) {
  if (isLocalStorageEnabled()) {
    try {
      await fs.unlink(localFilePathForObject(objectPath));
      return true;
    } catch (err) {
      if (err && err.code === 'ENOENT') return false;
      throw err;
    }
  }

  await ensureRemoteBucket();
  if (!supabase) {
    throw new Error('Supabase storage is not configured');
  }
  const { error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove([objectPath]);
  if (error) {
    throw new Error(`Remote delete failed: ${error.message}`);
  }
  return true;
}

async function remoteListFiles(prefix) {
  if (isLocalStorageEnabled()) {
    await ensureLocalBucket(prefix);
    const dir = path.join(LOCAL_UPLOAD_ROOT, safePrefix(prefix));
    const files = [];

    async function walk(currentDir) {
      let entries = [];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch (err) {
        if (err && err.code === 'ENOENT') return;
        throw err;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }

        const relPath = path.relative(LOCAL_UPLOAD_ROOT, fullPath).split(path.sep).join('/');
        files.push({
          name: entry.name,
          path: relPath,
          url: localPublicPath(prefix, entry.name),
          ext: path.extname(entry.name).toLowerCase()
        });
      }
    }

    await walk(dir);
    return files;
  }

  await ensureRemoteBucket();
  if (!supabase) {
    throw new Error('Supabase storage is not configured');
  }

  const { data: items, error } = await supabase.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .list(prefix, {
      limit: 1000,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' }
    });

  if (error) {
    throw new Error(`Remote list failed: ${error.message}`);
  }

  const files = Array.isArray(items) ? items.filter((row) => row && row.name) : [];

  return Promise.all(
    files.map(async (row) => {
      const objectPath = row.name.startsWith(`${prefix}/`) ? row.name : `${prefix}/${row.name}`;
      const { data: signedData, error: signedError } = await supabase.storage
        .from(SUPABASE_STORAGE_BUCKET)
        .createSignedUrl(objectPath, 60 * 60);

      if (signedError) {
        throw new Error(`Remote signed URL failed: ${signedError.message}`);
      }

      return {
        name: path.basename(objectPath),
        path: objectPath,
        url: signedData?.signedUrl || '',
        ext: path.extname(objectPath).toLowerCase()
      };
    })
  );
}

async function remoteDeleteFile(prefix, fileName) {
  if (isLocalStorageEnabled()) {
    const cleanPrefix = safePrefix(prefix);
    const cleanFile = safeFileName(fileName);
    const target = localObjectPath(cleanPrefix, cleanFile);
    try {
      await fs.unlink(target);
      return true;
    } catch (err) {
      if (err && err.code === 'ENOENT') return false;
      throw err;
    }
  }

  await ensureRemoteBucket();
  if (!supabase) {
    throw new Error('Supabase storage is not configured');
  }

  const { data: items, error } = await supabase.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .list(prefix, {
      limit: 1000,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' }
    });

  if (error) {
    throw new Error(`Remote delete lookup failed: ${error.message}`);
  }

  const match = Array.isArray(items)
    ? items.find((item) => item.name === path.basename(fileName))
    : null;

  if (!match) return false;

  const objectPath = match.name.startsWith(`${prefix}/`) ? match.name : `${prefix}/${match.name}`;
  const { error: deleteError } = await supabase.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .remove([objectPath]);

  if (deleteError) {
    throw new Error(`Remote delete failed: ${deleteError.message}`);
  }

  return true;
}

module.exports = {
  isRemoteStorageEnabled,
  isLocalStorageEnabled,
  ensureRemoteBucket,
  remoteUploadFile,
  remoteListFiles,
  remoteDeleteFile,
  remoteSignedUrl,
  remoteDeleteByPath,
  localFilePathForObject
};

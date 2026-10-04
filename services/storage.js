const path = require('path');
const fs = require('fs/promises');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'crm-files';
const STORAGE_BACKEND = (process.env.STORAGE_BACKEND || 'auto').toLowerCase();
// LOCAL_UPLOAD_ROOT lets the local test harness keep its files in a temp
// folder instead of the project's uploads/ directory.
const LOCAL_UPLOAD_ROOT = process.env.LOCAL_UPLOAD_ROOT || path.join(__dirname, '..', 'uploads');

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })
  : null;

// Two buckets:
//   SUPABASE_STORAGE_BUCKET (private)  customer documents, job photos, contracts.
//     Never public: the server checks access and hands out short-lived signed
//     links.
//   SUPABASE_PUBLIC_BUCKET  (public)   brand assets only (the company logo),
//     which have to load without signing in.
const SUPABASE_PUBLIC_BUCKET = process.env.SUPABASE_PUBLIC_BUCKET || 'crm-public-assets';
const PUBLIC_ASSET_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

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

      // The bucket may predate this code (or have been made public by an
      // older logo upload). Customer files must never be public — say so
      // loudly; scripts/verify-security.js fails the deploy check too.
      try {
        const { data: info } = await supabase.storage.getBucket(SUPABASE_STORAGE_BUCKET);
        if (info && info.public) {
          console.error(`[storage] SECURITY: bucket "${SUPABASE_STORAGE_BUCKET}" is PUBLIC. Anyone with a file's path can download it. Make it private (see scripts/verify-security.js).`);
        }
      } catch (_) { /* informational only */ }

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

// ---- Public brand assets (company logo) -------------------------------
let publicBucketReady = false;

async function ensurePublicAssetsBucket() {
  if (!supabase) throw new Error('Supabase storage is not configured');
  if (publicBucketReady) return;
  const { error } = await supabase.storage.createBucket(SUPABASE_PUBLIC_BUCKET, {
    public: true,
    allowedMimeTypes: PUBLIC_ASSET_MIMES,
    fileSizeLimit: 5 * 1024 * 1024
  });
  if (error && !/already exists/i.test(error.message || '')) {
    throw new Error(`Failed to ensure public assets bucket: ${error.message}`);
  }
  publicBucketReady = true;
}

// Uploads a brand asset to the PUBLIC bucket and returns its public URL.
async function uploadPublicAsset(objectPath, body, contentType) {
  if (SUPABASE_PUBLIC_BUCKET === SUPABASE_STORAGE_BUCKET) {
    throw new Error('SUPABASE_PUBLIC_BUCKET must be different from the private SUPABASE_STORAGE_BUCKET');
  }
  await ensurePublicAssetsBucket();
  const { error } = await supabase.storage
    .from(SUPABASE_PUBLIC_BUCKET)
    .upload(objectPath, body, { upsert: true, contentType });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data } = supabase.storage.from(SUPABASE_PUBLIC_BUCKET).getPublicUrl(objectPath);
  return data && data.publicUrl ? data.publicUrl : null;
}

// Logos uploaded before the split live in the private bucket under a
// "public" URL that stops working once that bucket is private. Returns the
// object path for such a URL (or null for anything else).
function legacyPrivateObjectPath(url) {
  const prefix = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/`;
  const value = String(url || '');
  if (!SUPABASE_URL || !value.startsWith(prefix)) return null;
  const objectPath = decodeURIComponent(value.slice(prefix.length).split('?')[0]);
  return objectPath && !objectPath.includes('..') ? objectPath : null;
}

// What the browser should load for a stored logo URL: legacy private-bucket
// logos are served through the signed-in /api/v2/branding/logo route.
function displayableLogoUrl(url) {
  if (legacyPrivateObjectPath(url)) return '/api/v2/branding/logo';
  return url || '';
}

async function downloadPrivateObject(objectPath) {
  if (!supabase) throw new Error('Supabase storage is not configured');
  const { data, error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).download(objectPath);
  if (error) throw new Error(`Download failed: ${error.message}`);
  return data; // Blob
}

module.exports = {
  SUPABASE_PUBLIC_BUCKET,
  uploadPublicAsset,
  legacyPrivateObjectPath,
  displayableLogoUrl,
  downloadPrivateObject,
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

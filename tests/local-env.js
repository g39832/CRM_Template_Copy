// Shared settings for running the app against the in-memory Supabase
// stand-in (tests/mock-supabase) instead of the real project in .env.
//
// Every variable the app reads for its database/storage is overridden here.
// dotenv never replaces a variable that is already set (even to ''), so the
// real credentials in .env cannot leak into a local test run.
const os = require('os');
const path = require('path');
const fs = require('fs');

const MOCK_PORT = Number(process.env.MOCK_SUPABASE_PORT || 54329);
const APP_PORT = Number(process.env.LOCAL_TEST_PORT || 3222);
const UPLOAD_ROOT = path.join(os.tmpdir(), 'crm-local-test-uploads');
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;

const APP_ENV = {
  NODE_ENV: 'test',
  PORT: String(APP_PORT),
  SUPABASE_URL: MOCK_URL,
  SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role-key',
  SUPABASE_ANON_KEY: 'mock-anon-key',
  SUPABASE_DATABASE_URL: '',
  SUPABASE_STORAGE_BUCKET: 'crm-files',
  STORAGE_BACKEND: 'local',
  LOCAL_UPLOAD_ROOT: UPLOAD_ROOT,
  ENABLE_DB_BACKUPS: 'false',
  SESSION_SECRET: 'local-test-session-secret',
  DISABLE_AUTH: 'false',
  // Re-check optional tables/columns on every request so tests can switch
  // the mock between "before" and "after" the migrations.
  SCHEMA_CACHE_MS: '0'
};

function assertLocalOnly(env = APP_ENV) {
  const host = new URL(env.SUPABASE_URL).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Refusing to run: SUPABASE_URL points at ${host}, not the local mock.`);
  }
}

// A tiny but valid one-page PDF and a 1x1 PNG, so view/download checks have
// real bytes to fetch.
const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
);
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// Recreates the upload folder with the files the seed data references:
// job files (job_files rows) and older client-level PDFs (listed by prefix).
function prepareUploads(root = UPLOAD_ROOT) {
  fs.rmSync(root, { recursive: true, force: true });
  const write = (rel, bytes) => {
    const full = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, bytes);
  };
  write('jobs/1/document/1700000000000-contract.pdf', PDF_BYTES);
  write('jobs/1/photo/1700000000001-before.png', PNG_BYTES);
  write('1/1690000000000-signed-estimate.pdf', PDF_BYTES);
  write('1/1690000000001-insurance-claim.pdf', PDF_BYTES);
  write('2/1690000000002-old-quote.pdf', PDF_BYTES);
}

module.exports = { MOCK_PORT, APP_PORT, MOCK_URL, UPLOAD_ROOT, APP_ENV, assertLocalOnly, prepareUploads, PDF_BYTES, PNG_BYTES };

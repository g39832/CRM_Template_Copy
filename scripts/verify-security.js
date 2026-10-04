#!/usr/bin/env node
// scripts/verify-security.js — run after every deploy (and on every new
// customer instance). READ-ONLY: it never writes, and it never prints keys,
// passwords or row contents — only pass/fail lines and counts.
//
//   node scripts/verify-security.js                       # uses .env
//   APP_URL=https://your-app.onrender.com node scripts/verify-security.js
//   node scripts/verify-security.js --public-only --app-url https://...  # no secrets needed
//   ... --object '12/1700000000000-file.pdf'   # also HEAD that file's public URL (no secrets needed)
//
// Environment it can use (each check is skipped when its input is missing):
//   SUPABASE_URL, SUPABASE_ANON_KEY       public key checks (or read from the app's login page)
//   SUPABASE_SERVICE_ROLE_KEY             bucket privacy + a real file's public URL
//   SUPABASE_DATABASE_URL / DATABASE_URL  RLS catalog check (every public table)
//   SUPABASE_STORAGE_BUCKET               private bucket name (default crm-files)
//   APP_URL                               /health, API login guard, browser-visible secrets
//
// Checks:
//   1. Every table in the public schema has Row Level Security on, and no
//      policy hands rows to the anon / authenticated roles.
//   2. The public key reads 0 rows from every table and cannot list files.
//   3. The private bucket is not public, and a real file's public URL is refused.
//   4. /health returns only {"status":"ok"}; the API refuses requests without
//      a session; the login page carries no secret key.
// Exit code 1 if anything fails.

try { require('dotenv').config(); } catch (_) { /* optional */ }

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : '';
}
const publicOnly = args.includes('--public-only');
const APP_URL = (argValue('--app-url') || process.env.APP_URL || '').replace(/\/+$/, '');
let SUPABASE_URL = publicOnly ? '' : (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
let ANON_KEY = publicOnly ? '' : (process.env.SUPABASE_ANON_KEY || '');
const SERVICE_KEY = publicOnly ? '' : (process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const DB_URL = publicOnly ? '' : String(process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || '').trim();
const KNOWN_OBJECT = argValue('--object');
const BUCKET = argValue('--bucket') || process.env.SUPABASE_STORAGE_BUCKET || 'crm-files';

// Tables checked with the public key when the catalog can't be read.
const KNOWN_TABLES = [
  'settings', 'clients', 'payments', 'notes', 'finance_overrides', 'jobs', 'finance_margin_entries',
  'companies', 'users', 'company_components', 'activity_log', 'email_templates', 'services',
  'client_service', 'job_line_items', 'session', 'job_files', 'expense_categories', 'job_expenses',
  'customer_tags', 'client_customer_tags', 'company_stage_labels',
  // DeVries-only tables
  'app_users', 'notifications', 'notification_reads', 'finance_adjustments', 'tags', 'job_tags'
];

let failures = 0;
let warnings = 0;
function pass(msg) { console.log('  PASS  ' + msg); }
function fail(msg) { failures++; console.log('  FAIL  ' + msg); }
function warn(msg) { warnings++; console.log('  WARN  ' + msg); }
function skip(msg) { console.log('  SKIP  ' + msg); }

async function readPublicConfigFromApp() {
  if (!APP_URL || (SUPABASE_URL && ANON_KEY)) return;
  try {
    const html = await (await fetch(APP_URL + '/')).text();
    const m = html.match(/window\.__AUTH_CONFIG__ = (\{.*?\});/);
    if (!m) return;
    const cfg = JSON.parse(m[1]);
    SUPABASE_URL = SUPABASE_URL || String(cfg.supabaseUrl || '').trim().replace(/\/+$/, '');
    ANON_KEY = ANON_KEY || String(cfg.supabaseAnonKey || '').trim();
  } catch (_) { /* reported by the checks below */ }
}

async function catalogCheck() {
  console.log('\n1. Row Level Security (database catalog)');
  if (!DB_URL) return skip('no SUPABASE_DATABASE_URL / DATABASE_URL — catalog not checked');
  let Client;
  try { ({ Client } = require('pg')); } catch (_) { return skip('pg module not installed'); }
  const opts = { connectionString: DB_URL };
  if (!/sslmode=/i.test(DB_URL) && !/localhost|127\.0\.0\.1/.test(DB_URL)) opts.ssl = { rejectUnauthorized: false };
  const client = new Client(opts);
  try {
    await client.connect();
    const tables = (await client.query(
      "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    )).rows;
    const off = tables.filter((t) => !t.rowsecurity).map((t) => t.tablename);
    if (off.length) fail(`RLS is OFF on: ${off.join(', ')}`);
    else pass(`RLS is on for all ${tables.length} public tables`);

    const policies = (await client.query(
      "SELECT tablename, policyname, roles::text AS roles, cmd FROM pg_policies WHERE schemaname = 'public'"
    )).rows.filter((p) => /anon|authenticated|public/i.test(p.roles));
    if (policies.length) {
      policies.forEach((p) => fail(`policy "${p.policyname}" on ${p.tablename} gives ${p.roles} ${p.cmd} access`));
    } else {
      pass('no policies grant the public key (anon/authenticated) access to public tables');
    }

    const bucket = (await client.query('SELECT public FROM storage.buckets WHERE id = $1', [BUCKET])).rows[0];
    if (!bucket) warn(`bucket "${BUCKET}" not found in storage.buckets`);
    else if (bucket.public) fail(`bucket "${BUCKET}" is PUBLIC in storage.buckets`);
    else pass(`bucket "${BUCKET}" is private (storage.buckets)`);
    return tables.map((t) => t.tablename);
  } catch (err) {
    fail('could not read the catalog: ' + err.message);
    return null;
  } finally {
    try { await client.end(); } catch (_) {}
  }
}

async function anonCheck(tables) {
  console.log('\n2. Public (browser) key');
  if (!SUPABASE_URL || !ANON_KEY) return skip('no SUPABASE_URL / public key (set them, or pass --app-url)');
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
  let readable = 0;
  for (const table of tables) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`, { headers });
    if (r.status === 404) continue; // table not in this deployment
    if (r.ok) {
      const rows = await r.json().catch(() => []);
      if (Array.isArray(rows) && rows.length) { readable++; fail(`public key can read rows from "${table}"`); }
    } else if (r.status !== 401 && r.status !== 403) {
      warn(`"${table}": unexpected HTTP ${r.status}`);
    }
  }
  if (!readable) pass(`public key reads 0 rows from every table checked (${tables.length})`);

  const list = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${encodeURIComponent(BUCKET)}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 5 })
  });
  const listed = list.ok ? await list.json().catch(() => []) : [];
  if (Array.isArray(listed) && listed.length) fail(`public key can list files in "${BUCKET}"`);
  else pass(`public key cannot list files in "${BUCKET}"`);
}

async function findAnyObject(storage) {
  // Walk a couple of folder levels to find one real file.
  const queue = [''];
  for (let depth = 0; depth < 4 && queue.length; depth++) {
    const prefix = queue.shift();
    const { data, error } = await storage.list(prefix, { limit: 20 });
    if (error || !Array.isArray(data)) return null;
    for (const item of data) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) return full; // files have an id, folders don't
      queue.push(full);
    }
  }
  return null;
}

async function headPublicUrl(objectPath) {
  const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
  const r = await fetch(url, { method: 'HEAD' });
  if (r.ok) fail(`a real file is downloadable WITHOUT signing in (HTTP ${r.status})`);
  else pass(`a real file's public URL is refused (HTTP ${r.status})`);
}

async function storageCheck() {
  console.log('\n3. Private file storage');
  if (!SUPABASE_URL) return skip('no SUPABASE_URL');
  if (KNOWN_OBJECT) await headPublicUrl(KNOWN_OBJECT);
  if (!SERVICE_KEY) {
    return skip('no SUPABASE_SERVICE_ROLE_KEY — bucket flag not checked (run with it, or check the dashboard)');
  }
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: info, error } = await supabase.storage.getBucket(BUCKET);
  if (error || !info) return warn(`bucket "${BUCKET}" not found (${error ? error.message : 'missing'})`);
  if (info.public) fail(`bucket "${BUCKET}" is PUBLIC`);
  else pass(`bucket "${BUCKET}" is private`);

  const objectPath = await findAnyObject(supabase.storage.from(BUCKET));
  if (!objectPath) return skip('no files in the bucket to test a public URL with');
  await headPublicUrl(objectPath);
}

async function appCheck() {
  console.log('\n4. Running app');
  if (!APP_URL) return skip('no APP_URL');
  const health = await fetch(APP_URL + '/health');
  const body = await health.json().catch(() => null);
  const keys = body && typeof body === 'object' ? Object.keys(body) : [];
  if (health.ok && keys.length === 1 && body.status === 'ok') pass('/health returns only {"status":"ok"}');
  else fail(`/health returns more than a status (keys: ${keys.join(', ') || 'none'})`);

  for (const path of ['/api/clients', '/api/v2/admin/users', '/api/email-settings', '/api/job-files/1']) {
    const r = await fetch(APP_URL + path, { redirect: 'manual' });
    if (r.status === 401) pass(`${path} without a session -> 401`);
    else fail(`${path} without a session -> HTTP ${r.status} (expected 401)`);
  }
  const page = await fetch(APP_URL + '/main', { redirect: 'manual' });
  if (page.status >= 300 && page.status < 400) pass('/main without a session redirects to sign-in');
  else fail(`/main without a session -> HTTP ${page.status}`);

  const html = await (await fetch(APP_URL + '/')).text();
  const leaked = /sb_secret_|service_role/i.test(html) || (SERVICE_KEY && html.includes(SERVICE_KEY));
  if (leaked) fail('the login page contains a secret / service-role key');
  else pass('the login page carries no secret key');

  const head = await fetch(APP_URL + '/', { method: 'HEAD' });
  ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy'].forEach((h) => {
    if (head.headers.get(h)) pass(`header ${h} present`);
    else warn(`header ${h} missing`);
  });
}

(async () => {
  console.log('Security verification (read-only)');
  await readPublicConfigFromApp();
  const catalogTables = await catalogCheck();
  await anonCheck(catalogTables && catalogTables.length ? catalogTables : KNOWN_TABLES);
  await storageCheck();
  await appCheck();
  console.log(`\n${failures ? 'FAILED' : 'OK'}: ${failures} failure(s), ${warnings} warning(s)`);
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('verify-security crashed: ' + err.message);
  process.exit(1);
});

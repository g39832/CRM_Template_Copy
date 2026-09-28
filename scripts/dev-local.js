// One-command local preview:  npm run dev:local
//
// Starts the in-memory fake database (tests/mock-supabase) with sample data,
// starts the app wired to it, and prints links that sign you straight in.
// Nothing reads or writes the real Supabase project in .env. Changes last
// until you stop it (Ctrl+C); the next run starts from the same sample data.
const path = require('path');
const { spawn } = require('child_process');
const { MOCK_PORT, APP_PORT, MOCK_URL, APP_ENV, UPLOAD_ROOT, assertLocalOnly, prepareUploads } = require('../tests/local-env');

const ROOT = path.join(__dirname, '..');
const children = [];

function start(args, env) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  child.stderr.on('data', (d) => process.stderr.write(d));
  children.push(child);
  return child;
}

async function waitFor(url, label) {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} did not start on ${url} — is something else already using that port?`);
}

function stopAll() {
  for (const child of children) child.kill();
}

process.on('SIGINT', () => { stopAll(); process.exit(0); });
process.on('SIGTERM', () => { stopAll(); process.exit(0); });

(async () => {
  const env = { ...APP_ENV, LOCAL_PREVIEW: '1' };
  assertLocalOnly(env);

  console.log('Starting fake database...');
  // Preview the database as it will be after the optional migrations
  // (technician column, payment history, expense categories).
  const mock = start(['tests/mock-supabase/server.js', String(MOCK_PORT)], { MOCK_MIGRATED: '1' });
  await waitFor(`${MOCK_URL}/__dump`, 'Fake database');
  prepareUploads(UPLOAD_ROOT);

  console.log('Starting the CRM...');
  const app = start(['server.js'], env);
  await waitFor(`http://127.0.0.1:${APP_PORT}/login.html`, 'CRM');

  const base = `http://localhost:${APP_PORT}`;
  const link = (email, role) => `${base}/api/v2/auth/preview-login?email=${encodeURIComponent(email)}&role=${role}`;
  console.log(`
  CRM preview is running with sample data (your real database is not touched).

    Open as admin:         ${link('owner@example.com', 'admin')}
    Open as regular user:  ${link('sam@example.com', 'user')}

  Sample clients: Alice Legacy (money on the client only), Bob Both (client money + jobs),
  Carla Jobs (monthly maintenance), Dan Lead (new lead), Eve Closed (last year).

  Press Ctrl+C to stop. The next run starts from the same sample data again.
`);

  for (const child of [mock, app]) {
    child.on('exit', (code) => {
      if (code !== null && code !== 0) console.error(`A preview process stopped unexpectedly (exit ${code}).`);
      stopAll();
      process.exit(code || 0);
    });
  }
})().catch((err) => {
  console.error(err.message);
  stopAll();
  process.exit(1);
});

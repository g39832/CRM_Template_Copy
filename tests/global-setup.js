// Logs in once for the whole run and saves the session cookie, so the
// authenticated tests reuse it instead of hitting the login rate limiter
// (it allows only a handful of attempts per 15 minutes).
const fs = require('fs');
const path = require('path');
const { request } = require('@playwright/test');

const STATE_FILE = path.join(__dirname, '..', 'test-results', '.auth', 'admin.json');

module.exports = async function globalSetup(config) {
  const { baseURL } = config.projects[0].use;
  const ctx = await request.newContext({ baseURL });
  try {
    const res = await ctx.post('/api/v2/auth/test-login', {
      data: { email: 'smoke-admin@example.com', role: 'admin', displayName: 'Smoke Admin' },
    });
    if (res.status() === 404) {
      throw new Error('test-login returned 404: the server on this port is not running with NODE_ENV=test. '
        + 'Stop any dev server using it, or set RESPONSIVE_TEST_PORT to a free port.');
    }
    if (res.status() === 429) {
      throw new Error('test-login was rate-limited (429). The limiter is in-memory; restart the server or wait 15 minutes.');
    }
    if (res.status() === 503) {
      throw new Error('test-login returned 503: Supabase is not configured. Check SUPABASE_* in .env.');
    }
    if (!res.ok()) throw new Error(`test-login failed: ${res.status()} ${await res.text()}`);
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    await ctx.storageState({ path: STATE_FILE });
  } finally {
    await ctx.dispose();
  }
};

module.exports.STATE_FILE = STATE_FILE;

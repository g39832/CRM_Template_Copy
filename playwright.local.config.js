// Playwright config for running the whole browser suite against the local
// in-memory Supabase stand-in (tests/mock-supabase) — no real data is read
// or written. Run: npm run test:local
//
// Starts two servers: the mock database and the app wired to it
// (see tests/local-env.js for every overridden variable).
const { defineConfig } = require('@playwright/test');
const base = require('./playwright.config');
const { APP_PORT, MOCK_PORT, APP_ENV, assertLocalOnly } = require('./tests/local-env');

assertLocalOnly();
// Lets tests that write data confirm they are running against the mock.
process.env.CRM_LOCAL_MOCK = '1';

module.exports = defineConfig({
  ...base,
  testIgnore: [],
  globalSetup: require.resolve('./tests/local-global-setup.js'),
  use: { ...base.use, baseURL: `http://127.0.0.1:${APP_PORT}` },
  webServer: [
    {
      command: `node tests/mock-supabase/server.js ${MOCK_PORT}`,
      url: `http://127.0.0.1:${MOCK_PORT}/__dump`,
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: 'node server.js',
      url: `http://127.0.0.1:${APP_PORT}/login.html`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: APP_ENV
    }
  ]
});

// Playwright config for the responsive / cross-device test suite.
// Run: npm run test:responsive   (see tests/README.md)
//
// The server is started in NODE_ENV=test so the test-only
// /api/v2/auth/test-login route is available (it 404s everywhere else).
// It uses the Supabase project configured in .env, same as test:smoke.
const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.RESPONSIVE_TEST_PORT || 3111);

// One project per device class. Phones and tablets get touch emulation, so
// (pointer: coarse) rules apply just as they do on real hardware.
const touch = { hasTouch: true, isMobile: true };
const DEVICES = [
  { name: 'phone-small-320', use: { viewport: { width: 320, height: 568 }, ...touch } },
  { name: 'phone-390', use: { viewport: { width: 390, height: 844 }, ...touch } },
  { name: 'phone-412', use: { viewport: { width: 412, height: 915 }, ...touch } },
  { name: 'phone-landscape-844', use: { viewport: { width: 844, height: 390 }, ...touch } },
  { name: 'tablet-768', use: { viewport: { width: 768, height: 1024 }, ...touch } },
  { name: 'tablet-landscape-1024', use: { viewport: { width: 1024, height: 768 }, hasTouch: true } },
  { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
];

module.exports = defineConfig({
  testDir: './tests',
  globalSetup: require.resolve('./tests/global-setup.js'),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // The suite logs in against a shared Supabase project; keep it serial so
  // it stays gentle on the API and the in-memory session store.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: DEVICES,
  webServer: {
    command: 'node server.js',
    url: `http://127.0.0.1:${PORT}/login.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { NODE_ENV: 'test', PORT: String(PORT), ENABLE_DB_BACKUPS: 'false' },
  },
});

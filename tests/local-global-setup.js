// Global setup for playwright.local.config.js: resets the mock database to
// its seed, lays down the seed files on disk, then logs in once as admin
// (reusing the regular global setup).
const { MOCK_URL, prepareUploads, assertLocalOnly } = require('./local-env');
const loginAsAdmin = require('./global-setup');

module.exports = async function localGlobalSetup(config) {
  assertLocalOnly();
  const res = await fetch(`${MOCK_URL}/__reset`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not reset the mock database');
  prepareUploads();
  // A user that exists in the seed, so database resets between tests do not
  // remove it (removed users are signed out by the session check).
  process.env.SMOKE_ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || 'owner@example.com';
  await loginAsAdmin(config);
};

// Tests for scripts/verify-security.js reporting + exit-status behavior,
// which the local (mock) test infrastructure can exercise without any real
// network or credentials.
//
// The script must never claim Row Level Security is verified when it is
// pointed at the local mock, and it must exit 0 (no false failures) for a
// mock-only run. These cases do not touch the network at all.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-security.js');

// Blank any real Supabase settings so a developer's .env cannot leak into the
// run (dotenv never overrides a variable that is already set, even to '').
const CLEAN_ENV = {
  ...process.env,
  APP_URL: '',
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  SUPABASE_DATABASE_URL: '',
  DATABASE_URL: '',
  SUPABASE_STORAGE_BUCKET: '',
  SUPABASE_PUBLIC_BUCKET: ''
};

function runVerify(extraEnv, args = ['--public-only']) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...CLEAN_ENV, ...extraEnv }
  });
  assert.equal(res.error, undefined, 'spawning verify-security must not fail: ' + (res.error && res.error.message));
  assert.ok(typeof res.stdout === 'string', 'the script produced stdout');
  return res;
}

test('verify-security reports mock-only Supabase checks as SKIPPED (never passed) and exits 0', () => {
  const res = runVerify({ CRM_MOCK_BACKEND: '1' });
  assert.equal(res.status, 0, 'a mock-only run has no security failures');
  assert.match(res.stdout, /mock backend/i, 'the mock reason is stated explicitly');
  assert.match(res.stdout, /SKIP/, 'checks are reported as skipped');
  assert.doesNotMatch(res.stdout, /FAIL/, 'nothing is misreported as a failure');
});

test('verify-security treats a loopback Supabase URL as the mock backend', () => {
  // Not --public-only, so the URL survives; it is a loopback address.
  const res = runVerify({ SUPABASE_URL: 'http://127.0.0.1:54329', SUPABASE_ANON_KEY: 'x' }, []);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /mock backend/i, 'loopback Supabase URL is detected as the mock');
  assert.match(res.stdout, /SKIP/);
  assert.doesNotMatch(res.stdout, /FAIL/);
});

test('verify-security skips cleanly (exit 0) when no targets are configured', () => {
  const res = runVerify({});
  assert.equal(res.status, 0);
  assert.match(res.stdout, /SKIP/);
  assert.doesNotMatch(res.stdout, /FAIL/);
});

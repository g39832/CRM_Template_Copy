/**
 * diagnose-connection.js — isolates "TypeError: fetch failed" errors.
 *
 * That error means Node couldn't complete an HTTPS request to Supabase
 * at all (before Supabase ever got to respond) — it's a network-layer
 * problem, not something wrong with the CRM code or your database
 * schema. This script checks each layer separately and tells you
 * exactly which one is failing.
 *
 * USAGE:
 *   node scripts/diagnose-connection.js
 */
require('dotenv').config();

const dns = require('dns').promises;

const rawUrl = (process.env.SUPABASE_URL || '').trim();
const anonKey = process.env.SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function fail(msg) {
  console.log('  [FAIL] ' + msg);
}
function pass(msg) {
  console.log('  [ OK ] ' + msg);
}
function info(msg) {
  console.log('         ' + msg);
}

async function main() {
  console.log('');
  console.log('  Supabase connectivity diagnosis');
  console.log('  ================================');
  console.log('');

  // 1. .env sanity
  if (!rawUrl) {
    fail('SUPABASE_URL is empty in .env — nothing else can work until this is set.');
    process.exit(1);
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(rawUrl)) {
    fail('SUPABASE_URL does not look like a normal Supabase URL: "' + rawUrl + '"');
    info('Expected shape: https://xxxxxxxxxxxx.supabase.co  (from your Supabase project Settings > API)');
  } else {
    pass('SUPABASE_URL is set and looks well-formed: ' + rawUrl);
  }
  if (!anonKey) fail('SUPABASE_ANON_KEY is empty in .env.'); else pass('SUPABASE_ANON_KEY is set.');
  if (!serviceKey) fail('SUPABASE_SERVICE_ROLE_KEY is empty in .env.'); else pass('SUPABASE_SERVICE_ROLE_KEY is set.');
  console.log('');

  const host = rawUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');

  // 2. DNS resolution
  console.log('  Checking DNS resolution for ' + host + ' ...');
  try {
    const addresses = await dns.lookup(host, { all: true });
    pass('DNS resolved to: ' + addresses.map((a) => a.address + ' (IPv' + a.family + ')').join(', '));
  } catch (err) {
    fail('DNS lookup failed: ' + err.code + ' — ' + err.message);
    info('This usually means: no internet access right now, a DNS server that can\'t');
    info('resolve *.supabase.co (corporate/ISP DNS filtering), or your Supabase project');
    info('was deleted (its subdomain stops resolving once a project is gone).');
    console.log('');
    printGeneralAdvice();
    process.exit(1);
  }
  console.log('');

  // 3. Raw HTTPS reachability (no auth required, just checks the socket)
  console.log('  Checking HTTPS reachability ...');
  try {
    const res = await fetch('https://' + host + '/auth/v1/health', { method: 'GET' });
    pass('Reached Supabase over HTTPS (status ' + res.status + ').');
  } catch (err) {
    fail('HTTPS request failed: ' + (err.cause ? (err.cause.code || err.cause.message) : err.message));
    info('DNS resolved fine, but the actual HTTPS connection didn\'t go through.');
    info('Common causes on Windows: a VPN/corporate firewall blocking outbound HTTPS,');
    info('antivirus SSL-inspection breaking the connection, or a flaky network adapter.');
    console.log('');
    printGeneralAdvice();
    process.exit(1);
  }
  console.log('');

  // 4. Authenticated request (confirms the project itself is alive, not paused/deleted)
  console.log('  Checking the Supabase project is active (not paused) ...');
  try {
    const res = await fetch('https://' + host + '/rest/v1/?select=1', {
      headers: { apikey: anonKey, Authorization: 'Bearer ' + anonKey }
    });
    if (res.status === 0) throw new Error('no response');
    pass('Project responded (status ' + res.status + '). If this is 401/404 that\'s normal here — it means the project is UP.');
  } catch (err) {
    fail('Could not get a response from the project API: ' + (err.cause ? (err.cause.code || err.cause.message) : err.message));
    info('Free-tier Supabase projects auto-pause after a week of inactivity. Log into');
    info('supabase.com/dashboard and check if this project shows "Paused" — if so, just');
    info('click "Restore/Resume" and try again.');
    process.exit(1);
  }

  console.log('');
  console.log('  All checks passed — this machine can reach Supabase fine.');
  console.log('  If password-login still fails, run `npm run migrate:v3` next');
  console.log('  (the users/companies tables may not exist yet).');
  console.log('');
}

function printGeneralAdvice() {
  console.log('  Things to try:');
  console.log('    1. Check supabase.com/dashboard — is this project "Paused"? Resume it.');
  console.log('    2. Try from a different network (e.g. phone hotspot) to rule out a');
  console.log('       firewall/VPN blocking *.supabase.co on this network.');
  console.log('    3. Temporarily disable antivirus/VPN and retry.');
  console.log('    4. Double-check SUPABASE_URL in .env has no typo and no trailing slash issues.');
  console.log('');
}

main().catch((err) => {
  console.error('Diagnostic script crashed:', err);
  process.exit(1);
});

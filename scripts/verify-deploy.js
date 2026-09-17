#!/usr/bin/env node
/**
 * verify-deploy.js — checks a deployed instance one layer at a time.
 *
 * WHY THIS EXISTS
 *   "ERR_SSL_PROTOCOL_ERROR", a browser "DANGEROUS SITE" interstitial and a
 *   phantom JavaScript error all look similar from inside the browser but have
 *   completely different causes. This script walks the stack in order —
 *   DNS -> TCP/TLS -> HTTP -> app routes -> Safe Browsing reputation — and
 *   prints exactly which layer is broken, so you can tell whether the problem
 *   lives in Render, in this app, or in the browser you are testing with.
 *
 * USAGE:
 *   node scripts/verify-deploy.js
 *   node scripts/verify-deploy.js https://your-service.onrender.com
 *   npm run verify:deploy
 *
 * EXIT CODES:
 *   0 = every layer is healthy
 *   1 = a hard failure (DNS, TLS, or HTTP/app) — takes precedence over 2
 *   2 = the server is healthy but browsers are blocking it (Safe Browsing flag)
 *   3 = reachable, but no Safe Browsing verdict came back (re-run; NOT a pass)
 */
const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_TARGET = 'https://crm-template-copy-2.onrender.com';
const target = (process.argv[2] || process.env.DEPLOY_URL || DEFAULT_TARGET).trim();

// The public endpoint behind transparencyreport.google.com's Safe Browsing
// lookup. It responds with an anti-JSON-hijacking prefix that must be stripped.
const SAFE_BROWSING_ENDPOINT =
  'https://transparencyreport.google.com/transparencyreport/api/v3/safebrowsing/status?site=';

// Codes returned by that endpoint (field [0][1] of the payload):
//   1 = no data / not rated
//   2 = unsafe content found for this URL   (FLAGGED)
//   3 = site-wide unsafe content            (FLAGGED)
//   4 = no unsafe content found             (clean)
//   6 = no rating on record for this host   (not flagged)
// Verified by calibration on 2026-09-17: github.com -> 4, onrender.com -> 4,
// unrated / sibling onrender.com hostnames -> 6, and a flagged onrender.com
// subdomain -> 2 on every path. Reverse-engineered, so advisory only.
const SAFE_BROWSING_CODES = {
  1: 'no rating available',
  2: 'unsafe content found for this URL',
  3: 'site-wide unsafe content',
  4: 'no unsafe content found',
  6: 'no rating on record for this hostname'
};

function fail(msg) {
  console.log('  [FAIL] ' + msg);
}
function pass(msg) {
  console.log('  [ OK ] ' + msg);
}
function warn(msg) {
  console.log('  [WARN] ' + msg);
}
function info(msg) {
  console.log('         ' + msg);
}
function head(msg) {
  console.log('');
  console.log('  ' + msg);
}

// One-shot GET that also surfaces the TLS details of the connection it made.
function rawRequest(requestUrl, options) {
  const opts = options || {};
  const timeoutMs = opts.timeoutMs || 20000;
  const maxBytes = opts.maxBytes || 250000;

  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(requestUrl);
    } catch (err) {
      return reject(new Error('Not a valid URL: ' + requestUrl));
    }

    const mod = parsed.protocol === 'http:' ? http : https;
    const req = mod.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'crm-template-verify-deploy',
          Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: timeoutMs
      },
      (res) => {
        const tls = {};
        const socket = res.socket || req.socket;
        if (socket && typeof socket.getPeerCertificate === 'function') {
          const cert = socket.getPeerCertificate() || {};
          tls.authorized = socket.authorized;
          tls.authorizationError = socket.authorizationError;
          tls.protocol = typeof socket.getProtocol === 'function' ? socket.getProtocol() : null;
          tls.subject = cert.subject && cert.subject.CN;
          tls.issuer = cert.issuer && (cert.issuer.O || cert.issuer.CN);
          tls.validTo = cert.valid_to;
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length < maxBytes) body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: body, tls: tls }));
      }
    );

    req.on('timeout', () => req.destroy(new Error('Request timed out after ' + timeoutMs + 'ms')));
    req.on('error', (err) => reject(err));
    req.end();
  });
}

function isTlsProblem(err) {
  const code = err.code || '';
  return (
    code === 'EPROTO' ||
    code === 'ECONNRESET' ||
    code === 'ERR_SSL_WRONG_VERSION_NUMBER' ||
    /ssl|tls|certificate|handshake/i.test(err.message || '')
  );
}

function explainNetworkError(err) {
  const code = err.code || '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    info('DNS could not resolve the hostname. The service may have been renamed or');
    info('deleted on Render, or this network\'s DNS is filtering it.');
    return;
  }
  if (code === 'ECONNREFUSED') {
    info('Nothing is listening on that host/port. If you added a :PORT to the URL,');
    info('remove it — Render only publishes ports 80 and 443 to the public internet.');
    return;
  }
  if (isTlsProblem(err)) {
    info('The TCP connection was made but the TLS handshake did not complete.');
    info('Render terminates HTTPS for you, so this is almost never the app\'s fault:');
    info('  - a URL with an explicit :PORT (https://host:3000) makes the browser');
    info('    speak TLS to a port that does not speak TLS at all;');
    info('  - antivirus / VPN / corporate proxy TLS inspection does exactly this;');
    info('  - compare with: curl -v https://<host>/login.html');
    info('    If curl succeeds while the browser fails, it is the browser or its');
    info('    network stack, not the deployment.');
    return;
  }
  info('Unexpected network error. Full message: ' + err.message);
}

async function checkDns(host) {
  head('1. DNS resolution for ' + host);
  try {
    const addresses = await dns.lookup(host, { all: true });
    pass('Resolved to ' + addresses.map((a) => a.address + ' (IPv' + a.family + ')').join(', '));
  } catch (err) {
    fail('DNS lookup failed: ' + (err.code || err.message));
    explainNetworkError(err);
    return false;
  }

  try {
    const cnames = await dns.resolveCname(host);
    if (cnames && cnames.length) pass('CNAME chain: ' + cnames.join(' -> '));
  } catch (err) {
    // Most hosts have no CNAME record; not a problem.
  }
  return true;
}

async function checkTlsAndRoot(baseUrl) {
  head('2. TLS handshake + homepage');
  let res;
  try {
    res = await rawRequest(baseUrl + '/');
  } catch (err) {
    fail('Could not complete an HTTPS request: ' + (err.code || err.message));
    explainNetworkError(err);
    return false;
  }

  if (res.tls.protocol) pass('TLS negotiated: ' + res.tls.protocol);
  if (res.tls.authorized === true) {
    pass('Certificate trusted' + (res.tls.subject ? ' (subject CN=' + res.tls.subject + ')' : ''));
    if (res.tls.issuer) info('Issued by: ' + res.tls.issuer + (res.tls.validTo ? ', valid to ' + res.tls.validTo : ''));
  } else if (res.tls.authorized === false) {
    warn('Certificate not trusted: ' + (res.tls.authorizationError || 'unknown reason'));
  }

  const server = res.headers.server || '(unknown)';
  const origin = res.headers['x-render-origin-server'] || '';
  pass('Homepage responded HTTP ' + res.status + ' (server: ' + server + (origin ? ', origin: ' + origin : '') + ')');
  info('Note: "cloudflare" here is expected — Render fronts onrender.com with Cloudflare\'s CDN.');
  return true;
}

async function checkLoginPage(baseUrl) {
  head('3. Login page + injected auth config');
  let res;
  try {
    res = await rawRequest(baseUrl + '/login.html');
  } catch (err) {
    fail('Could not reach /login.html: ' + (err.code || err.message));
    explainNetworkError(err);
    return false;
  }

  if (res.status !== 200) {
    fail('/login.html responded HTTP ' + res.status + ' (expected 200)');
    return false;
  }
  pass('/login.html responded HTTP 200');

  // Anchored on the closing </script> of the injected snippet so a future nested
  // config object can't silently truncate the match.
  const configMatch = res.body.match(/window\.__AUTH_CONFIG__\s*=\s*(\{.*?\})\s*;?\s*<\/script>/);
  if (!configMatch) {
    if (res.body.includes('__AUTH_CONFIG__')) {
      warn('The __AUTH_CONFIG__ marker is present but its snippet could not be parsed.');
      info('The injection format changed — check authConfigScript() in server.js.');
      return false;
    }
    warn('window.__AUTH_CONFIG__ is missing on /login.html.');
    info('That means the /login.html route change is not deployed yet (or an old');
    info('build is being served). Without it the page shows "Google sign-in isn\'t');
    info('configured yet" and disables the button.');
    return false;
  }

  // The script is injected even when the Supabase env vars are missing (it just
  // writes empty strings), so the VALUES have to be checked, not just the name.
  let config;
  try {
    config = JSON.parse(configMatch[1]);
  } catch (err) {
    warn('window.__AUTH_CONFIG__ is injected but is not valid JSON.');
    info('The page cannot start sign-in. Check authConfigScript() in server.js.');
    return false;
  }

  if (typeof config !== 'object' || config === null) {
    warn('window.__AUTH_CONFIG__ did not parse into a config object.');
    return false;
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    warn('window.__AUTH_CONFIG__ is injected but its values are empty:');
    info('supabaseUrl:     ' + (config.supabaseUrl || '(missing)'));
    info('supabaseAnonKey: ' + (config.supabaseAnonKey ? 'set' : '(missing)'));
    info('Set SUPABASE_URL and SUPABASE_ANON_KEY on the Render service (Environment');
    info('tab), then redeploy. Until then sign-in fails with the "isn\'t configured"');
    info('message and the button stays disabled.');
    return false;
  }

  pass(
    'Injected Supabase config looks complete (url ' +
      config.supabaseUrl +
      ', anon key ' +
      config.supabaseAnonKey.length +
      ' chars).'
  );

  const cacheControl = res.headers['cache-control'] || '(none)';
  if (/no-cache|no-store/i.test(cacheControl)) pass('Cache-Control: ' + cacheControl);
  else warn('Cache-Control is "' + cacheControl + '" — a stale login page could be served.');
  return true;
}

async function checkHttpRedirect(host) {
  head('4. Plain http:// -> https:// redirect (handled by Render, not the app)');
  try {
    const res = await rawRequest('http://' + host + '/');
    const location = res.headers.location || '';
    if ([301, 302, 307, 308].includes(res.status) && /^https:/i.test(location)) {
      pass('HTTP ' + res.status + ' -> ' + location);
    } else if (res.status === 200) {
      pass('Responded HTTP 200 on port 80. Render normally redirects to HTTPS; not fatal.');
    } else {
      warn('HTTP ' + res.status + (location ? ' -> ' + location : '') + ' (no HTTPS redirect seen)');
    }
  } catch (err) {
    warn('Could not check http:// (port 80): ' + (err.code || err.message));
  }
}

async function safeBrowsingStatus(site) {
  const res = await rawRequest(SAFE_BROWSING_ENDPOINT + encodeURIComponent(site));
  const text = (res.body || '').trim();

  // The endpoint is rate limited and sometimes answers with an HTML page.
  if (!/^\)\]\}'/.test(text)) {
    return { unknown: true, reason: 'unexpected response (rate limited?)' };
  }

  let payload;
  try {
    payload = JSON.parse(text.replace(/^\)\]\}'\s*/, ''));
  } catch (err) {
    return { unknown: true, reason: 'unparseable response' };
  }

  const row = Array.isArray(payload) && Array.isArray(payload[0]) ? payload[0] : null;
  if (!row) return { unknown: true, reason: 'empty payload' };

  const code = row[1];
  return {
    unknown: false,
    code: code,
    description: SAFE_BROWSING_CODES[code] || 'unrecognized code ' + code,
    flagged: code === 2 || code === 3
  };
}

async function checkReputation(host) {
  head('5. Google Safe Browsing reputation');
  let flagged = false;
  let answered = 0;

  const sites = [host, host + '/login.html'];
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    // The lookup endpoint throttles bursts, so space requests out even when the
    // previous one failed to answer.
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 2000));

    let status;
    try {
      status = await safeBrowsingStatus(site);
    } catch (err) {
      warn(site + ': lookup failed (' + (err.code || err.message) + ')');
      continue;
    }

    if (status.unknown) {
      warn(site + ': no verdict — ' + status.reason);
      continue;
    }

    answered += 1;
    if (status.flagged) {
      flagged = true;
      fail(site + ': FLAGGED as unsafe (code ' + status.code + ' — ' + status.description + ')');
    } else {
      pass(site + ': not flagged (code ' + status.code + ' — ' + status.description + ')');
    }
  }

  if (answered > 0 && answered < sites.length) {
    warn(
      'Only ' + answered + ' of ' + sites.length + ' lookups returned a verdict — treat this as inconclusive.'
    );
  }

  if (answered === 0) {
    warn('No Safe Browsing verdict could be retrieved (the lookup endpoint is rate limited).');
    info('Check manually: https://transparencyreport.google.com/safe-browsing/search?url=' + host);
    return 'inconclusive';
  }

  if (flagged) {
    console.log('');
    console.log('  This is a browser-side block, NOT a server problem.');
    console.log('  ------------------------------------------------------------------');
    console.log('  Browsers consult this list BEFORE they ever connect to Render, so');
    console.log('  restarting or redeploying the service cannot change the verdict.');
    console.log('  The block follows the HOSTNAME, so every page on it is affected.');
    console.log('');
    console.log('  What actually fixes it:');
    console.log('    1. File a false-positive review:');
    console.log('       https://safebrowsing.google.com/safebrowsing/report_error/');
    console.log('       (review times vary — typically hours to a few days)');
    console.log('    2. Or move to a hostname with a clean reputation right now:');
    console.log('       - attach a custom domain — Render provisions TLS automatically and');
    console.log('         a new domain is a guaranteed clean hostname; or');
    console.log('       - rename the service, then check the URL in the dashboard (a rename');
    console.log('         usually changes the onrender.com hostname, but verify it).');
    console.log('    3. Meanwhile you can click "this unsafe site" on the interstitial');
    console.log('       to reach your own deployment.');
    return 'flagged';
  }

  return 'clean';
}

async function main() {
  console.log('');
  console.log('  Deployed instance verification');
  console.log('  ==============================');
  console.log('  Target: ' + target);

  let parsed;
  try {
    parsed = new URL(target);
  } catch (err) {
    console.log('');
    fail('That is not a valid URL: ' + target);
    process.exit(1);
  }

  const host = parsed.host;
  if (parsed.port) {
    warn('The URL includes an explicit port (:' + parsed.port + ').');
    info('Render only publishes 80 and 443 publicly. Remove the port from the URL');
    info('you open in the browser, or the TLS handshake will fail.');
  }
  if (parsed.protocol === 'http:') {
    warn('Target uses http:// — use the https:// URL to check what browsers see.');
  }

  const baseUrl = parsed.protocol + '//' + host;

  const dnsOk = await checkDns(parsed.hostname);
  if (!dnsOk) {
    console.log('');
    console.log('  Stopped: DNS is the first layer, nothing else can be tested until it resolves.');
    process.exit(1);
  }

  const tlsOk = await checkTlsAndRoot(baseUrl);
  if (!tlsOk) {
    console.log('');
    console.log('  Stopped: the server could not complete an HTTPS request.');
    process.exit(1);
  }

  const loginOk = await checkLoginPage(baseUrl);
  await checkHttpRedirect(host);
  const reputation = await checkReputation(host);
  const flagged = reputation === 'flagged';

  console.log('');
  console.log('  Summary');
  console.log('  -------');
  console.log('    DNS .......... ' + (dnsOk ? 'ok' : 'FAILED'));
  console.log('    TLS/HTTPS .... ok');
  console.log('    /login.html .. ' + (loginOk ? 'ok' : 'FAILED (see auth config check above)'));
  console.log(
    '    reputation ... ' +
      (reputation === 'flagged'
        ? 'BLOCKED by Safe Browsing'
        : reputation === 'inconclusive'
          ? 'inconclusive (lookups throttled — re-run to confirm)'
          : 'no flag found')
  );

  if (!loginOk) {
    console.log('');
    console.log('  At least one hard check failed — fix that before the reputation check.');
    process.exit(1);
  }

  if (flagged) {
    console.log('');
    console.log('  The deployment itself is healthy — the browser is refusing to load it.');
    console.log('  See the Safe Browsing steps above.');
    process.exit(2);
  }

  // The lookup endpoint throttles bursts, so no verdict is NOT good news —
  // reporting success here would be a false "clean" result.
  if (reputation === 'inconclusive') {
    console.log('');
    console.log('  No Safe Browsing verdict came back, so this is NOT a clean bill of health.');
    console.log('  Re-run in a minute, or check manually:');
    console.log('    https://transparencyreport.google.com/safe-browsing/search?url=' + host);
    process.exit(3);
  }

  console.log('');
  console.log('  All checks passed — the deployment is reachable over HTTPS and not flagged.');
  console.log('');
}

main().catch((err) => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});

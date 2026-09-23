try {
  // Prefer dotenv when installed.
  require('dotenv').config();
} catch {
  // Fallback .env loader for local dev when dotenv is unavailable.
  const fsFallback = require('fs');
  const pathFallback = require('path');
  const envPath = pathFallback.join(__dirname, '.env');
  if (fsFallback.existsSync(envPath)) {
    const lines = fsFallback.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex === -1) continue;
      const key = trimmed.slice(0, equalsIndex).trim();
      const rawValue = trimmed.slice(equalsIndex + 1).trim();
      const unquoted = rawValue.replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) {
        process.env[key] = unquoted;
      }
    }
  }
}
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const session = require('express-session');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { AppError } = require('./api/request-utils');
const { startBackupScheduler } = require('./services/db-backup');

const app = express();
app.set('trust proxy', 1);
const disableAuth = process.env.DISABLE_AUTH === 'true';
const faviconSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="CRM Template">
  <rect width="64" height="64" rx="14" fill="#2563eb"/>
  <path d="M18 22h28v6H18zm0 10h20v6H18zm0 10h24v6H18z" fill="#ffffff"/>
</svg>`);

// ===== BODY PARSING =====
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ===== RATE LIMITING =====
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Try again in 15 minutes.' }
});
app.use('/api/v2/auth/google-session', loginLimiter);
app.use('/api/v2/auth/test-login', loginLimiter);

// ===== SESSION =====
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn(
    '[session] SESSION_SECRET is not set — a new random secret is generated on every boot, ' +
      'which invalidates every existing login on each restart. Set SESSION_SECRET in production.'
  );
}

// Sessions have to outlive a restart: Render redeploys replace the process, and
// idle instances spin down. express-session's default in-memory store loses
// every session each time that happens, which shows up as "I keep getting sent
// back to the login page". When SUPABASE_DATABASE_URL contains the Supabase
// Postgres *Session pooler* connection string (port 5432), sessions are stored
// in Postgres instead.
//
// SAFETY: the Postgres store is only activated after a successful connection
// probe, and any later store error permanently degrades to the in-memory store.
// A missing, wrong, or unreachable connection string therefore can never break
// logging in — it only means sessions are not persisted.
function buildPostgresSession() {
  const dbUrl = String(process.env.SUPABASE_DATABASE_URL || '').trim();
  if (!dbUrl) return null;

  try {
    const PgSessionStore = require('connect-pg-simple')(session);
    const PgPool = require('pg').Pool;
    const poolOptions = {
      connectionString: dbUrl,
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000
    };
    // Supabase requires TLS, but only force it when the URL does not say
    // otherwise (so a local `?sslmode=disable` string still connects).
    if (!/sslmode=/i.test(dbUrl)) {
      poolOptions.ssl = { rejectUnauthorized: false };
    }
    const pool = new PgPool(poolOptions);

    // connect-pg-simple only attaches this when it creates the pool itself.
    // Without a handler an idle-client error would be an unhandled 'error'
    // event and take the whole process down.
    pool.on('error', (err) => {
      console.error('[session] Postgres pool error: ' + err.message);
    });

    const store = new PgSessionStore({
      pool: pool,
      tableName: 'session',
      createTableIfMissing: true,
      pruneSessionInterval: 900, // seconds
      errorLog: (err) => {
        console.error('[session] Postgres store error: ' + (err && err.message ? err.message : err));
      }
    });

    return { store: store, pool: pool };
  } catch (err) {
    console.error('[session] Could not initialise the Postgres session store: ' + err.message);
    return null;
  }
}

function sessionDbHint() {
  return (
    'SUPABASE_DATABASE_URL must be the Supabase Postgres *Session pooler* connection string ' +
    '(port 5432) — the transaction pooler on port 6543 does not work for session storage.'
  );
}

function createSessionStore() {
  const memoryStore = new session.MemoryStore();
  const primary = buildPostgresSession();

  if (!primary) {
    console.warn(
      '[session] SUPABASE_DATABASE_URL is not set — sessions are kept in memory. Everyone is ' +
        'logged out on each restart or spin-down, and logins are not shared between instances.'
    );
    console.warn('[session] ' + sessionDbHint());
    return memoryStore;
  }

  const state = { mode: 'memory' };
  const store = new session.Store();

  function usingPostgres() {
    return state.mode === 'postgres';
  }

  function degrade(err) {
    if (state.mode === 'memory') return;
    state.mode = 'memory';
    console.error('[session] Postgres session store failed: ' + (err && err.message ? err.message : err));
    console.error('[session] Falling back to in-memory sessions; logins will not persist across restarts.');
    console.error('[session] ' + sessionDbHint());
  }

  store.get = function (sid, callback) {
    if (!usingPostgres()) return memoryStore.get(sid, callback);
    primary.store.get(sid, (err, sess) => {
      if (err) {
        degrade(err);
        return memoryStore.get(sid, callback);
      }
      return callback(null, sess);
    });
  };

  store.set = function (sid, sess, callback) {
    if (!usingPostgres()) return memoryStore.set(sid, sess, callback);
    primary.store.set(sid, sess, (err) => {
      if (err) {
        degrade(err);
        return memoryStore.set(sid, sess, callback);
      }
      return callback(null);
    });
  };

  store.touch = function (sid, sess, callback) {
    if (!usingPostgres()) return memoryStore.touch(sid, sess, callback);
    primary.store.touch(sid, sess, (err) => {
      if (err) {
        degrade(err);
        return memoryStore.touch(sid, sess, callback);
      }
      return callback(null);
    });
  };

  // Logout must never wait on the database: clear the in-memory copy and answer
  // immediately, then delete the persisted copy best-effort so a logged-out
  // session cannot come back to life if the store is re-promoted or another
  // instance is serving the same hostname.
  store.destroy = function (sid, callback) {
    memoryStore.destroy(sid, () => {
      if (callback) callback(null);
    });
    primary.store.destroy(sid, () => {});
  };

  // Promote to Postgres only once it has actually answered, so a bad
  // connection string cannot break logging in. Until then sessions live in
  // memory, so a session created during that brief window is not persisted;
  // the window closes long before real traffic arrives.
  primary.pool
    .query('select 1')
    .then(() => {
      state.mode = 'postgres';
      console.log('[session] Postgres session store active — logins survive restarts and spin-downs.');
    })
    .catch((err) => {
      console.error('[session] Could not reach the session database: ' + err.message);
      console.error('[session] Staying on in-memory sessions; logins will not persist across restarts.');
      console.error('[session] ' + sessionDbHint());
    });

  return store;
}

app.use(
  session({
    name: 'crm.template.sid',
    secret: sessionSecret,
    proxy: true,
    resave: false,
    saveUninitialized: false,
    store: createSessionStore(),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Allow local HTTP testing unless secure cookies are explicitly enabled.
      secure: process.env.SESSION_COOKIE_SECURE === 'true',
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);

function isAuthenticated(req) {
  if (disableAuth) return true;
  return Boolean(req.session && req.session.authenticated === true);
}

function requirePageAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  return res.redirect('/');
}

function requireApiAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  return res.status(401).json({ success: false, error: 'Unauthorized' });
}

// ===== API REQUEST TIMING =====
app.use('/api', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[API] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ===== API AUTH GUARD =====
app.use('/api', (req, res, next) => {
  // Allow unauthenticated access to the v2 auth endpoints themselves
  // (google-session, me, logout, test-login) — everything else under
  // /api requires an existing session.
  if (req.path.startsWith('/v2/auth/')) return next();
  return requireApiAuth(req, res, next);
});

const healthRoutes = require('./api/health');

// ===== HEALTH ROUTE =====
app.use('/health', healthRoutes);

// ===== API REQUEST VALIDATION BASELINE =====
app.use('/api', (req, res, next) => {
  const bodyMethods = new Set(['POST', 'PUT', 'PATCH']);
  const hasBodyMethod = bodyMethods.has(req.method);
  if (!hasBodyMethod) return next();

  if (req.is('multipart/form-data')) return next();
  if (!req.is('application/json')) {
    return next(new AppError(415, 'Content-Type must be application/json'));
  }
  return next();
});

// ===== API ROUTES =====
const clientsRoutes = require('./api/clients');
const companyProfileRoutes = require('./api/company-profile');
const emailSettingsRoutes = require('./api/email-settings');
const invoiceRoutes = require('./api/invoice');
const pdfRoutes = require('./api/pdf');
const notesRoutes = require('./api/notes');
const jobsRoutes = require('./api/jobs');
const jobFilesRoutes = require('./api/job-files');
const supabaseConfigRoutes = require('./api/supabase-config');

// Mount routers under /api
app.use('/api', clientsRoutes);
app.use('/api/company-profile', companyProfileRoutes);
app.use('/api/email-settings', emailSettingsRoutes);
app.use('/api', invoiceRoutes);
app.use('/api/pdf', pdfRoutes);
app.use('/api/supabase-config', supabaseConfigRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/job-files', jobFilesRoutes);

// ===== V2 API ROUTES =====
const authSystemRoutes = require('./api/auth-system');
const dashboardRoutes = require('./api/dashboard');

app.use('/api/v2/auth', authSystemRoutes);
app.use('/api/v2/dashboard', dashboardRoutes);

// ===== PLATFORM FEATURE ROUTES =====
const activityLogRoutes = require('./api/activity-log');
const userManagementRoutes = require('./api/user-management');
const emailTemplatesRoutes = require('./api/email-templates');
const exportRoutes = require('./api/export');
const portalRoutes = require('./api/portal');

app.use('/api/v2/admin', activityLogRoutes.router);
app.use('/api/v2/admin', userManagementRoutes);
app.use('/api/v2/admin', emailTemplatesRoutes);
app.use('/api/v2', exportRoutes);
app.use('/api/v2', portalRoutes);

// ===== SERVICES & SCOPES =====
var servicesRoutes = require('./api/services');
app.use('/api/v2', servicesRoutes);

// ===== ADMIN SETTINGS =====
var adminSettingsRoutes = require('./api/admin-settings');
app.use('/api/v2/admin', adminSettingsRoutes);

// ===== BLOCK SENSITIVE FILES FROM STATIC ACCESS =====
const blockedStaticPaths = [
  /^\/api\//i,
  /^\/node_modules\//i,
  /^\/package(?:-lock)?\.json$/i,
  /^\/server\.js$/i,
  /^\/forge\.config\.js$/i,
  /^\/(?:init-db|update-db)\.js$/i,
  /\.db(?:-wal|-shm)?$/i,
  /^\/\.env/i,
  /^\/\.git(?:\/|$)/i,
  /^\/uploads\//i,
  /^\/scripts\//i,
  /\.(?:key|pem|crt|p12|pfx|csr)$/i,
  /\.sql$/i,
  // Dev/test leftovers must never be public: saved logins and cookie jars,
  // logs, stray test PDFs, server-only code, deploy config, and a Chrome
  // extension manifest (at /manifest.json it looks like the site is
  // distributing an all-sites content script). Files like these are what
  // got the domain flagged by Google Safe Browsing.
  /\.(?:txt|log)$/i,
  /^\/(?:temp|tmp)-/i,
  /^\/test-[^/]*\.pdf$/i,
  /^\/(?:manifest\.json|content_reporter\.js)$/i,
  /^\/(?:render\.yaml|vercel\.json|playwright\.config\.js)$/i,
  /\.code-workspace$/i,
  /^\/(?:services|tests)\//i
];

app.use((req, res, next) => {
  if (blockedStaticPaths.some((pattern) => pattern.test(req.path))) {
    return res.status(404).end();
  }
  return next();
});

// ===== STATIC FILES =====
// Public assets (js, css) served from /public/ with absolute paths.
// This MUST be registered before the root static middleware so that
// /js/* and /css/* paths resolve correctly on ALL routes (fixes MIME
// and 404 errors when loading assets from nested URLs like /onboarding/step1).
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) res.type('text/css');
    if (filePath.endsWith('.js')) res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
  }
}));

app.use('/assets', express.static(path.join(__dirname, 'assets'), {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));

// Serve the installed @supabase/supabase-js UMD build ourselves instead of
// pulling it from a third-party CDN (cdn.jsdelivr.net) at page-load time.
// This avoids browser tracking-prevention features (e.g. Edge) flagging
// third-party script storage access, and pins every page to the exact
// supabase-js version actually installed/tested rather than whatever the
// CDN happens to resolve "latest" to.
app.get('/vendor/supabase.js', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'));
});
app.get('/favicon.ico', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('image/svg+xml');
  res.send(faviconSvg);
});

// ===== AUTH CONFIG INJECTION (Google sign-in via Supabase Auth) =====
// SUPABASE_URL and the anon key are meant to be public (the anon key is
// safe to ship to the browser by design), so injecting them into the
// login/callback pages does not expose anything sensitive.
function authConfigScript() {
  var config = {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  };
  return '<script>window.__AUTH_CONFIG__ = ' + JSON.stringify(config) + ';</script>';
}

function sendHtmlWithAuthConfig(res, filePath) {
  var html = fs.readFileSync(filePath, 'utf8');
  // These pages are rewritten per request (auth config is injected), so they
  // must never be cached — matching what the static middleware used to send
  // for .html files.
  res.setHeader('Cache-Control', 'no-cache');
  res.type('text/html');
  res.send(html.replace('</head>', authConfigScript() + '</head>'));
}

// ===== PAGE ROUTES (must be before root static middleware) =====
app.get('/', (req, res) => {
  if (disableAuth) return res.sendFile(path.join(__dirname, 'main.html'));
  if (isAuthenticated(req)) {
    return res.redirect('/main');
  }
  sendHtmlWithAuthConfig(res, path.join(__dirname, 'login.html'));
});

app.get('/auth/callback', (req, res) => {
  sendHtmlWithAuthConfig(res, path.join(__dirname, 'auth-callback.html'));
});

// Direct visits to /login.html (bookmarks, shared links like the deployed
// /login.html URL) must receive the same injected Supabase config as "/",
// otherwise the sign-in buttons can never initialize. Without this route the
// file is served as a plain static asset and window.__AUTH_CONFIG__ is absent.
app.get('/login.html', (req, res) => {
  if (isAuthenticated(req)) return res.redirect('/main');
  sendHtmlWithAuthConfig(res, path.join(__dirname, 'login.html'));
});

// Cache main.html for user-data injection
var _mainHtmlCache = null;
function getMainHtmlWithUser(req) {
  if (!_mainHtmlCache) {
    _mainHtmlCache = fs.readFileSync(path.join(__dirname, 'main.html'), 'utf8');
  }
  var userData = JSON.stringify(req.session && req.session.user ? req.session.user : {});
  return _mainHtmlCache.replace(
    '</head>',
    '<script>window.__USER__ = ' + userData + ';</script></head>'
  );
}

var _settingsHtmlCache = null;
function getSettingsHtmlWithUser(req) {
  if (!_settingsHtmlCache) {
    _settingsHtmlCache = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8');
  }
  var userData = JSON.stringify(req.session && req.session.user ? req.session.user : {});
  return _settingsHtmlCache.replace(
    '</head>',
    '<script>window.__USER__ = ' + userData + ';</script></head>'
  );
}

app.get('/main', (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  res.send(getMainHtmlWithUser(req));
});

app.get('/main.html', (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  res.send(getMainHtmlWithUser(req));
});

// Financial Overview / margin tracker page — admin only (Section 8).
// Regular users are redirected back into the CRM rather than ever
// receiving this page's markup or data.
function requireAdminPage(req, res, next) {
  if (!isAuthenticated(req)) return res.redirect('/');
  if (disableAuth) return next();
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  return res.redirect('/main');
}

app.get('/finance', requireAdminPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'finance.html'));
});

app.get('/finance.html', requireAdminPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'finance.html'));
});

// ===== V2 PAGE ROUTES =====
function requireV2Auth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/');
}

// Legacy bookmarks/links from the old multi-tenant onboarding UI —
// send them straight into the CRM instead of a dead page.
app.get('/register', (req, res) => res.redirect('/'));
app.get('/login-v2', (req, res) => res.redirect('/'));
app.get('/dashboard', (req, res) => res.redirect('/main'));

app.get('/settings', requireV2Auth, (req, res) => {
  res.send(getSettingsHtmlWithUser(req));
});

app.use(express.static(path.join(__dirname), {
  index: false,
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) {
      res.type('text/css');
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    if (filePath.endsWith('.js')) {
      res.type('application/javascript');
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    if (filePath.endsWith('.html')) {
      res.type('text/html');
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

// ===== API ERROR HANDLER =====
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: err.message,
      details: err.details || undefined
    });
  }

  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, error: 'Invalid JSON body' });
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, error: 'That file is too large (150MB limit per file).' });
    }
    return res.status(400).json({ success: false, error: err.message });
  }

  console.error('Unhandled server error:', err);
  return res.status(500).json({ success: false, error: 'Internal server error' });
});

// ===== ENSURE UPLOADS FOLDER EXISTS =====
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
console.log('Uploads folder is ready');
if (process.env.ENABLE_DB_BACKUPS === 'true') {
  startBackupScheduler();
}

// ===== START SERVER =====
// Render (like most PaaS platforms) terminates TLS/HTTPS at its edge proxy and
// forwards plain HTTP to the container. This process must therefore run as a
// plain HTTP server bound to 0.0.0.0 on the port Render injects via PORT
// (Render's default is 10000). Never create an HTTPS server or force an
// internal http->https redirect here: doing either breaks the edge proxy and
// surfaces as ERR_SSL_PROTOCOL_ERROR in the browser.
function startServer(port = process.env.PORT || 10000, host = '0.0.0.0') {
  const server = app.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port} (HTTP only, TLS terminated by the platform proxy)`);
  });
  // Node's default request/headers timeouts (a few minutes) are too tight for
  // large photo-report PDFs uploaded over a slow mobile connection — raise
  // them so a slow upload is not cut off mid-transfer.
  server.requestTimeout = 10 * 60 * 1000;
  server.headersTimeout = 10 * 60 * 1000 + 5000;
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };

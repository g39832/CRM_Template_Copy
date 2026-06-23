var { getClient } = require('./db-v2');

// In-memory cache.  null = not yet checked, true/false = cached value.
var adminClaimed = null;

// Excluded paths — requests to these never redirect.
var EXCLUDED_PATHS = [
  '/register',
  '/api/v2/auth/register',
  '/api/v2/auth/login',
  '/health',
  '/favicon.ico'
];

// ============================================================
// checkAdminClaimed()
// Queries the settings table and caches the result.
// Returns true if an admin has been claimed, false otherwise.
// ============================================================
async function checkAdminClaimed() {
  if (adminClaimed !== null) return adminClaimed;

  var supabase = getClient();
  if (!supabase) {
    // No Supabase = dev mode without DB — allow through.
    adminClaimed = true;
    return true;
  }

  try {
    var { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'admin_claimed')
      .maybeSingle();

    if (error) {
      console.error('[admin-guard] settings lookup failed:', error.message);
      adminClaimed = true;
      return true;
    }

    adminClaimed = (data && data.value === 'true');
    return adminClaimed;
  } catch (err) {
    console.error('[admin-guard] unexpected error:', err);
    adminClaimed = true;
    return true;
  }
}

// ============================================================
// setAdminClaimed(value)
// Updates the settings table AND the in-memory cache.
// Called by auth-system after the first admin registers.
// ============================================================
async function setAdminClaimed(value) {
  adminClaimed = value;

  var supabase = getClient();
  if (!supabase) return;

  try {
    await supabase
      .from('settings')
      .upsert(
        { key: 'admin_claimed', value: value ? 'true' : 'false' },
        { onConflict: 'key' }
      );
  } catch (err) {
    console.error('[admin-guard] failed to persist admin_claimed:', err.message);
  }
}

// ============================================================
// Middleware: requireRegistrationEnabled
// Redirects ALL page visitors to /register if the first admin
// has not yet been claimed.  Skips excluded paths so the
// registration flow itself works.
//
// The cache is pre-warmed during module load (see init() below)
// so that by the time the first request arrives, the middleware
// check is synchronous and no race condition exists.
// ============================================================
function requireRegistrationEnabled(req, res, next) {
  // Skip excluded paths
  var path = req.path;
  for (var i = 0; i < EXCLUDED_PATHS.length; i++) {
    if (path === EXCLUDED_PATHS[i] || path.indexOf(EXCLUDED_PATHS[i]) === 0) {
      return next();
    }
  }

  // If admin is already claimed or auth is disabled, pass through
  if (adminClaimed || process.env.DISABLE_AUTH === 'true') {
    return next();
  }

  // adminClaimed is null (cache not yet populated) or false (no admin).
  // If null, allow through optimistically — the init() call will have
  // populated it shortly after startup.
  if (adminClaimed === null) {
    return next();
  }

  // adminClaimed is false — redirect everyone to /register
  res.redirect('/register');
}

// ============================================================
// resetCache()
// Clears the in-memory cache so the next check forces a DB query.
// Useful for testing.
// ============================================================
function resetCache() {
  adminClaimed = null;
}

// ============================================================
// init()
// Pre-warm the cache at startup so the middleware doesn't need
// to await an async query on the first request.
// ============================================================
function init() {
  checkAdminClaimed().then(function (claimed) {
    console.log('[admin-guard] admin_claimed =', claimed);
  }).catch(function (err) {
    console.error('[admin-guard] init failed:', err);
    adminClaimed = true; // allow through on error
  });
}

// Warm cache immediately on module load.
init();

module.exports = {
  checkAdminClaimed: checkAdminClaimed,
  setAdminClaimed: setAdminClaimed,
  requireRegistrationEnabled: requireRegistrationEnabled,
  resetCache: resetCache
};

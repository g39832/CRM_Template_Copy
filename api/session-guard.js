// api/session-guard.js
//
// A signed-in session stores a copy of the user (id, role, company) taken at
// sign-in. Without re-checking it, a user an admin removed — or demoted —
// would keep their old access until the cookie expired (12 hours).
//
// This middleware re-reads the user's row at most once a minute per user
// (per server instance) and:
//   - signs the session out if the user no longer exists, so removing a user
//     in User Management ends their access within about a minute (straight
//     away on the instance that handled the removal, via forgetUser);
//   - copies a changed role / name / company onto the session, so a demotion
//     takes effect without the user signing out and back in.
//
// If the database cannot be reached the request is allowed through on the
// existing session (the data routes will fail on their own); a removed user
// cannot use an outage to get back in, because they have no user row.

const { getClient } = require('./db-v2');

const RECHECK_MS = 60 * 1000;
const lastChecked = new Map(); // userId -> timestamp of last successful check

function forgetUser(userId) {
  lastChecked.delete(String(userId));
}

function signOutSession(req) {
  delete req.session.user;
  req.session.authenticated = false;
}

function createSessionGuard({ disableAuth = false } = {}) {
  return async function sessionGuard(req, res, next) {
    if (disableAuth) return next();
    const sessionUser = req.session && req.session.user;
    if (!req.session || req.session.authenticated !== true || !sessionUser || !sessionUser.id) return next();

    const key = String(sessionUser.id);
    const checkedAt = lastChecked.get(key);
    if (checkedAt && Date.now() - checkedAt < RECHECK_MS) return next();

    const supabase = getClient();
    if (!supabase) return next();

    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, display_name, role, company_id')
        .eq('id', sessionUser.id)
        .maybeSingle();
      if (error) throw error;

      if (!data) {
        lastChecked.delete(key);
        console.warn('[auth] Signed out a session whose user no longer exists (id ' + key + ').');
        signOutSession(req);
        return next();
      }

      if (
        data.role !== sessionUser.role ||
        String(data.company_id) !== String(sessionUser.companyId) ||
        (data.display_name || '') !== (sessionUser.displayName || '') ||
        String(data.email || '') !== String(sessionUser.email || '')
      ) {
        req.session.user = {
          ...sessionUser,
          role: data.role,
          companyId: data.company_id,
          displayName: data.display_name || '',
          email: data.email
        };
      }
      lastChecked.set(key, Date.now());
    } catch (err) {
      console.error('[auth] Could not re-check the signed-in user: ' + (err && err.message ? err.message : err));
    }
    return next();
  };
}

module.exports = { createSessionGuard, forgetUser };

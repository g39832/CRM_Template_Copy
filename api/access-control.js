// api/access-control.js
//
// Shared role/ownership enforcement for the real CRM data endpoints
// (clients, jobs, finance, margin tracker). This is intentionally
// backend-only: every check here runs before data is read from or
// written to Supabase, so a regular user cannot see or change
// something they are not allowed to by hitting the API directly,
// regardless of what the frontend shows or hides.

const FINANCIAL_CLIENT_FIELDS = ['total_due', 'amount_paid', 'balance', 'job_cost'];
const FINANCIAL_JOB_FIELDS = ['total_due', 'amount_paid', 'balance', 'job_cost'];

function isAdmin(req) {
  return Boolean(req.session && req.session.user && req.session.user.role === 'admin');
}

function currentUserId(req) {
  return req.session && req.session.user ? req.session.user.id : null;
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

// True if the current session user is allowed to see/act on this client row.
// Admins can access every client. Regular users can only access clients
// that are specifically assigned to them (clients.assigned_user_id).
function canAccessClient(req, client) {
  if (!client) return false;
  if (isAdmin(req)) return true;
  const uid = currentUserId(req);
  if (!uid) return false;
  return client.assigned_user_id !== null &&
    client.assigned_user_id !== undefined &&
    String(client.assigned_user_id) === String(uid);
}

// Strip financial fields from a client row before it is sent to a
// regular user. Admins get the row untouched.
function sanitizeClient(req, client) {
  if (!client) return client;
  if (isAdmin(req)) return client;
  const copy = { ...client };
  for (const field of FINANCIAL_CLIENT_FIELDS) {
    delete copy[field];
  }
  return copy;
}

function sanitizeClients(req, clients) {
  return (clients || []).map((c) => sanitizeClient(req, c));
}

function sanitizeJob(req, job) {
  if (!job) return job;
  if (isAdmin(req)) return job;
  const copy = { ...job };
  for (const field of FINANCIAL_JOB_FIELDS) {
    delete copy[field];
  }
  return copy;
}

function sanitizeJobs(req, jobs) {
  return (jobs || []).map((j) => sanitizeJob(req, j));
}

// Filters a list of clients down to what this session is allowed to see.
function filterClientsForUser(req, clients) {
  if (isAdmin(req)) return clients || [];
  const uid = currentUserId(req);
  return (clients || []).filter((c) => c.assigned_user_id !== null &&
    c.assigned_user_id !== undefined &&
    String(c.assigned_user_id) === String(uid));
}

module.exports = {
  isAdmin,
  currentUserId,
  requireAdmin,
  canAccessClient,
  sanitizeClient,
  sanitizeClients,
  sanitizeJob,
  sanitizeJobs,
  filterClientsForUser
};

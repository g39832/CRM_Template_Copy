const express = require('express');
const { getClient } = require('./db-v2');
const { asyncHandler } = require('./request-utils');
const { requireAdmin } = require('./access-control');
const { isRemoteStorageEnabled } = require('../services/storage');

// GET /health — public liveness check for Render / uptime monitors.
// It answers without touching the database and says nothing about the
// business: it used to return client counts, payment counts and total money
// received to anyone, and ran several full-table reads on every hit.
const router = express.Router();

router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'ok' });
});

// GET /api/v2/admin/system-health — admins only (it sits behind the API
// login guard and requireAdmin). Confirms the database answers, using one
// tiny query; still no business figures.
const adminRouter = express.Router();

adminRouter.get('/system-health', requireAdmin, asyncHandler(async (req, res) => {
  const started = Date.now();
  let database = 'not_configured';
  const supabase = getClient();
  if (supabase) {
    const { error } = await supabase.from('settings').select('key').limit(1);
    database = error ? 'error' : 'ok';
  }
  res.set('Cache-Control', 'no-store');
  res.json({
    status: database === 'ok' ? 'ok' : 'degraded',
    database,
    databaseMs: Date.now() - started,
    storageMode: isRemoteStorageEnabled() ? 'supabase' : 'local',
    environment: process.env.NODE_ENV || 'development'
  });
}));

module.exports = router;
module.exports.adminRouter = adminRouter;

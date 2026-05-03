const express = require('express');
const db = require('./db');
const { asyncHandler } = require('./request-utils');
const { isRemoteStorageEnabled } = require('../services/storage');

const router = express.Router();

function requireHealthSecret(req, res, next) {
  const required = process.env.HEALTH_SECRET;
  if (!required) return next();
  const provided = req.headers['x-health-secret'] || '';
  if (provided === required) return next();
  return res.status(401).json({ success: false, error: 'Unauthorized health check' });
}

router.get('/', requireHealthSecret, asyncHandler(async (req, res) => {
  const timestamp = new Date().toISOString();
  await db.schemaReady;

  const clientsResult = await db.query('SELECT COUNT(*)::int AS total_clients FROM clients');
  const overdueResult = await db.query('SELECT COUNT(*)::int AS overdue_clients FROM clients WHERE balance > 0');
  const paymentsResult = await db.query('SELECT COUNT(*)::int AS payment_count, COALESCE(SUM(amount),0) AS total_received FROM payments');
  const todayResult = await db.query(`
    SELECT
      COUNT(*)::int AS new_clients,
      COALESCE(SUM(payments.amount), 0) AS today_payments
    FROM clients
    LEFT JOIN payments
      ON payments.client_id = clients.id
      AND DATE(payments.payment_date) = CURRENT_DATE
    WHERE DATE(clients.created_at) = CURRENT_DATE
  `);

  const clients = clientsResult.rows[0] || {};
  const overdue = overdueResult.rows[0] || {};
  const payments = paymentsResult.rows[0] || {};
  const today = todayResult.rows[0] || {};

  res.json({
    status: 'ok',
    timestamp,
    environment: process.env.NODE_ENV || 'development',
    storageMode: isRemoteStorageEnabled() ? 'supabase' : 'local',
    databaseConfigured: Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)),
    metrics: {
      totalClients: Number(clients.total_clients || 0),
      overdueClients: Number(overdue.overdue_clients || 0),
      paymentCount: Number(payments.payment_count || 0),
      totalReceived: Number(payments.total_received || 0),
      newClientsToday: Number(today.new_clients || 0),
      todayPayments: Number(today.today_payments || 0)
    }
  });
}));

module.exports = router;

const express = require('express');
const db = require('./db');
const { asyncHandler, AppError, parseYear } = require('./request-utils');
const { logActivity } = require('./activity-log');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
  next();
}

function escapeCSV(value) {
  var str = value === null || value === undefined ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function formatMoney(value) {
  var num = Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
}

router.get('/export/clients', requireAuth, asyncHandler(async (req, res) => {
  await db.schemaReady;
  var { rows } = await db.query('SELECT id, name, phone, email, address, status, total_due, amount_paid, balance, scope_of_work, job_cost, client_type, created_at FROM clients ORDER BY name ASC');

  var csv = 'ID,Name,Phone,Email,Address,Status,Total Due,Amount Paid,Balance,Scope of Work,Job Cost,Client Type,Created At\n';
  rows.forEach(function (row) {
    csv += [
      row.id, row.name, row.phone, row.email,
      escapeCSV(row.address), row.status,
      formatMoney(row.total_due), formatMoney(row.amount_paid), formatMoney(row.balance),
      escapeCSV(row.scope_of_work), formatMoney(row.job_cost),
      row.client_type || 'one-off', row.created_at
    ].map(escapeCSV).join(',') + '\n';
  });

  await logActivity(req.session.user.companyId, req.session.user.id, 'Exported clients', 'export', 'clients', { rows: rows.length });
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="clients-export.csv"');
  res.send('\uFEFF' + csv);
}));

router.get('/export/payments', requireAuth, asyncHandler(async (req, res) => {
  var year = req.query.year ? parseYear(req.query.year, 'year') : new Date().getFullYear();

  await db.schemaReady;
  var { rows } = await db.query(
    `SELECT p.id, p.client_id, c.name AS client_name, p.amount, p.payment_date
     FROM payments p LEFT JOIN clients c ON c.id = p.client_id
     WHERE EXTRACT(YEAR FROM p.payment_date)::int = $1
     ORDER BY p.payment_date DESC`,
    [year]
  );

  var csv = 'ID,Client ID,Client Name,Amount,Payment Date\n';
  rows.forEach(function (row) {
    csv += [row.id, row.client_id, escapeCSV(row.client_name), formatMoney(row.amount), row.payment_date].map(escapeCSV).join(',') + '\n';
  });

  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="payments-' + year + '-export.csv"');
  res.send('\uFEFF' + csv);
}));

router.get('/export/finance-summary', requireAuth, asyncHandler(async (req, res) => {
  var year = req.query.year ? parseYear(req.query.year, 'year') : new Date().getFullYear();

  await db.schemaReady;
  var { rows: summary } = await db.query(
    `SELECT
      COUNT(DISTINCT c.id)::int AS total_clients,
      COALESCE(SUM(c.total_due), 0) AS total_expected,
      COALESCE((SELECT SUM(amount) FROM payments WHERE EXTRACT(YEAR FROM payment_date)::int = $1), 0) AS total_received
     FROM clients c
     WHERE EXTRACT(YEAR FROM c.created_at)::int = $1`,
    [year]
  );

  var { rows: margins } = await db.query(
    `SELECT c.id, c.name, c.total_due, c.amount_paid, c.job_cost, c.client_type
     FROM clients c WHERE EXTRACT(YEAR FROM c.created_at)::int = $1 AND c.total_due > 0`,
    [year]
  );

  var csv = 'Year,Total Clients,Total Expected,Total Received,Total Remaining\n';
  var s = summary[0] || {};
  var totalExpected = Number(s.total_expected || 0);
  var totalReceived = Number(s.total_received || 0);
  csv += [year, s.total_clients || 0, formatMoney(totalExpected), formatMoney(totalReceived), formatMoney(totalExpected - totalReceived)].map(escapeCSV).join(',') + '\n\n';

  csv += 'Client ID,Client Name,Total Due,Amount Paid,Job Cost,Client Type\n';
  margins.forEach(function (row) {
    csv += [row.id, escapeCSV(row.name), formatMoney(row.total_due), formatMoney(row.amount_paid), formatMoney(row.job_cost), row.client_type || 'one-off'].map(escapeCSV).join(',') + '\n';
  });

  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="finance-summary-' + year + '-export.csv"');
  res.send('\uFEFF' + csv);
}));

router.get('/export/margin-entries', requireAuth, asyncHandler(async (req, res) => {
  var year = req.query.year ? parseYear(req.query.year, 'year') : new Date().getFullYear();

  await db.schemaReady;
  var { rows } = await db.query(
    `SELECT id, client_id, client_name, category, project, invoice_status, amount, expense_type, recurring, expense_date, notes
     FROM finance_margin_entries
     WHERE EXTRACT(YEAR FROM expense_date)::int = $1
     ORDER BY expense_date DESC`,
    [year]
  );

  var csv = 'ID,Client ID,Client Name,Category,Project,Invoice Status,Amount,Expense Type,Recurring,Expense Date,Notes\n';
  rows.forEach(function (row) {
    csv += [row.id, row.client_id, escapeCSV(row.client_name), escapeCSV(row.category), escapeCSV(row.project),
      row.invoice_status, formatMoney(row.amount), row.expense_type, row.recurring ? 'Yes' : 'No',
      row.expense_date, escapeCSV(row.notes || '')].map(escapeCSV).join(',') + '\n';
  });

  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="margin-entries-' + year + '-export.csv"');
  res.send('\uFEFF' + csv);
}));

module.exports = router;

const express = require('express');
const db = require('./db');
const { asyncHandler, AppError, parseIntField } = require('./request-utils');
const { logActivity } = require('./activity-log');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });
  next();
}

router.get('/portal/clients', requireAdmin, asyncHandler(async (req, res) => {
  await db.schemaReady;
  var { rows } = await db.query(
    `SELECT id, name, email, client_type, total_due, amount_paid, balance
     FROM clients WHERE client_type = 'recurring' ORDER BY name ASC`
  );

  var clientsWithPortal = rows.map(function (row) {
    var token = Buffer.from(row.id + ':' + row.email + ':crm-portal').toString('base64').replace(/=/g, '');
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      clientType: row.client_type,
      totalDue: Number(row.total_due || 0),
      amountPaid: Number(row.amount_paid || 0),
      balance: Number(row.balance || 0),
      portalUrl: '/portal/client/' + token
    };
  });

  res.json({ success: true, data: clientsWithPortal });
}));

router.get('/portal/client/:token', asyncHandler(async (req, res) => {
  try {
    var decoded = Buffer.from(req.params.token, 'base64').toString('utf8');
    var parts = decoded.split(':');
    var clientId = parseInt(parts[0], 10);
    var email = parts[1] || '';

    if (!Number.isFinite(clientId)) {
      return res.status(400).send('<h1>Invalid portal link</h1><p>This link is invalid or has expired.</p>');
    }

    await db.schemaReady;
    var { rows } = await db.query(
      `SELECT id, name, email, phone, total_due, amount_paid, balance, scope_of_work, client_type, created_at
       FROM clients WHERE id = $1 AND email = $2`,
      [clientId, email]
    );

    if (!rows.length) return res.status(404).send('<h1>Client not found</h1><p>The portal link is no longer valid.</p>');

    var client = rows[0];
    var { rows: payments } = await db.query(
      'SELECT id, amount, payment_date FROM payments WHERE client_id = $1 ORDER BY payment_date DESC LIMIT 20',
      [clientId]
    );
    var { rows: jobs } = await db.query(
      'SELECT id, title, status, total_due, amount_paid, balance FROM jobs WHERE client_id = $1 ORDER BY created_at DESC LIMIT 10',
      [clientId]
    );

    res.send(renderPortalPage(client, payments, jobs));
  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).send('<h1>Server error</h1><p>Please try again later.</p>');
  }
}));

function renderPortalPage(client, payments, jobs) {
  var primaryColor = '#2563eb';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Client Portal - ${escapeHtml(client.name)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Inter, system-ui, sans-serif; background: #f1f5f9; color: #1e293b; display: flex; flex-direction: column; min-height: 100vh; }
    header { background: linear-gradient(135deg, ${primaryColor}, #1d4ed8); color: white; padding: 32px 24px; text-align: center; }
    header h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 4px; }
    header p { opacity: 0.85; font-size: 0.9rem; }
    .container { max-width: 800px; margin: 0 auto; padding: 24px; flex: 1; }
    .card { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 20px; margin-bottom: 20px; }
    .card h2 { font-size: 1.05rem; font-weight: 700; margin-bottom: 14px; color: ${primaryColor}; }
    .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .stat { text-align: center; padding: 14px; background: #f8fafc; border-radius: 8px; }
    .stat-value { font-size: 1.4rem; font-weight: 800; }
    .stat-label { font-size: 0.78rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    th { text-align: left; padding: 8px 6px; border-bottom: 2px solid #e2e8f0; color: #64748b; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 10px 6px; border-bottom: 1px solid #f1f5f9; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    .badge-paid { background: #dcfce7; color: #166534; }
    .badge-pending { background: #fef9c3; color: #854d0e; }
    .badge-overdue { background: #fee2e2; color: #991b1b; }
    .empty { text-align: center; padding: 24px; color: #94a3b8; font-size: 0.9rem; }
    footer { text-align: center; padding: 20px; color: #94a3b8; font-size: 0.8rem; margin-top: auto; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(client.name)}</h1>
    <p>${escapeHtml(client.email || '')}</p>
  </header>
  <div class="container">
    <div class="card">
      <h2>Account Summary</h2>
      <div class="stat-grid">
        <div class="stat"><div class="stat-value" style="color:${primaryColor}">$${formatMoney(client.total_due)}</div><div class="stat-label">Total Due</div></div>
        <div class="stat"><div class="stat-value" style="color:#16a34a">$${formatMoney(client.amount_paid)}</div><div class="stat-label">Amount Paid</div></div>
        <div class="stat"><div class="stat-value" style="color:#dc2626">$${formatMoney(client.balance)}</div><div class="stat-label">Balance</div></div>
      </div>
    </div>
    <div class="card">
      <h2>Recent Payments</h2>
      ${payments.length ? `<table><thead><tr><th>Date</th><th>Amount</th></tr></thead><tbody>${payments.map(function (p) {
        return '<tr><td>' + formatDate(p.payment_date) + '</td><td><strong>$' + formatMoney(p.amount) + '</strong></td></tr>';
      }).join('')}</tbody></table>` : '<div class="empty">No payments recorded yet.</div>'}
    </div>
    <div class="card">
      <h2>Jobs & Invoices</h2>
      ${jobs.length ? `<table><thead><tr><th>Title</th><th>Status</th><th>Amount</th></tr></thead><tbody>${jobs.map(function (j) {
        var badgeClass = j.status === 'Paid' || j.status === 'Invoice' ? 'badge-paid' : 'badge-pending';
        return '<tr><td>' + escapeHtml(j.title) + '</td><td><span class="badge ' + badgeClass + '">' + escapeHtml(j.status) + '</span></td><td><strong>$' + formatMoney(j.total_due) + '</strong></td></tr>';
      }).join('')}</tbody></table>` : '<div class="empty">No jobs or invoices yet.</div>'}
    </div>
  </div>
  <footer>Powered by CRM Template</footer>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatMoney(value) {
  var num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
}

function formatDate(value) {
  if (!value) return '—';
  var d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

module.exports = router;

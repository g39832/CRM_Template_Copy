const express = require('express');
const { getClient } = require('./db-v2');
const db = require('./db');
const { asyncHandler, AppError, assertObject, parseStringField, parseIntField } = require('./request-utils');
const { logActivity } = require('./activity-log');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });
  next();
}

router.get('/email-templates', asyncHandler(async (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false, error: 'Not authenticated' });

  await db.schemaReady;
  var { rows } = await db.query(
    'SELECT id, name, subject, body, variables, type, created_at, updated_at FROM email_templates WHERE company_id = $1 ORDER BY name ASC',
    [req.session.user.companyId]
  );
  res.json({ success: true, data: rows || [] });
}));

router.post('/email-templates', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  var name = parseStringField(req.body.name, 'name', { maxLength: 100 });
  var subject = parseStringField(req.body.subject, 'subject', { maxLength: 500 });
  var body = parseStringField(req.body.body, 'body', { maxLength: 50000 });
  var type = (req.body.type || 'custom').slice(0, 50);
  var variables = req.body.variables;
  if (variables && typeof variables === 'object') variables = JSON.stringify(variables);

  await db.schemaReady;
  var { rows } = await db.query(
    `INSERT INTO email_templates (company_id, name, subject, body, type, variables)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, subject, body, type, variables, created_at, updated_at`,
    [req.session.user.companyId, name, subject, body, type, variables || null]
  );

  await logActivity(req.session.user.companyId, req.session.user.id, 'Created email template', 'email_template', rows[0].id, { name: name, type: type });
  res.json({ success: true, data: rows[0] });
}));

router.put('/email-templates/:id', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  var id = parseIntField(req.params.id, 'id', { min: 1 });

  var sets = [];
  var params = [];
  var pIdx = 1;

  if (req.body.name !== undefined) { sets.push('name = $' + pIdx++); params.push(parseStringField(req.body.name, 'name', { maxLength: 100 })); }
  if (req.body.subject !== undefined) { sets.push('subject = $' + pIdx++); params.push(parseStringField(req.body.subject, 'subject', { maxLength: 500 })); }
  if (req.body.body !== undefined) { sets.push('body = $' + pIdx++); params.push(parseStringField(req.body.body, 'body', { maxLength: 50000 })); }
  if (req.body.type !== undefined) { sets.push('type = $' + pIdx++); params.push(String(req.body.type).slice(0, 50)); }
  if (req.body.variables !== undefined) {
    var v = req.body.variables;
    sets.push('variables = $' + pIdx++);
    params.push(typeof v === 'object' ? JSON.stringify(v) : v);
  }

  if (sets.length === 0) throw new AppError(400, 'No fields to update');
  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  params.push(req.session.user.companyId);

  await db.schemaReady;
  var { rows } = await db.query(
    'UPDATE email_templates SET ' + sets.join(', ') + ' WHERE id = $' + pIdx++ + ' AND company_id = $' + pIdx + ' RETURNING id, name, subject, body, type, variables, created_at, updated_at',
    params
  );

  if (!rows.length) throw new AppError(404, 'Template not found');
  await logActivity(req.session.user.companyId, req.session.user.id, 'Updated email template', 'email_template', id, { name: rows[0].name });
  res.json({ success: true, data: rows[0] });
}));

router.delete('/email-templates/:id', requireAdmin, asyncHandler(async (req, res) => {
  var id = parseIntField(req.params.id, 'id', { min: 1 });

  await db.schemaReady;
  var { rowCount } = await db.query('DELETE FROM email_templates WHERE id = $1 AND company_id = $2', [id, req.session.user.companyId]);

  if (rowCount === 0) throw new AppError(404, 'Template not found');
  await logActivity(req.session.user.companyId, req.session.user.id, 'Deleted email template', 'email_template', id, {});
  res.json({ success: true });
}));

router.get('/email-templates/types', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: [
      { type: 'invoice', label: 'Invoice' },
      { type: 'estimate', label: 'Estimate' },
      { type: 'receipt', label: 'Payment Receipt' },
      { type: 'reminder', label: 'Payment Reminder' },
      { type: 'portal-invite', label: 'Client Portal Invite' },
      { type: 'custom', label: 'Custom' }
    ]
  });
}));

module.exports = router;

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const db = require('./db');
const { asyncHandler } = require('./request-utils');
const { buildInvoiceData, generateInvoicePDF, sendInvoiceEmail } = require('../services/invoice');
const { normalizeEmailConfig } = require('../services/email-config');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const EMAIL_SETTINGS_KEY = 'email_delivery_config';

async function readStoredEmailConfig() {
  await db.schemaReady;
  const { rows } = await db.query('SELECT value FROM settings WHERE key = $1', [EMAIL_SETTINGS_KEY]);
  const raw = rows[0]?.value;
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchLatestNote(clientId) {
  const { data, error } = await supabase
    .from('notes')
    .select('id, content, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

router.post('/send-invoice/:clientId', asyncHandler(async (req, res) => {
  try {
    const { clientId } = req.params;

    const { data: client, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (error || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (!client.email) {
      return res.status(400).json({
        error: 'Client must have an email before sending invoice'
      });
    }

    const latestNote = await fetchLatestNote(clientId);
    const invoiceData = buildInvoiceData({ client, latestNote });
    const pdfBuffer = await generateInvoicePDF(invoiceData);
    const storedEmailConfig = await readStoredEmailConfig();
    const emailConfig = normalizeEmailConfig(storedEmailConfig || {});
    await sendInvoiceEmail(client.email, pdfBuffer, emailConfig);

    res.json({ success: true });
  } catch (err) {
    console.error('Send invoice failed:', err);
    const message = String(err?.message || '');
    if (/email sender|smtp host|smtp password|smtp username/i.test(message)) {
      return res.status(400).json({
        error: 'Email sender is not configured. Open Email Setup and save a sender account.'
      });
    }
    res.status(500).json({ error: 'Failed to send invoice' });
  }
}));

module.exports = router;

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { asyncHandler } = require('./request-utils');
const { buildInvoiceData, generateInvoicePDF } = require('../services/invoice');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

    const latestNote = await fetchLatestNote(clientId);
    const invoiceData = buildInvoiceData({ client, latestNote });
    const pdfBuffer = await generateInvoicePDF(invoiceData);

    const safeClientName = String(client.name || 'client')
      .trim()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'client';
    const filename = `${safeClientName}-${invoiceData.invoiceNumber}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`
    });

    return res.send(pdfBuffer);
  } catch (err) {
    console.error('Send invoice failed:', err);
    res.status(500).json({ error: 'Failed to send invoice' });
  }
}));

module.exports = router;

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const db = require('./db');
const { asyncHandler } = require('./request-utils');
const { buildInvoiceData, generateInvoicePDF } = require('../services/invoice');
const { normalizeCompanyProfile } = require('../services/company-profile');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const COMPANY_PROFILE_KEY = 'company_profile';

async function readStoredCompanyProfile() {
  await db.schemaReady;
  const { rows } = await db.query('SELECT value FROM settings WHERE key = $1', [COMPANY_PROFILE_KEY]);
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

// Shared handler for both invoice and estimate generation
async function handleDocumentGeneration(req, res, mode) {
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
    const storedCompanyProfile = await readStoredCompanyProfile();
    const normalizedProfile = normalizeCompanyProfile(storedCompanyProfile || {});

    // Extract base64 from the stored data URL and attach it to the profile
    // so buildInvoiceData can pass it through to generateInvoicePDF
    if (storedCompanyProfile?.logoUrl) {
      const match = storedCompanyProfile.logoUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (match) {
        normalizedProfile.logoBase64 = match[1];
      }
    }

    const invoiceData = buildInvoiceData({
      client,
      latestNote,
      companyProfile: normalizedProfile,
      mode
    });

    const pdfBuffer = await generateInvoicePDF(invoiceData, mode);

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
    console.error(`${mode} generation failed:`, err);
    res.status(500).json({ error: `Failed to generate ${mode}` });
  }
}

router.post('/send-invoice/:clientId', asyncHandler((req, res) =>
  handleDocumentGeneration(req, res, 'invoice')
));

router.post('/send-estimate/:clientId', asyncHandler((req, res) =>
  handleDocumentGeneration(req, res, 'estimate')
));

module.exports = router;

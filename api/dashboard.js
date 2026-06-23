const express = require('express');
const { getClient } = require('./db-v2');
const { asyncHandler, AppError } = require('./request-utils');

const router = express.Router();

// ============================================================
// Middleware: require authenticated admin with a company context
// ============================================================
function requireCompanyUser(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  if (!req.session.user.companyId) {
    return res.status(400).json({ success: false, error: 'No company associated' });
  }
  next();
}

// ============================================================
// GET /api/v2/dashboard/stats
//
// Returns aggregated dashboard metrics for the admin's company:
//   - totalClients, activeJobs, outstandingInvoices, thisMonthRevenue
//   - revenueSplit: { oneOffRevenue, recurringRevenue }
//   - workflow: company's business_workflow setting
//   - retentionAlerts: list of recurring clients at risk (no invoice 45+ days)
//   - featureStatus: which feature components are active
//   - branding: company name, logo_url, brand colors
// ============================================================
router.get('/stats', requireCompanyUser, asyncHandler(async (req, res) => {
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  const companyId = req.session.user.companyId;

  // ---- Company info & branding ----
  var { data: company } = await supabase
    .from('companies')
    .select('name, logo_url, brand_primary_color, brand_secondary_color, business_workflow')
    .eq('id', companyId)
    .maybeSingle();

  if (!company) {
    return res.json({ success: true, data: getEmptyStats() });
  }

  const workflow = company.business_workflow || 'both';

  // ---- Total clients ----
  var { count: totalClients } = await supabase
    .from('clients')
    .select('id', { count: 'exact', head: true });

  // ---- Active jobs (not Closed) ----
  var { count: activeJobs } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'Closed');

  // ---- Outstanding invoices (clients with balance > 0) ----
  var { count: outstandingInvoices } = await supabase
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .gt('balance', 0);

  // ---- This month's revenue ----
  var now = new Date();
  var firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  var { data: monthPayments } = await supabase
    .from('payments')
    .select('amount, client_id')
    .gte('payment_date', firstOfMonth);

  var thisMonthRevenue = 0;
  if (monthPayments) {
    thisMonthRevenue = monthPayments.reduce(function (sum, p) { return sum + Number(p.amount || 0); }, 0);
  }

  // ---- Revenue split: one-off vs recurring ----
  var { data: splitData } = await supabase
    .from('clients')
    .select('id, client_type, total_due');

  var oneOffRevenue = 0;
  var recurringRevenue = 0;
  if (splitData) {
    splitData.forEach(function (c) {
      var t = Number(c.total_due || 0);
      if (c.client_type === 'recurring') {
        recurringRevenue += t;
      } else {
        oneOffRevenue += t;
      }
    });
  }

  // ---- Retention alerts (recurring clients with no payment in 45 days) ----
  var retentionAlerts = [];
  var fortyFiveDaysAgo = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString();

  var { data: recurringClients } = await supabase
    .from('clients')
    .select('id, name, phone, email')
    .eq('client_type', 'recurring');

  if (recurringClients) {
    for (var i = 0; i < recurringClients.length; i++) {
      var rc = recurringClients[i];
      var { data: lastPayment } = await supabase
        .from('payments')
        .select('payment_date')
        .eq('client_id', rc.id)
        .order('payment_date', { ascending: false })
        .limit(1);

      var lastDate = lastPayment && lastPayment.length > 0 ? lastPayment[0].payment_date : null;
      var atRisk = !lastDate || new Date(lastDate) < new Date(fortyFiveDaysAgo);

      if (atRisk) {
        retentionAlerts.push({
          id: rc.id,
          name: rc.name,
          phone: rc.phone,
          email: rc.email,
          lastPaymentDate: lastDate
        });
      }
    }
  }

  // ---- Feature status (all components, not just active) ----
  var { data: allFeatures } = await supabase
    .from('company_components')
    .select('component_type, is_active, display_order, config')
    .eq('company_id', companyId)
    .order('display_order', { ascending: true });

  var platformFeatures = {};
  if (allFeatures) {
    allFeatures.forEach(function (f) {
      platformFeatures[f.component_type] = {
        isActive: f.is_active,
        displayOrder: f.display_order,
        config: f.config || {}
      };
    });
  }

  // ---- Check platform flags ----
  var hasAdvancedFiltering = platformFeatures['advanced-filtering']?.isActive === true;
  var hasClientPortal = platformFeatures['client-portal']?.isActive === true;
  var hasEmailTemplates = platformFeatures['email-templates']?.isActive === true;
  var hasMultiCurrency = platformFeatures['multi-currency']?.isActive === true;
  var hasRecurringInvoices = platformFeatures['recurring-invoices']?.isActive === true;
  var hasExportReporting = platformFeatures['export-reporting']?.isActive === true;
  var hasRoleBasedAccess = platformFeatures['role-based-access']?.isActive === true;
  var hasActivityLog = platformFeatures['activity-log']?.isActive === true;

  // ---- Company currency (multi-currency feature) ----
  var currency = 'USD';
  if (hasMultiCurrency && company.currency) {
    currency = company.currency;
  }

  // ---- Assemble response ----
  res.json({
    success: true,
    data: {
      branding: {
        companyName: company.name || '',
        logoUrl: company.logo_url || '',
        primaryColor: company.brand_primary_color || '#1c92d2',
        secondaryColor: company.brand_secondary_color || '#7c3aed'
      },
      workflow: workflow,
      totalClients: totalClients || 0,
      activeJobs: activeJobs || 0,
      outstandingInvoices: outstandingInvoices || 0,
      thisMonthRevenue: thisMonthRevenue,
      revenueSplit: {
        oneOffRevenue: oneOffRevenue,
        recurringRevenue: recurringRevenue
      },
      retentionAlerts: retentionAlerts,
      activeFeatures: allFeatures || [],
      platformFeatures: {
        advancedFiltering: hasAdvancedFiltering,
        clientPortal: hasClientPortal,
        emailTemplates: hasEmailTemplates,
        multiCurrency: hasMultiCurrency,
        recurringInvoices: hasRecurringInvoices,
        exportReporting: hasExportReporting,
        roleBasedAccess: hasRoleBasedAccess,
        activityLog: hasActivityLog,
        currency: currency
      }
    }
  });
}));

function getEmptyStats() {
  return {
    branding: { companyName: '', logoUrl: '', primaryColor: '#1c92d2', secondaryColor: '#7c3aed' },
    workflow: 'both',
    totalClients: 0,
    activeJobs: 0,
    outstandingInvoices: 0,
    thisMonthRevenue: 0,
    revenueSplit: { oneOffRevenue: 0, recurringRevenue: 0 },
    retentionAlerts: [],
    activeFeatures: [],
    platformFeatures: {
      advancedFiltering: false,
      clientPortal: false,
      emailTemplates: false,
      multiCurrency: false,
      recurringInvoices: false,
      exportReporting: false,
      roleBasedAccess: false,
      activityLog: false,
      currency: 'USD'
    }
  };
}

// ============================================================
// Middleware: requireCronSecret
//
// Validates the X-Cron-Secret header against the CRON_SECRET
// environment variable.  If they match, access is granted even
// without a session (allows Render cron jobs to call the endpoint).
// ============================================================
function requireCronSecret(req, res, next) {
  var headerSecret = req.get('X-Cron-Secret');
  var envSecret = process.env.CRON_SECRET;

  if (envSecret && headerSecret && headerSecret === envSecret) {
    req._cronAuthorized = true;
    return next();
  }

  // Fall through to session-based auth
  if (req.session && req.session.user && req.session.user.companyId) {
    return next();
  }

  return res.status(401).json({ success: false, error: 'Unauthorized. Provide X-Cron-Secret header or authenticate.' });
}

// ============================================================
// GET /api/v2/dashboard/recurring-cron
//
// Worker route: scans returning clients and auto-generates
// pending invoice drafts for the current month.
//
// Two auth modes:
//   1. Cron mode (X-Cron-Secret header) — processes ALL companies
//   2. Session mode (authenticated admin) — processes only their company
//
// Designed to be called by an external cron scheduler (Render Cron)
// or manually by an admin for testing.
// ============================================================
router.get('/recurring-cron', requireCronSecret, asyncHandler(async (req, res) => {
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  var now = new Date();
  var firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  var generated = [];
  var errors = [];
  var processedCompanies = [];

  // Determine which companies to process
  var companies = [];
  if (req._cronAuthorized) {
    // Cron mode: process ALL companies
    var { data: allCompanies, error: coErr } = await supabase
      .from('companies')
      .select('id, name, slug');

    if (coErr) throw new AppError(500, 'Failed to list companies: ' + coErr.message);
    companies = allCompanies || [];
  } else {
    // Session mode: process only the admin's company
    companies = [{ id: req.session.user.companyId, name: req.session.user.companyName || '', slug: '' }];
  }

  var { buildInvoiceData, generateInvoicePDF } = require('../services/invoice');
  var { normalizeCompanyProfile } = require('../services/company-profile');

  for (var c = 0; c < companies.length; c++) {
    var company = companies[c];
    processedCompanies.push({ id: company.id, name: company.name || company.slug || company.id });

    // Find company profile for PDF branding
    var { data: companyProfileRaw } = await supabase
      .from('companies')
      .select('name, logo_url, brand_primary_color, brand_secondary_color, slug')
      .eq('id', company.id)
      .maybeSingle();

    var companyName = companyProfileRaw?.name || company.name || 'Your Company';

    // Find recurring clients for this company
    var { data: recurringClients } = await supabase
      .from('clients')
      .select('id, name, email, total_due, amount_paid, balance, scope_of_work, phone, address')
      .eq('client_type', 'recurring');

    if (!recurringClients || recurringClients.length === 0) {
      continue;
    }

    for (var i = 0; i < recurringClients.length; i++) {
      var client = recurringClients[i];

      // Check if already invoiced this month
      var { data: existing } = await supabase
        .from('payments')
        .select('id')
        .eq('client_id', client.id)
        .gte('payment_date', firstOfMonth)
        .limit(1);

      if (existing && existing.length > 0) {
        continue;
      }

      var { data: lastJob } = await supabase
        .from('jobs')
        .select('total_due, scope_of_work')
        .eq('client_id', client.id)
        .order('created_at', { ascending: false })
        .limit(1);

      var amount = lastJob && lastJob.length > 0 ? Number(lastJob[0].total_due || 0) : Number(client.total_due || 0);
      var scope = lastJob && lastJob.length > 0 ? (lastJob[0].scope_of_work || '') : (client.scope_of_work || '');

      // Create the job record
      var { data: newJob, error: jobErr } = await supabase
        .from('jobs')
        .insert({
          client_id: client.id,
          title: 'Recurring - ' + new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
          status: 'Invoice',
          scope_of_work: scope,
          total_due: amount,
          job_cost: 0,
          amount_paid: 0,
          balance: amount
        })
        .select()
        .single();

      if (jobErr) {
        errors.push({ companyId: company.id, clientId: client.id, name: client.name, error: jobErr.message });
        continue;
      }

      // Generate invoice PDF
      try {
        var profileForPdf = normalizeCompanyProfile({
          businessName: companyName,
          businessAddress: '',
          businessPhone: '',
          businessEmail: '',
          logoUrl: companyProfileRaw?.logo_url || ''
        });

        var invoiceData = buildInvoiceData({
          client: { ...client, scope_of_work: scope, total_due: amount, amount_paid: 0, balance: amount, id: String(client.id) + '-J' + String(newJob.id) },
          latestNote: null,
          companyProfile: profileForPdf,
          mode: 'invoice'
        });

        var pdfBuffer = await generateInvoicePDF(invoiceData, 'invoice');

        var safeName = String(client.name || 'client').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'client';
        var filename = safeName + '-' + invoiceData.invoiceNumber + '.pdf';

        // Upload PDF to Supabase storage
        var { error: storageErr } = await supabase.storage
          .from(process.env.SUPABASE_STORAGE_BUCKET || 'crm-files')
          .upload('invoices/' + company.id + '/' + filename, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: true
          });

        generated.push({
          companyId: company.id,
          clientId: client.id,
          name: client.name,
          jobId: newJob.id,
          amount: amount,
          invoiceNumber: invoiceData.invoiceNumber,
          pdfUrl: storageErr ? null : ('invoices/' + company.id + '/' + filename)
        });
      } catch (pdfErr) {
        generated.push({
          companyId: company.id,
          clientId: client.id,
          name: client.name,
          jobId: newJob.id,
          amount: amount,
          invoiceNumber: null,
          pdfUrl: null,
          pdfError: pdfErr.message
        });
      }
    }
  }

  res.json({
    success: true,
    mode: req._cronAuthorized ? 'cron' : 'session',
    companiesProcessed: processedCompanies.length,
    generated: generated,
    errors: errors,
    message: 'Recurring invoices processed. ' + generated.length + ' generated, ' + errors.length + ' errors across ' + processedCompanies.length + ' companies.'
  });
}));

// ============================================================
// PLACEHOLDER: KANBAN DRAG-AND-DROP
//
// PUT /api/v2/dashboard/jobs/move
//
// FUTURE: Accepts { jobId, fromStatus, toStatus, newIndex }
// and reorders the job within the kanban board.  Currently a
// placeholder that returns a 501 Not Implemented response.
//
// When implemented, this endpoint will:
//   1. Validate the job belongs to the requesting company
//   2. Update the job's status column
//   3. Reorder sibling jobs' display_order values
//   4. Return the updated kanban column state
// ============================================================
router.put('/jobs/move', requireCompanyUser, asyncHandler(async (req, res) => {
  // Placeholder — replace with full implementation in the
  // Kanban Drag-and-Drop feature sprint.
  res.status(501).json({
    success: false,
    error: 'Kanban job move is not yet implemented. This endpoint is reserved for the upcoming drag-and-drop feature.'
  });
}));

// ============================================================
// PLACEHOLDER: CLIENT PORTAL LINKS
//
// GET /api/v2/dashboard/clients/:id/portal-link
//
// FUTURE: For recurring clients, generates a secure single-use
// portal link that grants time-limited access to the client's
// dashboard (invoices, documents, job status).  Currently a
// placeholder that returns a 501 Not Implemented response.
//
// When implemented, this endpoint will:
//   1. Verify the client belongs to the requesting company
//   2. Check client_type === 'recurring'
//   3. Generate a signed JWT or token with expiry
//   4. Store the token in a portal_sessions table
//   5. Return the portal URL
// ============================================================
router.get('/clients/:id/portal-link', requireCompanyUser, asyncHandler(async (req, res) => {
  // Placeholder — replace with full implementation in the
  // Client Portal feature sprint.
  res.status(501).json({
    success: false,
    error: 'Client portal links are not yet implemented. This endpoint is reserved for the upcoming client portal feature.'
  });
}));

module.exports = router;

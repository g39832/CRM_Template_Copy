const express = require('express');
const multer = require('multer');
const path = require('path');
const { getClient } = require('./db-v2');
const { asyncHandler, assertObject, parseStringField, AppError } = require('./request-utils');
const { resetCache, setAdminClaimed } = require('./admin-guard');

const router = express.Router();

// ============================================================
// Multer config — memory storage for logo upload
// ============================================================
var ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
var MAX_FILE_SIZE = 2 * 1024 * 1024;

var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE }
});

// ============================================================
// Middleware: require authenticated admin
// ============================================================
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  if (!req.session.user.companyId) {
    return res.status(400).json({ success: false, error: 'No company associated with this account' });
  }
  next();
}

async function deleteAllRows(supabase, table, sentinelField, sentinelValue) {
  var query = supabase.from(table).delete();
  if (sentinelField) {
    query = query.neq(sentinelField, sentinelValue);
  }
  return query;
}

// ============================================================
// GET /api/v2/admin/settings
// Returns company profile, branding, workflow, and features.
// ============================================================
router.get('/settings', requireAdmin, asyncHandler(async (req, res) => {
  var supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  var companyId = req.session.user.companyId;

  var { data: company, error: coErr } = await supabase
    .from('companies')
    .select('id, name, tagline, description, contact_email, logo_url, brand_primary_color, brand_secondary_color, business_workflow, onboarding_step')
    .eq('id', companyId)
    .maybeSingle();

  if (coErr) throw new AppError(500, 'Failed to load company: ' + coErr.message);

  var { data: components, error: compErr } = await supabase
    .from('company_components')
    .select('id, component_type, is_active, display_order, config')
    .eq('company_id', companyId)
    .order('display_order', { ascending: true });

  if (compErr) throw new AppError(500, 'Failed to load features: ' + compErr.message);

  res.json({
    success: true,
    data: {
      company: company || null,
      features: components || []
    }
  });
}));

// ============================================================
// PATCH /api/v2/admin/settings
// Atomically updates company (branding, workflow) and
// company_components (features).  Clears server-side cache.
// Body: { company: {...}, features: [...], logo?: file }
// ============================================================
router.patch('/settings', requireAdmin, (req, res, next) => {
  // Multer handles optional logo file + JSON fields in multipart
  upload.single('logo')(req, res, function (err) {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, error: 'File too large. Maximum size is 2 MB.' });
        }
        return res.status(400).json({ success: false, error: err.message });
      }
      return next(err);
    }
    next();
  });
}, asyncHandler(async (req, res) => {
  var supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  var companyId = req.session.user.companyId;

  // ---- Parse body fields from multipart or JSON ----
  var companyData = {};
  if (req.body.company) {
    try {
      companyData = typeof req.body.company === 'string' ? JSON.parse(req.body.company) : req.body.company;
    } catch (_) {
      throw new AppError(400, 'Invalid company data format');
    }
  } else {
    // Support flat fields as alternative
    if (req.body.companyName !== undefined) companyData.name = req.body.companyName;
    if (req.body.tagline !== undefined) companyData.tagline = req.body.tagline;
    if (req.body.description !== undefined) companyData.description = req.body.description;
    if (req.body.contactEmail !== undefined) companyData.contact_email = req.body.contactEmail;
    if (req.body.primaryColor !== undefined) companyData.brand_primary_color = req.body.primaryColor;
    if (req.body.secondaryColor !== undefined) companyData.brand_secondary_color = req.body.secondaryColor;
    if (req.body.workflow !== undefined) companyData.business_workflow = req.body.workflow;
  }

  var features = null;
  if (req.body.features) {
    try {
      features = typeof req.body.features === 'string' ? JSON.parse(req.body.features) : req.body.features;
    } catch (_) {
      throw new AppError(400, 'Invalid features format');
    }
    if (!Array.isArray(features)) {
      throw new AppError(400, 'features must be an array');
    }
  }

  // ---- Validate workflow if provided ----
  if (companyData.business_workflow) {
    var validWorkflows = ['single', 'returning', 'both'];
    if (validWorkflows.indexOf(companyData.business_workflow) === -1) {
      throw new AppError(400, 'Workflow must be one of: single, returning, both');
    }
  }

  // ---- Validate colors if provided ----
  var hexRegex = /^#[0-9A-Fa-f]{6}$/;
  if (companyData.brand_primary_color && !hexRegex.test(companyData.brand_primary_color)) {
    throw new AppError(400, 'Primary color must be a valid hex color (e.g., #2563eb)');
  }
  if (companyData.brand_secondary_color && !hexRegex.test(companyData.brand_secondary_color)) {
    throw new AppError(400, 'Secondary color must be a valid hex color');
  }

  // ---- Validate file (if provided) ----
  if (req.file && !ALLOWED_MIMES.includes(req.file.mimetype)) {
    throw new AppError(400, 'Invalid file type. Allowed: PNG, JPG, GIF, WebP, SVG.');
  }

  // ---- Upload logo to Supabase Storage (if provided) ----
  var logoUrl = null;
  if (req.file) {
    var ext = path.extname(req.file.originalname) || '.png';
    var objectPath = 'company-logos/' + companyId + ext;

    var { error: bucketError } = await supabase.storage.createBucket(
      process.env.SUPABASE_STORAGE_BUCKET || 'crm-files',
      { public: true }
    );
    if (bucketError && !/already exists/i.test(bucketError.message || '')) {
      throw new AppError(500, 'Failed to configure storage: ' + bucketError.message);
    }

    var { error: uploadError } = await supabase.storage
      .from(process.env.SUPABASE_STORAGE_BUCKET || 'crm-files')
      .upload(objectPath, req.file.buffer, {
        upsert: true,
        contentType: req.file.mimetype
      });

    if (uploadError) {
      throw new AppError(500, 'Failed to upload logo: ' + uploadError.message);
    }

    var { data: publicUrlData } = supabase.storage
      .from(process.env.SUPABASE_STORAGE_BUCKET || 'crm-files')
      .getPublicUrl(objectPath);

    logoUrl = publicUrlData.publicUrl || null;
  }

  // ---- Build company update object ----
  var updateData = {};
  if (companyData.name !== undefined) updateData.name = String(companyData.name).trim();
  if (companyData.tagline !== undefined) updateData.tagline = String(companyData.tagline).trim();
  if (companyData.description !== undefined) updateData.description = String(companyData.description).trim();
  if (companyData.contact_email !== undefined) updateData.contact_email = String(companyData.contact_email).trim().toLowerCase();
  if (companyData.brand_primary_color !== undefined) updateData.brand_primary_color = companyData.brand_primary_color;
  if (companyData.brand_secondary_color !== undefined) updateData.brand_secondary_color = companyData.brand_secondary_color;
  if (companyData.business_workflow !== undefined) updateData.business_workflow = companyData.business_workflow;
  if (logoUrl) updateData.logo_url = logoUrl;

  // ---- Validate email if contact_email is being updated ----
  if (updateData.contact_email) {
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(updateData.contact_email)) {
      throw new AppError(400, 'Invalid contact email format');
    }
  }

  // ---- Atomically update company ----
  if (Object.keys(updateData).length > 0) {
    updateData.updated_at = new Date().toISOString();

    // Refresh schema cache if business_workflow is being updated
    if (updateData.business_workflow) {
      try {
        await supabase.from('companies').select('business_workflow').limit(0);
      } catch (_) {}
    }

    var { error: upErr } = await supabase
      .from('companies')
      .update(updateData)
      .eq('id', companyId);

    if (upErr) throw new AppError(500, 'Failed to update company: ' + upErr.message);
  }

  // ---- Replace features if provided ----
  if (features !== null) {
    var allowedTypes = require('../components/index').getAvailableTypes();

    var featureRows = features.map(function (f, i) {
      var type = (f.component_type || '').trim();
      if (!type) throw new AppError(400, 'Feature at index ' + i + ' is missing component_type');
      if (allowedTypes.indexOf(type) === -1) {
        throw new AppError(400, 'Invalid component_type "' + type + '" at index ' + i);
      }
      return {
        company_id: companyId,
        component_type: type,
        is_active: f.is_active !== false,
        display_order: typeof f.display_order === 'number' ? f.display_order : i,
        config: (f.config && typeof f.config === 'object') ? f.config : {}
      };
    });

    var { error: delErr } = await supabase
      .from('company_components')
      .delete()
      .eq('company_id', companyId);

    if (delErr) throw new AppError(500, 'Failed to replace features: ' + delErr.message);

    if (featureRows.length > 0) {
      var { error: insErr } = await supabase
        .from('company_components')
        .insert(featureRows);

      if (insErr) throw new AppError(500, 'Failed to save features: ' + insErr.message);
    }
  }

  // ---- Update session with new workflow ----
  if (companyData.business_workflow) {
    req.session.user.workflow = companyData.business_workflow;
  }

  res.json({
    success: true,
    message: 'Settings saved',
    logoUrl: logoUrl
  });
}));

// ============================================================
// POST /api/v2/admin/reset-demo
// Wipes the demo onboarding data so the app can be shown from a
// clean first-run state again. Intended for client demos.
// ============================================================
router.post('/reset-demo', requireAdmin, asyncHandler(async (req, res) => {
  var confirm = String((req.body && req.body.confirm) || '').trim().toLowerCase();
  if (confirm !== 'reset demo') {
    throw new AppError(400, 'Type RESET DEMO to confirm the reset.');
  }

  var supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  // Clear the onboarding tenant data in a safe order.
  var deleteSteps = [
    { table: 'company_components', field: 'id', value: 0, label: 'company components' },
    { table: 'email_templates', field: 'id', value: '00000000-0000-0000-0000-000000000000', label: 'email templates' },
    { table: 'activity_log', field: 'id', value: '00000000-0000-0000-0000-000000000000', label: 'activity log' },
    { table: 'users', field: 'id', value: '00000000-0000-0000-0000-000000000000', label: 'users' },
    { table: 'companies', field: 'id', value: '00000000-0000-0000-0000-000000000000', label: 'companies' }
  ];

  for (var i = 0; i < deleteSteps.length; i++) {
    var step = deleteSteps[i];
    var result = await deleteAllRows(supabase, step.table, step.field, step.value);
    if (result.error && !/does not exist/i.test(result.error.message || '')) {
      throw new AppError(500, 'Failed to clear ' + step.label + ': ' + result.error.message);
    }
  }

  await setAdminClaimed(false);
  resetCache();

  if (req.session) {
    req.session.destroy(function () {
      res.json({
        success: true,
        message: 'Demo state reset. The next visitor will see the first-run setup again.'
      });
    });
    return;
  }

  res.json({
    success: true,
    message: 'Demo state reset. The next visitor will see the first-run setup again.'
  });
}));

module.exports = router;

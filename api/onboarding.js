const express = require('express');
const multer = require('multer');
const path = require('path');
const { getClient } = require('./db-v2');
const { asyncHandler, assertObject, parseStringField, AppError } = require('./request-utils');

const router = express.Router();

// ============================================================
// Multer config — memory storage for logo upload (Step 2)
// ============================================================
const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE }
});

// ============================================================
// Middleware: require authenticated admin with a company
// ============================================================
function requireOnboardingAdmin(req, res, next) {
  if (!req.session.user) {
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

// ============================================================
// GET /api/v2/onboarding/status
// Returns the current onboarding progress for the admin.
// Reads the canonical step from the database row.
// ============================================================
router.get('/status', requireOnboardingAdmin, asyncHandler(async (req, res) => {
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  const { data: company } = await supabase
    .from('companies')
    .select('name, tagline, description, contact_email, logo_url, brand_primary_color, brand_secondary_color, onboarding_step')
    .eq('id', req.session.user.companyId)
    .maybeSingle();

  const step = company ? (company.onboarding_step || 0) : 0;

  res.json({
    success: true,
    onboardingComplete: req.session.user.onboardingComplete,
    step,
    company: company || null
  });
}));

// ============================================================
// POST /api/v2/onboarding/company-profile  —  Step 1
//
// Validates and saves the company name, tagline, description,
// and contact email to the companies table. Also persists
// onboarding_step = 1 so progress survives server restarts.
// ============================================================
router.post('/company-profile', requireOnboardingAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);

  const companyName = parseStringField(req.body.companyName, 'companyName', { minLength: 1, maxLength: 200 });
  const tagline = parseStringField(req.body.tagline, 'tagline', { required: false, defaultValue: '', maxLength: 300 });
  const description = parseStringField(req.body.description, 'description', { required: false, defaultValue: '', maxLength: 5000 });
  const contactEmail = parseStringField(req.body.contactEmail, 'contactEmail', { minLength: 1, maxLength: 254 }).toLowerCase();

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(contactEmail)) {
    throw new AppError(400, 'Invalid contact email format');
  }

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  const { data: company, error } = await supabase
    .from('companies')
    .update({
      name: companyName,
      tagline,
      description,
      contact_email: contactEmail,
      onboarding_step: 1,
      updated_at: new Date().toISOString()
    })
    .eq('id', req.session.user.companyId)
    .select()
    .single();

  if (error) {
    throw new AppError(500, 'Failed to save company profile');
  }

  req.session.user.companyName = companyName;
  req.session.user.companyEmail = contactEmail;
  req.session.user.onboardingStep = 1;

  res.json({
    success: true,
    message: 'Company profile saved',
    company: {
      id: company.id,
      name: company.name,
      tagline: company.tagline,
      description: company.description,
      contactEmail: company.contact_email
    }
  });
}));

// ============================================================
// POST /api/v2/onboarding/branding  —  (reserved for future use)
//
// Branding / logo upload is not part of the current 4-step flow.
// This handler is kept for backward compatibility.
// ============================================================
router.post('/branding', requireOnboardingAdmin, function (req, res, next) {
  // Wrap multer manually so we can return clean JSON on size/error
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
  // ---- Validate fields ----
  const primaryColor = parseStringField(req.body.primaryColor, 'primaryColor', { minLength: 7, maxLength: 7 });
  const secondaryColor = parseStringField(req.body.secondaryColor, 'secondaryColor', { minLength: 7, maxLength: 7 });

  const hexRegex = /^#[0-9A-Fa-f]{6}$/;
  if (!hexRegex.test(primaryColor)) {
    throw new AppError(400, 'Primary color must be a valid hex color (e.g., #2563eb)');
  }
  if (!hexRegex.test(secondaryColor)) {
    throw new AppError(400, 'Secondary color must be a valid hex color');
  }

  // ---- Validate file (if provided) ----
  if (req.file && !ALLOWED_MIMES.includes(req.file.mimetype)) {
    throw new AppError(400, 'Invalid file type. Allowed: PNG, JPG, GIF, WebP, SVG.');
  }

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  let logoUrl = '';

  // ---- Upload logo to Supabase Storage ----
  if (req.file) {
    const ext = path.extname(req.file.originalname) || '.png';
    const objectPath = 'company-logos/' + req.session.user.companyId + ext;

    // Ensure the bucket exists and is public so the logo is accessible
    const { error: bucketError } = await supabase.storage.createBucket(
      process.env.SUPABASE_STORAGE_BUCKET || 'crm-files',
      { public: true }
    );
    if (bucketError && !/already exists/i.test(bucketError.message || '')) {
      throw new AppError(500, 'Failed to configure storage: ' + bucketError.message);
    }

    const { error: uploadError } = await supabase.storage
      .from(process.env.SUPABASE_STORAGE_BUCKET || 'crm-files')
      .upload(objectPath, req.file.buffer, {
        upsert: true,
        contentType: req.file.mimetype
      });

    if (uploadError) {
      throw new AppError(500, 'Failed to upload logo: ' + uploadError.message);
    }

    const { data: publicUrlData } = supabase.storage
      .from(process.env.SUPABASE_STORAGE_BUCKET || 'crm-files')
      .getPublicUrl(objectPath);

    logoUrl = publicUrlData.publicUrl || '';
  }

  // ---- Update company record ----
  const updateData = {
    brand_primary_color: primaryColor,
    brand_secondary_color: secondaryColor,
    onboarding_step: 2,
    updated_at: new Date().toISOString()
  };
  if (logoUrl) {
    updateData.logo_url = logoUrl;
  }

  const { error: updateError } = await supabase
    .from('companies')
    .update(updateData)
    .eq('id', req.session.user.companyId);

  if (updateError) {
    throw new AppError(500, 'Failed to save branding: ' + updateError.message);
  }

  req.session.user.onboardingStep = 2;
  req.session.user.logoUrl = logoUrl;

  res.json({
    success: true,
    message: 'Branding saved',
    logoUrl: logoUrl || null,
    primaryColor: primaryColor,
    secondaryColor: secondaryColor
  });
}));

// ============================================================
// POST /api/v2/onboarding/workflow  —  Step 2
//
// Accepts a workflow selection ('single', 'returning', or 'both')
// and saves it to the companies.business_workflow column.
// Advances onboarding_step to 2.
//
// NOTE: If you see "Could not find the 'business_workflow' column",
// run the SQL migration first, then in Supabase SQL Editor execute:
//   NOTIFY pgrst, 'reload schema';
// This forces the schema cache to pick up the new column.
// ============================================================
router.post('/workflow', requireOnboardingAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);

  var workflow = (req.body.workflow || '').trim().toLowerCase();
  var validWorkflows = ['single', 'returning', 'both'];
  if (validWorkflows.indexOf(workflow) === -1) {
    throw new AppError(400, 'Workflow must be one of: single, returning, both');
  }

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  // ---- Schema cache refresh ---------------------------------
  // On freshly migrated databases, the Supabase schema cache may
  // not yet know about the business_workflow column.  Issuing a
  // benign SELECT forces the cache to re-sync.
  try {
    await supabase.from('companies').select('business_workflow').limit(0);
  } catch (_) {
    // If this fails, the column truly doesn't exist — the UPDATE
    // below will also fail with a clear error message.
  }
  // -----------------------------------------------------------

  var { error } = await supabase
    .from('companies')
    .update({
      business_workflow: workflow,
      onboarding_step: 2,
      updated_at: new Date().toISOString()
    })
    .eq('id', req.session.user.companyId);

  if (error) {
    throw new AppError(500, 'Failed to save workflow: ' + error.message);
  }

  req.session.user.workflow = workflow;
  req.session.user.onboardingStep = 2;

  res.json({
    success: true,
    message: 'Workflow saved',
    workflow: workflow
  });
}));

// ============================================================
// GET /api/v2/onboarding/features
// Returns all feature components for the admin's company.
// ============================================================
router.get('/features', requireOnboardingAdmin, asyncHandler(async (req, res) => {
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  var { data: components, error } = await supabase
    .from('company_components')
    .select('id, component_type, is_active, display_order, config')
    .eq('company_id', req.session.user.companyId)
    .order('display_order', { ascending: true });

  if (error) throw new AppError(500, 'Failed to load features: ' + error.message);

  // If no components exist yet, return the defaults
  if (!components || components.length === 0) {
    const { DEFAULT_FEATURES } = require('../components/index');
    return res.json({ success: true, features: DEFAULT_FEATURES, isDefault: true });
  }

  res.json({ success: true, features: components, isDefault: false });
}));

// ============================================================
// POST /api/v2/onboarding/features  —  Step 3
//
// Replaces ALL existing company_components with the submitted
// list, then advances onboarding_step to 3 and marks the
// company as complete.
//
// Body: { features: [{ component_type, is_active, display_order, config }] }
// ============================================================
router.post('/features', requireOnboardingAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);

  if (!Array.isArray(req.body.features)) {
    throw new AppError(400, 'features must be an array');
  }

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  const companyId = req.session.user.companyId;

  // ---- Validate each feature ----
  const allowedTypes = require('../components/index').getAvailableTypes();
  var features = req.body.features.map(function (f, i) {
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

  // ---- Replace all components in a transaction-like batch ----
  // 1. Delete existing
  var { error: delErr } = await supabase
    .from('company_components')
    .delete()
    .eq('company_id', companyId);

  if (delErr) throw new AppError(500, 'Failed to replace features: ' + delErr.message);

  // 2. Insert new
  if (features.length > 0) {
    var { error: insErr } = await supabase
      .from('company_components')
      .insert(features);

    if (insErr) throw new AppError(500, 'Failed to save features: ' + insErr.message);
  }

  // ---- Advance onboarding step ----
  var { error: upErr } = await supabase
    .from('companies')
    .update({
      onboarding_step: 3,
      updated_at: new Date().toISOString()
    })
    .eq('id', companyId);

  if (upErr) {
    // Non-fatal — features are already saved
    console.error('[onboarding] Failed to advance step:', upErr.message);
  }

  req.session.user.onboardingStep = 3;
  req.session.user.onboardingComplete = true;

  res.json({
    success: true,
    message: 'Features saved. Onboarding complete!',
    featuresCount: features.length
  });
}));

module.exports = router;
module.exports.requireOnboardingAdmin = requireOnboardingAdmin;

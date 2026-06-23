const express = require('express');
const { requireClient } = require('./db-v2');
const { asyncHandler, assertObject, parseIntField, parseStringField, AppError } = require('./request-utils');

const router = express.Router();

function requireScopesAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  if (!req.session.user.companyId) {
    return res.status(400).json({ success: false, error: 'No company associated with this account' });
  }
  next();
}

// ============================================================
// GET /api/v2/scopes/health
// ============================================================
router.get('/health', asyncHandler(async (req, res) => {
  const supabase = requireClient();
  var { error } = await supabase
    .from('scopes_of_work')
    .select('id')
    .limit(1);
  if (error && !error.message.toLowerCase().includes('does not exist')) {
    throw new AppError(503, 'Database connectivity check failed: ' + error.message);
  }
  res.json({
    success: true,
    status: 'ok',
    databaseReachable: true,
    timestamp: new Date().toISOString()
  });
}));

// ============================================================
// POST /api/v2/scopes
// ============================================================
router.post('/', requireScopesAuth, asyncHandler(async (req, res) => {
  assertObject(req.body);
  var name = parseStringField(req.body.name, 'name', { minLength: 1, maxLength: 200 });
  var description = parseStringField(req.body.description ?? '', 'description', { required: false, maxLength: 5000, defaultValue: '' });
  var lineItems = req.body.lineItems || req.body.line_items || [];
  if (!Array.isArray(lineItems)) throw new AppError(400, 'lineItems must be an array');
  var isDefault = req.body.isDefault === true || req.body.is_default === true;

  const supabase = requireClient();

  if (isDefault) {
    await supabase
      .from('scopes_of_work')
      .update({ is_default: false })
      .eq('company_id', req.session.user.companyId)
      .eq('is_default', true);
  }

  var { data: scope, error } = await supabase
    .from('scopes_of_work')
    .insert({
      company_id: req.session.user.companyId,
      name: name,
      description: description,
      line_items: lineItems,
      is_default: isDefault
    })
    .select()
    .single();

  if (error) throw new AppError(500, 'Failed to create scope: ' + error.message);

  res.json({
    success: true,
    scope: {
      id: scope.id,
      name: scope.name,
      description: scope.description,
      lineItems: scope.line_items,
      isDefault: scope.is_default,
      createdAt: scope.created_at
    }
  });
}));

// ============================================================
// GET /api/v2/scopes
// ============================================================
router.get('/', requireScopesAuth, asyncHandler(async (req, res) => {
  const supabase = requireClient();
  var { data: scopes, error } = await supabase
    .from('scopes_of_work')
    .select('*')
    .eq('company_id', req.session.user.companyId)
    .order('name', { ascending: true });

  if (error) throw new AppError(500, 'Failed to fetch scopes: ' + error.message);

  res.json({
    success: true,
    scopes: (scopes || []).map(function (s) {
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        lineItems: s.line_items,
        isDefault: s.is_default,
        createdAt: s.created_at,
        updatedAt: s.updated_at
      };
    })
  });
}));

// ============================================================
// GET /api/v2/scopes/:id
// ============================================================
router.get('/:id', requireScopesAuth, asyncHandler(async (req, res) => {
  var scopeId = req.params.id;
  const supabase = requireClient();

  var { data: scope, error } = await supabase
    .from('scopes_of_work')
    .select('*')
    .eq('id', scopeId)
    .eq('company_id', req.session.user.companyId)
    .maybeSingle();

  if (error) throw new AppError(500, 'Failed to fetch scope: ' + error.message);
  if (!scope) throw new AppError(404, 'Scope not found');

  res.json({
    success: true,
    scope: {
      id: scope.id,
      name: scope.name,
      description: scope.description,
      lineItems: scope.line_items,
      isDefault: scope.is_default,
      createdAt: scope.created_at,
      updatedAt: scope.updated_at
    }
  });
}));

// ============================================================
// PUT /api/v2/scopes/:id
// ============================================================
router.put('/:id', requireScopesAuth, asyncHandler(async (req, res) => {
  assertObject(req.body);
  var scopeId = req.params.id;
  const supabase = requireClient();

  var { data: existing, error: fetchErr } = await supabase
    .from('scopes_of_work')
    .select('id')
    .eq('id', scopeId)
    .eq('company_id', req.session.user.companyId)
    .maybeSingle();

  if (fetchErr) throw new AppError(500, 'Failed to fetch scope: ' + fetchErr.message);
  if (!existing) throw new AppError(404, 'Scope not found');

  var updates = {};
  if (req.body.name !== undefined) updates.name = parseStringField(req.body.name, 'name', { maxLength: 200 });
  if (req.body.description !== undefined) updates.description = parseStringField(req.body.description ?? '', 'description', { required: false, maxLength: 5000, defaultValue: '' });
  if (req.body.lineItems !== undefined || req.body.line_items !== undefined) {
    var li = req.body.lineItems || req.body.line_items;
    if (!Array.isArray(li)) throw new AppError(400, 'lineItems must be an array');
    updates.line_items = li;
  }
  if (req.body.isDefault !== undefined || req.body.is_default !== undefined) {
    var makeDefault = req.body.isDefault === true || req.body.is_default === true;
    if (makeDefault) {
      await supabase
        .from('scopes_of_work')
        .update({ is_default: false })
        .eq('company_id', req.session.user.companyId)
        .eq('is_default', true)
        .neq('id', scopeId);
    }
    updates.is_default = makeDefault;
  }
  updates.updated_at = new Date().toISOString();

  var { data: updated, error: updateErr } = await supabase
    .from('scopes_of_work')
    .update(updates)
    .eq('id', scopeId)
    .select()
    .single();

  if (updateErr) throw new AppError(500, 'Failed to update scope: ' + updateErr.message);

  res.json({
    success: true,
    scope: {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      lineItems: updated.line_items,
      isDefault: updated.is_default,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at
    }
  });
}));

// ============================================================
// DELETE /api/v2/scopes/:id
// ============================================================
router.delete('/:id', requireScopesAuth, asyncHandler(async (req, res) => {
  var scopeId = req.params.id;
  const supabase = requireClient();

  var { data: existing, error: fetchErr } = await supabase
    .from('scopes_of_work')
    .select('id')
    .eq('id', scopeId)
    .eq('company_id', req.session.user.companyId)
    .maybeSingle();

  if (fetchErr) throw new AppError(500, 'Failed to fetch scope: ' + fetchErr.message);
  if (!existing) throw new AppError(404, 'Scope not found');

  var { error: delErr } = await supabase
    .from('scopes_of_work')
    .delete()
    .eq('id', scopeId);

  if (delErr) throw new AppError(500, 'Failed to delete scope: ' + delErr.message);

  res.json({ success: true });
}));

module.exports = router;

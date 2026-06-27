const express = require('express');
const { requireClient } = require('./db-v2');
const { asyncHandler, assertObject, parseIntField, parseStringField, parseNumberField, AppError } = require('./request-utils');

const router = express.Router();

function isMissingTableError(err) {
  var msg = String(err?.message || '').toLowerCase();
  var code = String(err?.code || '').toUpperCase();
  return msg.includes('does not exist') || msg.includes('relation') || code === '42P01';
}

function tryQuery(supabase, table, queryFn) {
  return queryFn().catch(function (err) {
    if (isMissingTableError(err)) {
      return { data: [], error: null };
    }
    throw err;
  });
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  if (!req.session.user.companyId) {
    return res.status(400).json({ success: false, error: 'No company associated' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  if (!req.session.user.companyId) {
    return res.status(400).json({ success: false, error: 'No company associated' });
  }
  next();
}

// ======================================================
// SERVICE PRESETS CRUD (Admin only for write)
// ======================================================

// GET /api/v2/services — List all active presets for the company
router.get('/services', requireAuth, asyncHandler(async (req, res) => {
  const supabase = requireClient();
  const companyId = req.session.user.companyId;
  const includeInactive = req.query.all === 'true' && req.session.user.role === 'admin';

  let query = supabase
    .from('services')
    .select('*')
    .eq('company_id', companyId)
    .order('name', { ascending: true });

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) {
      return res.json({ success: true, services: [] });
    }
    throw new AppError(500, 'Failed to fetch services: ' + error.message);
  }

  res.json({
    success: true,
    services: (data || []).map(function (s) {
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        defaultRate: Number(s.default_rate || 0),
        isActive: s.is_active,
        createdAt: s.created_at,
        updatedAt: s.updated_at
      };
    })
  });
}));

// POST /api/v2/services — Create a service preset (admin only)
router.post('/services', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const name = parseStringField(req.body.name, 'name', { minLength: 1, maxLength: 200 });
  const description = parseStringField(req.body.description ?? '', 'description', { required: false, maxLength: 2000, defaultValue: '' });
  const defaultRate = parseNumberField(req.body.defaultRate ?? req.body.default_rate ?? 0, 'defaultRate', { required: false, defaultValue: 0 });

  const supabase = requireClient();
  const { data, error } = await supabase
    .from('services')
    .insert({
      company_id: req.session.user.companyId,
      name: name,
      description: description,
      default_rate: defaultRate
    })
    .select()
    .single();

  if (error) throw new AppError(500, 'Failed to create service: ' + error.message);

  res.json({
    success: true,
    service: {
      id: data.id,
      name: data.name,
      description: data.description,
      defaultRate: Number(data.default_rate || 0),
      isActive: data.is_active,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    }
  });
}));

// PUT /api/v2/services/:id — Update a service preset (admin only)
router.put('/services/:id', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const serviceId = parseIntField(req.params.id, 'id', { min: 1 });
  const supabase = requireClient();
  const companyId = req.session.user.companyId;

  const { data: existing, error: fetchErr } = await supabase
    .from('services')
    .select('id')
    .eq('id', serviceId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (fetchErr) throw new AppError(500, 'Failed to fetch service: ' + fetchErr.message);
  if (!existing) throw new AppError(404, 'Service not found');

  var updates = {};
  if (req.body.name !== undefined) updates.name = parseStringField(req.body.name, 'name', { maxLength: 200 });
  if (req.body.description !== undefined) updates.description = parseStringField(req.body.description ?? '', 'description', { required: false, maxLength: 2000, defaultValue: '' });
  if (req.body.defaultRate !== undefined || req.body.default_rate !== undefined) {
    updates.default_rate = parseNumberField(req.body.defaultRate ?? req.body.default_rate, 'defaultRate', { required: false, defaultValue: 0 });
  }
  if (req.body.isActive !== undefined || req.body.is_active !== undefined) {
    updates.is_active = req.body.isActive === true || req.body.is_active === true;
  }
  updates.updated_at = new Date().toISOString();

  const { data: updated, error: updateErr } = await supabase
    .from('services')
    .update(updates)
    .eq('id', serviceId)
    .select()
    .single();

  if (updateErr) throw new AppError(500, 'Failed to update service: ' + updateErr.message);

  res.json({
    success: true,
    service: {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      defaultRate: Number(updated.default_rate || 0),
      isActive: updated.is_active,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at
    }
  });
}));

// DELETE /api/v2/services/:id — Remove a service preset (admin only)
router.delete('/services/:id', requireAdmin, asyncHandler(async (req, res) => {
  const serviceId = parseIntField(req.params.id, 'id', { min: 1 });
  const supabase = requireClient();
  const companyId = req.session.user.companyId;

  const { data: existing, error: fetchErr } = await supabase
    .from('services')
    .select('id')
    .eq('id', serviceId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (fetchErr) throw new AppError(500, 'Failed to fetch service: ' + fetchErr.message);
  if (!existing) throw new AppError(404, 'Service not found');

  const { error: delErr } = await supabase
    .from('services')
    .delete()
    .eq('id', serviceId);

  if (delErr) throw new AppError(500, 'Failed to delete service: ' + delErr.message);

  res.json({ success: true });
}));

// ======================================================
// CLIENT-SERVICE ASSIGNMENTS
// ======================================================

// GET /api/v2/clients/:clientId/services — List services assigned to a client
router.get('/clients/:clientId/services', requireAuth, asyncHandler(async (req, res) => {
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const supabase = requireClient();

  const { data, error } = await supabase
    .from('client_service')
    .select('*, services(name, description, default_rate)')
    .eq('client_id', clientId)
    .order('sort_order', { ascending: true });

  if (error) {
    if (isMissingTableError(error)) {
      return res.json({ success: true, assignments: [] });
    }
    throw new AppError(500, 'Failed to fetch client services: ' + error.message);
  }

  res.json({
    success: true,
    assignments: (data || []).map(function (cs) {
      return {
        id: cs.id,
        clientId: cs.client_id,
        serviceId: cs.service_id,
        serviceName: cs.services?.name || '',
        serviceDescription: cs.services?.description || '',
        defaultRate: Number(cs.services?.default_rate || 0),
        customRate: cs.custom_rate !== null ? Number(cs.custom_rate) : null,
        notes: cs.notes || '',
        sortOrder: cs.sort_order,
        createdAt: cs.created_at
      };
    })
  });
}));

// POST /api/v2/clients/:clientId/services — Assign services to a client
router.post('/clients/:clientId/services', requireAuth, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const serviceIds = req.body.serviceIds || req.body.service_ids || [];

  if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
    throw new AppError(400, 'serviceIds must be a non-empty array');
  }

  const supabase = requireClient();

  // Verify all services exist and belong to the same company
  const { data: validServices, error: svcErr } = await supabase
    .from('services')
    .select('id')
    .in('id', serviceIds)
    .eq('company_id', req.session.user.companyId);

  if (svcErr) throw new AppError(500, 'Failed to verify services: ' + svcErr.message);
  if (!validServices || validServices.length !== serviceIds.length) {
    throw new AppError(400, 'One or more services are invalid or do not belong to your company');
  }

  // Determine next sort_order
  const { data: existing } = await supabase
    .from('client_service')
    .select('sort_order')
    .eq('client_id', clientId)
    .order('sort_order', { ascending: false })
    .limit(1);

  var nextOrder = (existing && existing.length > 0) ? (existing[0].sort_order + 1) : 0;

  const insertData = serviceIds.filter(Boolean).map(function (sid, idx) {
    return {
      client_id: clientId,
      service_id: sid,
      sort_order: nextOrder + idx
    };
  });

  const { data: inserted, error: insErr } = await supabase
    .from('client_service')
    .insert(insertData)
    .select('*, services(name, description, default_rate)');

  if (insErr) throw new AppError(500, 'Failed to assign services: ' + insErr.message);

  res.json({
    success: true,
    assignments: (inserted || []).map(function (cs) {
      return {
        id: cs.id,
        clientId: cs.client_id,
        serviceId: cs.service_id,
        serviceName: cs.services?.name || '',
        serviceDescription: cs.services?.description || '',
        defaultRate: Number(cs.services?.default_rate || 0),
        customRate: cs.custom_rate !== null ? Number(cs.custom_rate) : null,
        notes: cs.notes || '',
        sortOrder: cs.sort_order,
        createdAt: cs.created_at
      };
    })
  });
}));

// DELETE /api/v2/clients/:clientId/services/:assignmentId — Remove a service from a client
router.delete('/clients/:clientId/services/:assignmentId', requireAuth, asyncHandler(async (req, res) => {
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const assignmentId = parseIntField(req.params.assignmentId, 'assignmentId', { min: 1 });
  const supabase = requireClient();

  const { data: existing, error: fetchErr } = await supabase
    .from('client_service')
    .select('id')
    .eq('id', assignmentId)
    .eq('client_id', clientId)
    .maybeSingle();

  if (fetchErr) throw new AppError(500, 'Failed to fetch assignment: ' + fetchErr.message);
  if (!existing) throw new AppError(404, 'Assignment not found');

  const { error: delErr } = await supabase
    .from('client_service')
    .delete()
    .eq('id', assignmentId);

  if (delErr) throw new AppError(500, 'Failed to remove service: ' + delErr.message);

  res.json({ success: true });
}));

// PUT /api/v2/clients/:clientId/services/reorder — Reorder assigned services
router.put('/clients/:clientId/services/reorder', requireAuth, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  var order = req.body.order;
  if (!Array.isArray(order)) throw new AppError(400, 'order must be an array of {id, sortOrder}');

  const supabase = requireClient();

  for (var i = 0; i < order.length; i++) {
    var item = order[i];
    var assignmentId = parseIntField(item.id, 'order[' + i + '].id', { min: 1 });
    var sortOrder = parseIntField(item.sortOrder || item.sort_order || i, 'order[' + i + '].sortOrder', { min: 0 });
    await supabase
      .from('client_service')
      .update({ sort_order: sortOrder })
      .eq('id', assignmentId)
      .eq('client_id', clientId);
  }

  res.json({ success: true });
}));

// ======================================================
// CASH AGGREGATE: total amount_paid across all client jobs
// ======================================================

// GET /api/v2/clients/:clientId/cash-aggregate
router.get('/clients/:clientId/cash-aggregate', requireAuth, asyncHandler(async (req, res) => {
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const supabase = requireClient();

  const { data, error } = await supabase
    .from('jobs')
    .select('amount_paid')
    .eq('client_id', clientId);

  if (error) {
    if (isMissingTableError(error)) {
      return res.json({ success: true, clientId: clientId, totalCashCollected: 0, jobCount: 0 });
    }
    throw new AppError(500, 'Failed to aggregate cash: ' + error.message);
  }

  var total = (data || []).reduce(function (sum, row) {
    return sum + Number(row.amount_paid || 0);
  }, 0);

  res.json({
    success: true,
    clientId: clientId,
    totalCashCollected: Math.round(total * 100) / 100,
    jobCount: (data || []).length
  });
}));

module.exports = router;

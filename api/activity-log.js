const express = require('express');
const { getClient } = require('./db-v2');
const { asyncHandler, AppError, assertObject } = require('./request-utils');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });
  next();
}

async function logActivity(companyId, userId, action, entityType, entityId, details) {
  try {
    const supabase = getClient();
    if (!supabase) return;
    await supabase.from('activity_log').insert({
      company_id: companyId,
      user_id: userId,
      action: String(action).slice(0, 100),
      entity_type: String(entityType).slice(0, 50),
      entity_id: entityId ? String(entityId).slice(0, 100) : null,
      details: details ? JSON.stringify(details) : null
    });
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}

router.get('/activity-log', requireAdmin, asyncHandler(async (req, res) => {
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  var page = Math.max(1, Number(req.query.page) || 1);
  var limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  var offset = (page - 1) * limit;

  var query = supabase
    .from('activity_log')
    .select('*', { count: 'exact' })
    .eq('company_id', req.session.user.companyId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  var actionFilter = req.query.action;
  if (actionFilter) query = query.eq('action', actionFilter);

  var entityFilter = req.query.entity_type;
  if (entityFilter) query = query.eq('entity_type', entityFilter);

  var { data, count, error } = await query;
  if (error) throw new AppError(500, 'Failed to fetch activity log');

  res.json({ success: true, data: data || [], total: count || 0, page: page, limit: limit });
}));

router.get('/activity-log/actions', requireAdmin, asyncHandler(async (req, res) => {
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  var { data, error } = await supabase
    .from('activity_log')
    .select('action')
    .eq('company_id', req.session.user.companyId)
    .order('action', { ascending: true });

  if (error) throw new AppError(500, 'Failed to fetch actions');

  var unique = [...new Set((data || []).map(function (r) { return r.action; }).filter(Boolean))];
  res.json({ success: true, data: unique });
}));

module.exports = { router, logActivity };

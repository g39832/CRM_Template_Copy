const express = require('express');
const bcrypt = require('bcryptjs');
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

router.get('/users', requireAdmin, asyncHandler(async (req, res) => {
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  var { data, error } = await supabase
    .from('users')
    .select('id, email, display_name, role, created_at, updated_at')
    .eq('company_id', req.session.user.companyId)
    .order('created_at', { ascending: true });

  if (error) throw new AppError(500, 'Failed to fetch users');
  res.json({ success: true, data: data || [] });
}));

router.post('/users', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  var email = parseStringField(req.body.email, 'email', { maxLength: 255 }).toLowerCase();
  var password = parseStringField(req.body.password, 'password', { minLength: 6, maxLength: 128 });
  var displayName = parseStringField(req.body.displayName || req.body.display_name || '', 'displayName', { required: false, maxLength: 100, defaultValue: '' });
  var role = 'user';
  if (req.body.role === 'admin') {
    throw new AppError(400, 'Only one admin account is allowed per company. Create a user account instead.');
  }

  var passwordHash = bcrypt.hashSync(password, 10);

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  var { data, error } = await supabase
    .from('users')
    .insert({
      email: email,
      password_hash: passwordHash,
      display_name: displayName,
      role: role,
      company_id: req.session.user.companyId,
      onboarding_complete: true
    })
    .select('id, email, display_name, role, created_at')
    .single();

  if (error) {
    if (error.code === '23505') throw new AppError(409, 'A user with this email already exists');
    throw new AppError(500, 'Failed to create user: ' + error.message);
  }

  await logActivity(req.session.user.companyId, req.session.user.id, 'Created user', 'user', data.id, { email: email, role: role });
  res.json({ success: true, data: data });
}));

router.put('/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  var id = parseIntField(req.params.id, 'id', { min: 1 });

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  var updates = {};
  if (req.body.displayName || req.body.display_name) {
    updates.display_name = parseStringField(req.body.displayName || req.body.display_name, 'displayName', { required: false, maxLength: 100, defaultValue: '' });
  }
  if (req.body.role) {
    if (req.body.role === 'admin') {
      throw new AppError(400, 'Only one admin account is allowed per company.');
    }
    updates.role = 'user';
  }
  if (req.body.password) {
    updates.password_hash = bcrypt.hashSync(parseStringField(req.body.password, 'password', { minLength: 6, maxLength: 128 }), 10);
  }

  if (Object.keys(updates).length === 0) {
    throw new AppError(400, 'No fields to update');
  }

  var { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', id)
    .eq('company_id', req.session.user.companyId)
    .select('id, email, display_name, role, created_at')
    .single();

  if (error) {
    if (error.code === '23505') throw new AppError(409, 'Email already in use');
    throw new AppError(500, 'Failed to update user: ' + error.message);
  }
  if (!data) throw new AppError(404, 'User not found');

  await logActivity(req.session.user.companyId, req.session.user.id, 'Updated user', 'user', data.id, Object.keys(updates));
  res.json({ success: true, data: data });
}));

router.delete('/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  var id = parseIntField(req.params.id, 'id', { min: 1 });

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  var { data: existing } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', id)
    .eq('company_id', req.session.user.companyId)
    .single();

  if (!existing) throw new AppError(404, 'User not found');
  if (existing.role === 'admin') throw new AppError(400, 'Cannot delete the admin user');

  var { error } = await supabase
    .from('users')
    .delete()
    .eq('id', id)
    .eq('company_id', req.session.user.companyId);

  if (error) throw new AppError(500, 'Failed to delete user: ' + error.message);

  await logActivity(req.session.user.companyId, req.session.user.id, 'Deleted user', 'user', id, {});
  res.json({ success: true });
}));

router.get('/users/permissions', asyncHandler(async (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
  res.json({
    success: true,
    data: {
      role: req.session.user.role || 'user',
      isAdmin: req.session.user.role === 'admin',
      companyId: req.session.user.companyId,
      onboardingComplete: req.session.user.onboardingComplete || false
    }
  });
}));

module.exports = router;

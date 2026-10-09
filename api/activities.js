// api/activities.js
//
// Calendar activities (v11): customer-process appointments and reminders —
// "Send quote", "Meet insurance adjuster 9:30 AM", "Contract signing
// 6:45 PM", "Take measurements" — that happen BEFORE (or alongside) the
// actual work. They are deliberately NOT jobs: creating one never schedules
// work, approves a job or changes any money. The Calendar shows them apart
// from scheduled jobs (time + reminder style instead of a work bar).
//
// Each activity belongs to one client and, optionally, one job of that same
// client (the database enforces this too: calendar_activities has a foreign
// key on (job_id, client_id) → jobs(id, client_id)). The client never
// changes after creation; the linked job can be changed or removed.
//
// Dates and times are wall-clock values with no time zone: activity_date is a
// DATE ("YYYY-MM-DD") and start_time/end_time are TIME ("HH:MM", 24-hour),
// exactly as typed. Nothing is ever converted to or from UTC, so an activity
// on Oct 20 at 6:45 PM shows on Oct 20 at 6:45 PM for everyone — the same
// convention the job schedule uses. A blank start time means "any time that
// day"; an end time needs a start time and must be later than it.
//
// Access: the same rule as the client — admins see every client's
// activities, a regular user only those of clients assigned to them. Anyone
// who can open the client can add, edit and complete its activities; only
// admins can delete one (a regular user marks it Completed instead).
//
//   GET    /api/activities?from=YYYY-MM-DD&to=YYYY-MM-DD   (the Calendar)
//   GET    /api/clients/:clientId/activities
//   GET    /api/jobs/:jobId/activities
//   GET    /api/activities/:id
//   POST   /api/activities
//   PUT    /api/activities/:id
//   DELETE /api/activities/:id                              (admin only)

const express = require('express');
const db = require('./db');
const { getClient } = require('./db-v2');
const { asyncHandler, assertObject, parseIntField, parseStringField, AppError } = require('./request-utils');
const { isAdmin, requireAdmin, canAccessClient, currentUserId } = require('./access-control');
const { hasTable } = require('./schema-features');
const { logActivity } = require('./activity-log');

const router = express.Router();

const TABLE = 'calendar_activities';
const STATUSES = ['pending', 'completed'];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_HM = /^([01]\d|2[0-3]):([0-5]\d)(?::00(?:\.0+)?)?$/;
const MAX_RANGE_DAYS = 400;
const NOT_SUPPORTED = 'Calendar activities need the one-time database update (TEMPLATE UPGRADE v11 in supabase-schema.sql).';

function requireSupabase() {
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  return supabase;
}

async function requireActivitiesTable() {
  if (!(await hasTable(TABLE))) throw new AppError(409, NOT_SUPPORTED);
}

function parseDate(value, field, { required = true } = {}) {
  const s = String(value === null || value === undefined ? '' : value).trim();
  if (!s) {
    if (required) throw new AppError(400, `${field} is required (YYYY-MM-DD)`);
    return null;
  }
  const d = new Date(s + 'T00:00:00Z');
  if (!DATE_ONLY.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new AppError(400, `${field} must be a real date (YYYY-MM-DD)`);
  }
  const year = Number(s.slice(0, 4));
  if (year < 2000 || year > 2100) throw new AppError(400, `${field} must be between 2000 and 2100`);
  return s;
}

// "HH:MM" (24-hour) or null for blank. Postgres returns "HH:MM:SS"; accepted
// too so an unchanged value can be sent back.
function parseTime(value, field) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const s = String(value).trim();
  const m = s.match(TIME_HM);
  if (!m) throw new AppError(400, `${field} must be a time (HH:MM, 24-hour)`);
  return `${m[1]}:${m[2]}`;
}

function checkTimes(start, end) {
  if (end && !start) throw new AppError(400, 'An end time needs a start time');
  if (start && end && end <= start) throw new AppError(400, 'The end time must be later than the start time');
}

function hm(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

// What the browser gets for one activity.
function present(row, { client, job } = {}) {
  return {
    id: Number(row.id),
    client_id: Number(row.client_id),
    client_name: client ? (client.name || '') : (row.client_name || ''),
    job_id: row.job_id === null || row.job_id === undefined ? null : Number(row.job_id),
    job_title: job ? (job.title || 'Untitled job') : (row.job_id ? (row.job_title || 'Untitled job') : null),
    title: row.title || '',
    notes: row.notes || '',
    activity_date: String(row.activity_date || '').slice(0, 10),
    start_time: hm(row.start_time),
    end_time: hm(row.end_time),
    status: STATUSES.includes(row.status) ? row.status : 'pending',
    completed_at: row.completed_at || null,
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

function sortActivities(list) {
  return list.sort((a, b) => a.activity_date.localeCompare(b.activity_date) ||
    // all-day reminders first, then by start time
    (a.start_time || '').localeCompare(b.start_time || '') || a.id - b.id);
}

async function loadClientOrThrow(clientId) {
  const { rows } = await db.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  if (!rows[0]) throw new AppError(404, 'Client not found');
  return rows[0];
}

async function loadAccessibleClient(req, clientId) {
  const client = await loadClientOrThrow(clientId);
  if (!canAccessClient(req, client)) throw new AppError(403, 'You do not have access to this client');
  return client;
}

// A linked job must exist and belong to the activity's client.
async function loadJobForClient(jobId, clientId) {
  const { data, error } = await requireSupabase().from('jobs').select('id, client_id, title, status').eq('id', jobId).maybeSingle();
  if (error) throw new AppError(500, 'Failed to load the job: ' + error.message);
  if (!data) throw new AppError(400, 'That job does not exist');
  if (Number(data.client_id) !== Number(clientId)) throw new AppError(400, 'That job belongs to a different client');
  return data;
}

async function loadActivityWithAccess(req, id) {
  const { data, error } = await requireSupabase().from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw new AppError(500, 'Failed to load the activity: ' + error.message);
  if (!data) throw new AppError(404, 'Activity not found');
  const client = await loadClientOrThrow(data.client_id);
  // Same answer as "not found" for someone who may not see this client, so
  // ids of other users' activities cannot be probed.
  if (!canAccessClient(req, client)) throw new AppError(404, 'Activity not found');
  return { row: data, client };
}

// Adds client names and job titles to a list of rows.
async function presentMany(rows) {
  const supabase = requireSupabase();
  const clientIds = [...new Set(rows.map((r) => Number(r.client_id)))];
  const jobIds = [...new Set(rows.filter((r) => r.job_id).map((r) => Number(r.job_id)))];
  const [clients, jobs] = await Promise.all([
    clientIds.length ? supabase.from('clients').select('id, name').in('id', clientIds) : { data: [] },
    jobIds.length ? supabase.from('jobs').select('id, title').in('id', jobIds) : { data: [] }
  ]);
  if (clients.error) throw new AppError(500, 'Failed to load clients: ' + clients.error.message);
  if (jobs.error) throw new AppError(500, 'Failed to load jobs: ' + jobs.error.message);
  const clientById = new Map((clients.data || []).map((c) => [Number(c.id), c]));
  const jobById = new Map((jobs.data || []).map((j) => [Number(j.id), j]));
  return sortActivities(rows.map((r) => present(r, { client: clientById.get(Number(r.client_id)), job: r.job_id ? jobById.get(Number(r.job_id)) : null })));
}

function parseActivityFields(body, existing) {
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (!existing || has('title')) {
    out.title = parseStringField(body.title, 'title', { minLength: 1, maxLength: 200 });
  }
  if (!existing || has('notes')) {
    out.notes = parseStringField(body.notes ?? '', 'notes', { required: false, maxLength: 5000, defaultValue: '' });
  }
  if (!existing || has('activity_date')) out.activity_date = parseDate(body.activity_date, 'activity_date');
  if (!existing || has('start_time')) out.start_time = parseTime(body.start_time, 'start_time');
  if (!existing || has('end_time')) out.end_time = parseTime(body.end_time, 'end_time');
  if (has('status')) {
    if (!STATUSES.includes(body.status)) throw new AppError(400, 'status must be pending or completed');
    out.status = body.status;
  }
  const start = 'start_time' in out ? out.start_time : hm(existing && existing.start_time);
  const end = 'end_time' in out ? out.end_time : hm(existing && existing.end_time);
  checkTimes(start, end);
  return out;
}

function parseJobId(value) {
  if (value === null || value === undefined || value === '') return null;
  return parseIntField(value, 'job_id', { min: 1 });
}

// ======================================================
// LISTS
// ======================================================
router.get('/activities', asyncHandler(async (req, res) => {
  if (!(await hasTable(TABLE))) return res.json({ supported: false, message: NOT_SUPPORTED, activities: [] });
  const from = parseDate(req.query.from, 'from');
  const to = parseDate(req.query.to, 'to');
  if (to < from) throw new AppError(400, 'to must not be before from');
  const days = (new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000;
  if (days > MAX_RANGE_DAYS) throw new AppError(400, `The range can be at most ${MAX_RANGE_DAYS} days`);

  const supabase = requireSupabase();
  const { data, error } = await supabase.from(TABLE).select('*').gte('activity_date', from).lte('activity_date', to);
  if (error) throw new AppError(500, 'Failed to load activities: ' + error.message);
  let rows = data || [];
  if (!isAdmin(req) && rows.length) {
    const ids = [...new Set(rows.map((r) => Number(r.client_id)))];
    const { data: clients, error: cErr } = await supabase.from('clients').select('*').in('id', ids);
    if (cErr) throw new AppError(500, 'Failed to load clients: ' + cErr.message);
    const allowed = new Set((clients || []).filter((c) => canAccessClient(req, c)).map((c) => Number(c.id)));
    rows = rows.filter((r) => allowed.has(Number(r.client_id)));
  }
  res.json({ supported: true, activities: await presentMany(rows) });
}));

router.get('/clients/:clientId/activities', asyncHandler(async (req, res) => {
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  await loadAccessibleClient(req, clientId);
  if (!(await hasTable(TABLE))) return res.json({ supported: false, message: NOT_SUPPORTED, activities: [] });
  const { data, error } = await requireSupabase().from(TABLE).select('*').eq('client_id', clientId);
  if (error) throw new AppError(500, 'Failed to load activities: ' + error.message);
  res.json({ supported: true, activities: await presentMany(data || []) });
}));

router.get('/jobs/:jobId/activities', asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  if (!rows[0]) throw new AppError(404, 'Job not found');
  await loadAccessibleClient(req, rows[0].client_id);
  if (!(await hasTable(TABLE))) return res.json({ supported: false, message: NOT_SUPPORTED, activities: [] });
  const { data, error } = await requireSupabase().from(TABLE).select('*').eq('job_id', jobId);
  if (error) throw new AppError(500, 'Failed to load activities: ' + error.message);
  res.json({ supported: true, activities: await presentMany(data || []) });
}));

router.get('/activities/:id', asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await requireActivitiesTable();
  const { row } = await loadActivityWithAccess(req, id);
  res.json({ activity: (await presentMany([row]))[0] });
}));

// ======================================================
// CREATE / EDIT / COMPLETE / DELETE
// ======================================================
router.post('/activities', asyncHandler(async (req, res) => {
  assertObject(req.body);
  await requireActivitiesTable();
  const clientId = parseIntField(req.body.client_id, 'client_id', { min: 1 });
  const fields = parseActivityFields(req.body, null);
  const jobId = parseJobId(req.body.job_id);
  await loadAccessibleClient(req, clientId);
  if (jobId) await loadJobForClient(jobId, clientId);

  const now = new Date().toISOString();
  const status = fields.status || 'pending';
  const insert = {
    ...fields,
    status,
    completed_at: status === 'completed' ? now : null,
    client_id: clientId,
    job_id: jobId,
    created_by: currentUserId(req) || null,
    created_at: now,
    updated_at: now
  };
  const { data, error } = await requireSupabase().from(TABLE).insert(insert).select().single();
  if (error) throw new AppError(500, 'Failed to save the activity: ' + error.message);
  await logActivity(req.session.user.companyId, req.session.user.id, 'Created calendar activity', 'calendar_activity', data.id,
    { client_id: clientId, job_id: jobId, activity_date: fields.activity_date });
  res.json({ success: true, activity: (await presentMany([data]))[0] });
}));

router.put('/activities/:id', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await requireActivitiesTable();
  const { row } = await loadActivityWithAccess(req, id);
  if (req.body.client_id !== undefined && Number(req.body.client_id) !== Number(row.client_id)) {
    throw new AppError(400, 'An activity cannot be moved to a different client');
  }
  const updates = parseActivityFields(req.body, row);
  if (req.body.job_id !== undefined) {
    const jobId = parseJobId(req.body.job_id);
    if (jobId) await loadJobForClient(jobId, row.client_id);
    updates.job_id = jobId;
  }
  if (updates.status && updates.status !== row.status) {
    updates.completed_at = updates.status === 'completed' ? new Date().toISOString() : null;
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await requireSupabase().from(TABLE).update(updates).eq('id', id).select().maybeSingle();
  if (error) throw new AppError(500, 'Failed to save the activity: ' + error.message);
  if (!data) throw new AppError(404, 'Activity not found');
  const action = updates.status && updates.status !== row.status
    ? (updates.status === 'completed' ? 'Completed calendar activity' : 'Reopened calendar activity')
    : 'Edited calendar activity';
  await logActivity(req.session.user.companyId, req.session.user.id, action, 'calendar_activity', id,
    { client_id: Number(row.client_id), fields: Object.keys(updates).filter((k) => k !== 'updated_at') });
  res.json({ success: true, activity: (await presentMany([data]))[0] });
}));

router.delete('/activities/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await requireActivitiesTable();
  const { row } = await loadActivityWithAccess(req, id);
  const { error } = await requireSupabase().from(TABLE).delete().eq('id', id);
  if (error) throw new AppError(500, 'Failed to delete the activity: ' + error.message);
  await logActivity(req.session.user.companyId, req.session.user.id, 'Deleted calendar activity', 'calendar_activity', id,
    { client_id: Number(row.client_id), job_id: row.job_id, title: row.title, activity_date: String(row.activity_date).slice(0, 10) });
  res.json({ success: true });
}));

module.exports = router;

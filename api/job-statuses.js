// api/job-statuses.js
//
// The job workflow's statuses, in one place.
//
// jobs.status always stores a fixed INTERNAL id (Prospect, Approved,
// Completed, Invoice, Closed, Cancelled). What the business sees is a
// LABEL, which an admin can rename in Settings → Job Statuses (stored in the
// settings table under `job_status_labels`, no database change needed).
// Renaming "Approved" to "Accepted" changes only the text: the job keeps
// status = 'Approved', so Finance, the Calendar and every rule below keep
// working exactly the same. Statuses cannot be added, removed or reordered
// here — each id has a fixed meaning:
//
//   Prospect   — not approved yet (lead / estimate / waiting on the customer)
//   Approved   — the customer approved the work: Finance starts counting it,
//                and it can be scheduled on the Calendar
//   Completed  — work done (still counts in Finance)
//   Invoice    — invoiced (still counts in Finance)
//   Closed     — finished and closed (still counts in Finance)
//   Cancelled  — will not go ahead (never counts in Finance)
//
// FINANCE RULE: a job's money counts toward Expected Earnings and Remaining
// to Be Collected only while its status is one of FINANCE_STATUSES.

const express = require('express');
const { getClient } = require('./db-v2');
const { asyncHandler, assertObject, AppError } = require('./request-utils');
const { requireAdmin } = require('./access-control');
const { logActivity } = require('./activity-log');

const SETTINGS_KEY = 'job_status_labels';
const MAX_LABEL_LENGTH = 30;

const JOB_STATUSES = [
  { id: 'Prospect', defaultLabel: 'Prospect', countsInFinance: false, meaning: 'Not approved yet — lead, estimate or waiting on the customer. Not counted in Finance.' },
  { id: 'Approved', defaultLabel: 'Approved', countsInFinance: true, meaning: 'Approved by the customer. Counted in Finance from now on, and can be scheduled on the Calendar.' },
  { id: 'Completed', defaultLabel: 'Completed', countsInFinance: true, meaning: 'Work finished. Still counted in Finance.' },
  { id: 'Invoice', defaultLabel: 'Invoice', countsInFinance: true, meaning: 'Invoiced. Still counted in Finance.' },
  { id: 'Closed', defaultLabel: 'Closed', countsInFinance: true, meaning: 'Finished and closed. Still counted in Finance.' },
  { id: 'Cancelled', defaultLabel: 'Cancelled', countsInFinance: false, meaning: 'Will not go ahead. Not counted in Finance; payments already recorded stay in the payment history.' }
];

const STATUS_IDS = JOB_STATUSES.map((s) => s.id);
const FINANCE_STATUSES = JOB_STATUSES.filter((s) => s.countsInFinance).map((s) => s.id);
// The status a job must have to appear on the Calendar's work schedule.
const SCHEDULED_STATUS = 'Approved';

function isJobStatus(value) {
  return STATUS_IDS.includes(value);
}

// The single answer to "does this job's money count in Finance?".
function countsInFinance(jobOrStatus) {
  const status = jobOrStatus && typeof jobOrStatus === 'object' ? jobOrStatus.status : jobOrStatus;
  return FINANCE_STATUSES.includes(status);
}

function cleanLabel(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readStoredLabels() {
  const supabase = getClient();
  if (!supabase) return {};
  const { data, error } = await supabase.from('settings').select('value').eq('key', SETTINGS_KEY).maybeSingle();
  if (error || !data || !data.value) return {};
  try {
    const parsed = JSON.parse(data.value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

// [{ id, label, defaultLabel, countsInFinance, meaning }] in workflow order.
async function getJobStatuses() {
  const stored = await readStoredLabels();
  return JOB_STATUSES.map((s) => {
    const custom = cleanLabel(stored[s.id]);
    return { ...s, label: custom && custom.length <= MAX_LABEL_LENGTH ? custom : s.defaultLabel };
  });
}

async function getStatusLabelMap() {
  const statuses = await getJobStatuses();
  return Object.fromEntries(statuses.map((s) => [s.id, s.label]));
}

// Validates a full or partial { id: label } map. Every label must be 1-30
// characters, and no two statuses may end up with the same label (ignoring
// case) — two identical names in the status menu would be ambiguous.
function validateLabels(input, current) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'labels must be an object of { statusId: label }');
  }
  const next = { ...current };
  for (const [id, raw] of Object.entries(input)) {
    if (!isJobStatus(id)) throw new AppError(400, `Unknown job status: ${id}`);
    const label = cleanLabel(raw);
    if (!label) throw new AppError(400, 'Status names cannot be empty');
    if (label.length > MAX_LABEL_LENGTH) throw new AppError(400, `Status names can be at most ${MAX_LABEL_LENGTH} characters`);
    next[id] = label;
  }
  const seen = new Map();
  for (const id of STATUS_IDS) {
    const key = next[id].toLowerCase();
    if (seen.has(key)) throw new AppError(400, `Two statuses cannot both be called "${next[id]}"`);
    seen.set(key, id);
  }
  return next;
}

const router = express.Router();

// Anyone signed in may read the names (every job view needs them).
router.get('/job-statuses', asyncHandler(async (req, res) => {
  res.json({ statuses: await getJobStatuses(), financeStatuses: FINANCE_STATUSES, scheduledStatus: SCHEDULED_STATUS });
}));

// Admins rename statuses. Only labels change — jobs keep their status ids.
router.put('/job-statuses', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  const current = await getStatusLabelMap();
  const next = validateLabels(req.body.labels, current);
  // Only labels that differ from the default are stored, so a reset is
  // simply saving the default name again.
  const stored = {};
  for (const s of JOB_STATUSES) if (next[s.id] !== s.defaultLabel) stored[s.id] = next[s.id];
  const { error } = await supabase.from('settings').upsert({ key: SETTINGS_KEY, value: JSON.stringify(stored) }, { onConflict: 'key' });
  if (error) throw new AppError(500, 'Failed to save status names: ' + error.message);
  const changed = STATUS_IDS.filter((id) => next[id] !== current[id]).map((id) => ({ id, from: current[id], to: next[id] }));
  if (changed.length) {
    await logActivity(req.session.user.companyId, req.session.user.id, 'Renamed job statuses', 'settings', SETTINGS_KEY, { changed });
  }
  res.json({ success: true, statuses: await getJobStatuses() });
}));

module.exports = {
  router,
  JOB_STATUSES,
  STATUS_IDS,
  FINANCE_STATUSES,
  SCHEDULED_STATUS,
  isJobStatus,
  countsInFinance,
  getJobStatuses,
  getStatusLabelMap,
  validateLabels
};

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
// here — each id has a fixed meaning.
//
// FINANCE ELIGIBILITY is configurable per status: Settings → Job Statuses has
// a "Track in Finance" switch for each one, stored under `job_status_finance`
// (again a settings key, no migration). Different businesses collect at
// different points in their workflow — one starts counting at Approved,
// another only once a contract is signed — so this is deliberately a setting
// rather than a hardcoded list. The DEFAULTS below are the long-standing v11
// behaviour (Approved/Completed/Invoice/Closed count; Prospect/Cancelled do
// not), so an existing installation behaves exactly as before until an admin
// changes a switch. Eligibility always follows the status ID, never the name,
// and is read by BOTH the server (finance-rules.js, dashboard.js, jobs.js) and
// the browser (public/js/job-statuses.js) from the one answer below.

const express = require('express');
const { getClient } = require('./db-v2');
const { asyncHandler, assertObject, AppError } = require('./request-utils');
const { requireAdmin } = require('./access-control');
const { logActivity } = require('./activity-log');

const SETTINGS_KEY = 'job_status_labels';
const FINANCE_KEY = 'job_status_finance';
const MAX_LABEL_LENGTH = 30;

const JOB_STATUSES = [
  { id: 'Prospect', defaultLabel: 'Prospect', defaultCountsInFinance: false, meaning: 'Not approved yet — lead, estimate or waiting on the customer.' },
  { id: 'Approved', defaultLabel: 'Approved', defaultCountsInFinance: true, meaning: 'Approved by the customer. Can be scheduled on the Calendar.' },
  { id: 'Completed', defaultLabel: 'Completed', defaultCountsInFinance: true, meaning: 'Work finished.' },
  { id: 'Invoice', defaultLabel: 'Invoice', defaultCountsInFinance: true, meaning: 'Invoiced.' },
  { id: 'Closed', defaultLabel: 'Closed', defaultCountsInFinance: true, meaning: 'Finished and closed.' },
  { id: 'Cancelled', defaultLabel: 'Cancelled', defaultCountsInFinance: false, meaning: 'Will not go ahead; payments already recorded stay in the payment history.' }
];

const STATUS_IDS = JOB_STATUSES.map((s) => s.id);
// The v11 default mapping — also the fallback whenever a status has no stored
// setting, so a missing or legacy configuration can never silently make every
// status count.
const DEFAULT_FINANCE_COUNTS = Object.fromEntries(JOB_STATUSES.map((s) => [s.id, s.defaultCountsInFinance]));
// The status a job must have to appear on the Calendar's work schedule.
const SCHEDULED_STATUS = 'Approved';

// The persisted finance-eligibility map (id -> boolean), overlaid on the
// defaults. Kept in memory so countsInFinance() stays synchronous for the hot
// paths (finance-rules, dashboard, jobs). It is refreshed on every read of the
// settings (getJobStatuses), after an admin saves, and whenever a job is
// serialized (jobs.js), so it can never drift from the database for long.
let financeCounts = { ...DEFAULT_FINANCE_COUNTS };

function isJobStatus(value) {
  return STATUS_IDS.includes(value);
}

// The single answer to "does this job's money count in Finance?" — read by the
// server and sent to the browser on every job (counts_in_finance).
function countsInFinance(jobOrStatus) {
  const status = jobOrStatus && typeof jobOrStatus === 'object' ? jobOrStatus.status : jobOrStatus;
  return financeCounts[status] === true;
}

function cleanLabel(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readSetting(key) {
  const supabase = getClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  if (error || !data) return null;
  return data.value;
}

function parseObject(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

async function readStoredLabels() {
  return parseObject(await readSetting(SETTINGS_KEY)) || {};
}

// Re-reads `job_status_finance` and rebuilds the cache. Only known ids with a
// boolean value are honoured; anything missing keeps the default. Returns the
// fresh map.
async function refreshFinanceCounts() {
  const stored = parseObject(await readSetting(FINANCE_KEY));
  const next = { ...DEFAULT_FINANCE_COUNTS };
  if (stored) {
    for (const id of STATUS_IDS) if (typeof stored[id] === 'boolean') next[id] = stored[id];
  }
  financeCounts = next;
  return financeCounts;
}

// [{ id, label, defaultLabel, countsInFinance, defaultCountsInFinance, meaning }]
// in workflow order. Refreshes the finance cache as a side effect, so any page
// or worker that reads the statuses also gets the current eligibility.
async function getJobStatuses() {
  await refreshFinanceCounts();
  const stored = await readStoredLabels();
  return JOB_STATUSES.map((s) => {
    const custom = cleanLabel(stored[s.id]);
    return {
      id: s.id,
      defaultLabel: s.defaultLabel,
      label: custom && custom.length <= MAX_LABEL_LENGTH ? custom : s.defaultLabel,
      countsInFinance: financeCounts[s.id] === true,
      defaultCountsInFinance: s.defaultCountsInFinance,
      meaning: s.meaning
    };
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

// Validates a partial { id: true|false } map of Finance tracking switches.
function validateFinance(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'finance must be an object of { statusId: true|false }');
  }
  const next = {};
  for (const [id, raw] of Object.entries(input)) {
    if (!isJobStatus(id)) throw new AppError(400, `Unknown job status: ${id}`);
    if (typeof raw !== 'boolean') throw new AppError(400, `Finance tracking for ${id} must be true or false`);
    next[id] = raw;
  }
  return next;
}

const router = express.Router();

// Anyone signed in may read the names and the tracking switches (every job view
// needs them).
router.get('/job-statuses', asyncHandler(async (req, res) => {
  const statuses = await getJobStatuses();
  res.json({
    statuses,
    financeStatuses: statuses.filter((s) => s.countsInFinance).map((s) => s.id),
    scheduledStatus: SCHEDULED_STATUS
  });
}));

// Admins rename statuses and set which ones count in Finance. Jobs keep their
// status ids, so changing either never alters a job's stored status.
router.put('/job-statuses', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  // Always start from the stored configuration, so a finance-only save can
  // never overwrite an entry the in-memory cache has not seen (a fresh process,
  // or a change made by another instance/request).
  await refreshFinanceCounts();

  const touchesLabels = req.body.labels !== undefined;
  const touchesFinance = req.body.finance !== undefined;
  if (!touchesLabels && !touchesFinance) {
    throw new AppError(400, 'Send labels and/or finance');
  }

  const changed = [];
  const writes = [];
  let nextFinance = null;
  let financeChanged = false;

  if (touchesLabels) {
    const current = await getStatusLabelMap();
    const next = validateLabels(req.body.labels, current);
    // Only labels that differ from the default are stored, so a reset is
    // simply saving the default name again.
    const stored = {};
    for (const s of JOB_STATUSES) if (next[s.id] !== s.defaultLabel) stored[s.id] = next[s.id];
    writes.push(supabase.from('settings').upsert({ key: SETTINGS_KEY, value: JSON.stringify(stored) }, { onConflict: 'key' }));
    for (const id of STATUS_IDS) if (next[id] !== current[id]) changed.push({ field: 'label', id, from: current[id], to: next[id] });
  }

  if (touchesFinance) {
    const current = { ...financeCounts };
    const patch = validateFinance(req.body.finance);
    nextFinance = { ...current, ...patch };
    // Stored like labels: only the statuses that differ from the default, so
    // switching a status back to its default clears its entry.
    const stored = {};
    for (const id of STATUS_IDS) if (nextFinance[id] !== DEFAULT_FINANCE_COUNTS[id]) stored[id] = nextFinance[id];
    writes.push(supabase.from('settings').upsert({ key: FINANCE_KEY, value: JSON.stringify(stored) }, { onConflict: 'key' }));
    for (const id of STATUS_IDS) {
      if (patch[id] !== undefined && nextFinance[id] !== current[id]) {
        financeChanged = true;
        changed.push({ field: 'finance', id, from: current[id], to: nextFinance[id] });
      }
    }
  }

  const results = await Promise.all(writes);
  for (const r of results) if (r.error) throw new AppError(500, 'Failed to save job statuses: ' + r.error.message);

  // Apply the finance change to the in-memory cache only after it is stored.
  if (nextFinance) financeCounts = nextFinance;

  // A Finance switch reclassifies jobs across every year, so bring the stored
  // year totals back in step with the records (the Finance page flags them when
  // they differ). Required lazily to avoid a circular require at load time.
  if (financeChanged) {
    try {
      const { refreshAllFinanceYears } = require('./finance-totals');
      await refreshAllFinanceYears('job status finance');
    } catch (e) {
      console.error('Failed to refresh Finance year totals after a job status change:', e.message);
    }
  }

  if (changed.length) {
    // A neutral/representative key: the names key when labels changed, the
    // finance key when only the switches changed.
    const auditKey = touchesLabels ? SETTINGS_KEY : FINANCE_KEY;
    await logActivity(req.session.user.companyId, req.session.user.id, 'Updated job status settings', 'settings', auditKey, { changed });
  }
  res.json({ success: true, statuses: await getJobStatuses() });
}));

module.exports = {
  router,
  JOB_STATUSES,
  STATUS_IDS,
  SCHEDULED_STATUS,
  isJobStatus,
  countsInFinance,
  getJobStatuses,
  getStatusLabelMap,
  validateLabels,
  refreshFinanceCounts
};

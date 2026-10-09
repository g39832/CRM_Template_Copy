// api/finance-totals.js
//
// Year totals for the Finance page (the Year Totals & Overrides table and the
// Financial Overview cards). The figures come from finance-rules.js — the one
// place that decides which money counts (approved jobs + client-level
// amounts; see the rule written out at the top of that file).
//
// finance_overrides keeps one row per year. It is recalculated after every
// change that can move a year's figures, and an admin can also type figures
// into it by hand (Save Year Data); GET /api/finance/summary reports both the
// stored row and the figures calculated from the records, so the page can
// show when they differ.

const db = require('./db');
const { getClient } = require('./db-v2');
const { AppError } = require('./request-utils');
const { loadFinanceData, buildYearFinance, yearOf } = require('./finance-rules');

// ---------------------------------------------------------------------------
// MANUAL OVERRIDES (persistent)
//
// The `finance_overrides` table holds the CALCULATED snapshot for a year: every
// job/payment change refreshes it through updateFinanceTotals(), so a figure
// typed directly into it would be silently overwritten. Administrator intent
// therefore lives in the settings key/value store, under
// `finance_override:<year>` (the same no-migration pattern used for job status
// labels and the technician fallback). Recalculation never touches that row, so
// a manual override stays selected until an admin changes or clears it.
//
// A settings value of {"expected":7000,"received":3200,"remaining":3000,"clients":4}
// is the override; its absence means "show the calculated figures".
// ---------------------------------------------------------------------------
const MANUAL_KEY_PREFIX = 'finance_override:';

const numOr0 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function manualOverrideKey(year) {
  return MANUAL_KEY_PREFIX + year;
}

// Returns { totalClients, totalExpected, totalReceived, totalRemaining } or
// null when no manual override is active for the year.
async function getManualOverride(year) {
  const supabase = getClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from('settings').select('value').eq('key', manualOverrideKey(year)).maybeSingle();
  if (error || !data || !data.value) return null;
  try {
    const parsed = JSON.parse(data.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return {
      totalClients: Math.max(0, Math.round(numOr0(parsed.clients))),
      totalExpected: numOr0(parsed.expected),
      totalReceived: numOr0(parsed.received),
      totalRemaining: numOr0(parsed.remaining)
    };
  } catch (e) {
    return null;
  }
}

// Stores an admin's manual figures for the year (creates or replaces).
async function setManualOverride(year, values) {
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  const payload = {
    expected: numOr0(values && values.totalExpected),
    received: numOr0(values && values.totalReceived),
    remaining: numOr0(values && values.totalRemaining),
    clients: Math.max(0, Math.round(numOr0(values && values.totalClients)))
  };
  const { error } = await supabase
    .from('settings')
    .upsert({ key: manualOverrideKey(year), value: JSON.stringify(payload) }, { onConflict: 'key' });
  if (error) throw new AppError(500, 'Failed to save the manual override: ' + error.message);
  return {
    totalClients: payload.clients,
    totalExpected: payload.expected,
    totalReceived: payload.received,
    totalRemaining: payload.remaining
  };
}

// Every year that has a saved manual override (so a year with an override but
// no records still appears in the Finance year list).
async function listManualOverrideYears() {
  const supabase = getClient();
  if (!supabase) return [];
  const { data, error } = await supabase.from('settings').select('key').like('key', MANUAL_KEY_PREFIX + '%');
  if (error || !Array.isArray(data)) return [];
  return data
    .map((row) => Number(String(row.key).slice(MANUAL_KEY_PREFIX.length)))
    .filter((y) => Number.isInteger(y) && y > 0);
}

// Removes the override so the year returns to its calculated figures.
async function clearManualOverride(year) {
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  const { error } = await supabase.from('settings').delete().eq('key', manualOverrideKey(year));
  if (error) throw new AppError(500, 'Failed to clear the manual override: ' + error.message);
}

function getValidYear(inputYear) {
  const currentYear = new Date().getFullYear();
  const parsed = Number.parseInt(inputYear, 10);
  return !parsed || parsed < 2000 || parsed > currentYear + 5
    ? currentYear
    : parsed;
}

async function getFinanceTotalsForYear(year) {
  const { totals } = buildYearFinance(await loadFinanceData(), year);
  return {
    total_clients: totals.clients,
    total_expected: totals.expected,
    total_received: totals.received,
    total_remaining: totals.remaining
  };
}

// Average margin % across the year's counted work that has a cost recorded.
async function getAverageMarginForYear(year) {
  return buildYearFinance(await loadFinanceData(), year).totals.avgMarginPct;
}

async function updateFinanceTotals(year) {
  year = getValidYear(year);
  const totals = await getFinanceTotalsForYear(year);

  await db.query(`
    INSERT INTO finance_overrides (year, total_expected, total_received, total_remaining, total_clients)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT(year) DO UPDATE SET
      total_expected = EXCLUDED.total_expected,
      total_received = EXCLUDED.total_received,
      total_remaining = EXCLUDED.total_remaining,
      total_clients = EXCLUDED.total_clients,
      updated_at = CURRENT_TIMESTAMP
  `, [
    year,
    totals.total_expected,
    totals.total_received,
    totals.total_remaining,
    totals.total_clients
  ]);
}

async function updateFinanceTotalsSafe(year, context = 'finance totals') {
  try {
    await updateFinanceTotals(year);
  } catch (err) {
    console.error(`Failed to update ${context} for year ${year}:`, err);
  }
}

// Recalculates every year a change can touch: the year the record was
// created (expected/remaining) and the current year (payments land "now").
async function refreshFinanceYearsFor(createdAt, context) {
  const years = new Set([new Date().getFullYear()]);
  const created = yearOf(createdAt);
  if (created) years.add(created);
  for (const y of years) await updateFinanceTotalsSafe(y, context);
}

module.exports = {
  getValidYear,
  getFinanceTotalsForYear,
  getAverageMarginForYear,
  updateFinanceTotals,
  updateFinanceTotalsSafe,
  refreshFinanceYearsFor,
  getManualOverride,
  setManualOverride,
  clearManualOverride,
  listManualOverrideYears
};

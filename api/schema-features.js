// api/schema-features.js
//
// Detects optional columns added by the v6 migration
// (scripts/migrate-v6-client-overview.sql) so the app works both before and
// after it has been run:
//   - clients.technician  (text)   — who does the work for a client
//   - payments.job_id     (bigint) — which job a payment was recorded on
//
// Each probe is a zero-row select. A missing column is cached as "absent"
// for a short while and then re-checked, so running the migration takes
// effect without restarting the server.

const { getClient } = require('./db-v2');

// SCHEMA_CACHE_MS=0 (used by the local test harness) re-probes every time.
const RECHECK_ABSENT_MS = process.env.SCHEMA_CACHE_MS !== undefined ? Number(process.env.SCHEMA_CACHE_MS) : 60 * 1000;
const CACHE_PRESENT = process.env.SCHEMA_CACHE_MS !== '0';
const cache = new Map();

function isMissingColumnError(error) {
  const code = String(error && error.code || '');
  const message = String(error && error.message || '').toLowerCase();
  return code === '42703' || code === 'PGRST204' ||
    (message.includes('column') && (message.includes('does not exist') || message.includes('could not find')));
}

async function hasColumn(table, column) {
  const key = `${table}.${column}`;
  const cached = cache.get(key);
  if (cached && ((cached.present && CACHE_PRESENT) || Date.now() - cached.checkedAt < RECHECK_ABSENT_MS)) {
    return cached.present;
  }

  const supabase = getClient();
  if (!supabase) return false;
  const { error } = await supabase.from(table).select(column).limit(0);
  if (error && !isMissingColumnError(error)) {
    // Network or other failure — don't cache, just report absent this time.
    return false;
  }
  const present = !error;
  cache.set(key, { present, checkedAt: Date.now() });
  return present;
}

function isMissingTableError(error) {
  const code = String(error && error.code || '');
  const message = String(error && error.message || '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' ||
    (message.includes('relation') && message.includes('does not exist')) ||
    message.includes('could not find the table');
}

// True when a table exists (v7 expense tables are optional until migrated).
async function hasTable(table) {
  const key = `table:${table}`;
  const cached = cache.get(key);
  if (cached && ((cached.present && CACHE_PRESENT) || Date.now() - cached.checkedAt < RECHECK_ABSENT_MS)) {
    return cached.present;
  }
  const supabase = getClient();
  if (!supabase) return false;
  const { error } = await supabase.from(table).select('id').limit(0);
  if (error && !isMissingTableError(error)) return false;
  const present = !error;
  cache.set(key, { present, checkedAt: Date.now() });
  return present;
}

function markColumnAbsent(table, column) {
  cache.set(`${table}.${column}`, { present: false, checkedAt: Date.now() });
}

module.exports = {
  hasColumn,
  markColumnAbsent,
  isMissingColumnError,
  isMissingTableError,
  hasTable,
  hasExpenseTables: async () => (await hasTable('expense_categories')) && (await hasTable('job_expenses')),
  // v9: a job's schedule (estimated start date + duration in days).
  hasJobSchedule: async () => (await hasColumn('jobs', 'scheduled_start')) && (await hasColumn('jobs', 'duration_days')),
  // v10: whether a job's estimate/invoice itemizes its services' prices.
  hasJobPricingDisplay: () => hasColumn('jobs', 'show_line_item_prices'),
  hasClientTechnician: () => hasColumn('clients', 'technician'),
  hasPaymentJobId: () => hasColumn('payments', 'job_id')
};

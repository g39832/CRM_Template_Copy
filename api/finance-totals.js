// api/finance-totals.js
//
// Year totals for the Finance page. A client's money can live in two places:
//   - client-level fields (clients.total_due / amount_paid / balance /
//     job_cost) — how the CRM recorded money before jobs existed, and
//   - its jobs (jobs.total_due / amount_paid / balance / job_cost).
// Both are counted, so the Finance page matches the totals shown on each
// client page (client-level amounts + the sum of the client's jobs). Client-
// level amounts are attributed to the year the client was created; job
// amounts to the year the job was created.
//
// Money received comes from the payments ledger, which holds client-level
// payments and — since this change — job payments too.

const db = require('./db');
const { getClient } = require('./db-v2');

function getValidYear(inputYear) {
  const currentYear = new Date().getFullYear();
  const parsed = Number.parseInt(inputYear, 10);
  return !parsed || parsed < 2000 || parsed > currentYear + 5
    ? currentYear
    : parsed;
}

function yearOf(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.getFullYear() : null;
}

async function fetchJobsForTotals() {
  const supabase = getClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('jobs')
    .select('id, total_due, amount_paid, balance, job_cost, created_at');
  if (error) {
    if (/does not exist|relation/i.test(error.message || '')) return [];
    throw error;
  }
  return data || [];
}

async function getFinanceTotalsForYear(year) {
  const clientSummaryResult = await db.query(`
    SELECT
      COUNT(*)::int AS total_clients,
      COALESCE(SUM(total_due), 0) AS total_expected,
      COALESCE(SUM(balance), 0) AS total_remaining
    FROM clients
    WHERE EXTRACT(YEAR FROM created_at)::int = $1
  `, [year]);

  const paymentSummaryResult = await db.query(`
    SELECT COALESCE(SUM(amount), 0) AS total_received
    FROM payments
    WHERE EXTRACT(YEAR FROM payment_date)::int = $1
  `, [year]);

  const jobs = (await fetchJobsForTotals()).filter((job) => yearOf(job.created_at) === Number(year));
  const jobExpected = jobs.reduce((sum, job) => sum + Number(job.total_due || 0), 0);
  const jobRemaining = jobs.reduce((sum, job) => sum + Number(job.balance || 0), 0);

  const clientSummary = clientSummaryResult.rows[0] || {};
  const paymentSummary = paymentSummaryResult.rows[0] || {};

  return {
    total_clients: Number(clientSummary.total_clients || 0),
    total_expected: Number(clientSummary.total_expected || 0) + jobExpected,
    total_received: Number(paymentSummary.total_received || 0),
    total_remaining: Number(clientSummary.total_remaining || 0) + jobRemaining
  };
}

// Average margin % across the year's priced work that has a cost recorded:
// every client-level record and every job with total_due > 0 and job_cost > 0.
async function getAverageMarginForYear(year) {
  const [{ rows: clients }, jobs] = await Promise.all([
    db.query('SELECT * FROM clients'),
    fetchJobsForTotals()
  ]);
  const margins = [];
  const collect = (row) => {
    const total = Number(row.total_due || 0);
    const cost = Number(row.job_cost || 0);
    if (total > 0 && cost > 0) margins.push(((total - cost) / total) * 100);
  };
  (clients || []).filter((c) => yearOf(c.created_at) === Number(year)).forEach(collect);
  jobs.filter((j) => yearOf(j.created_at) === Number(year)).forEach(collect);
  if (!margins.length) return null;
  return margins.reduce((a, b) => a + b, 0) / margins.length;
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
  refreshFinanceYearsFor
};

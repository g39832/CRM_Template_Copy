// api/finance-overview.js
//
// Read-only Finance endpoints behind the Financial Overview (admin only):
//   GET  /api/finance/overview?year=YYYY   revenue/cost/profit, money received
//                                          by month, salespeople, cost categories
//   GET  /api/finance/breakdown?year=YYYY&metric=expected|remaining|received|clients
//                                          the records behind one overview card
//   POST /api/finance/recalculate {year}   rewrites the year's stored totals row
//                                          from the records (finance_overrides)
//
// Every figure comes from finance-rules.js (buildYearFinance), the same code
// the year totals use, so a card, its drill-down list and the charts always
// add up to the same amounts:
//   - revenue  = Expected Earnings: approved jobs' totals + client accounts
//   - cost     = the same records' job_cost (a job's cost is the sum of its
//                itemized Job Costs, kept in jobs.job_cost by expenses.js)
//   - received = payments ledger entries dated that year (client-level and
//                job payments; corrections are negative entries)
// Jobs that are not approved (Prospect) or Cancelled count for nothing.

const express = require('express');
const db = require('./db');
const { getClient } = require('./db-v2');
const { asyncHandler, assertObject, parseYear, AppError } = require('./request-utils');
const { requireAdmin } = require('./access-control');
const { getValidYear, getFinanceTotalsForYear, updateFinanceTotals, getManualOverride } = require('./finance-totals');
const { loadFinanceData, buildYearFinance, yearOf } = require('./finance-rules');
const { hasExpenseTables } = require('./schema-features');

const router = express.Router();

const round = (v) => Math.round(Number(v || 0) * 100) / 100;
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function yearMonth(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return { year: d.getFullYear(), month: d.getMonth() };
}

async function selectAll(supabase, table, columns) {
  const { data, error } = await supabase.from(table).select(columns);
  if (error) {
    if (/does not exist|relation|schema cache/i.test(error.message || '')) return [];
    throw new AppError(500, `Failed to load ${table}: ${error.message}`);
  }
  return data || [];
}

router.get('/finance/overview', requireAdmin, asyncHandler(async (req, res) => {
  const year = req.query.year ? parseYear(req.query.year, 'year') : getValidYear(req.query.year);
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  const data = await loadFinanceData();
  const { clients, users } = data;
  const finance = buildYearFinance(data, year);
  // Only counted work (approved jobs + client accounts) — see finance-rules.js.
  const clientsY = clients.filter((c) => yearOf(c.created_at) === year);
  const jobsY = finance.countedJobs.map((r) => ({ id: r.job_id, client_id: r.client_id, total_due: r.total, job_cost: r.cost }));
  const paymentsY = data.payments.filter((p) => yearOf(p.payment_date) === year);

  // ---- Totals ----
  const revenue = finance.totals.expected;
  const cost = finance.totals.cost;
  const outstanding = finance.totals.remaining;
  const received = finance.totals.received;
  const profit = revenue - cost;

  // ---- Money received by month (payments ledger) ----
  const monthly = Array.from({ length: 12 }, (_, m) => ({ month: m, received: 0 }));
  paymentsY.forEach((p) => {
    const ym = yearMonth(p.payment_date);
    if (ym) monthly[ym.month].received += num(p.amount);
  });

  // ---- Revenue by salesperson (clients.assigned_user_id) ----
  const userById = new Map(users.map((u) => [String(u.id), u]));
  const clientById = new Map(clients.map((c) => [Number(c.id), c]));
  const people = new Map();
  const personFor = (client) => {
    const key = client && client.assigned_user_id ? String(client.assigned_user_id) : 'unassigned';
    if (!people.has(key)) {
      const u = userById.get(key);
      people.set(key, {
        id: key === 'unassigned' ? null : key,
        name: key === 'unassigned' ? 'Unassigned' : ((u && (u.display_name || u.email)) || 'Former user'),
        revenue: 0, cost: 0, received: 0, jobs: 0, clients: new Set()
      });
    }
    return people.get(key);
  };
  clientsY.forEach((c) => {
    const p = personFor(c);
    p.revenue += num(c.total_due);
    p.cost += num(c.job_cost);
    p.clients.add(Number(c.id));
  });
  jobsY.forEach((j) => {
    const c = clientById.get(Number(j.client_id));
    const p = personFor(c);
    p.revenue += num(j.total_due);
    p.cost += num(j.job_cost);
    p.jobs += 1;
    p.clients.add(Number(j.client_id));
  });
  paymentsY.forEach((pay) => {
    const c = clientById.get(Number(pay.client_id));
    const p = personFor(c);
    p.received += num(pay.amount);
  });
  const salespeople = [...people.values()]
    .filter((p) => Math.abs(p.revenue) > 0.005 || Math.abs(p.received) > 0.005 || p.jobs > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      revenue: round(p.revenue),
      received: round(p.received),
      profit: round(p.revenue - p.cost),
      jobs: p.jobs,
      clients: p.clients.size,
      share: revenue > 0 ? round((p.revenue / revenue) * 100) : 0
    }))
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));

  // ---- Cost by category ----
  // Itemized Job Costs grouped by category; job costs that aren't itemized
  // (older jobs) and client-level costs get their own rows, so the rows
  // always add up to the year's total cost.
  const buckets = new Map();
  const addBucket = (key, name, amount, kind) => {
    if (Math.abs(amount) < 0.005) return;
    const b = buckets.get(key) || { name, amount: 0, kind };
    b.amount += amount;
    buckets.set(key, b);
  };
  let itemizedJobIds = new Set();
  if (jobsY.length && await hasExpenseTables()) {
    const [expenses, categories] = await Promise.all([
      selectAll(supabase, 'job_expenses', 'job_id, category_id, amount'),
      selectAll(supabase, 'expense_categories', 'id, name')
    ]);
    const categoryName = new Map(categories.map((c) => [Number(c.id), c.name]));
    const jobIdsY = new Set(jobsY.map((j) => Number(j.id)));
    expenses.filter((e) => jobIdsY.has(Number(e.job_id))).forEach((e) => {
      itemizedJobIds.add(Number(e.job_id));
      const hasCategory = e.category_id !== null && e.category_id !== undefined;
      const key = hasCategory ? `cat-${e.category_id}` : 'uncategorized';
      addBucket(key, hasCategory ? (categoryName.get(Number(e.category_id)) || 'Uncategorized') : 'Uncategorized', num(e.amount), 'category');
    });
  }
  jobsY.filter((j) => !itemizedJobIds.has(Number(j.id)))
    .forEach((j) => addBucket('not-itemized', 'Job costs not itemized', num(j.job_cost), 'other'));
  clientsY.forEach((c) => addBucket('client-level', 'Client account costs', num(c.job_cost), 'other'));
  const costByCategory = [...buckets.values()]
    .map((b) => ({ name: b.name, amount: round(b.amount), kind: b.kind, share: cost > 0 ? round((b.amount / cost) * 100) : 0 }))
    .sort((a, b) => (a.kind === 'other') - (b.kind === 'other') || b.amount - a.amount);

  res.json({
    year,
    totals: {
      revenue: round(revenue),
      cost: round(cost),
      profit: round(profit),
      marginPct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null,
      received: round(received),
      outstanding: round(outstanding),
      jobs: jobsY.length,
      clients: clientsY.length
    },
    monthly: monthly.map((m) => ({ month: m.month, received: round(m.received) })),
    salespeople,
    costByCategory
  });
}));

// ======================================================
// DRILL-DOWN: the records behind one Financial Overview card.
// `total` is always the sum of the listed rows (or the row count for
// clients), and equals the figure the rules calculate for the card.
// ======================================================
const METRICS = ['expected', 'remaining', 'received', 'clients'];

router.get('/finance/breakdown', requireAdmin, asyncHandler(async (req, res) => {
  const year = req.query.year ? parseYear(req.query.year, 'year') : getValidYear(req.query.year);
  const metric = String(req.query.metric || '');
  if (!METRICS.includes(metric)) throw new AppError(400, 'metric must be one of: ' + METRICS.join(', '));

  const finance = buildYearFinance(await loadFinanceData(), year);
  let rows;
  let total;
  if (metric === 'expected') {
    rows = finance.moneyRows.filter((r) => Math.abs(r.total) > 0.005);
    total = finance.totals.expected;
  } else if (metric === 'remaining') {
    rows = finance.moneyRows.filter((r) => Math.abs(r.balance) > 0.005);
    total = finance.totals.remaining;
  } else if (metric === 'received') {
    rows = finance.payments;
    total = finance.totals.received;
  } else {
    rows = finance.clientsCreated;
    total = finance.totals.clients;
  }
  if (metric !== 'received' && metric !== 'clients') {
    rows = rows.slice().sort((a, b) => a.client_name.localeCompare(b.client_name) ||
      (a.kind === b.kind ? new Date(a.date) - new Date(b.date) : a.kind === 'job' ? -1 : 1));
  }
  if (metric === 'clients') rows = rows.slice().sort((a, b) => a.client_name.localeCompare(b.client_name));

  // Jobs created this year that are NOT counted (not approved / cancelled) —
  // listed so it is clear why they are missing from Expected and Remaining.
  const notCounted = metric === 'expected' || metric === 'remaining'
    ? finance.notCountedJobs.slice().sort((a, b) => a.client_name.localeCompare(b.client_name))
    : [];

  // The figure the card shows may come from a persistent manual override
  // (settings) or from a stored year row (finance_overrides) calculated before
  // the latest rules or by hand. Report whichever is selected so the page can
  // disclose it next to the figure the records add up to.
  let stored = null;
  try {
    const manual = await getManualOverride(year);
    if (manual) {
      stored = {
        expected: manual.totalExpected,
        received: manual.totalReceived,
        remaining: manual.totalRemaining,
        clients: manual.totalClients
      };
    } else {
      const { rows: overrideRows } = await db.query('SELECT * FROM finance_overrides WHERE year = $1', [year]);
      if (overrideRows[0]) {
        stored = {
          expected: Number(overrideRows[0].total_expected || 0),
          received: Number(overrideRows[0].total_received || 0),
          remaining: Number(overrideRows[0].total_remaining || 0),
          clients: Number(overrideRows[0].total_clients || 0)
        };
      }
    }
  } catch (e) { stored = null; }

  res.json({ year, metric, total, count: rows.length, rows, notCounted, stored: stored ? stored[metric] : null });
}));

// Replaces the year's stored totals with the figures calculated from the
// records (the same thing every job/payment change already does for its year).
router.post('/finance/recalculate', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const year = parseYear(req.body.year, 'year');
  await updateFinanceTotals(year);
  res.json({ success: true, year, totals: await getFinanceTotalsForYear(year) });
}));

module.exports = router;

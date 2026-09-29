// api/finance-overview.js
//
// GET /api/finance/overview?year=YYYY — read-only breakdowns behind the
// visual cards at the top of the Finance page (admin only).
//
// It uses the same rules as the rest of Finance (see finance-totals.js), so
// the charts agree with the year totals:
//   - revenue  = client-level total_due for clients created that year
//                + total_due of jobs created that year
//   - cost     = the same records' job_cost (a job's cost is the sum of its
//                itemized Job Costs, kept in jobs.job_cost by expenses.js)
//   - received = payments ledger entries dated that year (client-level and
//                job payments; corrections are negative entries)
// Nothing here writes to the database or changes any calculation.

const express = require('express');
const { getClient } = require('./db-v2');
const { asyncHandler, parseYear, AppError } = require('./request-utils');
const { requireAdmin } = require('./access-control');
const { getValidYear } = require('./finance-totals');
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

  const [clients, jobs, payments, users] = await Promise.all([
    selectAll(supabase, 'clients', '*'),
    selectAll(supabase, 'jobs', 'id, client_id, total_due, amount_paid, balance, job_cost, created_at'),
    selectAll(supabase, 'payments', '*'),
    selectAll(supabase, 'users', 'id, display_name, email')
  ]);

  const inYear = (row) => {
    const ym = yearMonth(row.created_at);
    return Boolean(ym && ym.year === year);
  };
  const clientsY = clients.filter(inYear);
  const jobsY = jobs.filter(inYear);
  const paymentsY = payments.filter((p) => {
    const ym = yearMonth(p.payment_date);
    return Boolean(ym && ym.year === year);
  });

  // ---- Totals ----
  const revenue = clientsY.reduce((s, c) => s + num(c.total_due), 0) + jobsY.reduce((s, j) => s + num(j.total_due), 0);
  const cost = clientsY.reduce((s, c) => s + num(c.job_cost), 0) + jobsY.reduce((s, j) => s + num(j.job_cost), 0);
  const outstanding = clientsY.reduce((s, c) => s + num(c.balance), 0) + jobsY.reduce((s, j) => s + num(j.balance), 0);
  const received = paymentsY.reduce((s, p) => s + num(p.amount), 0);
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

module.exports = router;

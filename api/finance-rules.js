// api/finance-rules.js
//
// THE single place that decides which money counts in Finance. The Finance
// page's year totals and Financial Overview cards, their drill-down lists,
// the Year Totals table's recalculation (finance-totals.js), the overview
// charts (finance-overview.js) and the dashboard stats (dashboard.js) all
// call buildYearFinance()/buildAllTimeBalances() below instead of writing
// their own formula, so they always agree.
//
// THE RULE
//   Jobs:  a job's money counts only while its status counts in Finance
//          (job-statuses.js: Approved, Completed, Invoice, Closed). A
//          Prospect (not yet approved) or Cancelled job counts for nothing,
//          however big its total — an estimate is not earnings. If a job is
//          moved back to Prospect or Cancelled it drops out again; nothing is
//          deleted and its own figures (total, received, balance) are kept, so
//          approving it again brings it straight back.
//   Client accounts: money recorded on the client record itself (how the CRM
//          worked before jobs) has no job status, so it keeps counting exactly
//          as before.
//   Expected Earnings  = counted jobs' totals + client-account totals
//   Remaining          = counted jobs' balances + client-account balances
//                        (a balance is total − received, so a partly paid job
//                        counts only what is still owed and a fully paid job
//                        counts 0; an overpayment shows as a negative balance)
//   Money Received     = every payment in the payments ledger dated that year
//                        (cash actually received — payment history is never
//                        hidden or rewritten, including payments on a job that
//                        is later moved back to Prospect or Cancelled; those
//                        entries are flagged in the drill-down)
//   Year: jobs and client accounts belong to the year they were created;
//         payments to the year they were received.

const { getClient } = require('./db-v2');
const { AppError } = require('./request-utils');
const { countsInFinance, getStatusLabelMap } = require('./job-statuses');

const EPSILON = 0.005;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (v) => Math.round(num(v) * 100) / 100;

function yearOf(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.getFullYear() : null;
}

async function selectAll(supabase, table, columns) {
  const { data, error } = await supabase.from(table).select(columns);
  if (error) {
    if (/does not exist|relation|schema cache|could not find/i.test(error.message || '')) return [];
    throw new AppError(500, `Failed to load ${table}: ${error.message}`);
  }
  return data || [];
}

// Everything the rules need, in one round of queries.
async function loadFinanceData() {
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  const [clients, jobs, payments, users, labels] = await Promise.all([
    selectAll(supabase, 'clients', '*'),
    selectAll(supabase, 'jobs', 'id, client_id, title, status, total_due, amount_paid, balance, job_cost, created_at'),
    selectAll(supabase, 'payments', '*'),
    selectAll(supabase, 'users', 'id, display_name, email'),
    getStatusLabelMap()
  ]);
  return { clients, jobs, payments, users, labels };
}

function hasClientAccountMoney(client) {
  return ['total_due', 'amount_paid', 'balance', 'job_cost'].some((k) => Math.abs(num(client[k])) > EPSILON);
}

// All figures for one year, plus the records behind each of them.
function buildYearFinance(data, year) {
  year = Number(year);
  const labels = data.labels || {};
  const clientById = new Map(data.clients.map((c) => [Number(c.id), c]));
  const jobById = new Map(data.jobs.map((j) => [Number(j.id), j]));
  const clientName = (id) => {
    const c = clientById.get(Number(id));
    return c ? (c.name || 'Unnamed client') : 'Deleted client';
  };

  const jobRow = (j) => ({
    kind: 'job',
    client_id: Number(j.client_id),
    client_name: clientName(j.client_id),
    job_id: Number(j.id),
    job_title: j.title || 'Untitled job',
    status: j.status || '',
    status_label: labels[j.status] || j.status || '',
    counts: countsInFinance(j),
    total: round(j.total_due),
    paid: round(j.amount_paid),
    balance: round(j.balance),
    cost: round(j.job_cost),
    date: j.created_at
  });
  const accountRow = (c) => ({
    kind: 'client_account',
    client_id: Number(c.id),
    client_name: c.name || 'Unnamed client',
    job_id: null,
    job_title: 'Client account (recorded before jobs)',
    status: '',
    status_label: 'Client account',
    counts: true,
    total: round(c.total_due),
    paid: round(c.amount_paid),
    balance: round(c.balance),
    cost: round(c.job_cost),
    date: c.created_at
  });

  const clientsY = data.clients.filter((c) => yearOf(c.created_at) === year);
  const jobsY = data.jobs.filter((j) => yearOf(j.created_at) === year).map(jobRow);
  const counted = jobsY.filter((r) => r.counts);
  const notCounted = jobsY.filter((r) => !r.counts);
  const accounts = clientsY.filter(hasClientAccountMoney).map(accountRow);
  const moneyRows = counted.concat(accounts);

  const payments = data.payments
    .filter((p) => yearOf(p.payment_date) === year)
    .map((p) => {
      const job = p.job_id !== null && p.job_id !== undefined ? jobById.get(Number(p.job_id)) : null;
      return {
        payment_id: Number(p.id),
        client_id: p.client_id === null || p.client_id === undefined ? null : Number(p.client_id),
        client_name: clientName(p.client_id),
        job_id: job ? Number(job.id) : null,
        job_title: job ? (job.title || 'Untitled job') : (p.job_id ? 'Deleted job' : 'Client account'),
        status: job ? job.status || '' : '',
        status_label: job ? (labels[job.status] || job.status || '') : '',
        // A payment on a job that no longer counts (moved back to Prospect or
        // Cancelled) is still money received — it is only flagged.
        job_counts: job ? countsInFinance(job) : true,
        amount: round(p.amount),
        date: p.payment_date
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date) || b.payment_id - a.payment_id);

  const sum = (rows, key) => round(rows.reduce((s, r) => s + num(r[key]), 0));
  const expected = sum(moneyRows, 'total');
  const remaining = sum(moneyRows, 'balance');
  const cost = sum(moneyRows, 'cost');
  const received = sum(payments, 'amount');

  // Average margin % over the counted records that have both a price and a
  // cost (the long-standing "Avg Margin" definition, now approval-aware).
  const margins = moneyRows
    .filter((r) => r.total > 0 && r.cost > 0)
    .map((r) => ((r.total - r.cost) / r.total) * 100);

  return {
    year,
    totals: {
      expected,
      received,
      remaining,
      cost,
      profit: round(expected - cost),
      marginPct: expected > 0 ? Math.round(((expected - cost) / expected) * 1000) / 10 : null,
      avgMarginPct: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : null,
      clients: clientsY.length,
      countedJobs: counted.length,
      notCountedJobs: notCounted.length
    },
    // Records behind each figure (the drill-down lists).
    moneyRows,
    countedJobs: counted,
    notCountedJobs: notCounted,
    clientAccounts: accounts,
    payments,
    clientsCreated: clientsY.map((c) => ({ client_id: Number(c.id), client_name: c.name || 'Unnamed client', stage: c.status || '', date: c.created_at }))
  };
}

// Per-client balance still owed across ALL years under the same rule
// (client account + counted jobs). Used by the dashboard.
function buildAllTimeBalances(data) {
  const balances = new Map();
  const add = (clientId, amount) => balances.set(Number(clientId), num(balances.get(Number(clientId))) + num(amount));
  data.clients.forEach((c) => add(c.id, c.balance));
  data.jobs.filter(countsInFinance).forEach((j) => add(j.client_id, j.balance));
  return balances;
}

module.exports = {
  EPSILON,
  round,
  yearOf,
  loadFinanceData,
  buildYearFinance,
  buildAllTimeBalances
};

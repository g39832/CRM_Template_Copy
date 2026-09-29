// api/expenses.js
//
// Custom job expense categories and itemized job costs.
//
//   Business (companies) -> expense_categories -> job_expenses <- jobs
//
// - Each business manages its own categories (Settings -> Expense Categories).
//   New businesses start with Labor, Materials, Commissions and Miscellaneous
//   Expenses. Categories are renamed in place (expenses reference them by id,
//   so every existing expense follows the new name) and deactivated rather
//   than deleted when in use — a deactivated category disappears from the
//   picker for new expenses but keeps every expense and total that uses it.
//   A category can only be deleted outright while nothing uses it (also
//   enforced by the database: job_expenses.category_id ... ON DELETE RESTRICT).
// - A job's itemized expenses ARE its cost: whenever one is added, edited or
//   removed, jobs.job_cost is recalculated as their sum, so profit, margin,
//   client totals and Finance keep using the one existing cost figure.
// - Job cost is admin-only everywhere in this CRM (regular users never see
//   it), so expenses and category management are admin-only too.
//
// Both tables come from the v7 migration. Until it has been run, every route
// answers `supported: false` (or 409 for writes) and the job keeps its single
// Job Cost field, exactly as before.

const express = require('express');
const db = require('./db');
const { getClient } = require('./db-v2');
const { asyncHandler, assertObject, parseIntField, parseNumberField, parseStringField, AppError } = require('./request-utils');
const { requireAdmin, canAccessClient } = require('./access-control');
const { refreshFinanceYearsFor } = require('./finance-totals');
const { hasExpenseTables } = require('./schema-features');

const router = express.Router();

const DEFAULT_CATEGORIES = ['Labor', 'Materials', 'Commissions', 'Miscellaneous Expenses'];
const PRE_ITEMIZED_DESCRIPTION = 'Cost entered before itemized expenses';
const MAX_CATEGORY_NAME = 80;

const NOT_MIGRATED_MESSAGE = 'Itemized job costs need the one-time database update (TEMPLATE UPGRADE v7 in supabase-schema.sql).';

function requireSupabase() {
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  return supabase;
}

async function requireExpenseTables() {
  if (!(await hasExpenseTables())) throw new AppError(409, NOT_MIGRATED_MESSAGE);
}

function companyIdOf(req) {
  const id = req.session && req.session.user && req.session.user.companyId;
  if (!id) throw new AppError(400, 'No company associated with this account');
  return id;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// ------------------------------------------------------------------
// Categories
// ------------------------------------------------------------------
function normalizeCategory(row, usage) {
  const u = usage && usage.get(Number(row.id));
  return {
    id: row.id,
    name: row.name,
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order || 0),
    expense_count: u ? u.count : 0,
    expense_total: u ? roundMoney(u.total) : 0
  };
}

async function listCompanyCategories(supabase, companyId) {
  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .eq('company_id', companyId)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new AppError(500, 'Failed to load expense categories: ' + error.message);
  return data || [];
}

// A business with no categories yet (e.g. created after the migration)
// gets the defaults the first time categories are needed.
async function ensureDefaultCategories(supabase, companyId) {
  const existing = await listCompanyCategories(supabase, companyId);
  if (existing.length) return existing;
  const rows = DEFAULT_CATEGORIES.map((name, i) => ({ company_id: companyId, name, sort_order: i, is_active: true }));
  const { error } = await supabase.from('expense_categories').insert(rows);
  if (error && !/duplicate|unique/i.test(error.message || '')) {
    throw new AppError(500, 'Failed to create default expense categories: ' + error.message);
  }
  return listCompanyCategories(supabase, companyId);
}

async function categoryUsage(supabase, categoryIds) {
  const usage = new Map();
  if (!categoryIds.length) return usage;
  const { data, error } = await supabase
    .from('job_expenses')
    .select('category_id, amount')
    .in('category_id', categoryIds);
  if (error) throw new AppError(500, 'Failed to load category usage: ' + error.message);
  for (const row of data || []) {
    const key = Number(row.category_id);
    const u = usage.get(key) || { count: 0, total: 0 };
    u.count += 1;
    u.total += Number(row.amount || 0);
    usage.set(key, u);
  }
  return usage;
}

async function loadCategoryOrThrow(supabase, companyId, id) {
  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw new AppError(500, 'Failed to load category: ' + error.message);
  if (!data) throw new AppError(404, 'Expense category not found');
  return data;
}

function parseCategoryName(value) {
  const name = parseStringField(value, 'name', { minLength: 1, maxLength: MAX_CATEGORY_NAME }).replace(/\s+/g, ' ');
  if (!name) throw new AppError(400, 'Category name is required');
  return name;
}

async function assertNameAvailable(supabase, companyId, name, exceptId) {
  const categories = await listCompanyCategories(supabase, companyId);
  const clash = categories.find((c) => c.name.toLowerCase() === name.toLowerCase() && Number(c.id) !== Number(exceptId));
  if (clash) {
    throw new AppError(409, clash.is_active === false
      ? `"${clash.name}" already exists but is deactivated — reactivate it instead.`
      : `A category named "${clash.name}" already exists.`);
  }
}

router.get('/v2/expense-categories', requireAdmin, asyncHandler(async (req, res) => {
  if (!(await hasExpenseTables())) return res.json({ supported: false, message: NOT_MIGRATED_MESSAGE, categories: [] });
  const supabase = requireSupabase();
  const categories = await ensureDefaultCategories(supabase, companyIdOf(req));
  const usage = await categoryUsage(supabase, categories.map((c) => c.id));
  res.json({ supported: true, categories: categories.map((c) => normalizeCategory(c, usage)) });
}));

router.post('/v2/expense-categories', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  await requireExpenseTables();
  const supabase = requireSupabase();
  const companyId = companyIdOf(req);
  const name = parseCategoryName(req.body.name);
  const existing = await ensureDefaultCategories(supabase, companyId);
  await assertNameAvailable(supabase, companyId, name);
  const sortOrder = existing.reduce((max, c) => Math.max(max, Number(c.sort_order || 0)), -1) + 1;
  const { data, error } = await supabase
    .from('expense_categories')
    .insert({ company_id: companyId, name, sort_order: sortOrder, is_active: true })
    .select()
    .single();
  if (error) throw new AppError(500, 'Failed to create category: ' + error.message);
  res.json({ success: true, category: normalizeCategory(data) });
}));

// Rename and/or activate/deactivate. Expenses point at the category's id,
// so a rename shows up on every existing expense and report immediately.
router.put('/v2/expense-categories/:id', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  await requireExpenseTables();
  const supabase = requireSupabase();
  const companyId = companyIdOf(req);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await loadCategoryOrThrow(supabase, companyId, id);

  const updates = { updated_at: new Date().toISOString() };
  if (req.body.name !== undefined) {
    updates.name = parseCategoryName(req.body.name);
    await assertNameAvailable(supabase, companyId, updates.name, id);
  }
  if (req.body.is_active !== undefined) updates.is_active = req.body.is_active === true;
  if (req.body.sort_order !== undefined) updates.sort_order = parseIntField(req.body.sort_order, 'sort_order', { min: 0 });

  const { data, error } = await supabase
    .from('expense_categories')
    .update(updates)
    .eq('id', id)
    .eq('company_id', companyId)
    .select()
    .single();
  if (error) throw new AppError(500, 'Failed to update category: ' + error.message);
  const usage = await categoryUsage(supabase, [id]);
  res.json({ success: true, category: normalizeCategory(data, usage) });
}));

// Permanent delete is only for categories nothing uses (e.g. one added by
// mistake). Anything with expenses must be deactivated instead, so no
// historical cost is ever lost.
router.delete('/v2/expense-categories/:id', requireAdmin, asyncHandler(async (req, res) => {
  await requireExpenseTables();
  const supabase = requireSupabase();
  const companyId = companyIdOf(req);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const category = await loadCategoryOrThrow(supabase, companyId, id);
  const usage = await categoryUsage(supabase, [id]);
  const u = usage.get(id);
  if (u && u.count > 0) {
    throw new AppError(409, `"${category.name}" is used by ${u.count} expense${u.count === 1 ? '' : 's'}. Deactivate it instead — its expenses and totals are kept.`);
  }
  const { error } = await supabase.from('expense_categories').delete().eq('id', id).eq('company_id', companyId);
  if (error) {
    if (/foreign key|violates/i.test(error.message || '')) {
      throw new AppError(409, `"${category.name}" is in use. Deactivate it instead.`);
    }
    throw new AppError(500, 'Failed to delete category: ' + error.message);
  }
  res.json({ success: true });
}));

// ------------------------------------------------------------------
// Job expenses
// ------------------------------------------------------------------
async function loadJobForAdmin(req, jobId) {
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = rows[0];
  if (!job) throw new AppError(404, 'Job not found');
  const { rows: clientRows } = await db.query('SELECT * FROM clients WHERE id = $1', [job.client_id]);
  if (!clientRows[0]) throw new AppError(404, 'Client not found');
  if (!canAccessClient(req, clientRows[0])) throw new AppError(403, 'You do not have access to this job');
  return job;
}

async function listJobExpenseRows(supabase, jobId) {
  const { data, error } = await supabase
    .from('job_expenses')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new AppError(500, 'Failed to load job expenses: ' + error.message);
  return data || [];
}

function normalizeExpense(row, categoriesById) {
  const category = row.category_id !== null && row.category_id !== undefined ? categoriesById.get(Number(row.category_id)) : null;
  return {
    id: row.id,
    job_id: row.job_id,
    description: row.description || '',
    amount: roundMoney(row.amount),
    category_id: row.category_id === null || row.category_id === undefined ? null : Number(row.category_id),
    category_name: category ? category.name : 'Uncategorized',
    category_active: category ? category.is_active !== false : true,
    expense_date: row.expense_date,
    created_at: row.created_at
  };
}

// Totals per category, in category order, with Uncategorized last. Only
// categories that actually hold expenses on this job appear.
function buildBreakdown(expenses, categories) {
  const totals = new Map();
  for (const e of expenses) {
    const key = e.category_id === null ? 'none' : e.category_id;
    const t = totals.get(key) || { category_id: e.category_id, name: e.category_name, is_active: e.category_active, total: 0, count: 0 };
    t.total += e.amount;
    t.count += 1;
    totals.set(key, t);
  }
  const order = new Map(categories.map((c, i) => [Number(c.id), i]));
  return [...totals.values()]
    .sort((a, b) => (a.category_id === null) - (b.category_id === null) ||
      (order.get(Number(a.category_id)) ?? 0) - (order.get(Number(b.category_id)) ?? 0))
    .map((t) => ({ ...t, total: roundMoney(t.total) }));
}

// Recalculates jobs.job_cost from the job's expenses (the one cost figure
// the rest of the CRM uses). Returns the updated job row.
async function recomputeJobCostFromExpenses(supabase, jobId) {
  const rows = await listJobExpenseRows(supabase, jobId);
  const cost = roundMoney(rows.reduce((sum, r) => sum + Number(r.amount || 0), 0));
  const { data, error } = await supabase.from('jobs').update({ job_cost: cost }).eq('id', jobId).select().maybeSingle();
  if (error) throw new AppError(500, 'Failed to update job cost: ' + error.message);
  return data;
}

// Total of a job's itemized expenses, or null when it has none (or the
// tables don't exist yet) — used by the job update route so a job with
// expenses always keeps job_cost equal to their sum.
async function itemizedJobCost(jobId) {
  if (!(await hasExpenseTables())) return null;
  const supabase = getClient();
  if (!supabase) return null;
  const rows = await listJobExpenseRows(supabase, jobId);
  if (!rows.length) return null;
  return roundMoney(rows.reduce((sum, r) => sum + Number(r.amount || 0), 0));
}

// Validates an incoming expense's category: must belong to this business
// and be active — unless it's the category the expense already has (an
// expense in a since-deactivated category can still be edited).
async function resolveCategoryId(supabase, companyId, value, currentId) {
  if (value === null || value === '' || value === undefined) return null;
  const id = parseIntField(value, 'category_id', { min: 1 });
  if (currentId !== undefined && Number(currentId) === id) return id;
  const category = await loadCategoryOrThrow(supabase, companyId, id);
  if (category.is_active === false) throw new AppError(400, `"${category.name}" is deactivated. Choose an active category.`);
  return id;
}

function parseExpenseFields(body, index = null) {
  const prefix = index === null ? '' : `expenses[${index}].`;
  return {
    description: parseStringField(body.description ?? '', prefix + 'description', { required: false, maxLength: 500, defaultValue: '' }),
    amount: roundMoney(parseNumberField(body.amount, prefix + 'amount', { min: 0 }))
  };
}

// The first time a job gets itemized expenses, a cost that was typed in as
// a single number is kept as an Uncategorized expense, so the job's cost
// (and its margin) doesn't silently drop.
async function preserveUnitemizedCost(supabase, job, req) {
  const existing = await listJobExpenseRows(supabase, job.id);
  const typedCost = roundMoney(job.job_cost);
  if (existing.length || typedCost <= 0) return;
  const { error } = await supabase.from('job_expenses').insert({
    job_id: job.id,
    client_id: job.client_id,
    category_id: null,
    description: PRE_ITEMIZED_DESCRIPTION,
    amount: typedCost,
    created_by: (req.session.user && req.session.user.id) || null
  });
  if (error) throw new AppError(500, 'Failed to keep the existing job cost: ' + error.message);
}

async function respondWithJobExpenses(req, res, supabase, jobId, extra = {}) {
  const categories = await ensureDefaultCategories(supabase, companyIdOf(req));
  const byId = new Map(categories.map((c) => [Number(c.id), c]));
  const expenses = (await listJobExpenseRows(supabase, jobId)).map((r) => normalizeExpense(r, byId));
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  res.json({
    supported: true,
    expenses,
    breakdown: buildBreakdown(expenses, categories),
    total: roundMoney(expenses.reduce((s, e) => s + e.amount, 0)),
    categories: categories.map((c) => normalizeCategory(c)),
    job: rows[0] || null,
    ...extra
  });
}

router.get('/jobs/:jobId/expenses', requireAdmin, asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  await db.schemaReady;
  await loadJobForAdmin(req, jobId);
  if (!(await hasExpenseTables())) {
    return res.json({ supported: false, message: NOT_MIGRATED_MESSAGE, expenses: [], breakdown: [], categories: [] });
  }
  await respondWithJobExpenses(req, res, requireSupabase(), jobId);
}));

router.post('/jobs/:jobId/expenses', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  await db.schemaReady;
  const job = await loadJobForAdmin(req, jobId);
  await requireExpenseTables();
  const supabase = requireSupabase();
  const companyId = companyIdOf(req);
  await ensureDefaultCategories(supabase, companyId);

  const fields = parseExpenseFields(req.body);
  const categoryId = await resolveCategoryId(supabase, companyId, req.body.category_id);
  await preserveUnitemizedCost(supabase, job, req);
  const { data, error } = await supabase
    .from('job_expenses')
    .insert({
      job_id: jobId,
      client_id: job.client_id,
      category_id: categoryId,
      ...fields,
      created_by: (req.session.user && req.session.user.id) || null
    })
    .select()
    .single();
  if (error) throw new AppError(500, 'Failed to add expense: ' + error.message);

  await recomputeJobCostFromExpenses(supabase, jobId);
  await refreshFinanceYearsFor(job.created_at, 'job expense add');
  await respondWithJobExpenses(req, res, supabase, jobId, { created_id: data.id });
}));

// Moves an older job's single typed-in cost into the itemized list as an
// Uncategorized line (the same thing adding the first cost does), so it can
// be edited, re-categorized or removed from Job Costs. Nothing is lost: the
// job's cost stays exactly the same.
router.post('/jobs/:jobId/expenses/itemize-existing', requireAdmin, asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  await db.schemaReady;
  const job = await loadJobForAdmin(req, jobId);
  await requireExpenseTables();
  const supabase = requireSupabase();
  await ensureDefaultCategories(supabase, companyIdOf(req));
  await preserveUnitemizedCost(supabase, job, req);
  await recomputeJobCostFromExpenses(supabase, jobId);
  await refreshFinanceYearsFor(job.created_at, 'job expense itemize');
  await respondWithJobExpenses(req, res, supabase, jobId);
}));

router.put('/jobs/:jobId/expenses/:expenseId', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const expenseId = parseIntField(req.params.expenseId, 'expenseId', { min: 1 });
  await db.schemaReady;
  const job = await loadJobForAdmin(req, jobId);
  await requireExpenseTables();
  const supabase = requireSupabase();
  const companyId = companyIdOf(req);

  const { data: existing, error: loadErr } = await supabase
    .from('job_expenses').select('*').eq('id', expenseId).eq('job_id', jobId).maybeSingle();
  if (loadErr) throw new AppError(500, 'Failed to load expense: ' + loadErr.message);
  if (!existing) throw new AppError(404, 'Expense not found');

  const updates = { updated_at: new Date().toISOString() };
  if (req.body.description !== undefined) {
    updates.description = parseStringField(req.body.description ?? '', 'description', { required: false, maxLength: 500, defaultValue: '' });
  }
  if (req.body.amount !== undefined) updates.amount = roundMoney(parseNumberField(req.body.amount, 'amount', { min: 0 }));
  if (req.body.category_id !== undefined) {
    updates.category_id = await resolveCategoryId(supabase, companyId, req.body.category_id, existing.category_id);
  }

  const { error } = await supabase.from('job_expenses').update(updates).eq('id', expenseId).eq('job_id', jobId);
  if (error) throw new AppError(500, 'Failed to update expense: ' + error.message);

  await recomputeJobCostFromExpenses(supabase, jobId);
  await refreshFinanceYearsFor(job.created_at, 'job expense update');
  await respondWithJobExpenses(req, res, supabase, jobId);
}));

router.delete('/jobs/:jobId/expenses/:expenseId', requireAdmin, asyncHandler(async (req, res) => {
  const jobId = parseIntField(req.params.jobId, 'jobId', { min: 1 });
  const expenseId = parseIntField(req.params.expenseId, 'expenseId', { min: 1 });
  await db.schemaReady;
  const job = await loadJobForAdmin(req, jobId);
  await requireExpenseTables();
  const supabase = requireSupabase();

  const { data: removed, error } = await supabase
    .from('job_expenses').delete().eq('id', expenseId).eq('job_id', jobId).select();
  if (error) throw new AppError(500, 'Failed to delete expense: ' + error.message);
  if (!removed || !removed.length) throw new AppError(404, 'Expense not found');

  await recomputeJobCostFromExpenses(supabase, jobId);
  await refreshFinanceYearsFor(job.created_at, 'job expense delete');
  await respondWithJobExpenses(req, res, supabase, jobId);
}));

// Copies expenses onto a newly created job (Duplicate / "Copy of" for
// recurring work). A category that has since been deactivated comes across
// as Uncategorized so the copy never adds new costs under a retired category.
async function copyExpensesToJob(req, newJob, expenses) {
  if (!Array.isArray(expenses) || !expenses.length) return false;
  if (!(await hasExpenseTables())) return false;
  const supabase = requireSupabase();
  const companyId = companyIdOf(req);
  const categories = await ensureDefaultCategories(supabase, companyId);
  const activeIds = new Set(categories.filter((c) => c.is_active !== false).map((c) => Number(c.id)));
  const rows = expenses.slice(0, 100).map((e, i) => {
    const fields = parseExpenseFields(e, i);
    const catId = e.category_id === null || e.category_id === undefined || e.category_id === '' ? null : Number(e.category_id);
    return {
      job_id: newJob.id,
      client_id: newJob.client_id,
      category_id: catId !== null && activeIds.has(catId) ? catId : null,
      ...fields,
      created_by: (req.session.user && req.session.user.id) || null
    };
  });
  const { error } = await supabase.from('job_expenses').insert(rows);
  if (error) throw new AppError(500, 'Failed to copy expenses: ' + error.message);
  await recomputeJobCostFromExpenses(supabase, newJob.id);
  return true;
}

module.exports = {
  router,
  DEFAULT_CATEGORIES,
  itemizedJobCost,
  copyExpensesToJob
};

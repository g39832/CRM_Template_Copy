const express = require('express');
const router = express.Router();
const db = require('./db');
const { getClient } = require('./db-v2');
const { asyncHandler, assertObject, parseIntField, parseNumberField, parseStringField, parseYear, AppError } = require('./request-utils');
const {
  isAdmin,
  currentUserId,
  requireAdmin,
  canAccessClient,
  sanitizeClient,
  sanitizeClients,
  filterClientsForUser
} = require('./access-control');

const CLIENT_STAGES = ['Lead', 'Photo report', 'Prospect', 'Approved', 'Invoiced', 'Closed'];

// Ensures a non-admin can only read/act on a client that is assigned to
// them. Fetches the client row (all columns) and throws 403/404 as
// appropriate. Returns the (unsanitized) row so the caller can use it.
async function loadClientWithAccessCheck(req, id) {
  const { rows } = await db.query('SELECT * FROM clients WHERE id = $1', [id]);
  const client = rows[0];
  if (!client) throw new AppError(404, 'Client not found');
  if (!canAccessClient(req, client)) throw new AppError(403, 'You do not have access to this client');
  return client;
}

// ======================================================
// HELPER: SAFE YEAR HANDLER
// ======================================================
function getValidYear(inputYear) {
  const currentYear = new Date().getFullYear();
  const parsed = Number.parseInt(inputYear, 10);
  return !parsed || parsed < 2000 || parsed > currentYear + 5
    ? currentYear
    : parsed;
}

function parseOptionalPagination(value, max) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(parsed, max);
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

  const clientSummary = clientSummaryResult.rows[0] || {};
  const paymentSummary = paymentSummaryResult.rows[0] || {};

  return {
    total_clients: Number(clientSummary.total_clients || 0),
    total_expected: Number(clientSummary.total_expected || 0),
    total_received: Number(paymentSummary.total_received || 0),
    total_remaining: Number(clientSummary.total_remaining || 0)
  };
}

// ======================================================
// HELPER: UPDATE FINANCE TOTALS FOR A YEAR
// ======================================================
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

// ======================================================
// SEARCH CLIENTS
// ======================================================
router.get('/search/filtered', asyncHandler(async (req, res) => {
  var term = String(req.query.q || '').slice(0, 200);
  var clientType = String(req.query.type || '').trim();
  var status = String(req.query.status || '').trim();
  var dateFrom = String(req.query.dateFrom || '').trim();
  var dateTo = String(req.query.dateTo || '').trim();
  var revenueMin = req.query.revenueMin ? Number(req.query.revenueMin) : null;
  var revenueMax = req.query.revenueMax ? Number(req.query.revenueMax) : null;

  await db.schemaReady;

  // db.js's query() only recognizes a fixed set of exact SQL strings (see
  // api/db.js) — it can't handle this route's conditionally-built WHERE
  // clause, so this goes straight through the real Supabase client instead.
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  let query = supabase.from('clients').select('*');

  if (term) {
    const like = `%${term}%`;
    query = query.or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like},address.ilike.${like}`);
  }
  if (clientType === 'one-off' || clientType === 'recurring') {
    query = query.eq('client_type', clientType);
  }
  if (status) {
    query = query.eq('status', status);
  }
  if (dateFrom) {
    query = query.gte('created_at', dateFrom);
  }
  if (dateTo) {
    query = query.lt('created_at', dateTo + 'T23:59:59.999');
  }
  if (revenueMin !== null && Number.isFinite(revenueMin)) {
    query = query.gte('total_due', revenueMin);
  }
  if (revenueMax !== null && Number.isFinite(revenueMax)) {
    query = query.lte('total_due', revenueMax);
  }

  const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
  if (error) throw new AppError(500, 'Filtered search failed: ' + error.message);

  return res.json(sanitizeClients(req, filterClientsForUser(req, data || [])));
}));

router.get('/search', asyncHandler(async (req, res) => {
  const term = parseStringField(req.query.q ?? '', 'q', { required: false, maxLength: 200, defaultValue: '' });
  const limit = parseOptionalPagination(req.query.limit, 500);
  const offset = parseOptionalPagination(req.query.offset, 1000000) ?? 0;
  await db.schemaReady;

  // Non-admins can only ever see their assigned clients, so pagination
  // is applied AFTER filtering (never leaks another user's row count).
  async function respondFiltered(rows) {
    const visible = filterClientsForUser(req, rows);
    const sliced = isAdmin(req) || limit === null ? visible : visible.slice(offset, offset + limit);
    return res.json(sanitizeClients(req, sliced));
  }

  if (!term) {
    if (limit === null || !isAdmin(req)) {
      const { rows } = await db.query('SELECT * FROM clients ORDER BY created_at DESC');
      return respondFiltered(rows);
    }
    const { rows } = await db.query(
      'SELECT * FROM clients ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return respondFiltered(rows);
  }

  const like = `%${term}%`;
  let sql = `
    SELECT DISTINCT clients.*
    FROM clients
    LEFT JOIN notes ON notes.client_id = clients.id
    WHERE clients.name ILIKE $1
       OR clients.phone ILIKE $2
       OR clients.email ILIKE $3
       OR clients.address ILIKE $4
       OR notes.content ILIKE $5
    ORDER BY clients.created_at DESC
  `;
  const params = [like, like, like, like, like];
  if (limit !== null && isAdmin(req)) {
    sql += ' LIMIT $6 OFFSET $7';
    params.push(limit, offset);
  }
  const { rows } = await db.query(sql, params);

  return respondFiltered(rows);
}));

// ======================================================
// SAVE CLIENT
// ======================================================
router.post('/save-client', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const fName = parseStringField(req.body.fName ?? '', 'fName', { required: false, maxLength: 120, defaultValue: '' });
  const lName = parseStringField(req.body.lName ?? '', 'lName', { required: false, maxLength: 120, defaultValue: '' });
  const name = parseStringField(req.body.name ?? '', 'name', { required: false, maxLength: 260, defaultValue: '' });
  const phone = parseStringField(req.body.phone ?? '', 'phone', { required: false, maxLength: 40, defaultValue: '' });
  const email = parseStringField(req.body.email ?? '', 'email', { required: false, maxLength: 254, defaultValue: '' });
  const address = parseStringField(req.body.address ?? '', 'address', { required: false, maxLength: 500, defaultValue: '' });
  const status = parseStringField(req.body.status ?? 'Lead', 'status', { required: false, maxLength: 30, defaultValue: 'Lead' });
  const scopeOfWork = parseStringField(req.body.scope_of_work ?? '', 'scope_of_work', { required: false, maxLength: 5000, defaultValue: '' });
  // total_due and job_cost are financial fields (Section 8: contract
  // amount, margin/cost basis) — only admins may set them, on create
  // or update. Regular users create leads/clients without pricing;
  // an admin fills in the contract amount and cost afterward.
  const totalDueInput = isAdmin(req) ? req.body.total_due : undefined;
  const jobCost = isAdmin(req) ? parseNumberField(req.body.job_cost ?? 0, 'job_cost', { required: false, defaultValue: 0 }) : 0;
  const finalName = name || `${fName} ${lName}`.trim();
  if (!finalName) return res.status(400).json({ error: 'Name required' });

  const total = parseNumberField(totalDueInput ?? 0, 'total_due', { required: false, defaultValue: 0 });
  const createdAt = new Date().toISOString();
  // A regular user's new client is auto-assigned to them so it's
  // immediately visible under their own access. Admins may optionally
  // assign it to someone else up front via assigned_user_id.
  const assignedUserId = isAdmin(req)
    ? (req.body.assigned_user_id || null)
    : currentUserId(req);

  await db.schemaReady;
  // Try to insert with new columns — gracefully fall back if they don't exist yet
  try {
    await db.query(`
      INSERT INTO clients (name, phone, email, address, status, total_due, amount_paid, balance, scope_of_work, job_cost, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10)
    `, [finalName, phone, email, address, status || 'Lead', total, total, scopeOfWork, jobCost, createdAt]);
  } catch (colErr) {
    if (String(colErr?.message || '').toLowerCase().includes('column') ||
        String(colErr?.message || '').toLowerCase().includes('unsupported')) {
      await db.query(`
        INSERT INTO clients (name, phone, email, address, status, total_due, amount_paid, balance, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8)
      `, [finalName, phone, email, address, status || 'Lead', total, total, createdAt]);
    } else {
      throw colErr;
    }
  }

  // Assign the new client (best-effort — the assigned_user_id column
  // may not exist yet on an unmigrated database). db.js's insert path
  // doesn't return the new row's id, so the most recently created
  // client with this name is used to find it — matches the same
  // "search right after create" pattern the rest of this endpoint
  // already relies on.
  if (assignedUserId) {
    try {
      const supabase = getClient();
      if (supabase) {
        const { data: created } = await supabase
          .from('clients')
          .select('id')
          .eq('name', finalName)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (created) {
          await supabase.from('clients').update({ assigned_user_id: assignedUserId }).eq('id', created.id);
        }
      }
    } catch (e) {
      console.warn('[clients] Could not set assigned_user_id on create:', e.message);
    }
  }

  const year = new Date(createdAt).getFullYear();
  await updateFinanceTotals(year);

  return res.json({ success: true, financeUpdated: true });
}));

// ======================================================
// UPDATE CLIENT
// ======================================================
router.post('/update-project', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.body.id, 'id', { min: 1 });
  const fName = parseStringField(req.body.fName ?? '', 'fName', { required: false, maxLength: 120, defaultValue: '' });
  const lName = parseStringField(req.body.lName ?? '', 'lName', { required: false, maxLength: 120, defaultValue: '' });
  const name = parseStringField(req.body.name ?? '', 'name', { required: false, maxLength: 260, defaultValue: '' });
  const phone = parseStringField(req.body.phone ?? '', 'phone', { required: false, maxLength: 40, defaultValue: '' });
  const email = parseStringField(req.body.email ?? '', 'email', { required: false, maxLength: 254, defaultValue: '' });
  const address = parseStringField(req.body.address ?? '', 'address', { required: false, maxLength: 500, defaultValue: '' });
  const status = parseStringField(req.body.status ?? '', 'status', { required: false, maxLength: 30, defaultValue: '' });
  const scopeOfWork = parseStringField(req.body.scope_of_work ?? '', 'scope_of_work', { required: false, maxLength: 5000, defaultValue: '' });
  // Financial fields (Section 8) — only admins may change these, even
  // through this general-purpose "save changes" endpoint.
  const totalDueInput = isAdmin(req) ? req.body.total_due : undefined;
  const jobCostInput = isAdmin(req) ? req.body.job_cost : undefined;

  await db.schemaReady;
  const clientRow = await loadClientWithAccessCheck(req, id);
  const fallbackName = String(clientRow.name || '').trim();

  const newTotal = typeof totalDueInput !== 'undefined'
    ? parseNumberField(totalDueInput, 'total_due', { required: false, defaultValue: Number(clientRow.total_due || 0) })
    : Number(clientRow.total_due || 0);
  const newBalance = (newTotal || 0) - Number(clientRow.amount_paid || 0);
  const newJobCost = typeof jobCostInput !== 'undefined'
    ? parseNumberField(jobCostInput, 'job_cost', { required: false, defaultValue: Number(clientRow.job_cost || 0) })
    : Number(clientRow.job_cost || 0);
  const finalName = name || `${fName} ${lName}`.trim() || fallbackName;
  let finalStatus = status || String(clientRow.status || 'Lead').trim() || 'Lead';
  // Client stage is restricted to the six pipeline stages. An unknown
  // value (e.g. a stale client sending an old status) is ignored in
  // favor of the client's current stage rather than corrupting it.
  if (status && !CLIENT_STAGES.includes(status)) {
    finalStatus = String(clientRow.status || 'Lead').trim() || 'Lead';
  }
  if (!finalName) {
    return res.status(400).json({ error: 'Name required' });
  }

  // Try to save scope_of_work and job_cost — gracefully skip if columns don't exist yet
  try {
    await db.query(`
      UPDATE clients
      SET name = $1, phone = $2, email = $3, address = $4, status = $5, total_due = $6, balance = $7,
          scope_of_work = $8, job_cost = $9
      WHERE id = $10
    `, [finalName, phone, email, address, finalStatus, newTotal || 0, newBalance, scopeOfWork, newJobCost, id]);
  } catch (colErr) {
    // Fallback: save without new columns if they don't exist in DB yet
    if (String(colErr?.message || '').toLowerCase().includes('column') ||
        String(colErr?.message || '').toLowerCase().includes('unsupported')) {
      await db.query(`
        UPDATE clients
        SET name = $1, phone = $2, email = $3, address = $4, status = $5, total_due = $6, balance = $7
        WHERE id = $8
      `, [finalName, phone, email, address, finalStatus, newTotal || 0, newBalance, id]);
    } else {
      throw colErr;
    }
  }

  const year = new Date(clientRow.created_at).getFullYear();
  await updateFinanceTotals(year);

  return res.json({ success: true, financeUpdated: true });
}));

// ======================================================
// DELETE CLIENT
// ======================================================
router.post('/delete-client', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.body.id, 'id', { min: 1 });

  await db.schemaReady;
  const clientRow = await loadClientWithAccessCheck(req, id);

  await db.query('DELETE FROM clients WHERE id = $1', [id]);

  if (clientRow) {
    const year = new Date(clientRow.created_at).getFullYear();
    await updateFinanceTotals(year);
  }

  return res.json({ success: true, financeUpdated: true });
}));

// ======================================================
// UPDATE TOTAL DUE
// ======================================================
async function handleUpdateTotal(req, res) {
  try {
    assertObject(req.body);
    const id = parseIntField(req.params.id, 'id', { min: 1 });
    const rawTotal = req.body.total ?? req.body.total_due;
    console.debug('[clients.total] incoming body:', req.body);
    if (rawTotal === undefined || rawTotal === null || rawTotal === '') {
      return res.status(400).json({ error: 'total is required' });
    }

    const total = Number(rawTotal);
    console.debug('[clients.total] computed total:', total);
    if (!Number.isFinite(total)) {
      return res.status(400).json({ error: 'total must be a valid number' });
    }

    await db.schemaReady;
    console.debug('[clients.total] fetching client row for id:', id);
    const clientResult = await db.query('SELECT total_due, amount_paid, created_at FROM clients WHERE id = $1', [id]);
    const clientRow = clientResult.rows[0];
    console.debug('[clients.total] client row result:', clientRow);
    if (!clientRow) return res.status(404).json({ error: 'Client not found' });

    const newBalance = total - Number(clientRow.amount_paid || 0);
    console.debug('[clients.total] updating client row:', { id, total, newBalance });

    await db.query('UPDATE clients SET total_due = $1, balance = $2 WHERE id = $3', [total, newBalance, id]);

    const year = clientRow.created_at ? new Date(clientRow.created_at).getFullYear() : new Date().getFullYear();
    console.debug('[clients.total] updating finance totals for year:', year);
    await updateFinanceTotalsSafe(year, 'client total');

    return res.json({ success: true, financeUpdated: true });
  } catch (err) {
    console.error('Failed to update client total:', err);
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}

router.put('/clients/:id/total', requireAdmin, asyncHandler(handleUpdateTotal));
router.post('/clients/:id/total', requireAdmin, asyncHandler(handleUpdateTotal));

// ======================================================
// RECORD PAYMENT
// ======================================================
router.put('/clients/:id/payment', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const amount = parseNumberField(req.body.payment ?? 0, 'payment', { required: false, defaultValue: 0 });
  if (amount <= 0) return res.status(400).json({ error: 'Invalid payment amount' });

  await db.schemaReady;
  const clientResult = await db.query('SELECT total_due, amount_paid, created_at FROM clients WHERE id = $1', [id]);
  const clientRow = clientResult.rows[0];
  if (!clientRow) return res.status(404).json({ error: 'Client not found' });

  const newPaid = Number(clientRow.amount_paid || 0) + amount;
  const newBalance = Number(clientRow.total_due || 0) - newPaid;

  const conn = await db.pool.connect();
  try {
    await conn.query('BEGIN');
    await conn.query(
      'INSERT INTO payments (client_id, amount, payment_date) VALUES ($1, $2, CURRENT_TIMESTAMP)',
      [id, amount]
    );
    await conn.query(
      'UPDATE clients SET amount_paid = $1, balance = $2 WHERE id = $3',
      [newPaid, newBalance, id]
    );
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  const year = clientRow.created_at ? new Date(clientRow.created_at).getFullYear() : new Date().getFullYear();
  await updateFinanceTotalsSafe(year, 'client payment');

  return res.json({ success: true, financeUpdated: true });
}));

// ======================================================
// RESET BALANCE (FORCE RE-CALC)
// ======================================================
router.put('/clients/:id/reset-paid', requireAdmin, asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });

  await db.schemaReady;
  const clientResult = await db.query('SELECT total_due, amount_paid, created_at FROM clients WHERE id = $1', [id]);
  const clientRow = clientResult.rows[0];
  if (!clientRow) return res.status(404).json({ error: 'Client not found' });

  const alreadyPaid = Number(clientRow.amount_paid || 0);

  const conn = await db.pool.connect();
  try {
    await conn.query('BEGIN');
    if (alreadyPaid > 0) {
      await conn.query(
        'INSERT INTO payments (client_id, amount, payment_date) VALUES ($1, $2, CURRENT_TIMESTAMP)',
        [id, -alreadyPaid]
      );
    }
    const newBalance = Number(clientRow.total_due || 0);
    await conn.query('UPDATE clients SET amount_paid = 0, balance = $1 WHERE id = $2', [newBalance, id]);
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  const year = clientRow.created_at ? new Date(clientRow.created_at).getFullYear() : new Date().getFullYear();
  await updateFinanceTotalsSafe(year, 'reset paid');

  const updatedClientResult = await db.query('SELECT total_due, amount_paid, balance FROM clients WHERE id = $1', [id]);
  return res.json({ success: true, client: updatedClientResult.rows[0], financeUpdated: true });
}));

// ======================================================
// RESTORE FINANCE STATE (FOR UNDO)
// ======================================================
router.put('/clients/:id/finance-state', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const total_due = parseNumberField(req.body.total_due ?? 0, 'total_due', { required: false, defaultValue: 0 });
  const amount_paid = parseNumberField(req.body.amount_paid ?? 0, 'amount_paid', { required: false, defaultValue: 0 });

  await db.schemaReady;
  const clientResult = await db.query('SELECT total_due, amount_paid, created_at FROM clients WHERE id = $1', [id]);
  const clientRow = clientResult.rows[0];
  if (!clientRow) return res.status(404).json({ error: 'Client not found' });

  const nextTotal = total_due;
  const nextPaid = amount_paid;
  const nextBalance = nextTotal - nextPaid;
  const deltaPaid = nextPaid - Number(clientRow.amount_paid || 0);

  const conn = await db.pool.connect();
  try {
    await conn.query('BEGIN');
    if (deltaPaid !== 0) {
      await conn.query(
        'INSERT INTO payments (client_id, amount, payment_date) VALUES ($1, $2, CURRENT_TIMESTAMP)',
        [id, deltaPaid]
      );
    }
    await conn.query(
      'UPDATE clients SET total_due = $1, amount_paid = $2, balance = $3 WHERE id = $4',
      [nextTotal, nextPaid, nextBalance, id]
    );
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  const year = clientRow.created_at ? new Date(clientRow.created_at).getFullYear() : new Date().getFullYear();
  await updateFinanceTotalsSafe(year, 'finance state restore');

  const updatedClientResult = await db.query('SELECT total_due, amount_paid, balance FROM clients WHERE id = $1', [id]);
  return res.json({ success: true, client: updatedClientResult.rows[0], financeUpdated: true });
}));

// ======================================================
// FINANCE PAGE ROUTES
// ======================================================

// Available Years
router.get('/finance/years', requireAdmin, asyncHandler(async (req, res) => {
  try {
    await db.schemaReady;

    const clientYearsResult = await db.query('SELECT DISTINCT EXTRACT(YEAR FROM created_at)::int AS year FROM clients');
    const paymentYearsResult = await db.query('SELECT DISTINCT EXTRACT(YEAR FROM payment_date)::int AS year FROM payments');
    const overrideYearsResult = await db.query('SELECT year FROM finance_overrides WHERE year IS NOT NULL');

    const clientYears = clientYearsResult.rows.map((r) => Number(r.year));
    const paymentYears = paymentYearsResult.rows.map((r) => Number(r.year));
    const overrideYears = overrideYearsResult.rows.map((r) => Number(r.year));

    const allYears = [...clientYears, ...paymentYears, ...overrideYears];
    const uniqueYears = [...new Set(allYears.filter((y) => Number.isInteger(y) && y > 0))];

    const currentYear = new Date().getFullYear();
    if (!uniqueYears.includes(currentYear)) uniqueYears.push(currentYear);

    uniqueYears.sort((a, b) => b - a);
    return res.json(uniqueYears);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch years' });
  }
}));

// Save Year Data (Manual Override)
router.post('/finance/save', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const year = parseYear(req.body.year, 'year');
  const totalExpected = parseNumberField(req.body.totalExpected ?? 0, 'totalExpected', { required: false, defaultValue: 0 });
  const totalReceived = parseNumberField(req.body.totalReceived ?? 0, 'totalReceived', { required: false, defaultValue: 0 });
  const totalRemaining = parseNumberField(req.body.totalRemaining ?? 0, 'totalRemaining', { required: false, defaultValue: 0 });
  const totalClients = parseIntField(req.body.totalClients ?? 0, 'totalClients', { required: false, min: 0 });

  try {
    await db.schemaReady;
    await db.query(`
      INSERT INTO finance_overrides (year, total_expected, total_received, total_remaining, total_clients)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT(year) DO UPDATE SET
        total_expected = EXCLUDED.total_expected,
        total_received = EXCLUDED.total_received,
        total_remaining = EXCLUDED.total_remaining,
        total_clients = EXCLUDED.total_clients,
        updated_at = CURRENT_TIMESTAMP
    `, [year, totalExpected, totalReceived, totalRemaining, totalClients]);

    return res.json({ success: true });
  } catch (err) {
    console.error('Finance save error:', err);
    return res.status(500).json({ error: 'Failed to save finance data' });
  }
}));

// ======================================================
// UPDATED FINANCE SUMMARY (CUMULATIVE BALANCES)
// ======================================================
router.get('/finance/summary', requireAdmin, asyncHandler(async (req, res) => {
  const year = req.query.year ? parseYear(req.query.year, 'year') : getValidYear(req.query.year);

  try {
    await db.schemaReady;
    const yearSummary = await getFinanceTotalsForYear(year);

    const overrideResult = await db.query('SELECT * FROM finance_overrides WHERE year = $1', [year]);

    const override = overrideResult.rows[0];

    const finalSummary = override || {
      total_clients: yearSummary.total_clients,
      total_expected: yearSummary.total_expected,
      total_received: yearSummary.total_received,
      total_remaining: yearSummary.total_remaining
    };

    // Compute average margin % for clients created in this year
    // margin = (total_due - job_cost) / total_due * 100, only where total_due > 0
    let avgMarginPct = null;
    try {
      const marginResult = await db.query(`
        SELECT AVG(((total_due - job_cost) / NULLIF(total_due, 0)) * 100) AS avg_margin
        FROM clients
        WHERE EXTRACT(YEAR FROM created_at)::int = $1
          AND total_due > 0
          AND job_cost IS NOT NULL
          AND job_cost > 0
      `, [year]);
      const raw = marginResult.rows[0]?.avg_margin;
      avgMarginPct = raw !== null && raw !== undefined ? Number(raw) : null;
    } catch (e) {
      // job_cost column may not exist yet on older DBs — gracefully skip
      avgMarginPct = null;
    }

    return res.json({
      mode: 'project',
      year,
      totalClients: Number(finalSummary.total_clients || finalSummary.totalClients || 0),
      totalExpected: Number(finalSummary.total_expected || finalSummary.totalExpected || 0),
      totalReceived: Number(finalSummary.total_received || finalSummary.totalReceived || 0),
      totalRemaining: Number(finalSummary.total_remaining || finalSummary.totalRemaining || 0),
      avgMarginPct: avgMarginPct !== null ? Math.round(avgMarginPct * 10) / 10 : null
    });
  } catch (err) {
    console.error('Finance summary error:', err);
    return res.status(500).json({ error: 'Failed to fetch project summary' });
  }
}));

// ======================================================
// CASH SUMMARY
// ======================================================
router.get('/finance/cash-summary', requireAdmin, asyncHandler(async (req, res) => {
  const year = req.query.year ? parseYear(req.query.year, 'year') : getValidYear(req.query.year);
  try {
    await db.schemaReady;
    const summaryResult = await db.query(`
      SELECT
        COUNT(DISTINCT client_id)::int AS paying_clients,
        COALESCE(SUM(amount), 0) AS total_cash_received
      FROM payments
      WHERE EXTRACT(YEAR FROM payment_date)::int = $1
    `, [year]);

    const summary = summaryResult.rows[0] || {};

    return res.json({
      mode: 'cash',
      year,
      payingClients: Number(summary.paying_clients || 0),
      totalCashReceived: Number(summary.total_cash_received || 0)
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch cash summary' });
  }
}));

// ======================================================
// MARGIN TRACKER DATA
// ======================================================
const MARGIN_CATEGORIES = ['Labor', 'Marketing', 'Software', 'Contractors', 'Operations', 'Taxes', 'Misc'];
const MARGIN_INVOICE_STATUSES = ['Pending', 'Billed', 'Partially Paid', 'Paid', 'Overdue'];

function normalizeDateInput(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function parseBooleanish(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function normalizeMarginEntryRow(row, clientNameLookup = new Map()) {
  const clientId = row.client_id === null || row.client_id === undefined || row.client_id === '' ? null : Number(row.client_id);
  const resolvedClientName = row.client_name || (clientId !== null ? clientNameLookup.get(clientId) : '') || '';
  return {
    id: Number(row.id),
    client_id: clientId,
    client_name: resolvedClientName,
    category: row.category || 'Misc',
    project: row.project || '',
    invoice_status: row.invoice_status || 'Pending',
    amount: Number(row.amount || 0),
    expense_type: row.expense_type || 'one-time',
    recurring: parseBooleanish(row.recurring),
    expense_date: normalizeDateInput(row.expense_date),
    notes: row.notes || '',
    attachment_url: row.attachment_url || '',
    created_at: normalizeDateInput(row.created_at),
    updated_at: normalizeDateInput(row.updated_at)
  };
}

async function getMarginBaseData() {
  await db.schemaReady;
  const [clientsResult, paymentsResult] = await Promise.all([
    db.query('SELECT * FROM clients'),
    db.query('SELECT * FROM payments')
  ]);

  let entriesResult = { rows: [] };
  try {
    entriesResult = await db.query('SELECT * FROM finance_margin_entries');
  } catch (err) {
    const message = String(err?.message || '').toLowerCase();
    if (!message.includes('finance_margin_entries') && !message.includes('does not exist') && err?.code !== '42P01') {
      throw err;
    }
    entriesResult = { rows: [] };
  }

  return {
    clients: clientsResult.rows || [],
    payments: paymentsResult.rows || [],
    expenses: entriesResult.rows || []
  };
}

async function resolveClientName(clientId) {
  if (clientId === null || clientId === undefined || clientId === '') return '';
  const { rows } = await db.query('SELECT * FROM clients');
  const client = rows.find((row) => Number(row.id) === Number(clientId));
  return client?.name || '';
}

router.get('/finance/margin/dashboard', requireAdmin, asyncHandler(async (req, res) => {
  const year = req.query.year ? parseYear(req.query.year, 'year') : getValidYear(req.query.year);

  try {
    const baseData = await getMarginBaseData();
    const clientNameLookup = new Map(baseData.clients.map((client) => [Number(client.id), client.name || '']));
    const expenses = baseData.expenses.map((row) => normalizeMarginEntryRow(row, clientNameLookup));

    let override = null;
    try {
      const overrideResult = await db.query('SELECT * FROM finance_overrides WHERE year = $1', [year]);
      if (overrideResult.rows.length > 0) {
        const row = overrideResult.rows[0];
        override = {
          year: Number(row.year),
          totalExpected: Number(row.total_expected || 0),
          totalReceived: Number(row.total_received || 0),
          totalRemaining: Number(row.total_remaining || 0),
          totalClients: Number(row.total_clients || 0)
        };
      }
    } catch (e) {
      // finance_overrides table may not exist — silently skip
    }

    return res.json({
      year,
      previousYear: year - 1,
      categories: MARGIN_CATEGORIES,
      invoiceStatuses: MARGIN_INVOICE_STATUSES,
      clients: baseData.clients,
      payments: baseData.payments,
      expenses,
      overrides: override
    });
  } catch (err) {
    console.error('Margin dashboard error:', err);
    return res.status(500).json({ error: 'Failed to fetch margin dashboard data' });
  }
}));

router.post('/finance/margin/entries', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);

  const clientId = req.body.client_id ?? req.body.clientId ?? null;
  const parsedClientId = clientId === null || clientId === undefined || clientId === '' ? null : parseIntField(clientId, 'client_id', { min: 1, required: false });
  const clientNameInput = parseStringField(req.body.client_name ?? req.body.clientName ?? '', 'client_name', { required: false, maxLength: 260, defaultValue: '' });
  const category = parseStringField(req.body.category ?? 'Misc', 'category', { required: false, maxLength: 80, defaultValue: 'Misc' });
  const project = parseStringField(req.body.project ?? '', 'project', { required: false, maxLength: 120, defaultValue: '' });
  const invoiceStatus = parseStringField(req.body.invoice_status ?? req.body.invoiceStatus ?? 'Pending', 'invoice_status', { required: false, maxLength: 80, defaultValue: 'Pending' });
  const amount = parseNumberField(req.body.amount ?? 0, 'amount', { required: false, defaultValue: 0, min: 0 });
  const expenseType = parseStringField(req.body.expense_type ?? req.body.expenseType ?? 'one-time', 'expense_type', { required: false, maxLength: 40, defaultValue: 'one-time' });
  const recurring = parseBooleanish(req.body.recurring ?? false);
  const expenseDate = normalizeDateInput(req.body.expense_date ?? req.body.expenseDate, new Date().toISOString());
  const notes = parseStringField(req.body.notes ?? '', 'notes', { required: false, maxLength: 5000, defaultValue: '' });
  const attachmentUrl = parseStringField(req.body.attachment_url ?? req.body.attachmentUrl ?? '', 'attachment_url', { required: false, maxLength: 2000, defaultValue: '' });

  const resolvedClientName = clientNameInput || (parsedClientId ? await resolveClientName(parsedClientId) : '');

  await db.schemaReady;
  await db.query(`
    INSERT INTO finance_margin_entries (
      client_id, client_name, category, project, invoice_status,
      amount, expense_type, recurring, expense_date, notes, attachment_url,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  `, [
    parsedClientId,
    resolvedClientName,
    category,
    project,
    invoiceStatus,
    amount,
    expenseType,
    recurring,
    expenseDate,
    notes,
    attachmentUrl,
    new Date().toISOString(),
    new Date().toISOString()
  ]);

  return res.json({ success: true, marginUpdated: true });
}));

router.put('/finance/margin/entries/:id', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });

  const clientId = req.body.client_id ?? req.body.clientId ?? null;
  const parsedClientId = clientId === null || clientId === undefined || clientId === '' ? null : parseIntField(clientId, 'client_id', { min: 1, required: false });
  const clientNameInput = parseStringField(req.body.client_name ?? req.body.clientName ?? '', 'client_name', { required: false, maxLength: 260, defaultValue: '' });
  const category = parseStringField(req.body.category ?? 'Misc', 'category', { required: false, maxLength: 80, defaultValue: 'Misc' });
  const project = parseStringField(req.body.project ?? '', 'project', { required: false, maxLength: 120, defaultValue: '' });
  const invoiceStatus = parseStringField(req.body.invoice_status ?? req.body.invoiceStatus ?? 'Pending', 'invoice_status', { required: false, maxLength: 80, defaultValue: 'Pending' });
  const amount = parseNumberField(req.body.amount ?? 0, 'amount', { required: false, defaultValue: 0, min: 0 });
  const expenseType = parseStringField(req.body.expense_type ?? req.body.expenseType ?? 'one-time', 'expense_type', { required: false, maxLength: 40, defaultValue: 'one-time' });
  const recurring = parseBooleanish(req.body.recurring ?? false);
  const expenseDate = normalizeDateInput(req.body.expense_date ?? req.body.expenseDate, new Date().toISOString());
  const notes = parseStringField(req.body.notes ?? '', 'notes', { required: false, maxLength: 5000, defaultValue: '' });
  const attachmentUrl = parseStringField(req.body.attachment_url ?? req.body.attachmentUrl ?? '', 'attachment_url', { required: false, maxLength: 2000, defaultValue: '' });

  const resolvedClientName = clientNameInput || (parsedClientId ? await resolveClientName(parsedClientId) : '');

  await db.schemaReady;
  await db.query(`
    UPDATE finance_margin_entries
    SET client_id = $1, client_name = $2, category = $3, project = $4, invoice_status = $5,
        amount = $6, expense_type = $7, recurring = $8, expense_date = $9,
        notes = $10, attachment_url = $11, updated_at = CURRENT_TIMESTAMP
    WHERE id = $12
  `, [
    parsedClientId,
    resolvedClientName,
    category,
    project,
    invoiceStatus,
    amount,
    expenseType,
    recurring,
    expenseDate,
    notes,
    attachmentUrl,
    id
  ]);

  return res.json({ success: true, marginUpdated: true });
}));

router.delete('/finance/margin/entries/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await db.schemaReady;
  await db.query('DELETE FROM finance_margin_entries WHERE id = $1', [id]);
  return res.json({ success: true, marginUpdated: true });
}));

// ======================================================
// NOTES ROUTES
// ======================================================
router.get('/clients/:id/notes', asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await db.schemaReady;
  await loadClientWithAccessCheck(req, id);
  const { rows } = await db.query(
    'SELECT id, content, created_at FROM notes WHERE client_id = $1 ORDER BY created_at DESC',
    [id]
  );
  return res.json(rows);
}));

router.post('/clients/:id/notes', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const content = parseStringField(req.body.content, 'content', { minLength: 1, maxLength: 10000 });

  await db.schemaReady;
  await loadClientWithAccessCheck(req, id);
  await db.query('INSERT INTO notes (client_id, content) VALUES ($1, $2)', [id, content]);
  return res.json({ success: true });
}));

router.put('/clients/:id/notes/:noteId', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });
  const content = parseStringField(req.body.content, 'content', { minLength: 1, maxLength: 10000 });

  await db.schemaReady;
  await loadClientWithAccessCheck(req, id);
  const result = await db.query('UPDATE notes SET content = $1 WHERE id = $2 AND client_id = $3', [content, noteId, id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found' });
  return res.json({ success: true });
}));

router.delete('/clients/:id/notes/:noteId', asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });

  await db.schemaReady;
  await loadClientWithAccessCheck(req, id);
  const result = await db.query('DELETE FROM notes WHERE id = $1 AND client_id = $2', [noteId, id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found' });
  return res.json({ success: true });
}));

// ======================================================
// CLIENT STAGE OPTIONS (Section 2/6)
// ======================================================
router.get('/clients/stages', asyncHandler(async (req, res) => {
  res.json({ stages: CLIENT_STAGES });
}));

// ======================================================
// ASSIGN CLIENT TO A USER (admin only — Section 3)
// ======================================================
router.put('/clients/:id/assign', requireAdmin, asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const assignedUserId = req.body.assigned_user_id || null;

  await db.schemaReady;
  const { rows } = await db.query('SELECT * FROM clients WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Client not found' });

  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');

  const { data, error } = await supabase
    .from('clients')
    .update({ assigned_user_id: assignedUserId })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) throw new AppError(500, 'Failed to assign client: ' + error.message);
  return res.json({ success: true, client: data });
}));

module.exports = router;

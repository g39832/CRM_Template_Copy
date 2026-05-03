const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_ACCESS_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ACCESS_KEY);

function buildClient() {
  if (!isConfigured) return null;
  return createClient(SUPABASE_URL, SUPABASE_ACCESS_KEY, {
    auth: { persistSession: false }
  });
}

const supabase = buildClient();

function ensureConfigured() {
  if (supabase) return;
  throw new Error('SUPABASE_URL and either SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY are required');
}

function normalizeSql(sql) {
  return String(sql || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toDateValue(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function makeResult(rows) {
  return { rows, rowCount: rows.length };
}

function rowMatchesSearch(row, term) {
  const haystack = [
    row.name,
    row.phone,
    row.email,
    row.address,
    row.status
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(term);
}

async function fetchAll(table) {
  ensureConfigured();
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function fetchClients() {
  const rows = await fetchAll('clients');
  return rows.map((row) => ({
    ...row,
    total_due: asNumber(row.total_due),
    amount_paid: asNumber(row.amount_paid),
    balance: asNumber(row.balance)
  }));
}

async function fetchPayments() {
  const rows = await fetchAll('payments');
  return rows.map((row) => ({
    ...row,
    amount: asNumber(row.amount)
  }));
}

async function fetchNotes() {
  return fetchAll('notes');
}

async function fetchFinanceOverrides() {
  const rows = await fetchAll('finance_overrides');
  return rows.map((row) => ({
    ...row,
    total_expected: asNumber(row.total_expected ?? row.totalExpected),
    total_received: asNumber(row.total_received ?? row.totalReceived),
    total_remaining: asNumber(row.total_remaining ?? row.totalRemaining),
    total_clients: asNumber(row.total_clients ?? row.totalClients)
  }));
}

async function getSettingsRow(key) {
  ensureConfigured();
  const { data, error } = await supabase
    .from('settings')
    .select('key, value')
    .eq('key', key)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function upsertSettingsRow(key, value) {
  ensureConfigured();
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
}

async function updateSettingsValue(key, value) {
  ensureConfigured();
  const { error } = await supabase
    .from('settings')
    .update({ value })
    .eq('key', key);
  if (error) throw error;
}

async function insertClient(row) {
  ensureConfigured();
  const payload = {
    name: row.name,
    phone: row.phone || '',
    email: row.email || '',
    address: row.address || '',
    status: row.status || 'Lead',
    total_due: asNumber(row.total_due),
    amount_paid: asNumber(row.amount_paid),
    balance: asNumber(row.balance),
    created_at: toDateValue(row.created_at) || new Date().toISOString()
  };
  const { error } = await supabase.from('clients').insert(payload);
  if (error) throw error;
}

async function updateClientById(id, values) {
  ensureConfigured();
  const { error } = await supabase.from('clients').update(values).eq('id', id);
  if (error) throw error;
}

async function deleteClientById(id) {
  ensureConfigured();
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) throw error;
}

async function insertPayment(row) {
  ensureConfigured();
  const payload = {
    client_id: row.client_id,
    amount: asNumber(row.amount),
    payment_date: toDateValue(row.payment_date) || new Date().toISOString()
  };
  const { error } = await supabase.from('payments').insert(payload);
  if (error) throw error;
}

async function insertNote(row) {
  ensureConfigured();
  const payload = {
    client_id: row.client_id,
    content: row.content,
    created_at: toDateValue(row.created_at) || new Date().toISOString()
  };
  const { error } = await supabase.from('notes').insert(payload);
  if (error) throw error;
}

async function updateNoteById(noteId, clientId, content) {
  ensureConfigured();
  const { error } = await supabase
    .from('notes')
    .update({ content })
    .eq('id', noteId)
    .eq('client_id', clientId);
  if (error) throw error;
}

async function deleteNoteById(noteId, clientId) {
  ensureConfigured();
  const { error } = await supabase
    .from('notes')
    .delete()
    .eq('id', noteId)
    .eq('client_id', clientId);
  if (error) throw error;
}

async function upsertFinanceOverride(row) {
  ensureConfigured();
  const payload = {
    year: row.year,
    total_expected: asNumber(row.total_expected),
    total_received: asNumber(row.total_received),
    total_remaining: asNumber(row.total_remaining),
    total_clients: asNumber(row.total_clients),
    notes: row.notes ?? null,
    updated_at: toDateValue(row.updated_at) || new Date().toISOString()
  };
  const { error } = await supabase.from('finance_overrides').upsert(payload, { onConflict: 'year' });
  if (error) throw error;
}

async function countRows(table, filterFn = null) {
  const rows = await fetchAll(table);
  return filterFn ? rows.filter(filterFn).length : rows.length;
}

async function query(text, params = []) {
  ensureConfigured();
  const sql = normalizeSql(text);

  if (sql === 'select value from settings where key = \'admin_password\'' || sql === 'select value from settings where key = $1') {
    const key = sql.includes('$1') ? params[0] : 'admin_password';
    const row = await getSettingsRow(key);
    return makeResult(row ? [row] : []);
  }

  if (sql === 'insert into settings (key, value) values ($1, $2) on conflict (key) do nothing' || sql === 'insert into settings (key, value) values ($1, $2)') {
    await upsertSettingsRow(params[0], params[1]);
    return makeResult([]);
  }

  if (sql === 'insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value') {
    await upsertSettingsRow(params[0], params[1]);
    return makeResult([]);
  }

  if (sql === 'update settings set value = $1 where key = \'admin_password\'') {
    await updateSettingsValue('admin_password', params[0]);
    return makeResult([]);
  }

  if (sql === 'select * from settings') {
    const rows = await fetchAll('settings');
    return makeResult(rows);
  }

  if (sql === 'select count(*)::int as total_clients from clients') {
    const total = await countRows('clients');
    return makeResult([{ total_clients: total }]);
  }

  if (sql === 'select count(*)::int as overdue_clients from clients where balance > 0') {
    const total = await countRows('clients', (row) => asNumber(row.balance) > 0);
    return makeResult([{ overdue_clients: total }]);
  }

  if (sql === 'select count(*)::int as payment_count, coalesce(sum(amount),0) as total_received from payments') {
    const payments = await fetchPayments();
    const totalReceived = payments.reduce((sum, row) => sum + asNumber(row.amount), 0);
    return makeResult([{ payment_count: payments.length, total_received: totalReceived }]);
  }

  if (sql.includes('count(*)::int as new_clients') && sql.includes('today_payments')) {
    const clients = await fetchClients();
    const payments = await fetchPayments();
    const today = new Date().toISOString().slice(0, 10);
    const newClients = clients.filter((row) => String(row.created_at || '').slice(0, 10) === today).length;
    const todayPayments = payments
      .filter((row) => String(row.payment_date || '').slice(0, 10) === today)
      .reduce((sum, row) => sum + asNumber(row.amount), 0);
    return makeResult([{ new_clients: newClients, today_payments: todayPayments }]);
  }

  if (sql.includes('count(*)::int as total_clients') && sql.includes('sum(total_due)') && sql.includes('sum(balance)')) {
    const year = Number(params[0]);
    const clients = await fetchClients();
    const filtered = clients.filter((row) => new Date(row.created_at).getFullYear() === year);
    const totalExpected = filtered.reduce((sum, row) => sum + asNumber(row.total_due), 0);
    const totalRemaining = filtered.reduce((sum, row) => sum + asNumber(row.balance), 0);
    return makeResult([{
      total_clients: filtered.length,
      total_expected: totalExpected,
      total_remaining: totalRemaining
    }]);
  }

  if (sql.includes('coalesce(sum(amount), 0) as total_received') && sql.includes('from payments where extract(year from payment_date)::int = $1')) {
    const year = Number(params[0]);
    const payments = await fetchPayments();
    const filtered = payments.filter((row) => new Date(row.payment_date).getFullYear() === year);
    const totalReceived = filtered.reduce((sum, row) => sum + asNumber(row.amount), 0);
    return makeResult([{ total_received: totalReceived }]);
  }

  if (sql === 'select distinct extract(year from created_at)::int as year from clients') {
    const clients = await fetchClients();
    const years = [...new Set(clients.map((row) => new Date(row.created_at).getFullYear()).filter(Number.isFinite))];
    return makeResult(years.map((year) => ({ year })));
  }

  if (sql === 'select distinct extract(year from payment_date)::int as year from payments') {
    const payments = await fetchPayments();
    const years = [...new Set(payments.map((row) => new Date(row.payment_date).getFullYear()).filter(Number.isFinite))];
    return makeResult(years.map((year) => ({ year })));
  }

  if (sql === 'select year from finance_overrides where year is not null') {
    const overrides = await fetchFinanceOverrides();
    return makeResult(overrides.filter((row) => row.year !== null && row.year !== undefined).map((row) => ({ year: row.year })));
  }

  if (sql === 'select * from finance_overrides where year = $1') {
    const overrides = await fetchFinanceOverrides();
    const row = overrides.find((item) => Number(item.year) === Number(params[0]));
    return makeResult(row ? [row] : []);
  }

  if (/^select count\(\*\)::int as c from [a-z_]+$/.test(sql)) {
    const table = sql.replace(/^select count\(\*\)::int as c from /, '');
    const total = await countRows(table);
    return makeResult([{ c: total }]);
  }

  if (sql === 'select * from clients order by created_at desc') {
    const rows = await fetchClients();
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return makeResult(rows);
  }

  if (sql === 'select * from clients order by created_at desc limit $1 offset $2') {
    const rows = await fetchClients();
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const limit = Math.max(0, Number(params[0]) || 0);
    const offset = Math.max(0, Number(params[1]) || 0);
    return makeResult(rows.slice(offset, offset + limit));
  }

  if (sql.startsWith('select distinct clients.* from clients left join notes on notes.client_id = clients.id where clients.name ilike $1')) {
    const term = String(params[0] || '').replace(/%/g, '').toLowerCase();
    const limit = params.length >= 6 ? Number(params[5]) : null;
    const offset = params.length >= 7 ? Number(params[6]) : 0;
    const clients = await fetchClients();
    const notes = await fetchNotes();
    const noteMatches = new Set(
      notes
        .filter((note) => String(note.content || '').toLowerCase().includes(term))
        .map((note) => Number(note.client_id))
    );

    const rows = clients.filter((row) => {
      const matchesClient = rowMatchesSearch(row, term);
      return matchesClient || noteMatches.has(Number(row.id));
    });

    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const sliced = limit === null ? rows : rows.slice(offset, offset + limit);
    return makeResult(sliced);
  }

  if (sql === 'select amount_paid, total_due, created_at from clients where id = $1' || sql === 'select total_due, amount_paid, created_at from clients where id = $1' || sql === 'select total_due, amount_paid, balance from clients where id = $1') {
    const clients = await fetchClients();
    const row = clients.find((item) => Number(item.id) === Number(params[0]));
    if (!row) return makeResult([]);
    return makeResult([row]);
  }

  if (sql === 'select created_at from clients where id = $1') {
    const clients = await fetchClients();
    const row = clients.find((item) => Number(item.id) === Number(params[0]));
    return makeResult(row ? [{ created_at: row.created_at }] : []);
  }

  if (sql === 'insert into clients (name, phone, email, address, status, total_due, amount_paid, balance, created_at) values ($1, $2, $3, $4, $5, $6, 0, $7, $8)') {
    await insertClient({
      name: params[0],
      phone: params[1],
      email: params[2],
      address: params[3],
      status: params[4],
      total_due: params[5],
      amount_paid: 0,
      balance: params[6],
      created_at: params[7]
    });
    return makeResult([]);
  }

  if (sql === 'update clients set name = $1, phone = $2, email = $3, address = $4, status = $5, total_due = $6, balance = $7 where id = $8') {
    await updateClientById(params[7], {
      name: params[0],
      phone: params[1],
      email: params[2],
      address: params[3],
      status: params[4],
      total_due: params[5],
      balance: params[6]
    });
    return makeResult([]);
  }

  if (sql === 'update clients set total_due = $1, balance = $2 where id = $3') {
    await updateClientById(params[2], {
      total_due: params[0],
      balance: params[1]
    });
    return makeResult([]);
  }

  if (sql === 'update clients set amount_paid = $1, balance = $2 where id = $3') {
    await updateClientById(params[2], {
      amount_paid: params[0],
      balance: params[1]
    });
    return makeResult([]);
  }

  if (sql === 'update clients set total_due = $1, amount_paid = $2, balance = $3 where id = $4') {
    await updateClientById(params[3], {
      total_due: params[0],
      amount_paid: params[1],
      balance: params[2]
    });
    return makeResult([]);
  }

  if (sql === 'delete from clients where id = $1') {
    await deleteClientById(params[0]);
    return makeResult([]);
  }

  if (sql === 'insert into payments (client_id, amount, payment_date) values ($1, $2, current_timestamp)') {
    await insertPayment({
      client_id: params[0],
      amount: params[1],
      payment_date: new Date().toISOString()
    });
    return makeResult([]);
  }

  if (sql === 'select count(distinct client_id)::int as paying_clients, coalesce(sum(amount), 0) as total_cash_received from payments where extract(year from payment_date)::int = $1') {
    const year = Number(params[0]);
    const payments = await fetchPayments();
    const filtered = payments.filter((row) => new Date(row.payment_date).getFullYear() === year);
    const payingClients = new Set(filtered.filter((row) => asNumber(row.amount) !== 0).map((row) => Number(row.client_id))).size;
    const totalCashReceived = filtered.reduce((sum, row) => sum + asNumber(row.amount), 0);
    return makeResult([{ paying_clients: payingClients, total_cash_received: totalCashReceived }]);
  }

  if (sql === 'insert into notes (client_id, content) values ($1, $2)') {
    await insertNote({
      client_id: params[0],
      content: params[1]
    });
    return makeResult([]);
  }

  if (sql === 'insert into notes (client_id, content) values ($1, $2) returning id, content, created_at') {
    await insertNote({
      client_id: params[0],
      content: params[1]
    });
    const notes = await fetchNotes();
    const row = notes
      .filter((item) => Number(item.client_id) === Number(params[0]))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    return makeResult(row ? [row] : []);
  }

  if (sql === 'select id, content, created_at from notes where client_id = $1 order by created_at desc' || sql === 'select id, content, created_at from notes where client_id = $1 order by created_at asc') {
    const notes = await fetchNotes();
    const rows = notes
      .filter((row) => Number(row.client_id) === Number(params[0]))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (sql.endsWith('desc')) rows.reverse();
    return makeResult(rows.map((row) => ({ id: row.id, content: row.content, created_at: row.created_at })));
  }

  if (sql === 'select id, content, created_at from notes where id = $1') {
    const notes = await fetchNotes();
    const row = notes.find((item) => Number(item.id) === Number(params[0]));
    return makeResult(row ? [{ id: row.id, content: row.content, created_at: row.created_at }] : []);
  }

  if (sql === 'update notes set content = $1 where id = $2 and client_id = $3') {
    await updateNoteById(params[1], params[2], params[0]);
    return { rows: [], rowCount: 1 };
  }

  if (sql === 'delete from notes where id = $1 and client_id = $2') {
    await deleteNoteById(params[0], params[1]);
    return { rows: [], rowCount: 1 };
  }

  if (sql === 'select * from clients order by created_at desc limit $1 offset $2') {
    const rows = await fetchClients();
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const limit = Number(params[0]) || 0;
    const offset = Number(params[1]) || 0;
    return makeResult(rows.slice(offset, offset + limit));
  }

  if (sql.startsWith('insert into finance_overrides (year, total_expected, total_received, total_remaining, total_clients) values ($1, $2, $3, $4, $5) on conflict(year) do update set')) {
    await upsertFinanceOverride({
      year: params[0],
      total_expected: params[1],
      total_received: params[2],
      total_remaining: params[3],
      total_clients: params[4]
    });
    return makeResult([]);
  }

  if (sql.startsWith('insert into finance_overrides (year, total_expected, total_received, total_remaining, total_clients, notes) values')) {
    await upsertFinanceOverride({
      year: params[0],
      total_expected: params[1],
      total_received: params[2],
      total_remaining: params[3],
      total_clients: params[4],
      notes: params[5],
      updated_at: params[6]
    });
    return makeResult([]);
  }

  if (sql === 'select * from finance_overrides where year = $1') {
    const overrides = await fetchFinanceOverrides();
    const row = overrides.find((item) => Number(item.year) === Number(params[0]));
    return makeResult(row ? [row] : []);
  }

  if (sql === 'select * from clients') {
    const rows = await fetchClients();
    return makeResult(rows);
  }

  if (sql === 'select * from payments') {
    const rows = await fetchPayments();
    return makeResult(rows);
  }

  if (sql === 'select * from notes') {
    const rows = await fetchNotes();
    return makeResult(rows);
  }

  if (sql === 'select * from finance_overrides') {
    const rows = await fetchFinanceOverrides();
    return makeResult(rows);
  }

  if (sql === 'select count(*)::int as total_clients from clients where balance > 0') {
    const total = await countRows('clients', (row) => asNumber(row.balance) > 0);
    return makeResult([{ overdue_clients: total }]);
  }

  throw new Error(`Unsupported Supabase query: ${String(text || '').trim()}`);
}

const pool = {
  async connect() {
    return {
      async query(text, params = []) {
        const sql = normalizeSql(text);
        if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
          return makeResult([]);
        }
        return query(text, params);
      },
      release() {}
    };
  }
};

const schemaReady = Promise.resolve().then(() => {
  if (!isConfigured) {
    console.warn('Supabase environment variables are not set yet. The app will start, but data access will fail until SUPABASE_URL and a Supabase key are configured.');
  }
  // TODO: If you want automatic provisioning, create a Supabase SQL migration for the tables used by this template.
});

module.exports = {
  pool,
  query,
  schemaReady
};

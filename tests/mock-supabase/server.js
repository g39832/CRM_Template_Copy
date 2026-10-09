// In-memory stand-in for the Supabase REST API (PostgREST), used only by the
// local test harness so every workflow can be exercised end-to-end without
// touching the real Supabase project in .env.
//
// Implements the subset of PostgREST that @supabase/supabase-js sends for the
// queries this app makes: select (with column lists and one level of embedded
// relations), filters (eq/neq/gt/gte/lt/lte/like/ilike/is/in/not/or),
// order/limit/offset, count, single-object responses, insert/upsert/update/
// delete with return=representation, foreign-key cascades, unique and check
// constraints, and PostgREST-style errors for unknown columns.
//
// Control endpoints (test harness only):
//   GET  /__dump              -> every table's rows
//   POST /__reset             -> reload the seed data
//   POST /__migrate {on:bool} -> add/remove the optional (v6) columns
//
// Run: node tests/mock-supabase/server.js [port]   (default 54329)

const http = require('http');
const crypto = require('crypto');
const { TABLES, FOREIGN_KEYS, COMPOSITE_KEYS } = require('./schema');
const buildSeed = require('./seed');

const PORT = Number(process.argv[2] || process.env.MOCK_SUPABASE_PORT || 54329);

const state = {
  migrated: process.env.MOCK_MIGRATED === '1',
  tables: {},
  seq: {}
};

function columnsFor(table) {
  const def = TABLES[table];
  return Object.assign({}, def.columns, state.migrated ? (def.optional || {}) : {});
}

function reset() {
  state.tables = {};
  state.seq = {};
  for (const name of Object.keys(TABLES)) {
    state.tables[name] = [];
    state.seq[name] = 0;
  }
  const seed = buildSeed();
  for (const [table, rows] of Object.entries(seed)) {
    for (const row of rows) insertRow(table, row, {});
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
class PgError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.body = { code, message, details: details || null, hint: null };
  }
}

// ---------------------------------------------------------------------------
// Value coercion / comparison
// ---------------------------------------------------------------------------
function coerce(type, value) {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'id':
    case 'int': {
      const n = Number(value);
      return Number.isFinite(n) ? Math.trunc(n) : value;
    }
    case 'num': {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    case 'bool':
      return value === true || value === 'true' || value === 1 || value === '1';
    case 'ts':
      return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
    case 'arr':
      return Array.isArray(value) ? value.slice() : value;
    default:
      return typeof value === 'object' ? value : String(value);
  }
}

function comparable(type, value) {
  if (value === null || value === undefined) return null;
  if (type === 'id' || type === 'int' || type === 'num') return Number(value);
  if (type === 'ts') return new Date(value).getTime();
  if (type === 'bool') return value === true || value === 'true';
  return String(value);
}

function likeToRegex(pattern, flags) {
  const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*').replace(/_/g, '.');
  return new RegExp('^' + escaped + '$', flags);
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
function splitTopLevel(str, sep = ',') {
  const parts = [];
  let depth = 0;
  let current = '';
  let quoted = false;
  for (const ch of str) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '(') depth++;
    if (!quoted && ch === ')') depth--;
    if (!quoted && depth === 0 && ch === sep) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function buildPredicate(table, column, expr) {
  const cols = columnsFor(table);
  if (!cols[column]) throw new PgError(400, '42703', `column ${table}.${column} does not exist`);
  const type = cols[column][0];
  let negate = false;
  if (expr.startsWith('not.')) {
    negate = true;
    expr = expr.slice(4);
  }
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  let arg = expr.slice(dot + 1);
  if (arg.startsWith('"') && arg.endsWith('"')) arg = arg.slice(1, -1);

  let test;
  switch (op) {
    case 'eq': test = (v) => v !== null && comparable(type, v) === comparable(type, arg); break;
    case 'neq': test = (v) => v !== null && comparable(type, v) !== comparable(type, arg); break;
    case 'gt': test = (v) => v !== null && comparable(type, v) > comparable(type, arg); break;
    case 'gte': test = (v) => v !== null && comparable(type, v) >= comparable(type, arg); break;
    case 'lt': test = (v) => v !== null && comparable(type, v) < comparable(type, arg); break;
    case 'lte': test = (v) => v !== null && comparable(type, v) <= comparable(type, arg); break;
    case 'like': test = (v) => v !== null && likeToRegex(arg, '').test(String(v)); break;
    case 'ilike': test = (v) => v !== null && likeToRegex(arg, 'i').test(String(v)); break;
    case 'is':
      if (arg === 'null') test = (v) => v === null || v === undefined;
      else if (arg === 'true') test = (v) => v === true;
      else if (arg === 'false') test = (v) => v === false;
      else throw new PgError(400, 'PGRST100', `unsupported is.${arg}`);
      break;
    case 'in': {
      const list = splitTopLevel(arg.replace(/^\(|\)$/g, '')).map((s) => s.replace(/^"|"$/g, ''));
      const set = new Set(list.map((s) => comparable(type, s)));
      test = (v) => v !== null && set.has(comparable(type, v));
      break;
    }
    case 'cs': {
      const list = arg.replace(/^\{|\}$/g, '').split(',').filter(Boolean);
      test = (v) => Array.isArray(v) && list.every((x) => v.includes(x));
      break;
    }
    default:
      throw new PgError(400, 'PGRST100', `unsupported operator ${op}`);
  }
  return (row) => {
    const result = test(row[column] === undefined ? null : row[column]);
    return negate ? !result : result;
  };
}

function buildOrPredicate(table, expr) {
  const inner = expr.replace(/^\(/, '').replace(/\)$/, '');
  const preds = splitTopLevel(inner).map((part) => {
    const firstDot = part.indexOf('.');
    return buildPredicate(table, part.slice(0, firstDot), part.slice(firstDot + 1));
  });
  return (row) => preds.some((p) => p(row));
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function buildFilters(table, params) {
  const preds = [];
  for (const [key, value] of params.entries()) {
    if (RESERVED.has(key) || key.includes('.')) continue;
    if (key === 'or') preds.push(buildOrPredicate(table, value));
    else preds.push(buildPredicate(table, key, value));
  }
  return (row) => preds.every((p) => p(row));
}

// ---------------------------------------------------------------------------
// Select / embedding
// ---------------------------------------------------------------------------
function parseSelect(select) {
  return splitTopLevel(select || '*').map((token) => {
    const m = token.match(/^(?:([a-zA-Z0-9_]+):)?([a-zA-Z0-9_*]+)(?:!([a-zA-Z0-9_]+))?(?:\((.*)\))?$/);
    if (!m) throw new PgError(400, 'PGRST100', `could not parse select token "${token}"`);
    const [, alias, name, , inner] = m;
    return inner !== undefined ? { embed: name, alias: alias || name, inner } : { column: name, alias: alias || name };
  });
}

function projectRow(table, row, selectTokens) {
  const cols = columnsFor(table);
  const out = {};
  for (const tok of selectTokens) {
    if (tok.embed) {
      out[tok.alias] = embedRelation(table, row, tok.embed, tok.inner);
    } else if (tok.column === '*') {
      for (const c of Object.keys(cols)) out[c] = row[c] === undefined ? null : row[c];
    } else {
      if (!cols[tok.column]) throw new PgError(400, '42703', `column ${table}.${tok.column} does not exist`);
      out[tok.alias] = row[tok.column] === undefined ? null : row[tok.column];
    }
  }
  return out;
}

function embedRelation(baseTable, baseRow, relTable, inner) {
  if (!TABLES[relTable]) throw new PgError(400, 'PGRST200', `Could not find a relationship between '${baseTable}' and '${relTable}'`);
  const tokens = parseSelect(inner || '*');
  const manyToOne = FOREIGN_KEYS.find(([child, , parent]) => child === baseTable && parent === relTable);
  if (manyToOne) {
    const fkCol = manyToOne[1];
    const parent = state.tables[relTable].find((r) => r.id === baseRow[fkCol]);
    return parent ? projectRow(relTable, parent, tokens) : null;
  }
  const oneToMany = FOREIGN_KEYS.find(([child, , parent]) => child === relTable && parent === baseTable);
  if (oneToMany) {
    const fkCol = oneToMany[1];
    return state.tables[relTable].filter((r) => r[fkCol] === baseRow.id).map((r) => projectRow(relTable, r, tokens));
  }
  throw new PgError(400, 'PGRST200', `Could not find a relationship between '${baseTable}' and '${relTable}'`);
}

function applyOrder(table, rows, orderParam) {
  if (!orderParam) return rows;
  const cols = columnsFor(table);
  const specs = orderParam.split(',').map((spec) => {
    const [column, dir = 'asc', nulls] = spec.split('.');
    if (!cols[column]) throw new PgError(400, '42703', `column ${table}.${column} does not exist`);
    return { column, desc: dir === 'desc', nullsFirst: nulls ? nulls === 'nullsfirst' : dir === 'desc', type: cols[column][0] };
  });
  return rows.slice().sort((a, b) => {
    for (const s of specs) {
      const va = comparable(s.type, a[s.column]);
      const vb = comparable(s.type, b[s.column]);
      if (va === vb) continue;
      if (va === null) return s.nullsFirst ? -1 : 1;
      if (vb === null) return s.nullsFirst ? 1 : -1;
      const cmp = va < vb ? -1 : 1;
      return s.desc ? -cmp : cmp;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
function checkColumns(table, obj) {
  const cols = columnsFor(table);
  for (const key of Object.keys(obj)) {
    if (!cols[key]) {
      throw new PgError(400, 'PGRST204', `Could not find the '${key}' column of '${table}' in the schema cache`);
    }
  }
}

function checkRow(table, row) {
  const def = TABLES[table];
  const cols = columnsFor(table);
  for (const [col, allowed] of Object.entries(def.check || {})) {
    if (row[col] !== null && row[col] !== undefined && !allowed.includes(row[col])) {
      throw new PgError(400, '23514', `new row for relation "${table}" violates check constraint "${table}_${col}_check"`);
    }
  }
  for (const [col, spec] of Object.entries(cols)) {
    if (spec.length === 1 && spec[0] !== 'id' && spec[0] !== 'uuid' && (row[col] === null || row[col] === undefined)) {
      throw new PgError(400, '23502', `null value in column "${col}" of relation "${table}" violates not-null constraint`);
    }
  }
  for (const [child, col, parent] of FOREIGN_KEYS) {
    if (child !== table || row[col] === null || row[col] === undefined || !cols[col]) continue;
    if (!state.tables[parent].some((p) => p.id === row[col])) {
      throw new PgError(409, '23503', `insert or update on table "${table}" violates foreign key constraint "${table}_${col}_fkey"`);
    }
  }
  checkCompositeKeys(table, row);
}

function checkCompositeKeys(table, row) {
  for (const [child, cols, parent, parentCols] of COMPOSITE_KEYS) {
    if (child !== table || cols.some((c) => row[c] === null || row[c] === undefined)) continue;
    if (!state.tables[parent].some((p) => parentCols.every((pc, i) => p[pc] === row[cols[i]]))) {
      throw new PgError(409, '23503', `insert or update on table "${table}" violates foreign key constraint "${table}_${cols.join('_')}_fkey"`);
    }
  }
}

function findConflict(table, row, conflictCols) {
  const def = TABLES[table];
  const keySets = conflictCols ? [conflictCols] : [def.pk, ...(def.unique || [])];
  for (const keys of keySets) {
    if (keys.some((k) => row[k] === null || row[k] === undefined)) continue;
    const existing = state.tables[table].find((r) => keys.every((k) => r[k] === row[k]));
    if (existing) return existing;
  }
  return null;
}

function insertRow(table, input, { upsert, ignoreDuplicates, onConflict } = {}) {
  checkColumns(table, input);
  const cols = columnsFor(table);
  const row = {};
  for (const [col, spec] of Object.entries(cols)) {
    const [type, def] = spec;
    if (input[col] !== undefined) {
      row[col] = coerce(type, input[col]);
    } else if (type === 'id') {
      row[col] = null;
    } else if (type === 'uuid' && TABLES[table].pk.includes(col)) {
      row[col] = crypto.randomUUID();
    } else {
      row[col] = typeof def === 'function' ? def() : (def === undefined ? null : def);
    }
  }
  for (const [col, spec] of Object.entries(cols)) {
    if (spec[0] === 'id') {
      if (row[col] === null) row[col] = ++state.seq[table];
      else state.seq[table] = Math.max(state.seq[table], row[col]);
    }
  }

  const conflict = findConflict(table, row, onConflict);
  if (conflict) {
    if (ignoreDuplicates) return null;
    if (upsert) {
      for (const key of Object.keys(input)) conflict[key] = coerce(cols[key][0], input[key]);
      checkRow(table, conflict);
      return conflict;
    }
    throw new PgError(409, '23505', `duplicate key value violates unique constraint "${table}_pkey"`);
  }
  checkRow(table, row);
  state.tables[table].push(row);
  return row;
}

function deleteRows(table, predicate) {
  const removed = state.tables[table].filter(predicate);
  if (!removed.length) return removed;
  const removedIds = new Set(removed.map((r) => r.id));
  for (const [child, col, parent, onDelete] of FOREIGN_KEYS) {
    if (parent === table && onDelete === 'restrict' && state.tables[child].some((r) => removedIds.has(r[col]))) {
      throw new PgError(409, '23503', `update or delete on table "${table}" violates foreign key constraint "${child}_${col}_fkey" on table "${child}"`);
    }
  }
  state.tables[table] = state.tables[table].filter((r) => !predicate(r));
  for (const [child, col, parent, onDelete] of FOREIGN_KEYS) {
    if (parent !== table) continue;
    const ids = new Set(removed.map((r) => r.id));
    if (onDelete === 'cascade') {
      deleteRows(child, (r) => ids.has(r[col]));
    } else {
      state.tables[child].forEach((r) => { if (ids.has(r[col])) r[col] = null; });
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve(undefined);
      try { resolve(JSON.parse(data)); } catch (err) { reject(new PgError(400, 'PGRST102', 'Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, headers));
  res.end(payload);
}

async function handleRest(req, res, table, url) {
  if (!TABLES[table] || (TABLES[table].optionalTable && !state.migrated)) {
    throw new PgError(404, 'PGRST205', `Could not find the table 'public.${table}' in the schema cache`);
  }
  const params = url.searchParams;
  const prefer = String(req.headers.prefer || '').split(',').map((s) => s.trim());
  const wantsObject = String(req.headers.accept || '').includes('application/vnd.pgrst.object+json');
  const wantsCount = prefer.some((p) => p.startsWith('count='));
  const returnRep = prefer.includes('return=representation');
  const selectTokens = parseSelect(params.get('select') || '*');
  // Like PostgREST, an unknown column is an error even when no rows match
  // (feature probes select a column with limit 0).
  const knownCols = columnsFor(table);
  for (const tok of selectTokens) {
    if (!tok.embed && tok.column !== '*' && !knownCols[tok.column]) {
      throw new PgError(400, '42703', `column ${table}.${tok.column} does not exist`);
    }
  }
  const filter = buildFilters(table, params);

  function respondRows(rows, status, totalCount) {
    const headers = {};
    if (wantsCount) {
      const total = totalCount === undefined ? rows.length : totalCount;
      headers['Content-Range'] = rows.length ? `0-${rows.length - 1}/${total}` : `*/${total}`;
    }
    if (req.method === 'HEAD') return send(res, 200, undefined, headers);
    const projected = rows.map((r) => projectRow(table, r, selectTokens));
    if (wantsObject) {
      if (projected.length !== 1) {
        throw new PgError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned', `The result contains ${projected.length} rows`);
      }
      return send(res, status, projected[0], headers);
    }
    return send(res, status, projected, headers);
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    let rows = state.tables[table].filter(filter);
    const total = rows.length;
    rows = applyOrder(table, rows, params.get('order'));
    const offset = Number(params.get('offset') || 0);
    const limit = params.has('limit') ? Number(params.get('limit')) : undefined;
    rows = rows.slice(offset, limit === undefined ? undefined : offset + limit);
    return respondRows(rows, 200, total);
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const items = Array.isArray(body) ? body : [body || {}];
    const upsert = prefer.includes('resolution=merge-duplicates');
    const ignoreDuplicates = prefer.includes('resolution=ignore-duplicates');
    const onConflict = params.get('on_conflict') ? params.get('on_conflict').split(',') : null;
    // All-or-nothing, like a single INSERT statement.
    const snapshot = JSON.stringify({ tables: state.tables, seq: state.seq });
    try {
      const written = items.map((item) => insertRow(table, item, { upsert, ignoreDuplicates, onConflict })).filter(Boolean);
      if (!returnRep) return send(res, 201, undefined);
      return respondRows(written, 201);
    } catch (err) {
      const restored = JSON.parse(snapshot);
      state.tables = restored.tables;
      state.seq = restored.seq;
      throw err;
    }
  }

  if (req.method === 'PATCH') {
    const body = (await readBody(req)) || {};
    checkColumns(table, body);
    const cols = columnsFor(table);
    const rows = state.tables[table].filter(filter);
    const before = rows.map((r) => Object.assign({}, r));
    try {
      for (const row of rows) {
        for (const [key, value] of Object.entries(body)) row[key] = coerce(cols[key][0], value);
        checkRow(table, row);
      }
    } catch (err) {
      rows.forEach((row, i) => Object.assign(row, before[i]));
      throw err;
    }
    if (!returnRep) return send(res, 204, undefined);
    return respondRows(rows, 200);
  }

  if (req.method === 'DELETE') {
    const removed = deleteRows(table, filter);
    if (!returnRep) return send(res, 204, undefined);
    return respondRows(removed, 200);
  }

  throw new PgError(405, 'PGRST000', 'Method not allowed');
}

// Supabase Auth stand-in for GET /auth/v1/user (what auth.getUser(token)
// calls). Test access tokens look like "google:<email>" (a verified Google
// identity) or "password:<email>" (an email/password identity, which the app
// must refuse). The auth user id is derived from the email so it is stable.
function handleAuthUser(req, res) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const m = token.match(/^(google|password):(.+)$/);
  if (!m) return send(res, 401, { code: 401, msg: 'invalid JWT' });
  const provider = m[1];
  const email = m[2];
  const hex = crypto.createHash('sha256').update('auth:' + email).digest('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return send(res, 200, {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider, providers: [provider] },
    user_metadata: { full_name: 'Test ' + email.split('@')[0] },
    identities: [{ provider }]
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/__dump') return send(res, 200, { migrated: state.migrated, tables: state.tables });
    if (url.pathname === '/__reset' && req.method === 'POST') {
      const body = (await readBody(req)) || {};
      if (body.migrated !== undefined) state.migrated = body.migrated === true;
      reset();
      return send(res, 200, { ok: true, migrated: state.migrated });
    }
    if (url.pathname === '/__migrate' && req.method === 'POST') {
      const body = (await readBody(req)) || {};
      state.migrated = body.on !== false;
      for (const [name, def] of Object.entries(TABLES)) {
        for (const [col, spec] of Object.entries(def.optional || {})) {
          for (const row of state.tables[name]) {
            if (state.migrated && row[col] === undefined) row[col] = typeof spec[1] === 'function' ? spec[1]() : spec[1];
            if (!state.migrated) delete row[col];
          }
        }
      }
      return send(res, 200, { migrated: state.migrated });
    }
    if (url.pathname === '/auth/v1/user' && req.method === 'GET') return handleAuthUser(req, res);
    const m = url.pathname.match(/^\/rest\/v1\/([a-zA-Z0-9_]+)$/);
    if (m) return await handleRest(req, res, m[1], url);
    throw new PgError(404, 'PGRST000', `No mock route for ${req.method} ${url.pathname}`);
  } catch (err) {
    if (err instanceof PgError) return send(res, err.status, err.body);
    console.error('[mock-supabase] internal error', err);
    return send(res, 500, { code: 'XX000', message: err.message });
  }
});

reset();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-supabase] listening on http://127.0.0.1:${PORT} (migrated=${state.migrated})`);
});

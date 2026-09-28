// api/client-extras.js
//
// Extra per-client display fields for the client overview and homepage:
//   - technician         — free-text name of who does the work
//   - assigned_user_name — display name of the assigned salesperson
//
// Technician lives in clients.technician once the v6 migration has been run.
// Until then it is kept in the existing key/value `settings` table under
// `client_technician:<clientId>`, so the feature works immediately and
// nothing is lost when the column is added later (the migration copies these
// values over, and reads fall back to them for any client whose column is
// still empty).

const { getClient } = require('./db-v2');
const { AppError } = require('./request-utils');
const { hasClientTechnician, markColumnAbsent, isMissingColumnError } = require('./schema-features');

const TECH_KEY_PREFIX = 'client_technician:';
const MAX_TECHNICIAN_LENGTH = 120;

function normalizeTechnician(value) {
  return String(value === null || value === undefined ? '' : value).trim().slice(0, MAX_TECHNICIAN_LENGTH);
}

async function readFallbackTechnicians(supabase) {
  const { data, error } = await supabase
    .from('settings')
    .select('key, value')
    .like('key', `${TECH_KEY_PREFIX}%`);
  if (error) return new Map();
  const map = new Map();
  for (const row of data || []) {
    const id = Number(String(row.key).slice(TECH_KEY_PREFIX.length));
    if (Number.isInteger(id) && id > 0 && row.value) map.set(id, row.value);
  }
  return map;
}

// Map of clientId -> technician name for every client that has one.
async function getTechnicianMap() {
  const supabase = getClient();
  if (!supabase) return new Map();
  const map = await readFallbackTechnicians(supabase);
  if (await hasClientTechnician()) {
    const { data, error } = await supabase.from('clients').select('id, technician');
    if (!error) {
      for (const row of data || []) {
        if (row.technician) map.set(Number(row.id), row.technician);
      }
    }
  }
  return map;
}

async function setTechnician(clientId, value) {
  const supabase = getClient();
  if (!supabase) throw new AppError(503, 'Database not configured');
  const technician = normalizeTechnician(value);

  if (await hasClientTechnician()) {
    const { error } = await supabase.from('clients').update({ technician }).eq('id', clientId);
    if (!error) {
      // Keep the pre-migration copy in step so an older value can never
      // resurface through the read fallback.
      await supabase.from('settings').delete().eq('key', TECH_KEY_PREFIX + clientId);
      return technician;
    }
    if (!isMissingColumnError(error)) throw new AppError(500, 'Failed to save technician: ' + error.message);
    markColumnAbsent('clients', 'technician');
  }

  if (!technician) {
    const { error } = await supabase.from('settings').delete().eq('key', TECH_KEY_PREFIX + clientId);
    if (error) throw new AppError(500, 'Failed to clear technician: ' + error.message);
    return technician;
  }
  const { error } = await supabase
    .from('settings')
    .upsert({ key: TECH_KEY_PREFIX + clientId, value: technician }, { onConflict: 'key' });
  if (error) throw new AppError(500, 'Failed to save technician: ' + error.message);
  return technician;
}

async function getUserNameMap() {
  const supabase = getClient();
  if (!supabase) return new Map();
  const { data, error } = await supabase.from('users').select('id, display_name, email');
  if (error) return new Map();
  return new Map((data || []).map((u) => [String(u.id), u.display_name || u.email || '']));
}

// Adds technician + assigned_user_name to client rows (already filtered to
// what the session may see). Never throws — the list still renders without
// the extras if a lookup fails.
async function attachClientExtras(rows) {
  const list = rows || [];
  if (!list.length) return list;
  try {
    const [techMap, userMap] = await Promise.all([getTechnicianMap(), getUserNameMap()]);
    return list.map((row) => ({
      ...row,
      technician: techMap.get(Number(row.id)) || row.technician || '',
      assigned_user_name: row.assigned_user_id ? (userMap.get(String(row.assigned_user_id)) || '') : ''
    }));
  } catch (err) {
    console.warn('[client-extras] could not attach technician/salesperson names:', err.message);
    return list;
  }
}

async function clearTechnicianFallback(clientId) {
  const supabase = getClient();
  if (!supabase) return;
  await supabase.from('settings').delete().eq('key', TECH_KEY_PREFIX + clientId);
}

module.exports = {
  TECH_KEY_PREFIX,
  normalizeTechnician,
  getTechnicianMap,
  setTechnician,
  attachClientExtras,
  clearTechnicianFallback
};

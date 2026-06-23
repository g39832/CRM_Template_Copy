const { createClient } = require('@supabase/supabase-js');
const { AppError } = require('./request-utils');

function getClient() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function requireClient() {
  const client = getClient();
  if (!client) throw new AppError(503, 'Database not configured. Set SUPABASE_URL and a Supabase key.');
  return client;
}

module.exports = { getClient, requireClient };

/**
 * Migration script for the CRM template v5 improvement:
 *   - Allow multiple admins per company (drops users_single_admin_idx)
 *
 * Safe to run multiple times (DROP INDEX IF EXISTS). Does not delete any
 * rows or change any existing user's role.
 *
 * Usage:
 *   node scripts/migrate-v5-multi-admin.js
 *
 * This script will attempt to apply the SQL using:
 *   1. SUPABASE_DATABASE_URL (direct pg connection) — if set in .env
 *   2. Supabase Management API (SUPABASE_ACCESS_TOKEN) — if set in .env
 *   3. Manual instructions — as fallback (paste supabase-schema.sql into the SQL editor)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const projectRef = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');

function loadMigrationSql() {
  const schemaPath = path.join(__dirname, '..', 'supabase-schema.sql');
  const full = fs.readFileSync(schemaPath, 'utf8');
  const marker = '-- TEMPLATE UPGRADE v5: allow multiple admins per company.';
  const idx = full.indexOf(marker);
  if (idx === -1) {
    throw new Error('Could not find the TEMPLATE UPGRADE v5 section in supabase-schema.sql');
  }
  return full.slice(idx);
}

async function run() {
  if (!SUPABASE_URL) {
    console.error('SUPABASE_URL not set in .env');
    process.exit(1);
  }

  const SQL = loadMigrationSql();
  console.log('Project:', projectRef);

  const dbUrl = process.env.SUPABASE_DATABASE_URL;
  if (dbUrl) {
    try {
      const { Client } = require('pg');
      const client = new Client({ connectionString: dbUrl });
      await client.connect();
      await client.query(SQL);
      await client.end();
      console.log('Migration completed via direct pg connection.');
      process.exit(0);
    } catch (err) {
      console.log('Direct pg connection failed:', err.message);
    }
  }

  const pat = process.env.SUPABASE_ACCESS_TOKEN;
  if (pat) {
    try {
      const resp = await fetch('https://api.supabase.com/v1/projects/' + projectRef + '/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + pat,
          'Accept': 'application/json'
        },
        body: JSON.stringify({ query: SQL })
      });
      if (resp.ok) {
        console.log('Migration completed via Management API.');
        process.exit(0);
      }
      console.log('Management API:', resp.status, (await resp.text()).substring(0, 200));
    } catch (err) {
      console.log('Management API error:', err.message);
    }
  }

  console.log('\n' + '='.repeat(64));
  console.log('  MIGRATION REQUIRED');
  console.log('='.repeat(64));
  console.log('  Neither SUPABASE_DATABASE_URL nor SUPABASE_ACCESS_TOKEN is set,');
  console.log('  so this script cannot reach your database automatically.\n');
  console.log('  Option A — Supabase Dashboard (recommended):');
  console.log('    1. Go to:  https://supabase.com/dashboard/project/' + projectRef + '/sql/new');
  console.log('    2. Run:  DROP INDEX IF EXISTS public.users_single_admin_idx;');
  console.log('    3. Click "Run"\n');
  console.log('  Option B — Environment variables:');
  console.log('    Set SUPABASE_DATABASE_URL in .env for auto-migration.');
  console.log('    Or set SUPABASE_ACCESS_TOKEN for Management API.\n');
  console.log('  Then re-run:  node scripts/migrate-v5-multi-admin.js');
  console.log('='.repeat(64) + '\n');
  process.exit(1);
}

run().catch(console.error);

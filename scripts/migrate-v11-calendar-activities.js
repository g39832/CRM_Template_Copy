/**
 * Migration script for the CRM template v11 (calendar activities):
 *   - calendar_activities — appointments/reminders linked to a client and,
 *     optionally, one of that client's jobs
 *   - a unique index on jobs (id, client_id) that the activity -> job link
 *     uses so an activity can never point at another client's job
 *
 * Purely additive and safe to run multiple times. Does not drop anything or
 * delete any rows. Runs the "TEMPLATE UPGRADE v11" section of
 * supabase-schema.sql (and the Row Level Security block after it, so the new
 * table gets RLS on with no policies, like every other table).
 *
 * BEFORE RUNNING against a database that holds real data: take a backup
 * (Supabase Dashboard -> Database -> Backups, or pg_dump). Rollback:
 * scripts/rollback-v11-calendar-activities.sql (drops the new table and every
 * activity in it).
 *
 * Usage (prints the target project and stops unless --yes is given):
 *   node scripts/migrate-v11-calendar-activities.js          # dry run
 *   node scripts/migrate-v11-calendar-activities.js --yes    # apply
 *
 * This script will attempt to apply the SQL using:
 *   1. SUPABASE_DATABASE_URL (direct pg connection) — if set in .env
 *   2. Supabase Management API (SUPABASE_ACCESS_TOKEN) — if set in .env
 *   3. Manual instructions — as fallback
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const projectRef = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');
const MARKER = '-- TEMPLATE UPGRADE v11: calendar activities (appointments and reminders).';

function loadMigrationSql() {
  const schemaPath = path.join(__dirname, '..', 'supabase-schema.sql');
  const full = fs.readFileSync(schemaPath, 'utf8');
  const idx = full.indexOf(MARKER);
  if (idx === -1) {
    throw new Error('Could not find the TEMPLATE UPGRADE v11 section in supabase-schema.sql');
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
  if (!process.argv.includes('--yes')) {
    console.log('\nDry run: nothing was changed. This would apply the TEMPLATE UPGRADE v11 section');
    console.log('(new table calendar_activities + unique index jobs(id, client_id)) to the project above.');
    console.log('Back up the database first, then re-run with --yes to apply.');
    process.exit(0);
  }

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
  console.log('    2. Paste everything from "TEMPLATE UPGRADE v11" to the end of supabase-schema.sql');
  console.log('    3. Click "Run"\n');
  console.log('  Option B — Environment variables:');
  console.log('    Set SUPABASE_DATABASE_URL in .env for auto-migration.');
  console.log('    Or set SUPABASE_ACCESS_TOKEN for Management API.\n');
  console.log('  Then re-run:  node scripts/migrate-v11-calendar-activities.js --yes');
  console.log('='.repeat(64) + '\n');
  process.exit(1);
}

run().catch(console.error);

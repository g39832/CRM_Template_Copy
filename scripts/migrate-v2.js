/**
 * Migration script for v2 onboarding tables (companies + users).
 *
 * Usage:
 *   node scripts/migrate-v2.js
 *
 * This script will attempt to create the required tables using:
 *   1. SUPABASE_DATABASE_URL (direct pg connection) — if set in .env
 *   2. Supabase Management API (SUPABASE_ACCESS_TOKEN) — if set in .env
 *   3. Clear manual instructions — as fallback
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const projectRef = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');

const SQL = `
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  brand_primary_color TEXT NOT NULL DEFAULT '#2563eb',
  brand_secondary_color TEXT NOT NULL DEFAULT '#7c3aed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  onboarding_complete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON public.users (email);
CREATE INDEX IF NOT EXISTS users_company_id_idx ON public.users (company_id);
CREATE INDEX IF NOT EXISTS companies_slug_idx ON public.companies (slug);
CREATE UNIQUE INDEX IF NOT EXISTS users_single_admin_idx ON public.users ((true)) WHERE role = 'admin';
`;

async function run() {
  if (!SUPABASE_URL) {
    console.error('SUPABASE_URL not set in .env');
    process.exit(1);
  }

  console.log('Project:', projectRef);

  // --- Method 1: Direct pg connection via SUPABASE_DATABASE_URL ---
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

  // --- Method 2: Supabase Management API ---
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

  // --- Method 3: Check if tables already exist via Supabase client ---
  try {
    const { createClient } = require('@supabase/supabase-js');
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    if (svcKey) {
      const supabase = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });
      const { error } = await supabase.from('users').select('id').limit(1);
      if (!error) {
        console.log('Tables already exist. No migration needed.');
        process.exit(0);
      }
    }
  } catch (_) { /* ignore */ }

  // --- Manual instructions ---
  console.log('\n' + '='.repeat(64));
  console.log('  MIGRATION REQUIRED');
  console.log('='.repeat(64));
  console.log('  The companies and users tables must be created in your');
  console.log('  Supabase project before the onboarding system can work.\n');
  console.log('  Option A — Supabase Dashboard (recommended):');
  console.log('    1. Go to:  https://supabase.com/dashboard/project/' + projectRef + '/sql/new');
  console.log('    2. Paste the full contents of supabase-schema.sql');
  console.log('    3. Click "Run"\n');
  console.log('  Option B — Environment variables:');
  console.log('    Set SUPABASE_DATABASE_URL in .env for auto-migration.');
  console.log('    Or set SUPABASE_ACCESS_TOKEN for Management API.\n');
  console.log('  Then re-run:  node scripts/migrate-v2.js');
  console.log('='.repeat(64) + '\n');
  process.exit(1);
}

run().catch(console.error);

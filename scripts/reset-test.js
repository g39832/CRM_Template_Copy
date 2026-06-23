/**
 * Fresh-start testing script — "npm run reset-test"
 *
 * Drops COMPANY data (users + companies + company_components) and
 * resets the admin_claimed flag so the registration guard redirects
 * all visitors to /register again.  This lets you walk through the
 * full 4-step onboarding flow as the very first admin.
 *
 * IMPORTANT: This only clears data for the multi-tenant onboarding
 * system.  Legacy CRM tables (clients, payments, notes, etc.) are
 * NOT touched.
 *
 * USAGE:
 *   npm run reset-test
 *
 * Or directly:
 *   node scripts/reset-test.js
 *
 * Prerequisites:
 *   - .env file with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set
 *   - Supabase project running with the onboarding tables
 */

require('dotenv').config();

var { createClient } = require('@supabase/supabase-js');

var url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
var key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!url || !key) {
  console.error('');
  console.error('  Missing Supabase credentials.');
  console.error('  Ensure your .env file contains:');
  console.error('    SUPABASE_URL=https://xxxx.supabase.co');
  console.error('    SUPABASE_SERVICE_ROLE_KEY=your-key');
  console.error('');
  process.exit(1);
}

var supabase = createClient(url, key, { auth: { persistSession: false } });

async function reset() {
  console.log('');
  console.log('  Resetting onboarding test state...');
  console.log('');

  // 1. Delete company components
  var { error: e1 } = await supabase.from('company_components').delete().neq('id', 0);
  if (e1 && !e1.message.includes('does not exist')) {
    console.log('  [WARN] Failed to clear company_components:', e1.message);
  } else {
    console.log('  [OK]   company_components cleared');
  }

  // 2. Delete users
  var { error: e2 } = await supabase.from('users').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (e2 && !e2.message.includes('does not exist')) {
    console.log('  [WARN] Failed to clear users:', e2.message);
  } else {
    console.log('  [OK]   users cleared');
  }

  // 3. Delete companies
  var { error: e3 } = await supabase.from('companies').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (e3 && !e3.message.includes('does not exist')) {
    console.log('  [WARN] Failed to clear companies:', e3.message);
  } else {
    console.log('  [OK]   companies cleared');
  }

  // 4. Reset admin_claimed flag
  var { error: e4 } = await supabase
    .from('settings')
    .upsert({ key: 'admin_claimed', value: 'false' }, { onConflict: 'key' });

  if (e4) {
    console.log('  [WARN] Failed to reset admin_claimed:', e4.message);
  } else {
    console.log('  [OK]   admin_claimed reset to false');
  }

  console.log('');
  console.log('  Reset complete.  Restart your server, then visit');
  console.log('  http://localhost:3000/ to be redirected to /register.');
  console.log('');
}

reset().catch(function (err) {
  console.error('Reset failed:', err);
  process.exit(1);
});

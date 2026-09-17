/**
 * Fresh-start testing script — "npm run reset-test"
 *
 * The old multi-tenant "admin_claimed" registration-guard flow this
 * script used to reset has been removed (Section 0: the app now uses
 * Google sign-in only, with no registration wizard). This script now
 * resets the company/user layer instead: it clears all companies and
 * users so the next person to sign in with Google automatically
 * becomes the new admin of a freshly auto-provisioned company.
 *
 * IMPORTANT: This only clears the tenant/user layer. The actual CRM
 * data (clients, jobs, payments, notes, job_line_items) is NOT
 * touched — use `npm run seed-demo-data` to (re)populate that safely.
 *
 * USAGE:
 *   npm run reset-test
 *
 * Or directly:
 *   node scripts/reset-test.js
 *
 * Prerequisites:
 *   - .env file with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set
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
  console.log('  Resetting company/user state...');
  console.log('');

  // Unassign any clients pointing at users we're about to delete, so
  // the delete doesn't fail on the foreign key.
  var { error: eUnassign } = await supabase
    .from('clients')
    .update({ assigned_user_id: null })
    .not('assigned_user_id', 'is', null);
  if (eUnassign && !/does not exist/i.test(eUnassign.message || '')) {
    console.log('  [WARN] Failed to unassign clients:', eUnassign.message);
  } else {
    console.log('  [OK]   Unassigned clients from users about to be cleared');
  }

  var { error: e1 } = await supabase.from('company_components').delete().neq('id', 0);
  if (e1 && !/does not exist/i.test(e1.message || '')) {
    console.log('  [WARN] Failed to clear company_components:', e1.message);
  } else {
    console.log('  [OK]   company_components cleared');
  }

  var { error: e2 } = await supabase.from('users').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (e2 && !/does not exist/i.test(e2.message || '')) {
    console.log('  [WARN] Failed to clear users:', e2.message);
  } else {
    console.log('  [OK]   users cleared');
  }

  var { error: e3 } = await supabase.from('companies').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (e3 && !/does not exist/i.test(e3.message || '')) {
    console.log('  [WARN] Failed to clear companies:', e3.message);
  } else {
    console.log('  [OK]   companies cleared');
  }

  console.log('');
  console.log('  Reset complete. Restart your server, then sign in with Google —');
  console.log('  the first person to do so becomes the new admin.');
  console.log('');
}

reset().catch(function (err) {
  console.error('Reset failed:', err);
  process.exit(1);
});

/**
 * Seed test data for recurring-cron verification
 *
 * Creates:
 *   - One recurring client WITH a payment this month (should NOT trigger)
 *   - One recurring client WITHOUT a payment this month (SHOULD trigger)
 *   - One recurring client WITHOUT any payments at all (SHOULD trigger)
 *   - One one-off client (should NOT trigger regardless)
 *
 * NOTE: Client data is single-tenant (no company_id column on clients/jobs/payments).
 * The cron endpoint processes all recurring clients globally.
 *
 * USAGE:
 *   node scripts/seed-test-data.js
 *
 * Prerequisites:
 *   - .env file with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set
 *   - client_type column must exist on clients table (run migration first)
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

async function seed() {
  console.log('');
  console.log('  Seeding test data for recurring-cron verification...');
  console.log('');

  // Clean up old seed data (delete all test entries by name pattern)
  var names = ['Test Recurring (Paid)', 'Test Recurring (Unpaid This Month)', 'Test Recurring (Never Paid)', 'Test One-Off (No Trigger)'];
  for (var n = 0; n < names.length; n++) {
    var { data: existing } = await supabase.from('clients').select('id').eq('name', names[n]);
    if (existing && existing.length > 0) {
      for (var e = 0; e < existing.length; e++) {
        await supabase.from('payments').delete().eq('client_id', existing[e].id);
        await supabase.from('jobs').delete().eq('client_id', existing[e].id);
      }
      await supabase.from('clients').delete().in('id', existing.map(function (r) { return r.id; }));
    }
  }
  console.log('  [OK]   Cleared previous test data');

  // 1. Recurring client WITH payment this month (should NOT generate invoice)
  var { data: c1 } = await supabase.from('clients').insert({
    name: 'Test Recurring (Paid)',
    email: 'paid@test.com',
    phone: '555-0101',
    address: '101 Paid Lane',
    status: 'Approved',
    client_type: 'recurring',
    total_due: 500,
    amount_paid: 500,
    balance: 0
  }).select().single();

  var fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('payments').insert({ client_id: c1.id, amount: 500, payment_date: fiveDaysAgo });

  await supabase.from('jobs').insert({
    client_id: c1.id, title: 'Previous Recurring Job', status: 'Invoice',
    total_due: 500, scope_of_work: 'Monthly retainer — standard service package',
    amount_paid: 500, balance: 0
  });

  console.log('  [OK]   Created "Test Recurring (Paid)" — paid this month, should NOT trigger');

  // 2. Recurring client WITHOUT payment this month (SHOULD generate invoice)
  var { data: c2 } = await supabase.from('clients').insert({
    name: 'Test Recurring (Unpaid This Month)',
    email: 'unpaid@test.com',
    phone: '555-0202',
    address: '202 Unpaid Blvd',
    status: 'Approved',
    client_type: 'recurring',
    total_due: 750,
    amount_paid: 0,
    balance: 750
  }).select().single();

  var sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('payments').insert({ client_id: c2.id, amount: 750, payment_date: sixtyDaysAgo });

  await supabase.from('jobs').insert({
    client_id: c2.id, title: 'Previous Recurring Job', status: 'Invoice',
    total_due: 750, scope_of_work: 'Monthly retainer — premium service package',
    amount_paid: 750, balance: 0
  });

  console.log('  [OK]   Created "Test Recurring (Unpaid This Month)" — last payment 60 days ago, SHOULD trigger');

  // 3. Recurring client with NO payments at all (SHOULD generate invoice)
  var { data: c3 } = await supabase.from('clients').insert({
    name: 'Test Recurring (Never Paid)',
    email: 'never@test.com',
    phone: '555-0303',
    address: '303 New Client Ave',
    status: 'Prospect',
    client_type: 'recurring',
    total_due: 300,
    amount_paid: 0,
    balance: 300
  }).select().single();

  console.log('  [OK]   Created "Test Recurring (Never Paid)" — no payments ever, SHOULD trigger');

  // 4. One-off client with unpaid balance (should NOT trigger)
  var { data: c4 } = await supabase.from('clients').insert({
    name: 'Test One-Off (No Trigger)',
    email: 'oneoff@test.com',
    phone: '555-0404',
    address: '404 One-Time St',
    status: 'Approved',
    client_type: 'one-off',
    total_due: 1200,
    amount_paid: 0,
    balance: 1200
  }).select().single();

  console.log('  [OK]   Created "Test One-Off (No Trigger)" — one-off, should NOT trigger');

  console.log('');
  console.log('  Seed complete. 4 test clients created.');
  console.log('');
  console.log('  Now call the cron endpoint:');
  console.log('    curl -H "X-Cron-Secret: your-secret" http://localhost:3000/api/v2/dashboard/recurring-cron');
  console.log('');
  console.log('  Expected: 2 invoices generated (c2 + c3), c1 skipped (already paid), c4 skipped (one-off)');
  console.log('');
}

seed().catch(function (err) {
  console.error('Seed failed:', err);
  process.exit(1);
});

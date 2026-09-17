/**
 * Seed realistic DEMO data for the CRM template — safe to run against
 * your own Supabase project. Creates:
 *   - 2 regular ("sales rep") users, for the assigned-client RBAC demo
 *   - 6 clients across all 6 pipeline stages, split across those two
 *     regular users (plus one left unassigned)
 *   - 1 job per client, each with its own job tags
 *   - Cost line items (all 6 categories) on a couple of jobs
 *   - A couple of payments so Financial Overview has something to show
 *
 * IMPORTANT — sign-in order: this script deliberately does NOT create
 * a fake admin account. The FIRST person to sign in with a real Google
 * account automatically becomes the admin (see getOrCreateDefaultCompany
 * in api/auth-system.js). So sign in with your own Google account BEFORE
 * or AFTER running this script — either order works, but if you seed
 * first and then sign in, you still land as admin because no admin row
 * exists yet. Signing in as admin lets you see every seeded client,
 * including the two assigned to the demo sales reps.
 *
 * USAGE:
 *   node scripts/seed-demo-data.js
 *
 * Prerequisites:
 *   - .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   - Run `npm run migrate:v3` first so the new columns/tables exist
 */
require('dotenv').config();

var { createClient } = require('@supabase/supabase-js');

var url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
var key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!url || !key) {
  console.error('');
  console.error('  Missing Supabase credentials.');
  console.error('  Ensure your .env file contains SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  console.error('');
  process.exit(1);
}

var supabase = createClient(url, key, { auth: { persistSession: false } });

var DEMO_MARKER = '(Demo)';

async function getOrCreateCompany() {
  var { data: existing } = await supabase.from('companies').select('*').order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (existing) return existing;
  var { data: created, error } = await supabase.from('companies').insert({
    name: process.env.BUSINESS_NAME || 'Demo Roofing Co.',
    slug: 'default',
    contact_email: ''
  }).select().single();
  if (error) throw error;
  return created;
}

async function upsertUser(companyId, email, role, displayName) {
  var { data: existing } = await supabase.from('users').select('*').eq('email', email).eq('company_id', companyId).maybeSingle();
  if (existing) {
    var { data: updated } = await supabase.from('users').update({ role: role, display_name: displayName }).eq('id', existing.id).select().single();
    return updated;
  }
  var { data: created, error } = await supabase.from('users').insert({
    email: email,
    password_hash: null,
    display_name: displayName,
    role: role,
    company_id: companyId,
    onboarding_complete: true
  }).select().single();
  if (error) throw error;
  return created;
}

async function clearPreviousDemoData() {
  var { data: existing } = await supabase.from('clients').select('id').ilike('name', '%' + DEMO_MARKER);
  if (existing && existing.length > 0) {
    var ids = existing.map(function (r) { return r.id; });
    var { data: jobs } = await supabase.from('jobs').select('id').in('client_id', ids);
    var jobIds = (jobs || []).map(function (j) { return j.id; });
    if (jobIds.length > 0) {
      await supabase.from('job_line_items').delete().in('job_id', jobIds);
    }
    await supabase.from('payments').delete().in('client_id', ids);
    await supabase.from('notes').delete().in('client_id', ids);
    await supabase.from('jobs').delete().in('client_id', ids);
    await supabase.from('clients').delete().in('id', ids);
  }
}

async function seed() {
  console.log('');
  console.log('  Seeding demo data...');
  console.log('');

  var company = await getOrCreateCompany();
  console.log('  [OK]   Company: ' + company.name);

  // Deliberately no fake admin row here — see the header comment.
  // The first real Google sign-in becomes admin automatically.
  var repA = await upsertUser(company.id, 'sales.jordan@demo-roofing.test', 'user', 'Jordan (Sales)');
  var repB = await upsertUser(company.id, 'sales.taylor@demo-roofing.test', 'user', 'Taylor (Sales)');
  console.log('  [OK]   Demo sales reps: ' + repA.email + ', ' + repB.email);

  await clearPreviousDemoData();
  console.log('  [OK]   Cleared any previous demo clients');

  var clientDefs = [
    { name: 'Maria Gonzalez ' + DEMO_MARKER, status: 'Lead', assignedTo: repA.id, scope: '' },
    { name: 'David Chen ' + DEMO_MARKER, status: 'Photo report', assignedTo: repA.id, scope: 'Roof inspection photos taken 3/12. Awaiting estimate.' },
    { name: 'Priya Patel ' + DEMO_MARKER, status: 'Prospect', assignedTo: repB.id, scope: 'Tear off existing 3-tab shingles.\nInstall synthetic underlayment.\nInstall architectural shingles, all slopes.' },
    { name: 'Sam Whitfield ' + DEMO_MARKER, status: 'Approved', assignedTo: repB.id, scope: 'Full roof replacement, 28 squares.\nNew ridge vent.\nGutter guards on all runs.' },
    { name: 'Angela Rossi ' + DEMO_MARKER, status: 'Invoiced', assignedTo: repA.id, scope: 'Storm damage repair, south-facing slope.\nReplace 6 damaged sheets of decking.' },
    { name: 'Marcus Webb ' + DEMO_MARKER, status: 'Closed', assignedTo: null, scope: 'Chimney flashing repair and re-seal.' }
  ];

  var createdClients = [];
  for (var i = 0; i < clientDefs.length; i++) {
    var def = clientDefs[i];
    var totalDue = 4000 + i * 1500;
    var amountPaid = def.status === 'Closed' || def.status === 'Invoiced' ? totalDue : (def.status === 'Approved' ? Math.round(totalDue * 0.4) : 0);
    var { data: client, error } = await supabase.from('clients').insert({
      name: def.name,
      phone: '555-01' + (10 + i),
      email: def.name.split(' ')[0].toLowerCase() + '@example.com',
      address: (100 + i) + ' Shingle St, Roofville, TX',
      status: def.status,
      total_due: totalDue,
      amount_paid: amountPaid,
      balance: totalDue - amountPaid,
      scope_of_work: def.scope,
      job_cost: Math.round(totalDue * 0.55),
      assigned_user_id: def.assignedTo,
      company_id: company.id
    }).select().single();
    if (error) throw error;
    createdClients.push(client);

    if (amountPaid > 0) {
      await supabase.from('payments').insert({ client_id: client.id, amount: amountPaid });
    }

    await supabase.from('notes').insert({ client_id: client.id, content: 'Demo note: initial contact logged.' });
  }
  console.log('  [OK]   Created ' + createdClients.length + ' demo clients across all 6 stages');

  var jobTagPool = [['storm-damage'], ['insurance-claim', 'priority'], ['retail'], ['warranty-follow-up'], []];
  var lineItemDefs = [
    { description: 'Roofing crew labor (3 days)', category: 'Labor', quantity: 3, unit_price: 650 },
    { description: 'Architectural shingles, 30yr', category: 'Materials', quantity: 28, unit_price: 118 },
    { description: 'Sales commission', category: 'Commissions', quantity: 1, unit_price: 300 },
    { description: 'Crew lunch (job site)', category: 'Meals/Drinks', quantity: 4, unit_price: 14 },
    { description: 'Dumpster / debris haul-off', category: 'Miscellaneous', quantity: 1, unit_price: 375 },
    { description: 'City re-roof permit', category: 'Permits', quantity: 1, unit_price: 150 }
  ];

  var jobCount = 0;
  var lineItemJobsSeeded = 0;
  for (var c = 0; c < createdClients.length; c++) {
    var client = createdClients[c];
    var { data: job, error: jobErr } = await supabase.from('jobs').insert({
      client_id: client.id,
      title: 'Roof Job — ' + client.name.replace(' ' + DEMO_MARKER, ''),
      status: 'Prospect',
      scope_of_work: client.scope_of_work,
      total_due: client.total_due,
      amount_paid: client.amount_paid,
      balance: client.balance,
      job_cost: client.job_cost,
      tags: jobTagPool[c % jobTagPool.length]
    }).select().single();
    if (jobErr) throw jobErr;
    jobCount++;

    // Put a full categorized cost breakdown on two of the jobs so the
    // Estimate/Invoice line-item feature has real data to show.
    if (c === 2 || c === 3) {
      for (var li = 0; li < lineItemDefs.length; li++) {
        await supabase.from('job_line_items').insert(Object.assign({ job_id: job.id, sort_order: li }, lineItemDefs[li]));
      }
      var total = lineItemDefs.reduce(function (sum, item) { return sum + item.quantity * item.unit_price; }, 0);
      await supabase.from('jobs').update({ total_due: total, balance: total - Number(job.amount_paid || 0) }).eq('id', job.id);
      lineItemJobsSeeded++;
    }
  }
  console.log('  [OK]   Created ' + jobCount + ' jobs (' + lineItemJobsSeeded + ' with full cost-category line items)');

  console.log('');
  console.log('  Demo data seeded successfully.');
  console.log('');
  console.log('  Now open the app and sign in with YOUR OWN Google account.');
  console.log('  Since no admin exists yet, you become the admin automatically');
  console.log('  and will see all 6 seeded clients plus the Financial Overview.');
  console.log('');
  console.log('  Two demo regular-user rows were also created (no real Google login');
  console.log('  needed to see the effect — as admin you can open Settings > Admin');
  console.log('  Settings and see them listed as ' + repA.email + ' / ' + repB.email + ',');
  console.log('  each already assigned some of the seeded clients, to demonstrate the');
  console.log('  "regular users only see their assigned clients" behavior).');
  console.log('');
}

seed().catch(function (err) {
  console.error('Seed failed:', err);
  process.exit(1);
});

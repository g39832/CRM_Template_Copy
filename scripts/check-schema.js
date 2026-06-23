require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const anonKey = process.env.SUPABASE_ANON_KEY || '';
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const headers = {
  'apikey': anonKey,
  'Authorization': 'Bearer ' + svcKey,
  'Accept': 'application/json'
};

async function run() {
  var projectRef = url.replace('https://', '').replace('.supabase.co', '');
  var allGood = true;

  // 1. Check if users table exists
  console.log('Checking schema...\n');
  var r1 = await fetch(url + '/rest/v1/information_schema.tables?table_schema=eq.public&table_name=eq.users&select=table_name', { headers });
  var usersData = await r1.json();
  var usersOk = Array.isArray(usersData) && usersData.length > 0;
  console.log('  users table:           ' + (usersOk ? 'EXISTS' : 'MISSING'));
  if (!usersOk) allGood = false;

  // 2. Check companies table
  var r2 = await fetch(url + '/rest/v1/information_schema.tables?table_schema=eq.public&table_name=eq.companies&select=table_name', { headers });
  var companiesData = await r2.json();
  var companiesOk = Array.isArray(companiesData) && companiesData.length > 0;
  console.log('  companies table:       ' + (companiesOk ? 'EXISTS' : 'MISSING'));
  if (!companiesOk) allGood = false;

  // 3. Check business_workflow column on companies
  var r3 = await fetch(url + '/rest/v1/information_schema.columns?table_schema=eq.public&table_name=eq.companies&column_name=eq.business_workflow&select=column_name,data_type', { headers });
  var bwData = await r3.json();
  var bwOk = Array.isArray(bwData) && bwData.length > 0;
  console.log('  business_workflow col: ' + (bwOk ? 'EXISTS (' + bwData[0].data_type + ')' : 'MISSING'));
  if (!bwOk) allGood = false;

  // 4. Check client_type column on clients
  var r4 = await fetch(url + '/rest/v1/information_schema.columns?table_schema=eq.public&table_name=eq.clients&column_name=eq.client_type&select=column_name,data_type', { headers });
  var ctData = await r4.json();
  var ctOk = Array.isArray(ctData) && ctData.length > 0;
  console.log('  client_type col:       ' + (ctOk ? 'EXISTS (' + ctData[0].data_type + ')' : 'MISSING'));
  if (!ctOk) allGood = false;

  // 5. Check company_components table
  var r5 = await fetch(url + '/rest/v1/information_schema.tables?table_schema=eq.public&table_name=eq.company_components&select=table_name', { headers });
  var ccData = await r5.json();
  var ccOk = Array.isArray(ccData) && ccData.length > 0;
  console.log('  company_components:    ' + (ccOk ? 'EXISTS' : 'MISSING'));
  if (!ccOk) allGood = false;

  console.log('');
  if (allGood) {
    console.log('SUCCESS: All required tables and columns exist. Migration is complete.');
    process.exit(0);
  }

  console.log('Some schema objects are missing. Run the full SQL from supabase-schema.sql:');
  console.log('1. Visit https://supabase.com/dashboard/project/' + projectRef + '/sql/new');
  console.log('2. Paste the full contents of supabase-schema.sql');
  console.log('3. Click "Run"\n');
  console.log('Then run this check again.');
  process.exit(1);
}

run().catch(console.error);

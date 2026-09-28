// Seed data for the in-memory Supabase stand-in. Shapes mirror what the real
// template database holds (client-level "legacy" money with and without jobs,
// jobs with and without line items, job + client notes, client services,
// payments, a recurring client, a client from a previous year) so the
// redesign is tested against realistic existing data. All names are fictional.

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const SAM_ID = '33333333-3333-4333-8333-333333333333';
const RILEY_ID = '44444444-4444-4444-8444-444444444444';

const year = new Date().getFullYear();
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 15, 0, 0)).toISOString();

module.exports = function buildSeed() {
  return {
    companies: [{ id: COMPANY_ID, name: 'Test Roofing Co', slug: 'default', created_at: iso(year - 2, 1, 1) }],
    users: [
      { id: OWNER_ID, email: 'owner@example.com', display_name: 'Olivia Owner', role: 'admin', company_id: COMPANY_ID, onboarding_complete: true, created_at: iso(year - 2, 1, 1) },
      { id: SAM_ID, email: 'sam@example.com', display_name: 'Sam Sales', role: 'user', company_id: COMPANY_ID, onboarding_complete: true, created_at: iso(year - 1, 3, 1) },
      { id: RILEY_ID, email: 'riley@example.com', display_name: 'Riley Rep', role: 'user', company_id: COMPANY_ID, onboarding_complete: true, created_at: iso(year - 1, 4, 1) }
    ],
    settings: [
      { key: 'admin_claimed', value: 'true' },
      { key: 'company_profile', value: JSON.stringify({ businessName: 'Test Roofing Co', businessAddress: '1 Main St', businessPhone: '555-0100', businessEmail: 'office@example.com', defaultScopeOfWork: '- Inspect roof\n- Provide written report' }) }
    ],
    services: [
      { id: 1, company_id: COMPANY_ID, name: 'Roof Inspection', description: 'Full roof inspection', default_rate: 250 },
      { id: 2, company_id: COMPANY_ID, name: 'Gutter Cleaning', description: '', default_rate: 180 },
      { id: 3, company_id: COMPANY_ID, name: 'Maintenance Visit', description: 'Monthly maintenance', default_rate: 120 },
      { id: 4, company_id: COMPANY_ID, name: 'Shingle Repair', description: '', default_rate: 400 },
      { id: 5, company_id: COMPANY_ID, name: 'Old Service', description: 'Retired', default_rate: 99, is_active: false }
    ],
    clients: [
      // 1: client-level money only (no jobs), client services, legacy PDFs on disk
      { id: 1, name: 'Alice Legacy', phone: '555-0101', email: 'alice@example.com', address: '10 Oak St', status: 'Invoiced',
        total_due: 5000, amount_paid: 2000, balance: 3000, job_cost: 3500, scope_of_work: '- Roof Inspection ($250.00)\n- Gutter Cleaning ($180.00)',
        assigned_user_id: SAM_ID, company_id: COMPANY_ID, created_at: iso(year, 2, 10) },
      // 2: client-level money AND jobs
      { id: 2, name: 'Bob Both', phone: '555-0102', email: 'bob@example.com', address: '22 Pine Ave', status: 'Approved',
        total_due: 1200, amount_paid: 1200, balance: 0, job_cost: 400, scope_of_work: 'Replace flashing',
        assigned_user_id: SAM_ID, company_id: COMPANY_ID, created_at: iso(year, 3, 5) },
      // 3: jobs only, recurring monthly maintenance
      { id: 3, name: 'Carla Jobs', phone: '555-0103', email: 'carla@example.com', address: '5 Elm Rd', status: 'Prospect',
        client_type: 'recurring', assigned_user_id: RILEY_ID, company_id: COMPANY_ID, created_at: iso(year, 4, 1) },
      // 4: brand-new lead, nothing attached, unassigned
      { id: 4, name: 'Dan Lead', phone: '555-0104', email: 'dan@example.com', address: '', status: 'Lead',
        company_id: COMPANY_ID, created_at: iso(year, 6, 12) },
      // 5: last year's client, closed
      { id: 5, name: 'Eve Closed', phone: '555-0105', email: 'eve@example.com', address: '9 Birch Ln', status: 'Closed',
        total_due: 800, amount_paid: 800, balance: 0, job_cost: 300, assigned_user_id: SAM_ID, company_id: COMPANY_ID, created_at: iso(year - 1, 9, 20) }
    ],
    jobs: [
      { id: 1, client_id: 2, title: 'Roof Replacement', status: 'Approved', scope_of_work: 'Tear off and replace roof',
        total_due: 2000, amount_paid: 500, balance: 1500, job_cost: 1200, tags: ['urgent'], created_at: iso(year, 3, 20) },
      { id: 2, client_id: 2, title: 'Gutter Job', status: 'Prospect', scope_of_work: '',
        total_due: 1500, amount_paid: 0, balance: 1500, job_cost: 700, created_at: iso(year, 5, 2) },
      { id: 3, client_id: 3, title: 'August Maintenance', status: 'Closed', scope_of_work: 'Monthly maintenance visit',
        total_due: 120, amount_paid: 120, balance: 0, job_cost: 40, created_at: iso(year, 8, 1) },
      { id: 4, client_id: 3, title: 'September Maintenance', status: 'Invoice', scope_of_work: 'Monthly maintenance visit',
        total_due: 120, amount_paid: 0, balance: 120, job_cost: 40, created_at: iso(year, 9, 1) },
      { id: 5, client_id: 5, title: 'Porch Roof', status: 'Closed', scope_of_work: 'Porch roof repair',
        total_due: 900, amount_paid: 900, balance: 0, job_cost: 350, created_at: iso(year - 1, 10, 1) }
    ],
    job_line_items: [
      { id: 1, job_id: 1, description: 'Tear-off labor', quantity: 1, unit_price: 800, category: 'Labor', sort_order: 0 },
      { id: 2, job_id: 1, description: 'Shingles', quantity: 30, unit_price: 40, category: 'Materials', sort_order: 1 },
      { id: 3, job_id: 4, description: 'Maintenance Visit', quantity: 1, unit_price: 120, category: 'Labor', sort_order: 0 },
      { id: 4, job_id: 3, description: 'Maintenance Visit', quantity: 1, unit_price: 120, category: 'Labor', sort_order: 0 }
    ],
    client_service: [
      { id: 1, client_id: 1, service_id: 1, sort_order: 0 },
      { id: 2, client_id: 1, service_id: 2, sort_order: 1 },
      { id: 3, client_id: 3, service_id: 3, custom_rate: 110, sort_order: 0 }
    ],
    payments: [
      { id: 1, client_id: 1, amount: 2000, payment_date: iso(year, 2, 20) },
      { id: 2, client_id: 2, amount: 1200, payment_date: iso(year, 3, 10) },
      { id: 3, client_id: 5, amount: 800, payment_date: iso(year - 1, 10, 5) }
    ],
    notes: [
      { id: 1, client_id: 1, content: 'Prefers morning calls', created_at: iso(year, 2, 11) },
      { id: 2, client_id: 2, content: 'Gate code 1234', created_at: iso(year, 3, 6) },
      { id: 3, client_id: 2, job_id: 1, content: 'Dumpster arrives Monday', created_at: iso(year, 3, 21) },
      { id: 4, client_id: 3, job_id: 4, content: 'Check north gutter', created_at: iso(year, 9, 2) }
    ],
    job_files: [
      { id: 1, job_id: 1, client_id: 2, category: 'document', file_name: 'contract.pdf', storage_path: 'jobs/1/document/1700000000000-contract.pdf', mime_type: 'application/pdf', size_bytes: 400, uploaded_by: OWNER_ID },
      { id: 2, job_id: 1, client_id: 2, category: 'photo', file_name: 'before.png', storage_path: 'jobs/1/photo/1700000000001-before.png', mime_type: 'image/png', size_bytes: 120, uploaded_by: OWNER_ID }
    ],
    finance_overrides: [
      { year, total_expected: 7000, total_received: 3200, total_remaining: 3000, total_clients: 4 }
    ],
    // v7 (only visible once migrated). Job 1's cost ($1,200) is itemized;
    // job 5's expense sits in a category that has since been deactivated;
    // job 2 still has a single typed-in cost ($700), like jobs created
    // before this feature.
    expense_categories: [
      { id: 1, company_id: COMPANY_ID, name: 'Labor', sort_order: 0 },
      { id: 2, company_id: COMPANY_ID, name: 'Materials', sort_order: 1 },
      { id: 3, company_id: COMPANY_ID, name: 'Commissions', sort_order: 2 },
      { id: 4, company_id: COMPANY_ID, name: 'Miscellaneous Expenses', sort_order: 3 },
      { id: 5, company_id: COMPANY_ID, name: 'Dumpsters', sort_order: 4, is_active: false }
    ],
    job_expenses: [
      { id: 1, job_id: 1, client_id: 2, category_id: 2, description: 'Shingles', amount: 700 },
      { id: 2, job_id: 1, client_id: 2, category_id: 1, description: 'Crew labor', amount: 500 },
      { id: 3, job_id: 5, client_id: 5, category_id: 5, description: 'Dumpster rental', amount: 350 }
    ],
    finance_margin_entries: [
      { id: 1, client_id: 2, client_name: 'Bob Both', category: 'Labor', project: 'Roof', amount: 300, expense_date: iso(year, 3, 25) }
    ]
  };
};

module.exports.IDS = { COMPANY_ID, OWNER_ID, SAM_ID, RILEY_ID };

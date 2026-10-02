// Table definitions for the in-memory Supabase stand-in used by the local
// test harness (tests/mock-supabase/server.js). Mirrors supabase-schema.sql
// closely enough that the app's real queries behave the same way — including
// "unknown column" errors, so code paths that feature-detect optional
// columns can be exercised both before and after a migration.
//
// Column shorthand: [type, default]. `default` may be a value or a function.
// Types: id (identity bigint), uuid, text, num, int, bool, ts, json, arr.

const now = () => new Date().toISOString();

const TABLES = {
  settings: {
    pk: ['key'],
    columns: { key: ['text'], value: ['text', ''] }
  },
  companies: {
    pk: ['id'],
    columns: {
      id: ['uuid'], name: ['text', ''], slug: ['text', ''], tagline: ['text', ''], description: ['text', ''],
      contact_email: ['text', ''], logo_url: ['text', ''], brand_primary_color: ['text', '#2563eb'],
      brand_secondary_color: ['text', '#2563eb'], onboarding_step: ['int', 1], business_workflow: ['text', 'both'],
      currency: ['text', 'USD'], created_at: ['ts', now], updated_at: ['ts', now]
    }
  },
  users: {
    pk: ['id'],
    unique: [['email']],
    columns: {
      id: ['uuid'], email: ['text'], password_hash: ['text', null], display_name: ['text', ''], role: ['text', 'user'],
      company_id: ['uuid', null], onboarding_complete: ['bool', false], auth_uid: ['uuid', null], picture_url: ['text', ''],
      created_at: ['ts', now], updated_at: ['ts', now]
    }
  },
  clients: {
    pk: ['id'],
    columns: {
      id: ['id'], name: ['text'], phone: ['text', ''], email: ['text', ''], address: ['text', ''], status: ['text', 'Lead'],
      total_due: ['num', 0], amount_paid: ['num', 0], balance: ['num', 0], scope_of_work: ['text', ''], job_cost: ['num', 0],
      client_type: ['text', 'one-off'], assigned_user_id: ['uuid', null], company_id: ['uuid', null], created_at: ['ts', now]
    },
    optional: { technician: ['text', ''] }
  },
  payments: {
    pk: ['id'],
    columns: { id: ['id'], client_id: ['int', null], amount: ['num', 0], payment_date: ['ts', now] },
    optional: { job_id: ['int', null] }
  },
  notes: {
    pk: ['id'],
    columns: { id: ['id'], client_id: ['int', null], job_id: ['int', null], content: ['text'], created_at: ['ts', now] }
  },
  finance_overrides: {
    pk: ['year'],
    columns: {
      year: ['int'], total_expected: ['num', 0], total_received: ['num', 0], total_remaining: ['num', 0],
      total_clients: ['int', 0], notes: ['text', null], updated_at: ['ts', now]
    }
  },
  finance_margin_entries: {
    pk: ['id'],
    columns: {
      id: ['id'], client_id: ['int', null], client_name: ['text', ''], category: ['text', 'Misc'], project: ['text', ''],
      invoice_status: ['text', 'Pending'], amount: ['num', 0], expense_type: ['text', 'one-time'], recurring: ['bool', false],
      expense_date: ['ts', now], notes: ['text', ''], attachment_url: ['text', ''], created_at: ['ts', now], updated_at: ['ts', now]
    }
  },
  jobs: {
    pk: ['id'],
    columns: {
      id: ['id'], client_id: ['int', null], title: ['text', 'New Job'], status: ['text', 'Prospect'], scope_of_work: ['text', ''],
      total_due: ['num', 0], amount_paid: ['num', 0], balance: ['num', 0], job_cost: ['num', 0], tags: ['arr', () => []],
      created_at: ['ts', now]
    },
    optional: { scheduled_start: ['text', null], duration_days: ['int', null], show_line_item_prices: ['bool', false] }
  },
  job_line_items: {
    pk: ['id'],
    check: {
      category: ['Labor', 'Materials', 'Commissions', 'Meals/Drinks', 'Miscellaneous', 'Permits']
    },
    columns: {
      id: ['id'], job_id: ['int'], description: ['text', ''], quantity: ['num', 1], unit_price: ['num', 0],
      category: ['text', 'Miscellaneous'], sort_order: ['int', 0], created_at: ['ts', now], updated_at: ['ts', now]
    }
  },
  job_files: {
    pk: ['id'],
    columns: {
      id: ['id'], job_id: ['int'], client_id: ['int'], category: ['text', 'document'], file_name: ['text'],
      storage_path: ['text'], mime_type: ['text', ''], size_bytes: ['int', 0], uploaded_by: ['uuid', null], created_at: ['ts', now]
    }
  },
  services: {
    pk: ['id'],
    columns: {
      id: ['id'], company_id: ['uuid'], name: ['text'], description: ['text', ''], default_rate: ['num', 0],
      is_active: ['bool', true], created_at: ['ts', now], updated_at: ['ts', now]
    }
  },
  client_service: {
    pk: ['id'],
    unique: [['client_id', 'service_id']],
    columns: {
      id: ['id'], client_id: ['int'], service_id: ['int'], custom_rate: ['num', null], notes: ['text', ''],
      sort_order: ['int', 0], created_at: ['ts', now]
    }
  },
  company_components: {
    pk: ['id'],
    columns: {
      id: ['id'], company_id: ['uuid'], component_type: ['text'], is_active: ['bool', true], display_order: ['int', 0],
      config: ['json', () => ({})], created_at: ['ts', now], updated_at: ['ts', now]
    }
  },
  activity_log: {
    pk: ['id'],
    columns: {
      id: ['id'], company_id: ['uuid'], user_id: ['uuid', null], action: ['text'], entity_type: ['text', null],
      entity_id: ['text', null], details: ['json', null], created_at: ['ts', now]
    }
  },
  // v7 tables — only reachable once the mock is "migrated" (see server.js).
  expense_categories: {
    pk: ['id'],
    optionalTable: true,
    columns: {
      id: ['id'], company_id: ['uuid', null], name: ['text'], is_active: ['bool', true], sort_order: ['int', 0],
      created_at: ['ts', now], updated_at: ['ts', now]
    }
  },
  job_expenses: {
    pk: ['id'],
    optionalTable: true,
    columns: {
      id: ['id'], job_id: ['int'], client_id: ['int', null], category_id: ['int', null], description: ['text', ''],
      amount: ['num', 0], expense_date: ['ts', now], created_by: ['uuid', null], created_at: ['ts', now], updated_at: ['ts', now]
    }
  },
  email_templates: {
    pk: ['id'],
    columns: {
      id: ['id'], company_id: ['uuid'], name: ['text'], subject: ['text'], body: ['text'], type: ['text', 'custom'],
      variables: ['json', () => ({})], created_at: ['ts', now], updated_at: ['ts', now]
    }
  }
};

// Foreign keys: [childTable, childColumn, parentTable, onDelete]
const FOREIGN_KEYS = [
  ['payments', 'client_id', 'clients', 'cascade'],
  ['notes', 'client_id', 'clients', 'cascade'],
  ['notes', 'job_id', 'jobs', 'cascade'],
  ['jobs', 'client_id', 'clients', 'cascade'],
  ['job_line_items', 'job_id', 'jobs', 'cascade'],
  ['job_files', 'job_id', 'jobs', 'cascade'],
  ['job_files', 'client_id', 'clients', 'cascade'],
  ['client_service', 'client_id', 'clients', 'cascade'],
  ['client_service', 'service_id', 'services', 'cascade'],
  ['finance_margin_entries', 'client_id', 'clients', 'set null'],
  ['clients', 'assigned_user_id', 'users', 'set null'],
  ['payments', 'job_id', 'jobs', 'set null'],
  ['expense_categories', 'company_id', 'companies', 'cascade'],
  ['job_expenses', 'job_id', 'jobs', 'cascade'],
  ['job_expenses', 'client_id', 'clients', 'cascade'],
  ['job_expenses', 'category_id', 'expense_categories', 'restrict'],
  ['job_expenses', 'created_by', 'users', 'set null']
];

module.exports = { TABLES, FOREIGN_KEYS };

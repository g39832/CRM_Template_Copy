-- =============================================
-- CRM TEMPLATE — WIZARD & CONTRACT BUILDER
-- Run this in the Supabase SQL editor.
-- Safe to run multiple times (IF NOT EXISTS).
-- =============================================

-- =============================================
-- 1. CONTRACT TEMPLATES
-- Stores document assembly definitions that
-- map which source sections compose a contract.
-- =============================================
create table if not exists public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text default '',
  template_config jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contract_templates_company_id_idx
  on public.contract_templates (company_id);

-- =============================================
-- 2. CONTRACT VERBOSE (Legal Terms)
-- Stores full legal / verbose contract bodies
-- that can be referenced by templates.
-- =============================================
create table if not exists public.contract_verbose (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null default 'Default Terms',
  body text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contract_verbose_company_id_idx
  on public.contract_verbose (company_id);

-- =============================================
-- 3. SCOPES OF WORK
-- Reusable line-item scope definitions that
-- can be attached to jobs or contracts.
-- =============================================
create table if not exists public.scopes_of_work (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text default '',
  line_items jsonb not null default '[]',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scopes_of_work_company_id_idx
  on public.scopes_of_work (company_id);

-- =============================================
-- 4. DOCUSIGN ENVELOPES
-- Tracks the lifecycle of electronic signature
-- requests sent via DocuSign.
-- =============================================
create table if not exists public.docusign_envelopes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id bigint references public.clients(id) on delete set null,
  job_id bigint references public.jobs(id) on delete set null,
  envelope_id text default '',
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'delivered', 'completed', 'declined', 'voided', 'expired')),
  document_type text not null
    check (document_type in ('estimate', 'invoice', 'contract')),
  document_url text default '',
  signing_url text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists docusign_envelopes_company_id_idx
  on public.docusign_envelopes (company_id);

create index if not exists docusign_envelopes_status_idx
  on public.docusign_envelopes (status);

-- =============================================
-- 5. EXTEND JOBS TABLE
-- Adds job_address for the wizard Step 3 and
-- margin_pct for fast financial aggregation.
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'job_address'
  ) THEN
    ALTER TABLE public.jobs ADD COLUMN job_address text DEFAULT '';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'margin_pct'
  ) THEN
    ALTER TABLE public.jobs ADD COLUMN margin_pct numeric(5,1) DEFAULT 0;
  END IF;
END $$;

-- =============================================
-- 6. BACKFILL margin_pct FOR EXISTING ROWS
-- Computes margin percentage for all existing
-- jobs where total_due > 0.  Jobs with zero or
-- null total_due get 0 margin_pct.
-- Safe to run multiple times (uses COALESCE).
-- =============================================
UPDATE public.jobs
SET margin_pct = ROUND(
  COALESCE(
    ((total_due - job_cost) / NULLIF(total_due, 0)) * 100,
    0
  ),
  1
)
WHERE margin_pct IS DISTINCT FROM ROUND(
  COALESCE(
    ((total_due - job_cost) / NULLIF(total_due, 0)) * 100,
    0
  ),
  1
);

-- =============================================
-- 7. SEED A DEFAULT CONTRACT_VERBOSE FOR EVERY
--    EXISTING COMPANY THAT DOESN'T HAVE ONE
-- =============================================
INSERT INTO public.contract_verbose (company_id, name, body, is_default)
SELECT c.id, 'Default Terms', '', true
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.contract_verbose cv
  WHERE cv.company_id = c.id AND cv.is_default = true
);

-- =============================================
-- 8. FORCE SUAPABASE SCHEMA CACHE REFRESH
-- =============================================
NOTIFY pgrst, 'reload schema';

-- =============================================
-- VERIFICATION QUERIES (run separately if needed)
-- =============================================
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'jobs'
--   AND column_name IN ('job_address', 'margin_pct');
--
-- SELECT id, name, margin_pct FROM public.jobs LIMIT 5;

# CRM Template

CRM Template is a Node.js web application for managing clients, payments, notes, file uploads, and finance summaries. This copy has been generalized so it can be reused as a client-facing demo template and connected to a new Supabase project.

## Overview

- Backend: Node.js + Express
- Frontend: HTML, CSS, JavaScript
- Data: Supabase PostgreSQL via the Supabase API
- Auth: Google sign-in via Supabase Auth (no passwords, no registration wizard)
- File storage: Supabase Storage

## Project Structure

- `server.js` - app entry point
- `api/` - route handlers and data access helpers
- `services/` - storage and backup helpers
- `main.html` / `finance.html` / `login.html` - frontend pages
- `main-renderer.js` / `finance-renderer.js` / `login.js` - client logic

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your local environment file:

```bash
copy .env.example .env
```

3. Fill in the values in `.env`.

4. Run the database migrations (safe to re-run — everything is additive):

```bash
node scripts/migrate-v2.js
node scripts/migrate-v3-crm-improvements.js
node scripts/migrate-v6-client-overview.js   # optional — see "Client page and jobs" below
```

   If those can't reach your database directly (no `SUPABASE_DATABASE_URL`/`SUPABASE_ACCESS_TOKEN`
   set), open your Supabase project's SQL editor and run the full contents of
   `supabase-schema.sql` instead — it's idempotent, so running the whole file is safe.

5. (Optional) Load realistic demo data so the app doesn't look empty:

```bash
node scripts/seed-demo-data.js
```

6. Enable Google sign-in (one-time, in your Supabase project):
   - Supabase Dashboard → Authentication → Providers → Google → enable it, and paste in a
     Google OAuth Client ID/Secret from the Google Cloud Console.
   - In that same Google Cloud OAuth client, add this Authorized redirect URI:
     `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - In Supabase Dashboard → Authentication → URL Configuration, add your app's own URL
     (e.g. `http://localhost:3000` for local dev) to "Redirect URLs".

7. Start the app:

```bash
npm start
```

Then open **http://localhost:3000** — the first person to sign in with Google
automatically becomes the admin.

## Supabase Setup

Create a Supabase project, then create these tables (also captured in full in
`supabase-schema.sql`, including the newer additive columns/tables described below):

- `settings`
- `clients`
- `payments`
- `notes`
- `finance_overrides`
- `finance_margin_entries`
- `jobs`
- `job_line_items`
- `companies`
- `users`

Minimum recommended columns:

- `settings`: `key text primary key`, `value text`
- `clients`: `id bigint identity primary key`, `name text`, `phone text`, `email text`, `address text`, `status text`, `total_due numeric`, `amount_paid numeric`, `balance numeric`, `scope_of_work text`, `job_cost numeric`, `assigned_user_id uuid references users(id)`, `company_id uuid references companies(id)`, `technician text` (v6, optional), `created_at timestamptz`
- `payments`: `id bigint identity primary key`, `client_id bigint`, `amount numeric`, `payment_date timestamptz`, `job_id bigint null` (v6, optional)
- `notes`: `id bigint identity primary key`, `client_id bigint`, `content text`, `created_at timestamptz`
- `finance_overrides`: `year int unique`, `total_expected numeric`, `total_received numeric`, `total_remaining numeric`, `total_clients int`, `notes text`, `updated_at timestamptz`
- `finance_margin_entries`: `id bigint identity primary key`, `client_id bigint null`, `client_name text`, `category text`, `project text`, `invoice_status text`, `amount numeric`, `expense_type text`, `recurring boolean`, `expense_date timestamptz`, `notes text`, `attachment_url text`, `created_at timestamptz`, `updated_at timestamptz`
- `jobs`: `id bigint identity primary key`, `client_id bigint`, `title text`, `status text`, `scope_of_work text`, `total_due numeric`, `amount_paid numeric`, `balance numeric`, `job_cost numeric`, `tags text[]`, `created_at timestamptz`
- `job_line_items`: `id bigint identity primary key`, `job_id bigint`, `description text`, `quantity numeric`, `unit_price numeric`, `category text` (Labor/Materials/Commissions/Meals-Drinks/Miscellaneous/Permits), `sort_order int`, `created_at timestamptz`, `updated_at timestamptz`
- `companies`: `id uuid primary key`, `name text`, `slug text unique`, ... (single row auto-created on first Google sign-in)
- `users`: `id uuid primary key`, `email text unique`, `auth_uid uuid unique` (links to the Supabase Auth user), `display_name text`, `picture_url text`, `role text` (`admin`/`user`), `company_id uuid`, `created_at timestamptz`

If you are unsure about a field, keep the column names above and adjust the app later through the TODOs in the code.

### Client-level pipeline stage vs. job-level tags

`clients.status` is the client's overall pipeline **stage**, shown on the main Client
Workspace page. It is restricted to exactly six values: `Lead`, `Photo report`,
`Prospect`, `Approved`, `Invoiced`, `Closed`. This is intentionally a completely
separate concept from `jobs.status` (a job's own workflow state) and `jobs.tags`
(free-form per-job labels) — neither of the latter two ever writes to `clients.status`.

### Roles and permissions

- **Admin**: full access — all clients, all jobs, Financial Overview, payments, exports,
  margin tracker, user management.
- **Regular user**: only sees clients where `clients.assigned_user_id` matches their own
  user id. Financial fields (`total_due`, `amount_paid`, `balance`, `job_cost`) are
  stripped server-side before the response ever reaches a regular user — see
  `api/access-control.js`. This is enforced on every relevant endpoint, not just hidden
  in the UI, so it can't be bypassed via direct API calls.
- On a job, a regular user sees the job total, money received and balance (never the job
  cost, profit or margin) and the job's services list — the same prices already printed
  on the estimate/invoice PDFs they can download. Adding, editing or removing priced
  services, recording payments and setting cost stay admin-only; a regular user's
  "+ Service" adds the service to the job's scope of work instead. They can edit the
  client's info (including Technician), job text, notes, files, photos and tags as before.

### Client page and jobs

The client page is a condensed **overview**; the detailed work happens inside each job.

- **Client page** — name, stage, Salesperson (`assigned_user_id`), Technician, address,
  phone and email; read-only totals (**Total Amount Due**, **Money Received**, **Balance**
  and, for admins, **Cost** with margin); the list of jobs with **+ Job** at the end; and
  collapsed client notes. Totals are never typed in here — they add up the client's jobs
  (plus any client-level amounts, below).
- **+ Job** — creates a job that can start blank, from the client's saved services and
  scope, from the company default scope, or as a copy of an earlier job. Copying is how
  recurring work is handled: copy "September Maintenance" and the new job is suggested as
  "October Maintenance" with the same services and cost. **Duplicate** inside a job does
  the same in one click.
- **Job workspace** (click a job) — status, tags, money (Job Total, Received, Balance,
  Cost, Profit, Margin), payments with history and undo, **Services & Scope of Work**
  (**+ Service** from the preset list, custom line items, inline edit/remove; the job
  total is the sum of its services, and the scope text prints on the estimate/invoice —
  if it's blank, the services are listed instead), documents & PDFs, photos, notes, and
  estimate/invoice downloads. Closing it with **X**, Escape or a click outside saves
  everything first, including a typed-but-unsubmitted payment or note; if a save fails
  the job stays open so nothing is lost.
- **Client account** — shown in the jobs list only when a client has money, services or
  PDFs recorded on the client record itself (how the CRM worked before jobs). It keeps all
  of that editable exactly as before — Total Due, payments and undo, cost and margin,
  client estimate/invoice, the client's saved services, and the client PDF drop box — and
  its amounts are included in the client totals. Those PDFs are also listed inside every
  job's Documents section.
- **Homepage** — sort by Stage, Salesperson, Technician, Year or Name; filter by
  Salesperson, Technician, Year, Stage and date added. (The min/max revenue and
  one-off/recurring filters are no longer shown; `client_type`, the recurring cron and
  `/api/search/filtered` are unchanged.)
- **Finance** — year totals now include job amounts as well as client-level amounts, and
  job payments are written to the `payments` ledger (so money received on jobs shows up
  in Finance and the margin tracker). Payment corrections are recorded as negative
  entries; payment records are never deleted.

### Job costs and expense categories

Inside a job (admins — job cost is admin-only), **Job Costs** lists each cost with a
description, amount and category, shows a total per category plus the Total Cost, and
the job's cost *is* that total — so profit, margin, the client's Cost tile and Finance
all use it with no separate calculation. The first itemized cost on a job that already
had a typed-in cost keeps that figure as an **Uncategorized** line, so nothing drops.

Categories belong to the business and are managed in **Settings → Expense Categories**
(admins). New businesses start with Labor, Materials, Commissions and Miscellaneous
Expenses. Costs reference categories by id, so **renaming** a category renames it on
every existing cost. **Deactivating** hides it from the picker for new costs while every
existing cost, total and report keeps it. A category can only be **deleted** while no
cost uses it (the database enforces this too).

This needs the **v7 migration** (`npm run migrate:v7`, or the "TEMPLATE UPGRADE v7"
section of `supabase-schema.sql` in the SQL editor): two new tables, `expense_categories`
and `job_expenses`, plus the default categories. Until it is run, jobs keep their single
Job Cost field and the new screens show a notice.

**Optional migration (v6)** — `node scripts/migrate-v6-client-overview.js`, or run the
"TEMPLATE UPGRADE v6" section at the end of `supabase-schema.sql` in the SQL editor.
It only adds `clients.technician` and `payments.job_id` (plus an index). Everything
works without it: technician names are kept in the `settings` table until the column
exists (the migration copies them over), and per-job payment history appears once
`payments.job_id` exists. Payments recorded on jobs before this change aren't in the
ledger, so they show as "Recorded before payment history" inside the job.

## Render Deployment

1. Create a new Render Web Service.
2. Connect this repository.
3. Set the build command to `npm install`.
4. Set the start command to `npm start`.
5. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SESSION_SECRET` (required in production — without it a random secret is generated on
     every boot, so every user is logged out on each restart)
   - `SUPABASE_SERVICE_ROLE_KEY` if you want server-side file upload support
   - `SUPABASE_DATABASE_URL` for durable sessions (see below)
   - Do **not** set `PORT` yourself — Render injects it, and the app binds to it on `0.0.0.0`
   - Email vars are optional and only needed if you later re-enable outbound email sending
   - Make sure the Google provider is enabled in Supabase Auth (see Setup step 6 above),
     and add your deployed URL to Supabase's Redirect URLs list.
6. Deploy the service.

The included `render.yaml` can be used as a starting point for Infrastructure as Code.

### Durable sessions (recommended)

Without extra configuration sessions live in the Node process's memory. That means every
restart, deploy, or idle spin-down logs everyone out (the browser keeps its cookie, but the
server no longer knows the session), and two instances would not share logins. Pointing the
app at your Supabase Postgres database fixes that:

1. In Supabase, open **Project Settings → Database → Connection string**, switch the selector (or the
   top-bar **Connect** button) to **Session pooler**, and copy that URI (port `5432`). If the host in
   the string is `db.<project-ref>.supabase.co` you are still on **Direct connection**: Render is
   IPv4-only and that host is IPv6-only (unless Supabase's IPv4 add-on is enabled), so it cannot
   connect — the pooler host contains `pooler.supabase.com` instead. The **Transaction pooler**
   (`6543`) does connect, but it cannot hold a session, so it is not an option here. Replace
   `[YOUR-PASSWORD]` in the copied string with your database password — keeping the
   `postgres.<project-ref>` username as-is and percent-encoding any special characters — then paste
   that password into `SUPABASE_DATABASE_URL` too. If you do not know the password, reset it on the
   same page; a reset changes every password-based connection (the pooler URL, migration scripts)
   but not the app's REST access, which uses the service-role key.
2. Add it to the Render service as `SUPABASE_DATABASE_URL`, then redeploy.
3. That's it. The `session` table is created automatically on first use (it is also defined in
   `supabase-schema.sql` if you prefer creating it yourself). If your database user is not
   allowed to create tables, run the session DDL at the end of `supabase-schema.sql` in the
   Supabase SQL editor first — otherwise the app cannot persist sessions and stays on the
   in-memory store. To create it yourself instead, run this:

```sql
-- Only needed if the app cannot create the table itself. Safe to re-run.
CREATE TABLE IF NOT EXISTS public.session (
  sid TEXT PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS session_expire_idx ON public.session (expire);
```

Row Level Security does not apply here: the app connects directly to Postgres as the `postgres`
role, so no policy is needed for this table. On boot the log prints either
`[session] Postgres session store active` or an explanation of
why it stayed on in-memory sessions. A missing, wrong, or unreachable value never breaks
sign-in; the app degrades to in-memory sessions instead. Falling back does log the current
user out once, because their session exists only in Postgres.

## Customization Guide

- Replace the placeholder brand text in the UI with your own company name.
- Update the login logo or badge if you want custom branding.
- Update the storage bucket name in `.env` if you want a different file bucket.
- Use `Company Profile` in the app to change the company name, address, phone, and email that appear on invoices.
- The invoice/estimate buttons download a PDF directly (including the categorized cost
  breakdown when a job has line items), so no email setup is required for that workflow.
- Add or refine Supabase Row Level Security policies before production use — this template
  relies on the server-side service role key plus its own `api/access-control.js` checks
  rather than RLS, so RLS is optional defense-in-depth, not currently required for it to work.

## Mobile / Responsive Layout

Styling is plain CSS, with no framework. Shared rules live in `style.css`, and
page-specific rules sit in each page's `<style>` block. The breakpoints are:

- `max-width: 768px` — main phone/tablet-portrait breakpoint (single column,
  full-screen client panel, stacked forms)
- `(orientation: portrait)` / `(orientation: landscape)` variants of the above
- `max-width: 640px` (job modals), `600px` (settings), `1180px` (finance grids)
- `(pointer: coarse)` — finger-sized tap targets on touch devices wider than
  768px (landscape phones, tablets), without changing the desktop layout

The fixes from the mobile audit are in the `RESPONSIVE FIXES` section at the
end of `style.css`, plus small additions to the media blocks in `main.html`,
`finance.html` and `settings.html`:

| Issue (before) | Where | Fix |
|---|---|---|
| Top nav overflowed on phones up to 390px; theme toggle and role badge were clipped and could not be tapped | all pages | nav links wrap; 40px+ tap targets |
| Client search input squashed to ~22px on phones and portrait tablets (filter button took the whole row) | dashboard | input flexes, filter button stays 44px square |
| Client panel kept a 2-column grid on phones: labels sat next to the wrong fields and the right column was cut off | client panel | single column at ≤768px |
| Client panel close button was 14–16px wide; phone/email links 16px tall | client panel | 44px close button, 40px link targets |
| Clients sidebar scrolled sideways by 40px at every width above 768px | dashboard | workspace capped to its container (desktop looks the same) |
| Settings page had 24px page padding on phones, which pushed the nav off-screen | settings | 12px padding at ≤600px |
| Margin table and heatmap scroll sideways on small screens, but you lost track of which client a row belonged to | finance | client column pinned, with a shadow hinting at more content; 44px expand buttons on touch |
| Badge text under 10px | dashboard | 0.7rem on phones/touch |

Cross-device tests: see [`tests/README.md`](tests/README.md)
(`npm run test:responsive`).

## Notes

- The app starts from `server.js` and listens on `process.env.PORT`.
- Backup support is optional and disabled by default in the template.
- Some areas include TODO comments where the original project relied on local database assumptions.

## Local test harness (no real data touched)

**Try it in a browser:** `npm run dev:local` starts the fake database with sample data plus the app, and prints
links that sign you straight in as an admin or a regular user. Ctrl+C stops it; the next run starts fresh.

`tests/mock-supabase/` is a small in-memory stand-in for the Supabase REST API, seeded
with realistic sample data (client-level money with and without jobs, services, notes,
files, a recurring client, a previous-year client). It lets every workflow be tested
end-to-end without reading or writing the project in `.env`:

```bash
npm run test:local:api   # API tests: permissions, totals, payments ledger, migration states
npm run test:local       # browser tests on 7 device sizes (incl. light/dark contrast checks)
```

Both override every database/storage variable (see `tests/local-env.js`) and refuse to run
if `SUPABASE_URL` isn't local. `tests/redesign.spec.js` creates and deletes records, so the
regular `npm run test:responsive` (which uses the real project) ignores it.

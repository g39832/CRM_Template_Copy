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

Then open **http://localhost:3000**. Sign-in is **invitation-only**: a Google account gets in
only if an admin added its email address. For the very first admin of a new deployment, put
your email in `ADMIN_EMAILS` (comma-separated) before signing in — it only works while the
company has no admin yet. Everyone else is added by an admin in Admin Settings → Users &
Permissions (email + role, no password).

## Security model (read before deploying a customer)

- **Invitation-only sign-in.** Unknown Google accounts are refused and no user row is
  created. Removing a user in User Management signs out their open sessions within a
  minute and they cannot sign back in. Role changes apply without signing out. Only
  Google-verified identities are accepted.
- **The browser never touches the database.** Every table has Row Level Security ON with
  no policies (the last block of `supabase-schema.sql`), so the public key that ships on
  the login page reads and writes nothing. The server uses the service-role key, which
  bypasses RLS. Never add anon/authenticated policies to "make something work".
- **Customer files are private.** `SUPABASE_STORAGE_BUCKET` (default `crm-files`) must stay
  private; files are served only after an access check, through short-lived (1-hour) signed links.
  Logos go to a separate public bucket, `SUPABASE_PUBLIC_BUCKET` (default
  `crm-public-assets`), created automatically on the first logo upload.
- **Admin-only company settings.** Email (SMTP) settings, company profile changes,
  branding, users and finance are refused (403) for regular users on the server.
- **`/health`** returns only `{"status":"ok"}`; admins can check the database at
  `/api/v2/admin/system-health`.
- **Headers.** A nonce-based Content-Security-Policy, `X-Frame-Options: DENY`,
  `nosniff`, a referrer policy and (over HTTPS) HSTS are sent on every response.
- **After every deploy** run the read-only check (exit code 1 on any failure):

  ```bash
  # with the deployment's .env (checks RLS, the bucket, a real file's public URL)
  APP_URL=https://your-app.onrender.com npm run verify:security
  # without any secrets (public surface only)
  node scripts/verify-security.js --public-only --app-url https://your-app.onrender.com
  ```

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
  Cost, Profit, Margin — **Cost is read-only here**; it comes from Job Costs), payments
  with history and undo, **Services & Scope of Work** (**+ Service** from the preset
  list, custom line items, inline edit/remove; the job total is the sum of its services),
  documents & PDFs and photos (click to upload or **drag and drop** files onto the
  section — PDF/Word/Excel for Documents, images for Photos, several at once), notes, and
  estimate/invoice downloads.
  - **+ Service is part of the Scope of Work**: each added service is written into the
    scope text as `- Service name` (saved immediately); removing or renaming the service
    updates that line. Quantity, unit price and category stay business-side.
  - **Estimates and invoices are customer-facing**: they show the business and client
    details, the Scope of Work (if the scope text is blank, the service names are listed)
    and one clear total (plus paid / balance due on invoices). They never show a cost
    breakdown, categories, quantities, unit prices, job costs, profit or margin. Amounts
    are printed with thousands separators (`12,500.00`).
  - Money fields accept natural typing (`1250.50` types straight through, nothing is
    reformatted while typing); they show `1,250.50` once you leave the field. Closing it with **X**, Escape or a click outside saves
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
  The page opens with a **Financial Overview** (modelled on the Roofing CRM finance
  dashboard): KPI cards (Expected Earnings, Received with % collected, Remaining,
  Clients, Avg Margin with a Healthy/Watch/Low indicator), a revenue/cost/profit chart
  with a margin ring, money received by month, sales by salesperson and costs by
  category. It is read-only (`GET /api/finance/overview`, admin only) and uses the same
  rules as the year totals; the Year Totals & Overrides table, Margin Tracker and Tax
  Documents below are unchanged.
- **New clients** — only the name (and phone) is needed; email is optional everywhere.

### Settings notes

- **My Settings → Preferences** switches (Dark mode, Compact dashboard layout, Email
  reminders) save to the browser as soon as they are switched. Compact layout tightens
  spacing on the Clients page. Email reminders is only a stored preference — the CRM
  does not send reminder emails.
- **Platform Preferences → Operational Model** (`companies.business_workflow`: single /
  returning / both) is saved and reloaded, but **nothing in the CRM currently changes
  with it** — clients, jobs, recurring work, totals and Finance behave the same for every
  choice. It is returned by `/api/v2/dashboard/stats`, whose workflow panel is not part
  of the current dashboard. The setting page says so.

### Job costs and expense categories

Inside a job (admins — job cost is admin-only), **Job Costs** lists each cost with a
description, amount and category, shows a total per category plus the Total Cost, and
the job's cost *is* that total — so profit, margin, the client's Cost tile and Finance
all use it with no separate calculation. Job Costs is the **only** place a job's cost
is changed: the Money section's Cost tile just displays it, and the server ignores a
`job_cost` sent to `PUT /api/jobs/:id` once the v7 tables exist. An older job that has
a typed-in cost from before itemized costs keeps it — Job Costs shows it with a **Move
into cost list** button (`POST /api/jobs/:id/expenses/itemize-existing`), and adding
the first itemized cost does the same automatically: the figure becomes an
**Uncategorized** line, so nothing drops. (Before the v7 migration there is no itemized
list, so the single Job Cost field is still shown in Money.) Client-level cost on the
older **Client account** records stays editable there, as before.

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

### Line-item pricing on estimates and invoices

Inside a job, **Estimate & invoice pricing** (under Services & Scope of Work) chooses
how that job's estimate and invoice PDFs show the price:

- **Show one total** (the default, and the original format) — the scope of work and one
  total; service prices are not shown.
- **Show line-item pricing** — each service added with **+ Service** (or as a custom line
  item) with its amount, then the total. Quantities, unit prices and categories are still
  never printed, and a scope line that just repeats a service's name isn't printed twice.

The services are the only prices: the total on both formats is their sum, exactly as the
Job Total is. The choice is saved on the job the moment it's switched
(`jobs.show_line_item_prices`) and only changes what the PDFs show — never the Job
Total, cost, payments, balance, profit or service prices. Switch it at any time and
download again; nothing has to be recreated. Duplicated jobs keep the choice.

This needs the **v10 database update** (the "TEMPLATE UPGRADE v10" section at the end of
`supabase-schema.sql`): one column that defaults to `false`, so every existing job keeps
the one-total format. Until it is run the option is hidden and PDFs show one total.

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
   - `ADMIN_EMAILS` — the first admin's Google email (only used while there is no admin)
   - `SESSION_COOKIE_SECURE=true` (HTTPS-only session cookie)
   - `SUPABASE_PUBLIC_BUCKET` (optional, default `crm-public-assets`) — logos only
   - Do **not** set `PORT` yourself — Render injects it, and the app binds to it on `0.0.0.0`
   - Email vars are optional and only needed if you later re-enable outbound email sending
   - Make sure the Google provider is enabled in Supabase Auth (see Setup step 6 above),
     and add your deployed URL to Supabase's Redirect URLs list.
6. Deploy the service.
7. Run `node scripts/verify-security.js` against it (see "Security model").

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
- The invoice/estimate buttons download a customer-facing PDF directly (scope of work and
  one total — no internal cost breakdown), so no email setup is required for that workflow.
- Add or refine Supabase Row Level Security policies before production use — this template
  relies on the server-side service role key plus its own `api/access-control.js` checks
  rather than RLS, so RLS is optional defense-in-depth, not currently required for it to work.

## Buttons, dropdowns and inputs

Every control's look (height, border, radius, colours, focus ring, hover,
disabled) comes from one section at the end of `style.css` headed
**CONTROLS**, driven by tokens on `:root` (`--control-h`, `--control-radius`,
`--control-border`, ...) that switch automatically in dark mode. Page
`<style>` blocks and component rules only handle layout (width, flex, grid).

- **Buttons**: `.btn-primary` (main action), `.btn-secondary` (everything
  else), `.btn-danger` (destructive: outlined red, solid red on hover). Add
  `.btn-sm` for small row actions (Edit / Delete / Deactivate). Default height
  40px, small 34px; 44px / 40px on phones and touch screens.
- **Inputs, selects, textareas** share one style; selects get a single
  chevron and theme-aware option lists (`color-scheme`). Dense rows (existing
  services and costs, filters, sort) use the compact 34px size.
- **Read-only** fields keep full-contrast text on a tinted background;
  **disabled** fields are dimmed.
- One font stack everywhere (`--font-ui`, Segoe UI / system UI).
- Avoid inline `style="background:..."` on buttons; it blocks the hover state.

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
| Split-screen / small windows (≤768px) could only be scrolled by dragging the scrollbar — mouse wheel and trackpad did nothing | all pages | `overflow-x` is no longer set on `html` (that made `body` a separate, non-scrolling scroll container that swallowed wheel events); `body` alone clips sideways overflow |

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

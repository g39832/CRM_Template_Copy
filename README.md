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
- `clients`: `id bigint identity primary key`, `name text`, `phone text`, `email text`, `address text`, `status text`, `total_due numeric`, `amount_paid numeric`, `balance numeric`, `scope_of_work text`, `job_cost numeric`, `assigned_user_id uuid references users(id)`, `company_id uuid references companies(id)`, `created_at timestamptz`
- `payments`: `id bigint identity primary key`, `client_id bigint`, `amount numeric`, `payment_date timestamptz`
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

## Notes

- The app starts from `server.js` and listens on `process.env.PORT`.
- Backup support is optional and disabled by default in the template.
- Some areas include TODO comments where the original project relied on local database assumptions.

# CRM Template

CRM Template is a Node.js web application for managing clients, payments, notes, file uploads, and finance summaries. This copy has been generalized so it can be reused as a client-facing demo template and connected to a new Supabase project.

## Overview

- Backend: Node.js + Express
- Frontend: HTML, CSS, JavaScript
- Data: Supabase PostgreSQL via the Supabase API
- Auth: App-level password login stored in Supabase `settings`
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

4. Start the app:

```bash
npm start
```

## Supabase Setup

Create a Supabase project, then create these tables:

- `settings`
- `clients`
- `payments`
- `notes`
- `finance_overrides`
- `finance_margin_entries`

Minimum recommended columns:

- `settings`: `key text primary key`, `value text`
- `clients`: `id bigint identity primary key`, `name text`, `phone text`, `email text`, `address text`, `status text`, `total_due numeric`, `amount_paid numeric`, `balance numeric`, `created_at timestamptz`
- `payments`: `id bigint identity primary key`, `client_id bigint`, `amount numeric`, `payment_date timestamptz`
- `notes`: `id bigint identity primary key`, `client_id bigint`, `content text`, `created_at timestamptz`
- `finance_overrides`: `year int unique`, `total_expected numeric`, `total_received numeric`, `total_remaining numeric`, `total_clients int`, `notes text`, `updated_at timestamptz`
- `finance_margin_entries`: `id bigint identity primary key`, `client_id bigint null`, `client_name text`, `category text`, `project text`, `invoice_status text`, `amount numeric`, `expense_type text`, `recurring boolean`, `expense_date timestamptz`, `notes text`, `attachment_url text`, `created_at timestamptz`, `updated_at timestamptz`

If you are unsure about a field, keep the column names above and adjust the app later through the TODOs in the code.

## Render Deployment

1. Create a new Render Web Service.
2. Connect this repository.
3. Set the build command to `npm install`.
4. Set the start command to `npm start`.
5. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `PORT`
   - `SESSION_SECRET`
   - `DEFAULT_ADMIN_PASSWORD`
   - `SUPABASE_SERVICE_ROLE_KEY` if you want server-side file upload support
   - Email vars are optional and only needed if you later re-enable outbound email sending
6. Deploy the service.

The included `render.yaml` can be used as a starting point for Infrastructure as Code.

## Customization Guide

- Replace the placeholder brand text in the UI with your own company name.
- Update the login logo or badge if you want custom branding.
- Adjust the `settings` password workflow if you want Supabase Auth instead of an app password.
- Update the storage bucket name in `.env` if you want a different file bucket.
- Use `Company Profile` in the app to change the company name, address, phone, and email that appear on invoices.
- The invoice button now downloads a PDF directly, so no email setup is required for that workflow.
- Add or refine Supabase Row Level Security policies before production use.

## Notes

- The app starts from `server.js` and listens on `process.env.PORT`.
- Backup support is optional and disabled by default in the template.
- Some areas include TODO comments where the original project relied on local database assumptions.

# Render Cron Job Configuration Guide

## Overview

The CRM Template includes a recurring invoice generation engine accessible at `GET /api/v2/dashboard/recurring-cron`. This endpoint scans for returning/recurring clients and auto-generates pending invoice drafts each billing cycle.

## 1. Setting Up the Cron Job in Render Dashboard

1. Go to your Render Dashboard → Your Web Service → **Cron Jobs** tab
2. Click **"Create Cron Job"**
3. **Endpoint:** `GET /api/v2/dashboard/recurring-cron`
4. **Schedule:** Use the cron expression below
5. **Add Header:** `X-Cron-Secret: <your-secret-token>`

## 2. Recommended Cron Schedule

```
0 0 1 * *
```

This runs **at midnight on the 1st day of every month**.

**Cron format breakdown:**
```
* * * * *
| | | | |
| | | | +-- Day of week (0-6, 0=Sunday)
| | | +---- Month (1-12)
| | +------ Day of month (1-31)
| +-------- Hour (0-23)
+---------- Minute (0-59)
```

**Alternative schedules:**
- `0 0 * * 1` — Every Monday (weekly billing)
- `0 0 1,15 * *` — 1st and 15th of each month (bi-monthly)
- `0 8 * * 1-5` — Every weekday at 8 AM (daily during business days)

## 3. Securing the Endpoint

The endpoint is protected by the `requireCronSecret` middleware in `api/dashboard.js` (line 236). It validates the `X-Cron-Secret` header against the `CRON_SECRET` environment variable.

### Token validation code (already implemented in `api/dashboard.js`):

```javascript
function requireCronSecret(req, res, next) {
  var headerSecret = req.get('X-Cron-Secret');
  var envSecret = process.env.CRON_SECRET;

  if (envSecret && headerSecret && headerSecret === envSecret) {
    req._cronAuthorized = true;
    return next();
  }

  // Fall through to session-based auth
  if (req.session && req.session.user && req.session.user.companyId) {
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized. Provide X-Cron-Secret header or authenticate.'
  });
}
```

### Setting the CRON_SECRET in Render:

1. Go to Render Dashboard → Your Web Service → **Environment** tab
2. Add a new environment variable:
   - **Key:** `CRON_SECRET`
   - **Value:** A randomly generated secret string (use `openssl rand -hex 32` or similar)
3. Click **Save Changes** and **Deploy**

## 4. Testing the Cron Endpoint Locally

### Prerequisites:
- Server running on `http://localhost:3000`
- `.env` file has `CRON_SECRET=your-secret-here`
- `npm run seed-test` has been run (creates test recurring clients)

### Curl Command:

```bash
curl -H "X-Cron-Secret: your-secret-here" \
  http://localhost:3000/api/v2/dashboard/recurring-cron
```

### Sample JSON Response:

```json
{
  "success": true,
  "mode": "cron",
  "companiesProcessed": 1,
  "generated": [
    {
      "companyId": "uuid-here",
      "clientId": 2,
      "name": "Test Recurring (Unpaid This Month)",
      "jobId": 15,
      "amount": 750,
      "invoiceNumber": "INV-001",
      "pdfUrl": "invoices/uuid-here/test-recurring-INV-001.pdf"
    },
    {
      "companyId": "uuid-here",
      "clientId": 3,
      "name": "Test Recurring (Never Paid)",
      "jobId": 16,
      "amount": 300,
      "invoiceNumber": "INV-002",
      "pdfUrl": null
    }
  ],
  "errors": [],
  "message": "Recurring invoices processed. 2 generated, 0 errors across 1 companies."
}
```

### Expected Behavior:

| Client Type | Payment This Month | Triggers Invoice? |
|-------------|-------------------|-------------------|
| Recurring   | Yes               | **NO** (already billed) |
| Recurring   | No (but has past payments) | **YES** |
| Recurring   | Never paid        | **YES** (first invoice) |
| One-off     | Any               | **NO** (not a recurring client) |

## 5. Seed Test Data for Cron Verification

Run the seed script to create test clients:

```bash
npm run seed-test
```

This creates:
- 1 recurring client WITH a payment this month (no invoice generated)
- 1 recurring client WITHOUT a payment this month (invoice generated)
- 1 recurring client WITH NO payments ever (invoice generated)
- 1 one-off client (no invoice generated)

## 6. Verification Checklist

- [ ] `CRON_SECRET` env var is set in Render and local `.env`
- [ ] Seed data created: `npm run seed-test`
- [ ] Curl command returns 200 with expected invoice count
- [ ] Cron job created in Render Dashboard with correct expression
- [ ] `X-Cron-Secret` header matches the environment variable exactly
- [ ] Unauthorized requests (without header or wrong secret) return 401
- [ ] Monthly schedule `0 0 1 * *` is appropriate for billing cycle

# Responsive / cross-device tests

Playwright tests for layout and core flows on every page, at seven device
sizes from a 320px phone to a 1440px desktop.

```bash
npm install                          # installs @playwright/test (dev dependency)
npx playwright install chromium      # first run only
npm run test:responsive              # all devices
npx playwright test --project=phone-390   # one device
npm run test:responsive:report       # open the HTML report from the last run
```

Playwright starts `node server.js` itself on port 3111 with `NODE_ENV=test`
(set `RESPONSIVE_TEST_PORT` to change the port). It uses the Supabase project
in `.env`, the same as `npm run test:smoke`.

## Device matrix (`playwright.config.js`)

| Project | Viewport | Touch |
|---|---|---|
| phone-small-320 | 320×568 (iPhone SE 1st gen) | yes |
| phone-390 | 390×844 (iPhone 12–15) | yes |
| phone-412 | 412×915 (Pixel 7) | yes |
| phone-landscape-844 | 844×390 | yes |
| tablet-768 | 768×1024 (iPad mini portrait) | yes |
| tablet-landscape-1024 | 1024×768 | yes |
| desktop-1440 | 1440×900 | no |

## What each test checks

| Test | Layout | Function |
|---|---|---|
| login page | no overflow; sign-in button on-screen and at least 40px | no JS errors |
| protected pages redirect | — | `/main` without a session goes to login |
| `/main`, `/finance`, `/settings` | no sideways page scroll; every nav item on-screen; theme toggle tappable | theme toggle switches and restores |
| navigation | — | Dashboard → Finance → Settings → Dashboard |
| dashboard intake/search | every intake field on-screen; search input keeps at least 60% of the row | search filters the client list |
| client panel | no sideways scroll in the panel; 1 column with labels above fields (≤768px), 2 columns above that; close button at least 44px on phones | editing marks the panel dirty; close auto-saves and returns to the list |
| job modal | modal on-screen with no sideways scroll | opens from a job card, closes |
| finance margin table | page doesn't scroll sideways; client column stays pinned while the table scrolls | row expand/collapse works |
| settings tabs | every tab reachable, page fits | each tab activates |

"Off-screen" here means an element's box lies outside the viewport and it is
not inside a scroll container. `html`/`body` use `overflow-x: hidden`, which
hides such elements instead of making the page scroll, so checking
`scrollWidth` alone would miss them.

## Safety and edge cases

- **No writes to the database.** Every non-GET `/api` request made by the page
  is intercepted and answered with a stub `{ success: true }`. Tests can still
  assert that a save was attempted (for example `POST /api/update-project` when
  the panel closes) without changing data.
- **One login per run.** `tests/global-setup.js` logs in once and shares the
  session, because the login route is rate-limited. It gives a specific error
  for each setup problem: 404 (the server isn't in test mode, usually because
  another dev server is on the port), 429 (rate-limited) or 503 (Supabase not
  configured).
- **Empty data.** Tests that need a client, a job or finance rows skip with a
  reason instead of failing when the database has none.
- Every page test also fails on uncaught JavaScript errors (`pageerror`).

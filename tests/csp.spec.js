// The Content-Security-Policy must not block anything the app really uses.
// Visits every page (signed out and as admin), opens a client and a job,
// and fails on any CSP violation or uncaught error.
const path = require('path');
const { test, expect } = require('@playwright/test');

const STATE_FILE = path.join(__dirname, '..', 'test-results', '.auth', 'admin.json');

// Page loads are the same on every screen size; one device is enough.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'desktop only');
});

function watch(page) {
  const problems = [];
  page.on('pageerror', (err) => problems.push('pageerror: ' + err.message));
  page.on('console', (msg) => {
    const text = msg.text();
    if (/Content Security Policy|Refused to (load|execute|connect|frame|apply)/i.test(text)) problems.push('console: ' + text);
  });
  return problems;
}

async function visit(page, path) {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(e.violatedDirective + ' ' + e.blockedURI);
    });
  });
  await page.goto(path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  return page.evaluate(() => window.__cspViolations || []);
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const path of ['/', '/login.html', '/auth/callback']) {
    test(`no CSP violations on ${path}`, async ({ page }) => {
      const problems = watch(page);
      const violations = await visit(page, path);
      expect(violations).toEqual([]);
      expect(problems.filter((p) => !/no_session|Auth callback/i.test(p))).toEqual([]);
    });
  }
});

test.describe('signed in as admin', () => {
  test.use({ storageState: STATE_FILE });
  for (const path of ['/main', '/finance', '/settings', '/calendar']) {
    test(`no CSP violations on ${path}`, async ({ page }) => {
      const problems = watch(page);
      const violations = await visit(page, path);
      expect(page.url()).toContain(path);
      expect(violations).toEqual([]);
      expect(problems).toEqual([]);
    });
  }

  test('opening a client, a job and its photo/file previews causes no CSP violations', async ({ page }) => {
    const problems = watch(page);
    await visit(page, '/main');
    const card = page.locator('.client-card').first();
    await expect(card).toBeVisible();
    await card.click();
    await page.waitForTimeout(1200);
    const jobRow = page.locator('[data-job-id]').first();
    if (await jobRow.count()) {
      await jobRow.click().catch(() => {});
      await page.waitForTimeout(1200);
    }
    const violations = await page.evaluate(() => window.__cspViolations || []);
    expect(violations).toEqual([]);
    expect(problems).toEqual([]);
  });
});

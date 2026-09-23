// Responsive + core-flow tests, run once per device project in
// playwright.config.js (320px phone → 1440px desktop).
//
// Each test checks two things: the layout fits the device (no sideways page
// scroll, nothing unreachable off-screen, finger-sized controls on touch
// devices) and the feature still works at that size (navigation, search,
// opening/closing a client, opening a job, finance table, settings tabs).
const { test, expect } = require('@playwright/test');
const { STATE_FILE } = require('./global-setup');

const MOBILE_MAX = 768; // matches the project's main CSS breakpoint

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collects uncaught page errors so each test can assert none happened. */
function trackPageErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function gotoAndSettle(page, path) {
  await page.goto(path, { waitUntil: 'networkidle' });
  // Renderers fetch data then paint; give entrance animations a moment.
  await page.waitForTimeout(500);
}

/**
 * Layout check. html/body use overflow-x:hidden, so scrollWidth alone would
 * miss content that is clipped off-screen. This also walks visible elements
 * and reports any that sit outside the viewport. Elements inside a
 * horizontal scroll container are skipped (that scroll is intentional).
 */
async function findLayoutProblems(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const problems = [];
    if (document.documentElement.scrollWidth > vw + 1) {
      problems.push(`page scrolls sideways: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
    }
    const insideScroller = (el) => {
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed' && el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if ((r.right > vw + 1 || r.left < -1) && !insideScroller(el)) {
        const name = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '')
          + (typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : '');
        problems.push(`${name} is off-screen [${Math.round(r.left)}..${Math.round(r.right)}] in ${vw}px viewport`);
      }
    }
    return [...new Set(problems)].slice(0, 15);
  });
}

async function expectFitsViewport(page) {
  expect(await findLayoutProblems(page)).toEqual([]);
}

async function expectInViewport(locator) {
  const box = await locator.boundingBox();
  expect(box, 'element should be rendered').not.toBeNull();
  const vw = await locator.page().evaluate(() => document.documentElement.clientWidth);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
}

/** On touch devices, controls should be at least `min` px in both directions. */
async function expectTappable(locator, min = 40) {
  const box = await locator.boundingBox();
  expect(box, 'element should be rendered').not.toBeNull();
  expect(box.width, 'tap target width').toBeGreaterThanOrEqual(min);
  expect(box.height, 'tap target height').toBeGreaterThanOrEqual(min);
}

const isMobileWidth = (page) => page.viewportSize().width <= MOBILE_MAX;

/** Opens the first client in the list, or skips if the database has none. */
async function openFirstClient(page) {
  const card = page.locator('.client-card').first();
  const count = await page.locator('.client-card').count();
  test.skip(count === 0, 'No clients in the configured database — nothing to open.');
  await card.click();
  const panel = page.locator('#projectPanel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#p-address')).toBeVisible();
  // wait for the entrance transition + async sections
  await page.waitForTimeout(800);
  return panel;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('unauthenticated', () => {
  test('login page fits the screen and the sign-in button is usable', async ({ page }) => {
    const errors = trackPageErrors(page);
    await gotoAndSettle(page, '/login.html');
    await expectFitsViewport(page);
    const btn = page.locator('#google-signin-btn');
    await expect(btn).toBeVisible();
    await expectInViewport(btn);
    await expectTappable(btn);
    expect(errors).toEqual([]);
  });

  test('protected pages redirect to login instead of rendering broken', async ({ page }) => {
    await page.goto('/main');
    await expect(page).not.toHaveURL(/\/main$/);
    await expect(page.locator('#google-signin-btn')).toBeVisible();
  });
});

/**
 * The suite runs against the Supabase project in .env, which may hold real
 * data. Every write the page attempts (POST/PUT/PATCH/DELETE to /api) is
 * intercepted and answered with a stub success, so tests can assert that the
 * app *tried* to save without changing anything. Login goes through
 * page.request, which bypasses page routes.
 */
async function blockWrites(page) {
  const writes = [];
  await page.route('**/api/**', (route) => {
    const req = route.request();
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue();
    writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  return writes;
}

test.describe('authenticated', () => {
  // Session cookie saved once by tests/global-setup.js.
  test.use({ storageState: STATE_FILE });

  let writes;
  test.beforeEach(async ({ page }) => {
    writes = await blockWrites(page);
  });

  for (const path of ['/main', '/finance', '/settings']) {
    test(`${path}: no sideways scroll and nav fully reachable`, async ({ page }) => {
      const errors = trackPageErrors(page);
      await gotoAndSettle(page, path);
      await expectFitsViewport(page);

      // Every visible nav control must be on-screen (regression: the theme
      // toggle and role badge used to be clipped on narrow phones).
      const navItems = page.locator('.top-nav .nav-links > :visible');
      const n = await navItems.count();
      expect(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) await expectInViewport(navItems.nth(i));

      const toggle = page.locator('#themeToggleBtn');
      await expectInViewport(toggle);
      if (isMobileWidth(page)) await expectTappable(toggle);

      // Theme toggle still works.
      const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      await toggle.click();
      await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
        .not.toBe(before);
      await toggle.click(); // restore
      expect(errors).toEqual([]);
    });
  }

  test('navigation links move between pages', async ({ page }) => {
    await gotoAndSettle(page, '/main');
    await page.locator('.top-nav a[href="/finance"]:visible').first().click();
    await expect(page).toHaveURL(/\/finance$/);
    await page.locator('.top-nav a[href="/settings"]:visible').first().click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.locator('.top-nav a[href="/main"]:visible').first().click();
    await expect(page).toHaveURL(/\/main$/);
  });

  test('dashboard: intake form and search are usable', async ({ page }) => {
    await gotoAndSettle(page, '/main');

    for (const id of ['#fName', '#lName', '#address', '#email', '#phone']) {
      const input = page.locator(id);
      await expect(input).toBeVisible();
      await expectInViewport(input);
    }
    await expectInViewport(page.locator('#clientIntakeForm button[type="submit"]'));

    // Regression: on phones the filter button stretched to 100% and squashed
    // the search input to ~22px.
    const search = page.locator('#searchClients');
    const bar = page.locator('.search-bar').first();
    const [sBox, bBox] = [await search.boundingBox(), await bar.boundingBox()];
    expect(sBox.width).toBeGreaterThan(bBox.width * 0.6);
    const filterBtn = page.locator('#filterToggleBtn');
    if (await filterBtn.isVisible()) {
      await expectInViewport(filterBtn);
      await expectTappable(filterBtn, 36);
    }

    // Search still filters the list.
    const first = page.locator('.client-card').first();
    if (await first.count()) {
      const name = (await first.getAttribute('data-name')) || '';
      const term = name.split(' ')[0];
      await search.fill(term);
      // Search is debounced and hits the API, so wait for the list to settle
      // instead of sleeping a fixed time.
      const cardNames = () => page.locator('.client-card').evaluateAll((els) => els.map((e) => e.dataset.name || ''));
      await expect.poll(async () => {
        const names = await cardNames();
        return names.length > 0 && names.every((nm) => nm.toLowerCase().includes(term.toLowerCase()));
      }, { timeout: 10_000 }).toBe(true);
      await search.fill('');
    }
  });

  test('client panel: fits, fields line up, and closes cleanly', async ({ page }) => {
    const errors = trackPageErrors(page);
    await gotoAndSettle(page, '/main');
    const panel = await openFirstClient(page);

    // No horizontal scrolling inside the panel card.
    const card = panel.locator('.detail-card');
    const overflow = await card.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, 'client panel content scrolls sideways').toBeLessThanOrEqual(1);

    for (const id of ['#p-address', '#p-phone', '#p-email', '#saveBtn', '#closeBtn']) {
      await expectInViewport(panel.locator(id));
    }

    const cols = await panel.locator('.details-grid').evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length
    );
    if (isMobileWidth(page)) {
      // Single column; each label sits directly above its own field.
      expect(cols).toBe(1);
      const pairs = [['Job Address', '#p-address'], ['Phone Number', '#p-phone'], ['Email Address', '#p-email']];
      for (const [label, field] of pairs) {
        const l = await panel.locator('label', { hasText: label }).first().boundingBox();
        const f = await panel.locator(field).boundingBox();
        expect(l.y + l.height, `${label} label should sit above its field`).toBeLessThanOrEqual(f.y + 1);
        expect(f.y - (l.y + l.height), `${label} label should be adjacent to its field`).toBeLessThan(40);
      }
      await expectTappable(panel.locator('#closeBtn'));
    } else {
      // Desktop/tablet-landscape keeps the original 2-column label/field layout.
      expect(cols).toBe(2);
    }

    // Editing a field marks the panel dirty.
    const phone = panel.locator('#p-phone');
    const original = await phone.inputValue();
    await phone.fill(original + '1');
    await expect(panel.locator('#saveStatus')).not.toHaveText('Saved');

    // Close auto-saves then returns to the list (on phones the sidebar is
    // hidden while the panel is open). The save is intercepted by blockWrites.
    await panel.locator('#closeBtn').click();
    await expect(panel).toBeHidden();
    expect(writes).toContain('POST /api/update-project');
    await expect(page.locator('.sidebar')).toBeVisible();
    await expectFitsViewport(page);
    expect(errors).toEqual([]);
  });

  test('job modal opens and fits the screen', async ({ page }) => {
    await gotoAndSettle(page, '/main');
    const panel = await openFirstClient(page);
    const job = panel.locator('#jobs-list > div').first();
    await page.waitForLoadState('networkidle');
    test.skip((await job.count()) === 0, 'First client has no jobs.');
    await job.click();
    const modal = page.locator('.job-modal-overlay .job-modal-card').last();
    await expect(modal).toBeVisible();
    await expectInViewport(modal);
    const overflow = await modal.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const close = modal.locator('.job-modal-close');
    await expectInViewport(close);
    await close.click();
    await expect(page.locator('.job-modal-overlay')).toHaveCount(0);
  });

  test('finance: wide table scrolls inside its box with the client column pinned', async ({ page }) => {
    const errors = trackPageErrors(page);
    await gotoAndSettle(page, '/finance');
    await expectFitsViewport(page);

    const wrap = page.locator('.mt-table-wrap').first();
    test.skip((await wrap.count()) === 0, 'Margin tracker did not render (no finance data).');
    await wrap.scrollIntoViewIfNeeded();
    const firstRowName = wrap.locator('tbody tr:not(.mt-expand-row) td:nth-child(2)').first();
    test.skip((await firstRowName.count()) === 0, 'Margin table has no rows.');

    const scrollable = await wrap.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    if (scrollable) {
      const before = await firstRowName.boundingBox();
      await wrap.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      await page.waitForTimeout(100);
      const after = await firstRowName.boundingBox();
      expect(Math.abs(after.x - before.x), 'client name column should stay pinned while scrolling').toBeLessThan(2);
      await wrap.evaluate((el) => { el.scrollLeft = 0; });
    }

    // Expand/collapse a row still works, with a finger-sized button on touch.
    const toggle = wrap.locator('.mt-row-toggle').first();
    if (isMobileWidth(page)) await expectTappable(toggle);
    await toggle.click();
    await expect(wrap.locator('.mt-expand-row')).toHaveCount(1);
    await wrap.locator('.mt-row-toggle').first().click();
    await expect(wrap.locator('.mt-expand-row')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('settings: every tab is reachable and switches content', async ({ page }) => {
    await gotoAndSettle(page, '/settings');
    await expectFitsViewport(page);
    const tabs = page.locator('.tab-btn:visible');
    const n = await tabs.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const tab = tabs.nth(i);
      await tab.scrollIntoViewIfNeeded(); // tab bar scrolls sideways on phones
      await tab.click();
      await expect(tab).toHaveClass(/active/);
      await expectInViewport(tab);
    }
    await tabs.first().click();
    await expectFitsViewport(page);
  });
});

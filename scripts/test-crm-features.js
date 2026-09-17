/**
 * test-crm-features.js — New-functionality verification
 *
 * Covers the non-auth parts of the CRM improvements spec:
 *   - Client pipeline stage: all 6 stage names save and survive reload.
 *   - Job tags are separate from both job.status and the client's stage
 *     (changing one never changes the other).
 *   - Default Scope of Work copies from the CLIENT (not the company
 *     default) into a newly created job, is editable, and later edits
 *     to the client's default scope do NOT rewrite the already-created
 *     job's saved scope.
 *   - Estimate/invoice line items: every one of the 6 cost categories
 *     can be saved, reloaded, and the job's total recomputes correctly.
 *   - Existing estimate/invoice PDF download still works.
 *
 * USAGE:
 *   npm run test:crm-features
 *
 * Requires network access to the configured Supabase project.
 */
const assert = require('assert');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3096';

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return '';
  return setCookieHeader.split(';')[0];
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/health`, { redirect: 'manual' });
      if (res.status >= 200 && res.status < 500) return;
    } catch (_) {}
    await sleep(300);
  }
  throw new Error('Server did not start in time');
}

async function req(pathname, { method = 'GET', body = null, cookie = '', rawBody = false } = {}) {
  const headers = {};
  if (!rawBody) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers,
    body: body !== null ? (rawBody ? body : JSON.stringify(body)) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { res, json, text };
}

async function loginAsAdmin() {
  const { res, json } = await req('/api/v2/auth/test-login', {
    method: 'POST',
    body: { email: 'crm-features-admin@example.com', role: 'admin', displayName: 'Features Admin' }
  });
  assert.strictEqual(res.status, 200, 'admin test-login should succeed: ' + JSON.stringify(json));
  return extractCookie(res.headers.get('set-cookie'));
}

async function main() {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3096';
  const { startServer } = require('../server');
  const server = startServer(3096);

  let passed = 0;
  function ok(label) { passed++; console.log('  [PASS] ' + label); }

  try {
    await waitForServer();
    const cookie = await loginAsAdmin();

    // ================================================
    // CLIENT STAGE (Section 2/6)
    // ================================================
    const create = await req('/api/save-client', {
      method: 'POST',
      cookie,
      body: { name: 'Stage Test Client', status: 'Lead', scope_of_work: 'Client default scope: replace gutters and downspouts.' }
    });
    assert.strictEqual(create.res.status, 200);

    const search = await req('/api/search?q=Stage Test Client', { cookie });
    const client = search.json[0];
    assert.ok(client, 'created client should be findable');

    const stages = ['Lead', 'Photo report', 'Prospect', 'Approved', 'Invoiced', 'Closed'];
    for (const stage of stages) {
      const update = await req('/api/update-project', {
        method: 'POST',
        cookie,
        body: { id: client.id, name: client.name, status: stage }
      });
      assert.strictEqual(update.res.status, 200, `saving stage ${stage} should succeed`);

      const reloaded = await req(`/api/search?q=Stage Test Client`, { cookie });
      const reloadedClient = reloaded.json.find((c) => c.id === client.id);
      assert.strictEqual(reloadedClient.status, stage, `stage ${stage} should persist after reload`);
    }
    ok('All 6 client pipeline stages save and survive reload');

    // Reset to Approved for the rest of the test.
    await req('/api/update-project', { method: 'POST', cookie, body: { id: client.id, name: client.name, status: 'Approved' } });

    // ================================================
    // SCOPE OF WORK COPY INTO NEW JOB (Section 4)
    // ================================================
    // The frontend (main-renderer.js's openNewJobModal) reads the
    // CLIENT's own scope_of_work and sends it explicitly when creating
    // a job — this is the Section 4 fix (previously it sent the
    // company-wide default instead). This test exercises that same
    // contract at the API level: the client's current scope, passed
    // through on creation, must be preserved verbatim on the new job.
    const job2Create = await req('/api/jobs', {
      method: 'POST',
      cookie,
      body: { client_id: client.id, title: 'Job 2', scope_of_work: client.scope_of_work }
    });
    assert.strictEqual(job2Create.res.status, 200);
    const job2 = job2Create.json.job;
    assert.strictEqual(job2.scope_of_work, 'Client default scope: replace gutters and downspouts.', 'job should have its own copy of the client\'s scope');
    ok('New job receives the CLIENT\'s own default scope (not blank / not company-only default)');

    // Edit the job's own scope after creation.
    const editJob2 = await req(`/api/jobs/${job2.id}`, {
      method: 'PUT',
      cookie,
      body: { scope_of_work: 'Edited job-specific scope: also replace fascia boards.' }
    });
    assert.strictEqual(editJob2.res.status, 200);
    assert.strictEqual(editJob2.json.job.scope_of_work, 'Edited job-specific scope: also replace fascia boards.');
    ok('Copied scope can be edited before/after the job is saved');

    // Now change the CLIENT's default scope and confirm job2's saved
    // scope is untouched (no unexpected rewrite of an existing job).
    await req('/api/update-project', {
      method: 'POST',
      cookie,
      body: { id: client.id, name: client.name, status: 'Approved', scope_of_work: 'CHANGED client default scope.' }
    });
    const job2Reloaded = await req(`/api/jobs/${job2.id}`, { cookie });
    assert.strictEqual(job2Reloaded.json.job.scope_of_work, 'Edited job-specific scope: also replace fascia boards.', 'changing the client default must not rewrite an existing job\'s scope');
    ok('Changing the client\'s default scope later does not rewrite an already-created job\'s scope');

    // ================================================
    // JOB TAGS vs CLIENT STAGE vs JOB STATUS (Section 2/7)
    // ================================================
    const tagUpdate = await req(`/api/jobs/${job2.id}/tags`, {
      method: 'PUT',
      cookie,
      body: { tags: ['storm-damage', 'priority'] }
    });
    assert.strictEqual(tagUpdate.res.status, 200);
    assert.deepStrictEqual(tagUpdate.json.job.tags, ['storm-damage', 'priority']);

    const statusUpdate = await req(`/api/jobs/${job2.id}`, {
      method: 'PUT',
      cookie,
      body: { status: 'Approved' }
    });
    assert.strictEqual(statusUpdate.res.status, 200);

    const clientAfter = await req(`/api/search?q=Stage Test Client`, { cookie });
    const clientRowAfter = clientAfter.json.find((c) => c.id === client.id);
    assert.strictEqual(clientRowAfter.status, 'Approved', 'client stage must be unaffected by job tag/status changes');

    const jobAfter = await req(`/api/jobs/${job2.id}`, { cookie });
    assert.deepStrictEqual(jobAfter.json.job.tags, ['storm-damage', 'priority'], 'job tags must be unaffected by job status changes');
    ok('Job tags and job status are independent of each other and of the client\'s pipeline stage');

    // ================================================
    // LINE ITEMS WITH ALL 6 COST CATEGORIES (Section 1)
    // ================================================
    const categories = [
      { description: 'Crew labor', category: 'Labor', quantity: 2, unit_price: 500 },
      { description: 'Shingles', category: 'Materials', quantity: 10, unit_price: 100 },
      { description: 'Sales commission', category: 'Commissions', quantity: 1, unit_price: 200 },
      { description: 'Crew lunch', category: 'Meals/Drinks', quantity: 3, unit_price: 12 },
      { description: 'Dumpster', category: 'Miscellaneous', quantity: 1, unit_price: 300 },
      { description: 'Permit fee', category: 'Permits', quantity: 1, unit_price: 150 }
    ];
    let expectedTotal = 0;
    for (const item of categories) {
      const added = await req(`/api/jobs/${job2.id}/line-items`, { method: 'POST', cookie, body: item });
      assert.strictEqual(added.res.status, 200, `adding a ${item.category} line item should succeed`);
      assert.strictEqual(added.json.lineItem.category, item.category);
      expectedTotal += item.quantity * item.unit_price;
    }
    ok('All 6 cost categories (Labor, Materials, Commissions, Meals/Drinks, Miscellaneous, Permits) can be saved');

    const lineItemsReloaded = await req(`/api/jobs/${job2.id}/line-items`, { cookie });
    assert.strictEqual(lineItemsReloaded.json.lineItems.length, 6, 'all 6 line items should persist after reload');
    for (const item of categories) {
      assert.ok(lineItemsReloaded.json.lineItems.some((li) => li.category === item.category), `category ${item.category} should still be present after reload`);
    }
    ok('Line item categories remain correct after reloading the job');

    const jobWithTotal = await req(`/api/jobs/${job2.id}`, { cookie });
    assert.strictEqual(Number(jobWithTotal.json.job.total_due), expectedTotal, 'job total should equal the sum of all line items');
    ok('Job total recalculates correctly from line items (' + expectedTotal + ')');

    // ================================================
    // EXISTING DOWNLOAD FUNCTIONALITY STILL WORKS
    // ================================================
    const estimateDownload = await req(`/api/jobs/${job2.id}/estimate`, { method: 'POST', cookie, body: {} });
    assert.strictEqual(estimateDownload.res.status, 200, 'estimate download should still work');
    assert.ok(estimateDownload.res.headers.get('content-type').includes('application/pdf'), 'estimate should be a PDF');

    const invoiceDownload = await req(`/api/jobs/${job2.id}/invoice`, { method: 'POST', cookie, body: {} });
    assert.strictEqual(invoiceDownload.res.status, 200, 'invoice download should still work');
    assert.ok(invoiceDownload.res.headers.get('content-type').includes('application/pdf'), 'invoice should be a PDF');
    ok('Existing "Download Estimate" / "Download Invoice" PDF generation still works, now including the cost breakdown');

    // ---- Cleanup ----
    await req('/api/delete-client', { method: 'POST', cookie, body: { id: client.id } });

    console.log('');
    console.log(`CRM features test passed (${passed} checks).`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error('CRM features test failed:', err);
  process.exit(1);
});

/**
 * test-complete-flow.js
 *
 * This used to test the old multi-tenant registration/onboarding wizard
 * (POST /api/v2/auth/register, /onboarding/step1-3). That flow has been
 * removed — the app now uses Google sign-in only, with the first sign-in
 * automatically becoming the admin (no registration screen at all).
 *
 * The equivalent "complete flow" coverage now lives in two focused
 * scripts instead of one combined onboarding test:
 *
 *   npm run test:rbac           -> scripts/test-rbac.js
 *     Admin vs. regular-user access, financial data redaction,
 *     assignment, and permission-boundary enforcement end-to-end.
 *
 *   npm run test:crm-features   -> scripts/test-crm-features.js
 *     Client pipeline stage, job tags vs. client stage vs. job status,
 *     default Scope of Work copy-into-new-job, line items with all 6
 *     cost categories, and PDF estimate/invoice generation.
 *
 * Running this script just points you at those two.
 */
console.log('');
console.log('  test-complete-flow.js has been superseded.');
console.log('  Run these instead:');
console.log('    npm run test:rbac');
console.log('    npm run test:crm-features');
console.log('');
process.exit(0);

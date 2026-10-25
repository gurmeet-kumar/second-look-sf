import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { store, reset, newScout, listing } from './test-store-lifecycle.mjs';

import { appDir, bundleDir, require, build } from './support/paths.mjs';
const calls = { searches: [], resultsByQuery: new Map(), results: [] };
globalThis.__secondLookResaleProviderMock = calls;
const providerCode = `
const calls=globalThis.__secondLookResaleProviderMock;
export class ProviderError extends Error {}
export async function searchItems(scout,paid,query){calls.searches.push({scoutId:scout.id,paid,query});return calls.resultsByQuery.get(query)??calls.results;}
export async function itemDetails(){throw new Error('Resale reference must not fetch details.');}
export async function screenItem(){throw new Error('Resale reference must not call AI screening.');}
export async function sendFindEmail(){throw new Error('Resale reference must not send an alert.');}
`;
const bundle = await build({
  entryPoints: [path.join(appDir, 'lib/engine.ts')], absWorkingDir: appDir,
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
  plugins: [{ name: 'resale-mock-runtime', setup(builder) {
    builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'runtime', namespace: 'mock' }));
    builder.onResolve({ filter: /^\.\/providers$/ }, args => args.importer.endsWith('engine.ts') ? { path: 'providers', namespace: 'mock' } : null);
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'runtime' ? 'export const env=globalThis.__secondLookTestEnv;' : providerCode, loader: 'js' }));
  } }],
});
const bundlePath = path.join(bundleDir, 'resale-integration.bundle.cjs');
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const engine = require(bundlePath);
const dateAgo = days => new Date(Date.now() - days * 86_400_000).toISOString();
const candidate = (id, title = 'Leather executive office chair', price = 80, patch = {}) => ({
  id, title, description: 'Used chair in good working condition.',
  url: `https://www.facebook.com/marketplace/item/${id}/`,
  price: { amount: price }, location: { city: 'San Francisco' },
  creation_time: dateAgo(2), is_live: true, ...patch,
});
const genericChair = { title: 'Free executive office chair', description: 'Used black leather executive office chair. In good working condition.', brand: null, model: null };
const checks = [];
async function check(name, fn) {
  reset(); calls.searches = []; calls.results = []; calls.resultsByQuery = new Map();
  await fn(); checks.push(name); console.log(`PASS ${name}`);
}
async function setup(patch = genericChair) {
  const scout = await store.createScout({ ...newScout(), query: 'gaming chair', maxWidthIn: null });
  const item = { ...listing(scout.id, 'target'), sourceCreatedAt: dateAgo(.1), ...patch };
  await store.upsertMatch(scout.id, item.id, item);
  return { scout, item };
}
function verifyLimit() {
  assert.ok(calls.searches.length <= 2, 'one reference never makes more than two paid searches');
  for (const call of calls.searches) assert.equal(call.paid, true, 'comparisons request paid listings');
}

await check('generic chair uses actual subtype and returns three local recent asking-price examples', async () => {
  const { scout, item } = await setup();
  calls.results = [candidate('chair-1', undefined, 40), candidate('chair-2', 'Executive office chair', 80), candidate('chair-3', 'Black leather office chair', 120)];
  const reference = await engine.resale(scout.id, item.id);
  assert.equal(reference.status, 'ready'); assert.equal(reference.version, 2);
  assert.equal(reference.basis, 'similar_items'); assert.equal(reference.confidence, 'low');
  assert.equal(reference.query, 'executive office chair');
  assert.equal(reference.geography, 'San Francisco');
  assert.equal(reference.count, 3); assert.equal(reference.low, 40); assert.equal(reference.high, 120);
  assert.deepEqual(new Set(reference.comps.map(comp => comp.id)), new Set(['chair-1', 'chair-2', 'chair-3']));
  assert.match(reference.note, /asking/i);
  assert.equal((await store.getMatch(scout.id, item.id)).resale.version, 2);
  verifyLimit(); assert.equal(calls.searches.length, 1);
});

await check('one or two comparable listings stay inspectable without inventing a range', async () => {
  for (const count of [1, 2]) {
    const { scout, item } = await setup({ ...genericChair, id: `partial-${count}` });
    calls.results = Array.from({ length: count }, (_, index) => candidate(`partial-${count}-${index}`, undefined, 50 + index * 25));
    calls.searches = [];
    const reference = await engine.resale(scout.id, item.id);
    assert.equal(reference.status, 'insufficient'); assert.equal(reference.count, count);
    assert.equal(reference.low, null); assert.equal(reference.high, null);
    assert.equal(reference.comps.length, count);
    for (const comp of reference.comps) assert.match(comp.url, /^https:\/\/www\.facebook\.com\/marketplace\/item\//);
    verifyLimit();
  }
});

await check('unsupported generic item does not spend a paid query', async () => {
  const { scout, item } = await setup({ title: 'Free miscellaneous household items', description: 'Various things, take what you want.', brand: null, model: null });
  const reference = await engine.resale(scout.id, item.id);
  assert.equal(reference.status, 'insufficient'); assert.equal(reference.count, 0);
  assert.equal(reference.low, null); assert.equal(reference.high, null);
  assert.deepEqual(reference.comps, []); assert.equal(calls.searches.length, 0);
});

await check('exact model numeric tokens distinguish ErgoChair 2 from ErgoChair 20', async () => {
  const { scout, item } = await setup({ title: 'Autonomous ErgoChair 2 office chair', description: 'Black ergonomic office chair.', brand: 'Autonomous', model: 'ErgoChair 2' });
  calls.results = [
    candidate('exact-1', 'Autonomous ErgoChair 2 ergonomic office chair', 150),
    candidate('exact-2', 'Autonomous ErgoChair 2', 175),
    candidate('exact-3', 'Autonomous ErgoChair 2 office chair', 200),
    candidate('wrong-number', 'Autonomous ErgoChair 20 office chair', 220),
  ];
  const reference = await engine.resale(scout.id, item.id);
  assert.equal(reference.status, 'ready'); assert.equal(reference.basis, 'exact_model');
  assert.equal(reference.confidence, 'model_match'); assert.equal(reference.count, 3);
  assert.equal(reference.comps.some(comp => comp.id === 'wrong-number'), false);
  assert.equal(reference.query, 'Autonomous ErgoChair 2');
  verifyLimit(); assert.equal(calls.searches.length, 1);
});

await check('exact search may fall back once to similar items but never loops', async () => {
  const { scout, item } = await setup({ ...genericChair, brand: 'UnknownCo', model: 'Executive 123' });
  calls.resultsByQuery.set('UnknownCo Executive 123', []);
  calls.resultsByQuery.set('executive office chair', [candidate('fallback-1', undefined, 40), candidate('fallback-2', undefined, 60), candidate('fallback-3', undefined, 90)]);
  const reference = await engine.resale(scout.id, item.id);
  assert.equal(reference.status, 'ready'); assert.equal(reference.basis, 'similar_items');
  assert.equal(reference.confidence, 'low'); assert.equal(reference.count, 3);
  assert.deepEqual(calls.searches.map(call => call.query), ['UnknownCo Executive 123', 'executive office chair']);
  verifyLimit();
});

await check('old, undated, placeholder, parts, fault, bundle, remote and unavailable results are excluded', async () => {
  const { scout, item } = await setup();
  calls.results = [
    candidate('valid-1', undefined, 40), candidate('valid-2', 'Executive office chair', 80), candidate('valid-3', 'Leather office chair', 120),
    candidate('old', undefined, 80, { creation_time: dateAgo(31) }),
    candidate('undated', undefined, 80, { creation_time: null }),
    candidate('placeholder-1', undefined, 1), candidate('placeholder-0', undefined, 0),
    candidate('parts', 'Executive office chair parts only', 50),
    candidate('broken', 'Executive office chair broken cylinder', 50),
    candidate('bundle', 'Set of 4 executive office chairs bundle', 200),
    candidate('new-box', 'Executive office chair new in box', 150),
    candidate('remote', undefined, 50, { location: { city: 'Oakland' } }),
    candidate('false-local', undefined, 50, { location: { city: 'South San Francisco' } }),
    candidate('sold', undefined, 50, { is_sold: true }),
    candidate('pending', undefined, 50, { is_pending: true }),
    candidate('hidden', undefined, 50, { is_hidden: true }),
    candidate('not-live', undefined, 50, { is_live: false }),
    candidate('wrong-type', 'Executive desk', 150),
    candidate('target', undefined, 50), candidate('valid-1', undefined, 40),
  ];
  const reference = await engine.resale(scout.id, item.id);
  assert.equal(reference.status, 'ready'); assert.equal(reference.count, 3);
  assert.deepEqual(reference.comps.map(comp => comp.id).sort(), ['valid-1', 'valid-2', 'valid-3']);
  verifyLimit();
});

await check('ready v2 cache lasts 24 hours and force refresh bypasses it', async () => {
  const { scout, item } = await setup();
  calls.results = [candidate('cache-1', undefined, 40), candidate('cache-2', undefined, 80), candidate('cache-3', undefined, 120)];
  const first = await engine.resale(scout.id, item.id);
  const firstCalls = calls.searches.length;
  await store.upsertMatch(scout.id, item.id, { resale: { ...first, queriedAt: new Date(Date.now() - 23 * 3_600_000).toISOString() } });
  const cached = await engine.resale(scout.id, item.id);
  assert.equal(calls.searches.length, firstCalls); assert.equal(cached.count, 3);
  calls.searches = [];
  await engine.resale(scout.id, item.id, { forceRefresh: true }); verifyLimit(); assert.ok(calls.searches.length > 0);
  const refreshed = (await store.getMatch(scout.id, item.id)).resale;
  await store.upsertMatch(scout.id, item.id, { resale: { ...refreshed, queriedAt: new Date(Date.now() - 25 * 3_600_000).toISOString() } });
  calls.searches = []; await engine.resale(scout.id, item.id);
  verifyLimit(); assert.ok(calls.searches.length > 0, 'expired ready result is queried again');
});

await check('insufficient v2 cache lasts only two minutes and old schema cache is ignored', async () => {
  const { scout, item } = await setup();
  calls.results = [candidate('short-cache', undefined, 70)];
  const first = await engine.resale(scout.id, item.id);
  const firstCalls = calls.searches.length;
  await store.upsertMatch(scout.id, item.id, { resale: { ...first, queriedAt: new Date(Date.now() - 60_000).toISOString() } });
  await engine.resale(scout.id, item.id); assert.equal(calls.searches.length, firstCalls);
  await store.upsertMatch(scout.id, item.id, { resale: { ...first, queriedAt: new Date(Date.now() - 180_000).toISOString() } });
  calls.searches = []; await engine.resale(scout.id, item.id);
  verifyLimit(); assert.ok(calls.searches.length > 0, 'insufficient result refreshes after two minutes');
  const old = { ...first, queriedAt: new Date().toISOString() }; delete old.version;
  await store.upsertMatch(scout.id, item.id, { resale: old });
  calls.searches = []; const upgraded = await engine.resale(scout.id, item.id);
  verifyLimit(); assert.ok(calls.searches.length > 0, 'pre-fix insufficient cache cannot block new comparisons'); assert.equal(upgraded.version, 2);
});

console.log(`All ${checks.length} resale integration checks passed with actual engine/store. No network, email or AI calls.`);

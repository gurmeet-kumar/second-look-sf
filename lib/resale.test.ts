import assert from 'node:assert/strict';
import { comparableListings, resalePlans, resaleReference, usableResaleCache } from './resale';
import type { Listing, RawItem } from './types';

const now = Date.parse('2026-10-24T23:30:00Z');
const target = {
  id: 'target', title: 'Office chair', description: 'An executive office chair in taupe faux leather. Used, in good working condition.', brand: null, model: null,
} as Listing;
const raw = (id: string, title: string, price = 50, patch: Partial<RawItem> = {}): RawItem => ({ id, title, url: '', price: { amount: price }, creation_time: '2026-10-20T12:00:00Z', location: { city: 'San Francisco' }, ...patch });
const plan = resalePlans(target)[0];
assert.equal(plan.query, 'executive office chair');
assert.equal(plan.basis, 'similar_items');

// Synthetic comparison fixtures preserve realistic titles, prices and date boundaries.
const actualSearch = [
  raw('synthetic-chair-a', 'Furmax Office Executive Chair, High Back, Adjustable', 55, { creation_time: '2026-10-15T04:58:32.000Z' }),
  raw('synthetic-chair-b', 'Black Executive High Back Office Desk Chair', 40, { creation_time: '2026-10-17T21:54:01.000Z' }),
  raw('synthetic-chair-c', 'Lowell executive chair, bonded leather', 100, { creation_time: '2026-09-25T18:53:56.000Z' }),
  raw('synthetic-chair-old', 'Burgundy Faux Leather Tufted Wingback Executive Chair', 40, { creation_time: '2026-08-29T06:11:01.000Z' }),
  raw('outside', 'Serta Smart Layers Hensley Executive Big & Tall Office Chair BLACK', 60, { location: { city: 'Half Moon Bay' } }),
];
const actual = comparableListings(target, actualSearch, plan, now);
assert.deepEqual(actual.map(comp => comp.price), [55, 40, 100]);
const ready = resaleReference(plan, actual, now);
assert.equal(ready.status, 'ready'); assert.equal(ready.low, 40); assert.equal(ready.high, 100);
assert.equal(ready.confidence, 'low'); assert.match(ready.note, /not a valuation of this item/);
assert.ok(actual.every(comp => comp.city === 'San Francisco' && comp.postedAt && comp.matchNote));

const rejected = [
  raw('target', 'Executive office chair'), raw('placeholder', 'Executive office chair', 1),
  raw('free', 'Executive office chair', 0), raw('no-price', 'Executive office chair', 10, { price: undefined }),
  raw('nan', 'Executive office chair', Number.NaN), raw('south-sf', 'Executive office chair', 50, { location: { city: 'South San Francisco' } }),
  raw('unknown-date', 'Executive office chair', 50, { creation_time: undefined, listing_date_text: 'Listed 1 week ago' }),
  raw('old', 'Executive office chair', 50, { creation_time: '2026-09-01T12:00:00Z' }),
  raw('sold', 'Executive office chair', 50, { is_sold: true }), raw('pending', 'Executive office chair', 50, { is_pending: true }),
  raw('hidden', 'Executive office chair', 50, { is_hidden: true }), raw('not-live', 'Executive office chair', 50, { is_live: false }),
  raw('parts', 'Executive chair parts only'), raw('fault', 'Broken executive office chair'), raw('bundle', 'Bundle of executive office chairs'),
  raw('new', 'Executive office chair new in box'), raw('gaming', 'Leather executive gaming chair'), raw('dining', 'Leather dining chair'),
  raw('stool', 'Executive leather chair stool'), raw('cover', 'Executive chair cover'),
];
assert.equal(comparableListings(target, rejected, plan, now).length, 0);
assert.equal(comparableListings(target, [actualSearch[0], actualSearch[0]], plan, now).length, 1);
const ergonomic = { ...target, title: 'Used ergonomic office chair', description: 'Ergonomic mesh office chair.' };
const ergonomicPlan = resalePlans(ergonomic)[0];
assert.deepEqual(comparableListings(ergonomic, [
  raw('wheels', 'Ergonomic office chair wheels'), raw('armrest', 'Mesh office chair armrest'),
  raw('headrest', 'Ergonomic office chair headrest'), raw('cylinder', 'Ergonomic office chair cylinder'),
  raw('new-leading', 'New ergonomic office chair'),
  raw('whole-with-headrest', 'Ergonomic office chair with adjustable headrest'),
  raw('whole-with-wheels', 'Mesh office chair with wheels'),
], ergonomicPlan, now).map(comp => comp.id), ['whole-with-headrest', 'whole-with-wheels']);
const partial = resaleReference(plan, actual.slice(0, 2), now);
assert.equal(partial.count, 2); assert.equal(partial.comps.length, 2); assert.equal(partial.status, 'insufficient');
assert.equal(partial.low, null); assert.equal(partial.high, null);

const exactTarget = { ...target, title: 'Autonomous ErgoChair 2', brand: 'Autonomous', model: 'ErgoChair 2' };
const exactPlan = resalePlans(exactTarget)[0];
assert.equal(exactPlan.basis, 'exact_model');
assert.deepEqual(comparableListings(exactTarget, [raw('two', 'Autonomous ErgoChair 2'), raw('twenty', 'Autonomous ErgoChair 20'), raw('brand-substring', 'NotAutonomous ErgoChair 2'), raw('model-substring', 'Autonomous MegaErgoChair 2')], exactPlan, now).map(comp => comp.id), ['two']);

const riser = { ...target, title: 'FREE Desk with detachable riser for standing desk', description: 'Desk and a separate manual riser. In working condition.' };
const riserPlan = resalePlans(riser)[0]; assert.equal(riserPlan.query, 'desk with riser');
assert.equal(resalePlans({ ...riser, description: 'Office desk with detachable manual riser. Executive office chair is not included.' })[0].query, 'desk with riser');
assert.equal(resalePlans({ ...target, title: 'Office desk', description: 'Used desk. Executive leather office chair is not included.' })[0].query, 'office desk');
assert.deepEqual(comparableListings(riser, [raw('compatible', 'Office desk with detachable riser'), raw('electric', 'Electric standing desk with riser'), raw('only', 'Desk riser only'), raw('different', 'Electric standing desk')], riserPlan, now).map(comp => comp.id), ['compatible']);
const electricDesk = { ...target, title: 'Electric standing desk', description: 'Used motorized adjustable desk.' };
const electricPlan = resalePlans(electricDesk)[0];
assert.deepEqual(comparableListings(electricDesk, [raw('electric-whole', 'Electric standing desk'), raw('manual-not-electric', 'Manual standing desk, not electric'), raw('manual-electric', 'Manual electric standing desk'), raw('non-electric', 'Non-electric standing desk'), raw('electric-legs', 'Electric standing desk legs')], electricPlan, now).map(comp => comp.id), ['electric-whole']);
const monitor = { ...target, title: 'Free 27 inch monitor', description: 'Used computer monitor.' };
const monitorPlan = resalePlans(monitor)[0]; assert.equal(monitorPlan.query, '27 inch monitor');
assert.deepEqual(comparableListings(monitor, [raw('27', 'Dell 27 inch computer monitor'), raw('24', 'Dell 24 inch computer monitor'), raw('stand', '27 inch monitor stand only'), raw('tv', '27 inch television monitor')], monitorPlan, now).map(comp => comp.id), ['27']);
assert.equal(resalePlans({ ...target, title: 'Miscellaneous household items', description: 'Things available.' }).length, 0);
assert.equal(resalePlans({ ...target, title: 'Office chairs and dining table', description: 'Leather executive chair and table bundle.' }).length, 0);

assert.ok(usableResaleCache(ready, now + 3_600_000));
assert.equal(usableResaleCache({ ...ready, version: undefined }, now), false);
assert.equal(usableResaleCache(ready, now + 86_400_001), false);
assert.ok(usableResaleCache(partial, now + 119_999));
assert.equal(usableResaleCache(partial, now + 120_000), false);
assert.equal(usableResaleCache({ ...ready, comps: [{ ...actual[0], postedAt: '2026-09-24T23:29:59Z' }] }, now), false);
console.log('Resale matcher checks passed: representative SF examples, model-digit boundaries, conservative similar categories, source age, placeholders, partial evidence and cache policy.');

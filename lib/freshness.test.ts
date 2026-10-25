import assert from 'node:assert/strict';
import { applyFreshness, sourcePostedAt } from './freshness';
import type { Listing } from './types';

const now = Date.parse('2026-10-24T22:00:00Z');
const hour = 60 * 60 * 1000;
const listing: Listing = {
  id: 'chair', scoutId: 'scout', title: 'Free gaming chair', url: 'https://www.facebook.com/marketplace/item/chair/', description: 'Works well.',
  price: 0, city: 'San Francisco', photo: null, photos: [], firstSeenAt: new Date(now).toISOString(), sourceCreatedAt: new Date(now - hour).toISOString(),
  decision: 'strong_fit', reasons: ['The chair matches your search.'], unknowns: [], questions: [], evidence: [],
  dimensions: { widthIn: null, depthIn: null, heightIn: null }, brand: null, model: null, conditionNote: null, visualNote: null,
  visualStatus: 'not_requested', distanceMiles: 1, userState: 'new', resale: null,
};
const source = (date: string | null, extra = {}) => ({ ...listing, sourceCreatedAt: date, ...extra });
const freshness = (value: Listing) => (value as Listing & { freshness?: { status: string; ageHours: number | null; maxAgeHours: number } }).freshness;

// Parsing must not silently interpret a local time, relative phrase, invalid date, or future date as posting evidence.
assert.equal(sourcePostedAt('2026-10-24T15:00:00-07:00', now), '2026-10-24T22:00:00.000Z');
assert.equal(sourcePostedAt('2026-10-24T15:00-0700', now), '2026-10-24T22:00:00.000Z');
assert.equal(sourcePostedAt(now / 1000, now), '2026-10-24T22:00:00.000Z');
assert.equal(sourcePostedAt(String(now / 1000), now), '2026-10-24T22:00:00.000Z');
assert.equal(sourcePostedAt(now, now), '2026-10-24T22:00:00.000Z');
assert.equal(sourcePostedAt(String(now), now), '2026-10-24T22:00:00.000Z');
for (const invalid of [null, undefined, '', '2026-10-24', '2026-10-24T22:00:00', 'Listed 6 days ago', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', '2026-10-24T24:00:00Z', Infinity, now + 301_000]) assert.equal(sourcePostedAt(invalid, now), null);
assert.equal(sourcePostedAt(now + 300_000, now), new Date(now + 300_000).toISOString());

// Discovering an old listing today must not make it recent; crossing the exact cutoff changes eligibility.
assert.equal(applyFreshness(listing, 24, now).decision, 'strong_fit');
assert.equal(freshness(applyFreshness(listing, 24, now))?.status, 'recent');
const boundary = source(new Date(now - 24 * hour).toISOString());
assert.equal(applyFreshness(boundary, 24, now).decision, 'strong_fit');
assert.equal(applyFreshness(boundary, 24, now + 1).decision, 'rejected');
const old = source('2026-03-23T06:46:55.000Z');
const rejected = applyFreshness(old, 24, now);
assert.equal(rejected.decision, 'rejected');
assert.equal(freshness(rejected)?.status, 'older');
assert.match(rejected.reasons[0], /outside your last 24 hours window/);
assert.match(rejected.reasons[0], /Age does not confirm availability/);

// An age overlay is reversible as preferences change, and cannot erase a genuine item failure.
const sixDays = source(new Date(now - 6 * 24 * hour).toISOString());
const narrow = applyFreshness(sixDays, 24, now);
assert.equal(narrow.decision, 'rejected');
assert.equal(applyFreshness(narrow, 168, now).decision, 'strong_fit');
assert.equal(applyFreshness(narrow, 168, now).reasons.some(reason => reason.includes('outside your last')), false);
assert.equal(applyFreshness(applyFreshness(sixDays, 168, now), 24, now).decision, 'rejected');
assert.deepEqual(applyFreshness(rejected, 24, now), rejected);
const broken = source('2026-03-23T06:46:55Z', { decision: 'rejected' as const, reasons: ['The chair gas cylinder collapses; working condition is required.'] });
assert.equal(applyFreshness(broken, 24, now).reasons[0], broken.reasons[0]);
assert.equal(applyFreshness(applyFreshness(broken, 24, now), 720, now).decision, 'rejected');

// Missing/coarse dates can prove old, but never prove fresh. Unknown age cannot become Strong fit.
const unknown = applyFreshness(source(null), 24, now);
assert.equal(unknown.decision, 'needs_checking');
assert.equal(freshness(unknown)?.status, 'unknown');
assert.match(unknown.unknowns.join(' '), /recency cannot be confirmed/);
assert.equal(applyFreshness(unknown, 24, now).unknowns.length, 1);
assert.equal(applyFreshness(unknown, 24, now).questions.length, 1);
assert.equal(applyFreshness(source(null, { decision: 'pending' as const }), 24, now).decision, 'pending');
assert.equal(applyFreshness(source(null, { decision: 'rejected' as const, reasons: ['Not free.'] }), 24, now).decision, 'rejected');
for (const text of ['Listed 7 months ago', 'Listed 6 days ago', 'Listed 1 week ago in San Francisco']) {
  const result = applyFreshness(source(null, { sourceDateText: text }), 24, now);
  assert.equal(result.decision, 'rejected');
  assert.equal(result.sourceCreatedAt, null);
  assert.equal(freshness(result)?.ageHours, null);
}
assert.equal(applyFreshness(source(null, { sourceDateText: 'Listed 3 hours ago' }), 24, now).decision, 'needs_checking');
assert.equal(applyFreshness(source(null, { sourceDateText: 'Listed today' }), 24, now).decision, 'needs_checking');
const staleRelative = source(null, { sourceDateText: 'Listed 3 hours ago', sourceDateObservedAt: new Date(now - 48 * hour).toISOString() });
assert.equal(applyFreshness(staleRelative, 24, now).decision, 'rejected');
assert.equal(freshness(applyFreshness(listing, -1, now))?.maxAgeHours, 24);
assert.equal(freshness(applyFreshness(source(new Date(now - 29 * 24 * hour).toISOString()), 720, now))?.status, 'recent');
assert.equal(listing.decision, 'strong_fit');
assert.deepEqual(listing.reasons, ['The chair matches your search.']);
assert.equal(listing.unknowns.length, 0);
console.log('Freshness checks passed: explicit dates, epochs, future/invalid rejection, exact cutoffs, reversible overlays, source-text lower bounds, unknowns, and preserved screening failures.');

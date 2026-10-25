import assert from 'node:assert/strict';
import { evaluate, parseScreeningFacts, type ScreeningFacts } from './screening';
import type { RawItem, Scout } from './types';

const scout: Scout = {
  id: 's1', query: 'standing desk', neighborhood: 'Mission District', radiusMiles: 5,
  maxWidthIn: 48, maxDepthIn: null, maxHeightIn: null, condition: 'working', includeUnknowns: false,
  email: 'demo@example.com', status: 'active', createdAt: '2026-10-24T20:00:00Z',
  lastCheckAt: null, lastSuccessAt: null, nextCheckAt: null, lastError: null,
};
const item: RawItem = {
  id: 'item1', url: 'https://www.facebook.com/marketplace/item/item1', title: 'Free standing desk',
  description: 'Acme Lift 2 standing desk. Width: 120 cm. Motor works. Complete desk. Pickup upstairs.',
  price: { amount: 0 }, location: { city: 'San Francisco', state: 'CA', latitude: 37.7599, longitude: -122.4148 },
};
const facts: ScreeningFacts = {
  relevant: true, relevanceStatus: 'matches', relevanceQuote: 'standing desk', rationale: 'Correct item.',
  brand: { value: 'Acme', quote: 'Acme Lift 2 standing desk.' }, model: { value: 'Lift 2', quote: 'Acme Lift 2 standing desk.' },
  dimensions: { width: { value: 120, unit: 'cm', quote: 'Width: 120 cm.' }, depth: null, height: null },
  works: { status: 'working', quote: 'Motor works.' }, fullItem: { status: 'complete', quote: 'Complete desk.' },
  priceContradiction: { present: false, quote: null },
  pickupRestrictions: [{ text: 'Pickup is upstairs.', quote: 'Pickup upstairs.' }], visualConcerns: [], questions: [],
};

const strong = evaluate(scout, item, facts, 'assessed');
assert.equal(evaluate(scout,item,{...facts,relevanceStatus:'uncertain'},'assessed').decision,'needs_checking');
assert.equal(strong.decision, 'strong_fit');
assert.equal(strong.dimensions?.widthIn, 47.24);
assert.equal(strong.model, 'Lift 2');
assert.ok(strong.evidence?.some((e) => e.field === 'Width'));

assert.equal(evaluate({ ...scout, maxWidthIn: 40 }, item, facts, 'assessed').decision, 'rejected');
assert.equal(evaluate(scout, { ...item, price: { amount: 20 } }, facts, 'assessed').decision, 'rejected');
assert.equal(evaluate(scout, { ...item, is_sold: true }, facts, 'assessed').decision, 'rejected');
assert.equal(evaluate(scout, { ...item, location: { city: 'Napa', latitude: 38.5, longitude: -122.5 } }, facts, 'assessed').decision, 'rejected');
assert.equal(evaluate(scout, { ...item, location: { city: 'San Francisco', state:'CA', latitude: 38.5, longitude: -122.5 } }, facts, 'assessed').decision, 'strong_fit','explicit city scope replaces the former hidden radius');
assert.equal(evaluate(scout, { ...item, location: {} }, facts, 'assessed').decision, 'needs_checking');

// Real-world regression: Marketplace's $0 field concealed a paid item in a moving sale.
const movingSale: RawItem = { ...item, title: 'MOVING SALE - everything must go', description: 'Bike Helmet — $10\nStanding Desk — $35\nOffice Chair — $10 each' };
const missedPrice = { ...facts, relevanceQuote: 'Standing Desk — $35', priceContradiction: { present: false, quote: null } };
const priced = evaluate(scout,movingSale,missedPrice,'assessed');
assert.equal(priced.decision,'rejected');
assert.ok(priced.evidence?.some(e=>e.field==='Payment requirement' && e.text==='Standing Desk — $35'));
assert.equal(evaluate(scout,{...movingSale,description:'Standing Desk - 35$'}, {...missedPrice,relevanceQuote:'Standing Desk'},'assessed').decision,'rejected');
assert.equal(evaluate(scout,{...item,description:item.description+' Originally bought for $600.'},facts,'assessed').decision,'strong_fit');
assert.equal(evaluate(scout,{...item,description:item.description+'\nStanding desk originally $600, now free.'},facts,'assessed').decision,'strong_fit');
assert.equal(evaluate(scout,{...item,description:item.description+'\nStanding desk originally $600, now $35.'},facts,'assessed').decision,'rejected');
assert.equal(evaluate(scout,{...item,description:item.description+'\nChair — $35'},facts,'assessed').decision,'strong_fit');
assert.equal(evaluate(scout,{...item,description:item.description+'\nStanding desk free. Optional delivery $20.'},facts,'assessed').decision,'strong_fit');

// Balanced presentation quotes must not hide a real fault; unsupported claims stay unknown.
const brokenDesk = {...item,description:'Large Poppin desk. Its standing function does not work anymore.'};
const brokenFacts: ScreeningFacts = {...facts,works:{status:'broken',quote:'"standing function does not work anymore"'}};
assert.equal(evaluate(scout,brokenDesk,brokenFacts,'assessed').decision,'rejected');
assert.equal(evaluate(scout,item,{...facts,works:{status:'working',quote:'“Motor works.”'}},'assessed').decision,'strong_fit');
const intermittent = {...item,description:'Intermittent issue: the gas cylinder sometimes loses air and collapses. I have been able to still use it fairly easily.'};
assert.equal(evaluate(scout,intermittent,{...facts,works:{status:'unknown',quote:'Intermittent issue: the gas cylinder sometimes loses air and collapses.'}},'assessed').decision,'rejected');
assert.equal(evaluate({...scout,condition:'any',maxWidthIn:null},intermittent,{...facts,works:{status:'unknown',quote:'Intermittent issue: the gas cylinder sometimes loses air and collapses.'}},'not_requested').decision,'strong_fit');
assert.equal(evaluate(scout,{...item,description:item.description+' No known issues.'},{...facts,works:{status:'working',quote:'Motor works. Complete desk. Pickup upstairs. No known issues.'}},'assessed').decision,'strong_fit');

const hallucinated: ScreeningFacts = { ...facts, dimensions: { width: { value: 40, unit: 'in', quote: 'Width: 40 in.' }, depth: null, height: null }, model: { value: 'Imaginary model', quote: 'Acme Lift 2 standing desk.' } };
const missing = evaluate(scout, item, hallucinated, 'assessed');
assert.equal(missing.decision, 'needs_checking');
assert.equal(missing.dimensions?.widthIn, null);
assert.equal(missing.model, null);
assert.equal(missing.evidence?.some((e) => e.text === 'Width: 40 in.'), false);

const wrongAxis = { ...item, description: 'Depth: 120 cm. Motor works.' };
const wrongAxisFacts: ScreeningFacts = { ...facts, dimensions: { ...facts.dimensions, width: { value: 120, unit: 'cm', quote: 'Depth: 120 cm.' } } };
assert.equal(evaluate(scout, wrongAxis, wrongAxisFacts, 'assessed').dimensions?.widthIn, null);

const attrs: RawItem = { ...item, description: 'Motor works.', attributes: [{ attribute_name: 'Width (in)', value: '48' }] };
const attrFacts: ScreeningFacts = { ...facts, dimensions: { ...facts.dimensions, width: { value: 48, unit: 'in', quote: 'Width (in): 48' } } };
assert.equal(evaluate(scout, attrs, attrFacts, 'assessed').dimensions?.widthIn, 48);

const visual = { ...facts, visualConcerns: ['Possible crack; check the photo.'] };
assert.equal(evaluate(scout, item, visual, 'assessed').decision, 'needs_checking');
assert.equal(evaluate(scout, item, visual, 'unavailable').decision, 'strong_fit');
const noWorkProof: ScreeningFacts = { ...facts, works: { status: 'working', quote: 'Invented working statement' } };
assert.equal(evaluate(scout, item, noWorkProof, 'not_requested').decision, 'needs_checking');
assert.throws(() => parseScreeningFacts({ ...facts, dimensions: { ...facts.dimensions, width: { value: -5, unit: 'in', quote: 'Width -5 in' } } }));
console.log('Screening checks passed: evidence, dimensions, hard filters, unknowns, image fallback, schema validation.');

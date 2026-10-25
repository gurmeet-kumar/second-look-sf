import assert from 'node:assert/strict';
import { applyRequirementChecks, pickupDistanceText } from './requirements';
import { applyFreshness } from './freshness';
import { evaluate, type ScreeningFacts } from './screening';
import type { Listing, RawItem, Scout } from './types';

const now=Date.parse('2026-10-24T22:00:00Z');
const scout: Scout={id:'standing',query:'standing desk',neighborhood:'Mission District',radiusMiles:5,maxWidthIn:null,maxDepthIn:null,maxHeightIn:null,condition:'any',includeUnknowns:true,email:'demo@example.invalid',maxAgeHours:24,status:'active',createdAt:new Date(now).toISOString(),lastCheckAt:null,lastSuccessAt:null,nextCheckAt:null,lastError:null};
const listing=(patch:Partial<Listing>={}):Listing=>({id:'desk',scoutId:scout.id,url:'https://example.invalid/desk',title:'Free wood desk',description:'Free wood desk',price:0,city:'Livermore, CA',photo:null,photos:[],firstSeenAt:new Date(now).toISOString(),sourceCreatedAt:new Date(now-3600000).toISOString(),decision:'rejected',reasons:['Approximate pickup location is 36 mi away, outside your 5 mi radius.'],unknowns:[],questions:[],evidence:[],dimensions:{widthIn:null,depthIn:null,heightIn:null},brand:null,model:null,conditionNote:null,visualNote:null,visualStatus:'not_requested',distanceMiles:35.8,userState:'new',resale:null,...patch});

// Representative desk fixtures must disclose unchecked capability and legacy distance handling.
for(const [title,description,distance] of [
  ['Free Wood Desk','Free wood desk',35.8],
  ['Free desk 48”w x 30” d x 29”h','Free desk\nOn the curb\nPickup address supplied separately',37.2],
  ['Black IKEA Desk','Four metal cylindrical legs. Estimated 60 x 30 x 29 inches.',5.3],
] as const) {
  const checked=applyRequirementChecks(listing({title,description,distanceMiles:distance}),scout);
  assert.equal(checked.decision,'rejected');
  assert.equal(checked.requestedFeatureCheck?.status,'unconfirmed');
  assert.equal(checked.requestedFeatureCheck?.quote,undefined,'shape, material and static height are not proof of a subtype mismatch');
  assert.ok(checked.unknowns.includes('Standing or height-adjustable capability is not established by the listing.'));
  assert.ok(checked.reasons.includes(`Approximate pickup location is ${distance.toFixed(1)} mi away, outside your 5 mi radius.`));
  assert.deepEqual(applyRequirementChecks(checked,scout),checked,'repeat state reads are idempotent');
}

const generic=applyRequirementChecks(listing({decision:'strong_fit',reasons:['Matches your search for standing desk.'],distanceMiles:1}),scout);
assert.equal(generic.decision,'needs_checking');
assert.equal(generic.reasons.some(reason=>reason.startsWith('Matches your search')),false);
assert.ok(generic.questions.some(question=>/standing height/.test(question)));

const supported=applyRequirementChecks(listing({title:'Free height-adjustable desk',description:'The motor works.',distanceMiles:5.3}),scout);
assert.equal(supported.decision,'rejected','supporting the feature does not override an independent radius failure');
assert.equal(supported.requestedFeatureCheck?.status,'supported');
assert.match(supported.requestedFeatureCheck!.summary,/not independently verified/);
assert.equal(applyRequirementChecks(listing({title:'Fixed-height standing desk',description:'Non-adjustable standing desk.',decision:'strong_fit',reasons:[],distanceMiles:1}),scout).decision,'strong_fit','a fixed-height standing desk is still a standing desk');
assert.equal(applyRequirementChecks(listing({title:'Fixed-height standing desk',description:'Height is fixed.',decision:'strong_fit',reasons:[],distanceMiles:1}),{...scout,query:'height adjustable desk'}).requestedFeatureCheck?.status,'mismatch');

const seated=applyRequirementChecks(listing({title:'Free desk',description:'This is not a standing desk. Seated desk only.',decision:'strong_fit',reasons:[],distanceMiles:1}),scout);
assert.equal(seated.decision,'rejected');
assert.equal(seated.requestedFeatureCheck?.status,'mismatch');
assert.equal(seated.requestedFeatureCheck?.quote,'This is not a standing desk.');
assert.ok(seated.evidence.some(item=>item.field==='Requested desk capability' && item.text==='This is not a standing desk.'));
assert.equal(applyRequirementChecks(listing({title:'Free desk',description:'This isn’t a standing desk.',decision:'strong_fit',reasons:[],distanceMiles:1}),scout).requestedFeatureCheck?.status,'mismatch');
assert.equal(applyRequirementChecks(listing({title:'Free standing desk',description:'A full standing desk, not a standing desk converter.',decision:'strong_fit',reasons:[],distanceMiles:1}),scout).requestedFeatureCheck?.status,'supported','a negated accessory is not a negated desk');
assert.equal(applyRequirementChecks(listing({title:'Free standing desk',description:'Not a wooden desk. The chair is not adjustable.',decision:'strong_fit',reasons:[],distanceMiles:1}),scout).requestedFeatureCheck?.status,'supported','negative claims about another item/feature do not negate standing-desk capability');
assert.equal(applyRequirementChecks(listing({title:'Free desk',description:'Getting a standing desk.',decision:'strong_fit',reasons:[],distanceMiles:1}),scout).requestedFeatureCheck?.status,'unconfirmed','the replacement desk is not the item offered');
assert.equal(applyRequirementChecks(listing({title:'Free desk',description:'Adjustable chair included.',decision:'strong_fit',reasons:[],distanceMiles:1}),scout).requestedFeatureCheck?.status,'unconfirmed');
assert.equal(applyRequirementChecks(listing({title:'Office chair',description:'Chair height is adjustable.',decision:'rejected',reasons:['The title explicitly describes a different item: Office chair.'],distanceMiles:1}),scout).requestedFeatureCheck?.status,'unconfirmed','chair height does not establish standing-desk capability');
assert.equal(applyRequirementChecks(listing({title:'Desk and chair',description:'Chair height is fixed, not adjustable.',decision:'strong_fit',reasons:[],distanceMiles:1}),{...scout,query:'height-adjustable desk'}).requestedFeatureCheck?.status,'unconfirmed','a fixed chair does not establish a fixed desk');
assert.equal(applyRequirementChecks(listing({title:'Desk and chair',description:'This desk is height-adjustable. Chair height is fixed.',decision:'strong_fit',reasons:[],distanceMiles:1}),{...scout,query:'height-adjustable desk'}).requestedFeatureCheck?.status,'supported');
assert.equal(applyRequirementChecks(listing({title:'Desk and chair',description:'Chair height is fixed but the desk is height-adjustable.',decision:'strong_fit',reasons:[],distanceMiles:1}),{...scout,query:'height-adjustable desk'}).requestedFeatureCheck?.status,'supported');
for(const title of ['Standing desk mat','Standing desk converter','Standing desk frame only']) assert.equal(applyRequirementChecks(listing({title,description:'Height adjustable.',decision:'strong_fit',reasons:[],distanceMiles:1}),scout).requestedFeatureCheck?.status,'unconfirmed','an accessory is not proof of a whole standing desk');
assert.equal(applyRequirementChecks(listing({title:'Standing desk, not a converter',description:'A full standing desk.',decision:'strong_fit',reasons:[],distanceMiles:1}),scout).requestedFeatureCheck?.status,'supported');
assert.equal(pickupDistanceText(5.04,5),'5.04 mi');
assert.equal(pickupDistanceText(5.004,5),'just over 5 mi');
assert.match(applyRequirementChecks(listing({distanceMiles:5.04}),scout).reasons[0],/5\.04 mi away, outside your 5 mi radius/);

// A model broad-category match must not bypass the deterministic subtype guard.
const item:RawItem={id:'generic',url:'https://example.invalid/generic',title:'Free wood desk',description:'A complete desk. Good condition.',price:{amount:0},location:{latitude:37.7599,longitude:-122.4148}};
const facts:ScreeningFacts={relevant:true,relevanceStatus:'matches',relevanceQuote:'desk',rationale:'A desk.',brand:null,model:null,dimensions:{width:null,depth:null,height:null},works:{status:'unknown',quote:null},fullItem:{status:'complete',quote:'A complete desk.'},priceContradiction:{present:false,quote:null},pickupRestrictions:[],visualConcerns:[],questions:[]};
const assessed=evaluate(scout,item,facts,'not_requested');
assert.equal(assessed.decision,'needs_checking');
assert.equal(assessed.cityCheck?.status,'unconfirmed','coordinates alone do not establish the pickup city');
assert.equal(assessed.requestedFeatureCheck?.status,'unconfirmed');
assert.equal(assessed.reasons!.some(reason=>reason.startsWith('Matches your search')),false);
const boundaryLatitude=37.7599+(5.04/3958.7613)*180/Math.PI;
const sameCityLocation={city:'San Francisco',state:'CA',latitude:boundaryLatitude,longitude:-122.4148};
const boundary=evaluate(scout,{...item,location:sameCityLocation},facts,'not_requested');
assert.equal(boundary.decision,'needs_checking','a same-city generic desk needs subtype confirmation, not rejection by a historical radius');
assert.equal(boundary.cityCheck?.status,'matches');
assert.equal(boundary.requestedFeatureCheck?.status,'unconfirmed');
assert.equal(boundary.distanceMiles,null,'distance no longer acts as a user constraint');
assert.ok(boundary.reasons!.every(reason=>!reason.includes('radius')));
const supportedBoundary=evaluate(scout,{...item,title:'Free standing desk',location:sameCityLocation},{...facts,relevanceQuote:'standing desk'},'not_requested');
assert.equal(supportedBoundary.decision,'strong_fit','a supported standing desk in the selected city can qualify beyond the historical radius');
assert.equal(supportedBoundary.requestedFeatureCheck?.status,'supported');
assert.equal(supportedBoundary.cityCheck?.status,'matches');

// Requirement checks must operate on base fit before freshness adds its overlay.
const old=listing({decision:'strong_fit',reasons:['Matches your search for standing desk.'],sourceCreatedAt:new Date(now-72*3600000).toISOString(),distanceMiles:1});
const narrow=applyFreshness(applyRequirementChecks(old,scout),24,now);
assert.equal(narrow.decision,'rejected');
assert.equal(narrow.screeningDecision,'needs_checking');
const widened=applyFreshness(applyRequirementChecks(narrow,scout),168,now);
assert.equal(widened.decision,'needs_checking');
assert.equal(widened.reasons.some(reason=>/outside your last/.test(reason)),false,'freshness failures must not become permanent base-fit reasons');
assert.equal(old.decision,'strong_fit','the saved input is not mutated');

console.log('Requirement checks passed: cached subtype evidence, explicit mismatch, subject-sensitive negatives, fixed-height standing desk, AI override guard, city-only evaluation, legacy distance formatting and reversible freshness.');

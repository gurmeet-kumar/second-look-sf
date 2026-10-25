import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {store,reset,row,newScout,listing} from './test-store-lifecycle.mjs';

import { appDir, bundleDir, require, build } from './support/paths.mjs';
const calls={search:0,detail:[],screen:[],email:[],searchItems:[],details:{}};
globalThis.__secondLookRequirementMock=calls;
const providerCode=`
const calls=globalThis.__secondLookRequirementMock;
export class ProviderError extends Error { constructor(message,retryAfterMs=60000,status=500){super(message);this.retryAfterMs=retryAfterMs;this.status=status;} }
export async function searchItems(){calls.search++;return calls.searchItems;}
export async function itemDetails(id){calls.detail.push(id);return calls.details[id];}
export async function screenItem(scout,item){calls.screen.push(item.id);return {facts:{relevant:true,relevanceStatus:'matches',relevanceQuote:'desk',rationale:'Broad desk category.',brand:null,model:null,dimensions:{width:null,depth:null,height:null},works:{status:'unknown',quote:null},fullItem:{status:'unknown',quote:null},priceContradiction:{present:false,quote:null},pickupRestrictions:[],visualConcerns:[],questions:[]},visualStatus:'not_requested'};}
export async function sendFindEmail(scout,item){calls.email.push(item.id);return 'email-'+item.id;}
`;
const result=await build({entryPoints:[path.join(appDir,'lib/engine.ts')],absWorkingDir:appDir,bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent',plugins:[{name:'mock-runtime',setup(builder){
  builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'mock'}));
  builder.onResolve({filter:/^\.\/providers$/},args=>args.importer.endsWith('engine.ts')?{path:'providers',namespace:'mock'}:null);
  builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='runtime'?'export const env=globalThis.__secondLookTestEnv;':providerCode,loader:'js'}));
}}]});
const bundlePath=path.join(bundleDir,'requirements-integration.bundle.cjs');writeFileSync(bundlePath,result.outputFiles[0].text);
const engine=require(bundlePath);
function resetCalls(){Object.assign(calls,{search:0,detail:[],screen:[],email:[],searchItems:[],details:{}});}
const fresh=new Date(Date.now()-3600000).toISOString();
const local={city:'San Francisco',state:'CA',latitude:37.7599,longitude:-122.4148};
const far={city:'Napa',latitude:38.30,longitude:-122.28};
const item=(id,patch={})=>({id,url:'https://example.invalid/'+id,title:'Free wood desk',description:'Free wood desk',price:{amount:0},creation_time:fresh,location:local,...patch});
const brief=()=>({...newScout(),condition:'any',maxWidthIn:null,includeUnknowns:false});

reset();resetCalls();
const cachedScout=await store.createScout(brief());
for(const [id,title,description,distance,city] of [
  ['wood','Free Wood Desk','Free wood desk',35.8,'Livermore, CA'],
  ['napa','Free desk 48”w x 30” d x 29”h','Free desk\nOn the curb\nPickup address supplied separately',37.2,'Napa, CA'],
  ['ikea','Black IKEA Desk','Four metal cylindrical legs. Estimated 60 x 30 x 29 inches.',5.3,'Brisbane, CA'],
]) await store.upsertMatch(cachedScout.id,id,{...listing(cachedScout.id,id),title,description,city,distanceMiles:distance,sourceCreatedAt:fresh,decision:'rejected',reasons:[`Approximate pickup location is ${Math.round(distance)} mi away, outside your 5 mi radius.`]});
const cached=(await store.getAppState()).listings;
assert.equal(cached.length,3);
for(const result of cached) {
  assert.equal(result.requestedFeatureCheck.status,'unconfirmed');
  assert.equal(result.decision,'rejected');
  assert.equal(result.cityCheck.status,'mismatch');
  assert.ok(result.reasons.some(reason=>reason.includes('outside your selected city')));
  assert.ok(result.reasons.every(reason=>!reason.includes('radius')));
  assert.equal((await store.getMatch(cachedScout.id,result.id)).requestedFeatureCheck,undefined,'state overlays do not rewrite stored assessments');
}
assert.equal(calls.search,0);assert.deepEqual(calls.detail,[]);assert.deepEqual(calls.screen,[]);
console.log('PASS cached desk-fixture state gains honest subtype uncertainty and city-only scope without provider calls or DB rewrites');

reset();resetCalls();
const scanScout=await store.createScout(brief());
calls.searchItems=[item('multiple',{price:{amount:20},is_pending:true,location:far}),item('supported-outside',{title:'Height-adjustable desk',description:'Height adjustable desk.',location:far}),item('explicit-mismatch',{description:'This is not a standing desk.'})];
await engine.tick({forceScoutId:scanScout.id});
const multiple=await store.getMatch(scanScout.id,'multiple');
assert.equal(multiple.decision,'rejected');
assert.equal(multiple.requestedFeatureCheck.status,'unconfirmed');
assert.ok(multiple.reasons.includes('The listing is not free.'));
assert.ok(multiple.reasons.includes('The listing is unavailable or pending.'));
assert.ok(multiple.reasons.some(reason=>/outside your selected city/.test(reason)));
assert.equal((await store.getMatch(scanScout.id,'supported-outside')).requestedFeatureCheck.status,'supported');
assert.equal((await store.getMatch(scanScout.id,'explicit-mismatch')).requestedFeatureCheck.status,'mismatch');
assert.equal(calls.search,1);assert.deepEqual(calls.detail,[]);assert.deepEqual(calls.screen,[]);assert.deepEqual(calls.email,[]);
console.log('PASS search collects simultaneous price/availability/city failures plus subtype check; known exclusions spend no detail/model calls');

reset();resetCalls();
const boundaryScout=await store.createScout(brief());
const boundaryLatitude=local.latitude+(5.04/3958.7613)*180/Math.PI;
calls.searchItems=[item('boundary',{title:'Free standing desk',description:'Complete standing desk.',location:{...local,latitude:boundaryLatitude}})];calls.details['boundary']=calls.searchItems[0];
await engine.tick({forceScoutId:boundaryScout.id});
const boundary=await store.getMatch(boundaryScout.id,'boundary');
assert.notEqual(boundary.decision,'rejected');assert.equal(boundary.cityCheck.status,'matches');
assert.ok(boundary.reasons.every(reason=>!reason.includes('radius')));
assert.deepEqual(calls.detail,['boundary']);assert.deepEqual(calls.screen,['boundary']);assert.deepEqual(calls.email,['boundary']);
console.log('PASS same-city item beyond historical radius is reviewed using city scope, without hidden distance rejection');

reset();resetCalls();
const detailScout=await store.createScout(brief());
await store.upsertMatch(detailScout.id,'late-distance',{...listing(detailScout.id,'late-distance'),title:'Free desk',description:'',sourceCreatedAt:fresh,decision:'pending',reasons:[]});
await store.addJob({scoutId:detailScout.id,itemId:'late-distance',stage:'detail',payload:{itemId:'late-distance'}});
calls.details['late-distance']=item('late-distance',{location:far,is_pending:true});
await engine.tick({forceScoutId:detailScout.id,continueOnly:true});
const detailed=await store.getMatch(detailScout.id,'late-distance');
assert.deepEqual(calls.detail,['late-distance']);assert.deepEqual(calls.screen,[]);assert.deepEqual(calls.email,[]);
assert.equal(detailed.requestedFeatureCheck.status,'unconfirmed');
assert.ok(detailed.reasons.some(reason=>/unavailable/.test(reason)));
assert.ok(detailed.reasons.some(reason=>/outside your/.test(reason)));
console.log('PASS detailed location rejection retains availability failure and standing requirement uncertainty without model spend');

reset();resetCalls();
const genericScout=await store.createScout(brief());
calls.searchItems=[item('generic-local')];calls.details['generic-local']=item('generic-local');
await engine.tick({forceScoutId:genericScout.id});
const generic=await store.getMatch(genericScout.id,'generic-local');
assert.deepEqual(calls.detail,['generic-local']);assert.deepEqual(calls.screen,['generic-local']);assert.deepEqual(calls.email,[]);
assert.equal(generic.decision,'needs_checking');assert.equal(generic.requestedFeatureCheck.status,'unconfirmed');
assert.equal(generic.reasons.some(reason=>reason.startsWith('Matches your search')),false);
assert.equal(row('SELECT COUNT(*) count FROM alerts').count,0,'existing includeUnknowns=false policy still blocks an uncertain fit');
console.log('PASS otherwise-eligible generic desk is screened once but a broad AI match cannot become confirmed standing capability');

reset();resetCalls();
const oldScout=await store.createScout(brief());
await store.upsertMatch(oldScout.id,'old',{...listing(oldScout.id,'old'),title:'Free desk',description:'Wood desk',sourceCreatedAt:new Date(Date.now()-72*3600000).toISOString(),reasons:['Matches your search for standing desk.']});
let old=(await store.getAppState()).listings[0];
assert.equal(old.decision,'rejected');assert.equal(old.screeningDecision,'needs_checking');
await store.updateScout(oldScout.id,{maxAgeHours:168});
old=(await store.getAppState()).listings[0];
assert.equal(old.decision,'needs_checking');assert.equal(old.reasons.some(reason=>/outside your last/.test(reason)),false);
assert.equal((await store.getMatch(oldScout.id,'old')).decision,'strong_fit');
console.log('PASS subtype overlay precedes freshness; widening age window restores uncertain fit without persisting date failures');
console.log('All requirement integration checks passed with actual engine/store/screening and mocked providers. No credentials or network calls.');

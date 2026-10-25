import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { store, reset, row, newScout, listing } from './test-store-lifecycle.mjs';

import { appDir, bundleDir, require, build } from './support/paths.mjs';
const calls={search:0,detail:[],screen:[],email:[],searchItems:[],details:{},tightenOnScreen:false};
globalThis.__secondLookFreshnessMock=calls;
globalThis.__secondLookFreshnessStore=store;
const providerCode=`
const calls=globalThis.__secondLookFreshnessMock;
export class ProviderError extends Error { constructor(message,retryAfterMs=60000,status=500){super(message);this.retryAfterMs=retryAfterMs;this.status=status;} }
export async function searchItems(){calls.search++;return calls.searchItems;}
export async function itemDetails(id){calls.detail.push(id);return {id,title:'Standing desk',url:'https://example.invalid/'+id,description:'A working standing desk',price:{amount:0},location:{city:'San Francisco',state:'CA',latitude:37.7599,longitude:-122.4148},...calls.details[id]};}
export async function screenItem(scout,item){calls.screen.push(item.id);if(calls.tightenOnScreen)await globalThis.__secondLookFreshnessStore.updateScout(scout.id,{maxAgeHours:24});return {facts:{},visualStatus:'not_requested'};}
export async function sendFindEmail(scout,item){calls.email.push({id:item.id,sourceCreatedAt:item.sourceCreatedAt,freshness:item.freshness});return 'email-'+item.id;}
`;
const result=await build({entryPoints:[path.join(appDir,'lib/engine.ts')],absWorkingDir:appDir,bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent',plugins:[{name:'mock-runtime',setup(builder){
  builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'mock'}));
  builder.onResolve({filter:/^\.\/providers$/},args=>args.importer.endsWith('engine.ts')?{path:'providers',namespace:'mock'}:null);
  builder.onResolve({filter:/^\.\/screening$/},args=>args.importer.endsWith('engine.ts')?{path:'screening',namespace:'mock'}:null);
  builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='runtime'?'export const env=globalThis.__secondLookTestEnv;':args.path==='providers'?providerCode:'export function evaluate(){return {decision:"strong_fit",reasons:["Fits the item requirements."],unknowns:[],questions:[]};}',loader:'js'}));
}}]});
const bundlePath=path.join(bundleDir,'freshness-integration.bundle.cjs');writeFileSync(bundlePath,result.outputFiles[0].text);
const engine=require(bundlePath);
function resetCalls(){Object.assign(calls,{search:0,detail:[],screen:[],email:[],searchItems:[],details:{},tightenOnScreen:false});}
const ago=hours=>new Date(Date.now()-hours*3600000).toISOString();
async function pending(scout,id,date){await store.upsertMatch(scout.id,id,{...listing(scout.id,id),decision:'pending',sourceCreatedAt:date});await store.addJob({scoutId:scout.id,itemId:id,stage:'detail',payload:{itemId:id}});}

reset();resetCalls();
const cachedScout=await store.createScout(newScout());
await store.upsertMatch(cachedScout.id,'old',listing(cachedScout.id,'old'));
await store.putItem({id:'old',title:'Standing desk',url:'https://example.invalid/old',creation_time:Math.floor((Date.now()-20*7*86400000)/1000)});
let state=await store.getAppState();
assert.equal(state.scouts[0].maxAgeHours,24);
assert.equal(state.listings[0].decision,'rejected');
assert.equal(state.listings[0].freshness.status,'older');
assert.equal((await store.getMatch(cachedScout.id,'old')).decision,'strong_fit','UI age overlay does not destroy base assessment');
await store.upsertMatch(cachedScout.id,'three-days',{...listing(cachedScout.id,'three-days'),sourceCreatedAt:ago(72)});
assert.equal((await store.getAppState()).listings.find(x=>x.id==='three-days').decision,'rejected');
await store.updateScout(cachedScout.id,{maxAgeHours:168});
assert.equal((await store.getAppState()).listings.find(x=>x.id==='three-days').decision,'strong_fit','widening restores cached assessment');
await store.upsertMatch(cachedScout.id,'relative-only',listing(cachedScout.id,'relative-only'));
await store.putItem({id:'relative-only',title:'Standing desk',url:'https://example.invalid/relative-only',listing_date_text:'Listed 20 weeks ago'});
const relativeOnly=(await store.getAppState()).listings.find(x=>x.id==='relative-only');
assert.equal(relativeOnly.sourceDateObservedAt,null,'first discovery is never substituted for source-phrase observation');
assert.equal(relativeOnly.sourceCreatedAt,null,'relative source text is not converted into an invented posting timestamp');
assert.equal(relativeOnly.decision,'rejected','very old source phrase is still a conservative age bound without an observation timestamp');
console.log('PASS cached raw dates backfill; legacy24h default; old posts rejected without overwriting fit; widening restores base');

reset();resetCalls();
const queueScout=await store.createScout(newScout());
await pending(queueScout,'old-queued',ago(500));
await engine.tick({forceScoutId:queueScout.id,continueOnly:true});
assert.deepEqual(calls.detail,[]);assert.deepEqual(calls.screen,[]);assert.deepEqual(calls.email,[]);
assert.equal((await store.getAppState()).listings[0].decision,'rejected');
assert.equal(row('SELECT COUNT(*) count FROM alerts').count,0);
console.log('PASS known-old queued item uses no detail/model/email calls and reserves no alert');

reset();resetCalls();
const searchScout=await store.createScout(newScout());
calls.searchItems=[{id:'search-old',title:'Standing desk',url:'https://example.invalid/search-old',price:{amount:0},creation_time:ago(700)}];
await engine.tick({forceScoutId:searchScout.id});
assert.equal(calls.search,1);assert.deepEqual(calls.detail,[]);assert.deepEqual(calls.screen,[]);
assert.equal((await store.getAppState()).listings[0].decision,'rejected');
console.log('PASS old timestamp from search prevents detail/model queue creation');

reset();resetCalls();
const unknownScout=await store.createScout(newScout());
await pending(unknownScout,'unknown',null);
await engine.tick({forceScoutId:unknownScout.id,continueOnly:true});
assert.deepEqual(calls.screen,['unknown']);assert.deepEqual(calls.email,[]);
assert.equal(row('SELECT COUNT(*) count FROM alerts').count,0);
const unknown=(await store.getAppState()).listings[0];
assert.equal(unknown.decision,'needs_checking');assert.equal(unknown.freshness.status,'unknown');
assert.equal((await store.getMatch(unknownScout.id,'unknown')).decision,'strong_fit');
console.log('PASS unknown posting date remains Needs checking despite item fit and includeUnknowns; no email reserved');

reset();resetCalls();
const recentScout=await store.createScout(newScout());
const recentDate=ago(1);
await pending(recentScout,'recent',recentDate);
await store.putItem({id:'recent',title:'Standing desk',url:'https://example.invalid/recent',creation_time:recentDate,listing_date_text:'Listed1hourago',source_date_observed_at:new Date().toISOString()});
calls.details.recent={creation_time:null,listing_date_text:null};
await engine.tick({forceScoutId:recentScout.id,continueOnly:true});
assert.equal((await store.getItem('recent')).creation_time,recentDate,'detail null does not erase search timestamp');
assert.equal((await store.getMatch(recentScout.id,'recent')).sourceCreatedAt,recentDate);
assert.equal((await store.getAppState()).listings[0].decision,'strong_fit','fresh model assessment is not frozen at pending by overlays');
assert.equal(calls.email.length,1);assert.equal(calls.email[0].freshness.status,'recent');assert.equal(calls.email[0].sourceCreatedAt,recentDate);
await engine.tick({forceScoutId:recentScout.id,continueOnly:true});assert.equal(calls.email.length,1);
console.log('PASS search timestamp survives missing detail date; recent item assessed and emailed once with source date');

reset();resetCalls();
const narrowedScout=await store.createScout({...newScout(),maxAgeHours:168});
await pending(narrowedScout,'narrowed',ago(48));
calls.details.narrowed={creation_time:ago(48)};calls.tightenOnScreen=true;
await engine.tick({forceScoutId:narrowedScout.id,continueOnly:true});
assert.deepEqual(calls.screen,['narrowed']);assert.deepEqual(calls.email,[]);
assert.equal(row('SELECT COUNT(*) count FROM alerts').count,0,'latest window is re-read before reservation');
console.log('PASS scout window narrowed during model call is rechecked before alert reservation');

reset();resetCalls();
const alertScout=await store.createScout({...newScout(),maxAgeHours:168});
await store.upsertMatch(alertScout.id,'queued-email',{...listing(alertScout.id,'queued-email'),sourceCreatedAt:ago(48)});
await store.reserveAlert(alertScout.id,'queued-email');
await store.addJob({scoutId:alertScout.id,itemId:'queued-email',stage:'email',payload:{itemId:'queued-email'}});
await store.updateScout(alertScout.id,{maxAgeHours:24});
await engine.tick({forceScoutId:alertScout.id,continueOnly:true});
assert.deepEqual(calls.email,[],'queued email is stopped when age policy changes');
assert.equal((await store.getAlert(alertScout.id,'queued-email')).status,'pending');
await store.updateScout(alertScout.id,{maxAgeHours:168});
await store.addJob({scoutId:alertScout.id,itemId:'queued-email',stage:'email',payload:{itemId:'queued-email'},restartDone:true});
await engine.tick({forceScoutId:alertScout.id,continueOnly:true});
assert.equal(calls.email.length,1);assert.equal((await store.getAlert(alertScout.id,'queued-email')).status,'sent');
console.log('PASS stale queued email blocked at send; widening can safely rearm same pending idempotent alert');
console.log('All freshness integration checks passed with actual engine/store and mocked providers. No network or provider calls.');

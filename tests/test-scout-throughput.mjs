import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { store, reset, row, newScout, listing } from './test-store-lifecycle.mjs';

import { appDir, bundleDir, require, build } from './support/paths.mjs';
const calls={search:0,detail:[],screen:[],email:[],active:0,max:0,searchItems:[]};
globalThis.__secondLookProviderMock=calls;
const providerCode=`
const calls=globalThis.__secondLookProviderMock;
export class ProviderError extends Error { constructor(message,retryAfterMs=60000,status=500){super(message);this.retryAfterMs=retryAfterMs;this.status=status;} }
async function work(kind,id){calls.active++;calls.max=Math.max(calls.max,calls.active);calls[kind].push(id);await new Promise(r=>setTimeout(r,5));calls.active--;}
export async function searchItems(){calls.search++;return calls.searchItems;}
export async function itemDetails(id){await work('detail',id);if(id==='gone')throw new ProviderError('This Facebook Marketplace item is no longer available',60000,404);return {id,title:'Standing desk',url:'https://example.invalid/'+id,description:'A working standing desk',creation_time:new Date().toISOString(),price:{amount:0},location:{city:'San Francisco',state:'CA',latitude:37.7599,longitude:-122.4148}};}
export async function screenItem(scout,item){await work('screen',item.id);if(item.id==='model404')throw new ProviderError('Model not found',60000,404);return {facts:{},visualStatus:'not_requested'};}
export async function sendFindEmail(scout,item){await work('email',item.id);return 'email-'+item.id;}
`;
const result=await build({entryPoints:[path.join(appDir,'lib/engine.ts')],absWorkingDir:appDir,bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent',plugins:[{name:'mock-runtime',setup(builder){
  builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'mock'}));
  builder.onResolve({filter:/^\.\/providers$/},args=>args.importer.endsWith('engine.ts')?{path:'providers',namespace:'mock'}:null);
  builder.onResolve({filter:/^\.\/screening$/},args=>args.importer.endsWith('engine.ts')?{path:'screening',namespace:'mock'}:null);
  builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='runtime'?'export const env=globalThis.__secondLookTestEnv;':args.path==='providers'?providerCode:'export function evaluate(){return {decision:"needs_checking",reasons:["Mock assessment for queue integration test."]};}',loader:'js'}));
}}]});
const bundlePath=path.join(bundleDir,'scout-throughput.bundle.cjs');writeFileSync(bundlePath,result.outputFiles[0].text);
const engine=require(bundlePath);
function resetCalls(){Object.assign(calls,{search:0,detail:[],screen:[],email:[],active:0,max:0,searchItems:[]});}
async function pending(scout,id){await store.upsertMatch(scout.id,id,{...listing(scout.id,id),decision:'pending'});}

reset();resetCalls();
const scoutA=await store.createScout(newScout());const scoutB=await store.createScout(newScout());
for(const id of ['a1','a2','a3'])await pending(scoutA,id);
await pending(scoutB,'b1');
await store.addJob({scoutId:scoutA.id,itemId:'a1',stage:'detail',payload:{},nextAt:new Date(Date.now()+600000).toISOString()});
await store.addJob({scoutId:scoutB.id,itemId:'b1',stage:'detail',payload:{}});
const outcome=await engine.tick({forceScoutId:scoutA.id,continueOnly:true});
assert.equal(calls.search,0,'continuation never starts a fresh search');
assert.equal(calls.max,3,'independent calls run with bounded concurrency3');
assert.deepEqual(new Set(calls.detail),new Set(['a1','a2','a3']),'legacy unqueued/deferred items advance immediately');
assert.equal(calls.detail.includes('b1'),false,'manual processing is scoped to selected scout');
assert.equal(outcome.pending,0);assert.equal(outcome.progress.pendingJobs,0);
assert.equal(await store.countPendingJobs(scoutB.id),1);
assert.equal(calls.email.length,3);
await engine.tick({forceScoutId:scoutA.id,continueOnly:true});
assert.equal(calls.email.length,3,'repeat continuation does not resend alerts');
console.log('PASS selected-scout continuation, deferred/backfilled jobs, concurrency3, no extra search, no duplicate email');

reset();resetCalls();
const scout=await store.createScout(newScout());
await pending(scout,'retry');
await store.addJob({scoutId:scout.id,itemId:'retry',stage:'detail',payload:{}});
const retryLease=await store.claimJob();await store.retryJob(retryLease,'provider backoff',60000);
const retryBefore=row('SELECT available_at FROM jobs WHERE id=?',retryLease.id).available_at;
const waiting=await engine.tick({forceScoutId:scout.id,continueOnly:true});
assert.equal(calls.detail.length,0);assert.equal(calls.search,0);
assert.equal(row('SELECT available_at FROM jobs WHERE id=?',retryLease.id).available_at,retryBefore);
assert.equal(waiting.progress.runnableJobs,0);assert.ok(waiting.progress.nextRetryAt);
console.log('PASS real provider backoff is respected by continuation');

reset();resetCalls();
const unavailableScout=await store.createScout(newScout());
for(const id of ['gone','model404'])await pending(unavailableScout,id);
await engine.tick({forceScoutId:unavailableScout.id,continueOnly:true});
assert.equal((await store.getMatch(unavailableScout.id,'gone')).decision,'rejected');
assert.equal(row("SELECT status FROM jobs WHERE scout_id=? AND id LIKE '%:gone:detail'",unavailableScout.id).status,'done');
assert.equal(row("SELECT status FROM jobs WHERE scout_id=? AND id LIKE '%:model404:screen'",unavailableScout.id).status,'pending');
assert.equal((await store.getMatch(unavailableScout.id,'model404')).decision,'pending');
console.log('PASS terminal item404 is rejected; model404 remains a retryable screening error');

reset();resetCalls();
const titleScout=await store.createScout(newScout());
calls.searchItems=[
  {id:'wrong',title:'Free sofa',price:{amount:0}},
  {id:'uncertain',title:'Moving sale sofa and household furniture',price:{amount:0}},
  {id:'model',title:'Autonomous SmartDesk 2',price:{amount:0}},
  {id:'generic',title:'Office furniture',price:{amount:0}},
];
await engine.tick({forceScoutId:titleScout.id});
assert.equal((await store.getMatch(titleScout.id,'wrong')).decision,'rejected');
assert.equal(calls.detail.includes('wrong'),false);
for(const id of ['uncertain','model','generic'])assert.ok(calls.detail.includes(id));
assert.equal(calls.search,1);
console.log('PASS conservative title filter skips explicit mismatch, keeps model names and vague/multi-item titles');
console.log('All throughput integration checks passed with actual engine/store and mocked providers. No network or provider calls.');

import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {store,reset,row,newScout,listing} from './test-store-lifecycle.mjs';

import { appDir, bundleDir, require, build } from './support/paths.mjs';
const calls={searches:[],items:[],details:{},screens:[],emails:[],order:[],hook:null};
globalThis.__secondLookCityMock=calls;
const mock=`
const calls=globalThis.__secondLookCityMock;
export class ProviderError extends Error {constructor(message,retryAfterMs=60000,status=500){super(message);this.retryAfterMs=retryAfterMs;this.status=status;}}
export async function searchItems(scout,paid=false,query=scout.query){calls.searches.push({scout,paid,query});if(calls.hook)await calls.hook();return calls.items;}
export async function itemDetails(id){return calls.details[id];}
export async function screenItem(scout,item){calls.screens.push(item.id);calls.order.push('screen:'+item.id);return {facts:{relevant:true,relevanceStatus:'matches',relevanceQuote:'standing desk',rationale:'Seller names requested type.',brand:null,model:null,dimensions:{width:null,depth:null,height:null},works:{status:'unknown',quote:null},fullItem:{status:'unknown',quote:null},priceContradiction:{present:false,quote:null},pickupRestrictions:[],visualConcerns:[],questions:[]},visualStatus:'not_requested'};}
export async function sendFindEmail(scout,item){calls.emails.push(item.id);calls.order.push('email:'+item.id);return 'email-'+item.id;}
`;
async function load(relative,providers=false){
  const result=await build({entryPoints:[path.join(appDir,relative)],absWorkingDir:appDir,bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent',plugins:[{name:'city-test-runtime',setup(builder){
    builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'mock'}));
    if(providers)builder.onResolve({filter:/^\.\/providers$/},args=>args.importer.endsWith('engine.ts')?{path:'providers',namespace:'mock'}:null);
    builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='runtime'?'export const env=globalThis.__secondLookTestEnv;':mock,loader:'js'}));
  }}]});
  const destination=path.join(bundleDir,relative.replace(/[^a-z0-9]/gi,'-')+'.city.cjs');
  writeFileSync(destination,result.outputFiles[0].text);return require(destination);
}
const engine=await load('lib/engine.ts',true);
const createRoute=await load('app/api/scouts/route.ts');
const patchRoute=await load('app/api/scouts/[id]/route.ts');
const sf={id:'5391959',label:'San Francisco, California',city:'San Francisco',state:'California',countryCode:'US',latitude:37.7749,longitude:-122.4194};
const sj={id:'5392171',label:'San Jose, California',city:'San Jose',state:'California',countryCode:'US',latitude:37.33939,longitude:-121.89496};
const fresh=new Date(Date.now()-3600000).toISOString();
const raw=(id,location={city:'San Francisco',state:'CA',latitude:38.5,longitude:-122.5})=>({id,title:'Free standing desk',description:'Complete standing desk.',url:'https://example.invalid/'+id,price:{amount:0},creation_time:fresh,location});
const brief=()=>({...newScout(),maxWidthIn:null,condition:'any',includeUnknowns:true});
function resetCalls(){Object.assign(calls,{searches:[],items:[],details:{},screens:[],emails:[],order:[],hook:null});}
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input)=>{
  const url=new URL(String(input));assert.equal(url.hostname,'geocoding-api.open-meteo.com','tests cannot reach Marketplace, models, or email');
  const value=url.searchParams.get('id')===sf.id?sf:sj;
  return Response.json({id:Number(value.id),name:value.city,admin1:value.state,country_code:'US',latitude:value.latitude,longitude:value.longitude,feature_code:'PPLA2'});
};
const request=(body,method='POST')=>new Request('https://app.example/api/scouts',{method,headers:{origin:'https://app.example','content-type':'application/json'},body:JSON.stringify(body)});
try {
  reset();resetCalls();
  let response=await createRoute.POST(request({query:'standing desk',locationId:sj.id}));
  assert.equal(response.status,201);
  const created=(await response.json()).scout;
  assert.deepEqual(created.location,sj);assert.equal(created.radiusMiles,50);assert.equal(created.neighborhood,sj.label);
  response=await createRoute.POST(request({query:'standing desk',locationId:sj.id,latitude:0,longitude:0}));assert.equal(response.status,400,'client coordinates are never accepted');
  response=await createRoute.POST(request({query:'standing desk',locationId:'https://evil.invalid'}));assert.equal(response.status,400);
  response=await createRoute.POST(request({query:'standing desk'}));assert.equal(response.status,400);
  await store.upsertMatch(created.id,'stale',{...listing(created.id,'stale'),sourceCreatedAt:fresh});
  await store.addJob({scoutId:created.id,itemId:'stale',stage:'detail',payload:{itemId:'stale'}});
  response=await patchRoute.PATCH(request({locationId:sf.id},'PATCH'),{params:{id:created.id}});
  assert.equal(response.status,200);assert.deepEqual((await store.getScout(created.id)).location,sf);
  assert.equal(row('SELECT COUNT(*) count FROM matches WHERE scout_id=?',created.id).count,0);
  assert.equal(row('SELECT COUNT(*) count FROM jobs WHERE scout_id=?',created.id).count,0);
  console.log('PASS create/patch resolve canonical city coordinates; reject malformed IDs and coordinate injection; city edits invalidate old matches and queue');

  reset();resetCalls();
  const outside=await store.createScout(brief());calls.items=[raw('napa',{city:'Napa',state:'CA'})];
  await engine.tick({forceScoutId:outside.id});
  const rejected=await store.getMatch(outside.id,'napa');assert.equal(rejected.decision,'rejected');assert.equal(rejected.cityCheck.status,'mismatch');assert.deepEqual(calls.screens,[]);assert.deepEqual(calls.emails,[]);
  assert.ok(rejected.reasons.some(reason=>/outside your selected city/.test(reason)));assert.ok(rejected.reasons.every(reason=>!reason.includes('radius')));
  console.log('PASS different-city items reject before paid detail/model work, with city reasoning and no hidden radius');

  reset();resetCalls();
  const unknown=await store.createScout(brief());calls.items=[raw('missing-state',{city:'San Francisco'})];calls.details['missing-state']=calls.items[0];
  await engine.tick({forceScoutId:unknown.id});
  assert.equal((await store.getMatch(unknown.id,'missing-state')).cityCheck.status,'unconfirmed');assert.deepEqual(calls.screens,['missing-state']);assert.deepEqual(calls.emails,[]);
  console.log('PASS unresolved source state remains unconfirmed and never emails, even with includeUnknowns');

  reset();resetCalls();
  const cached=await store.createScout(brief());
  await store.upsertMatch(cached.id,'old-radius',{...listing(cached.id,'old-radius'),city:'San Francisco, CA',sourceCreatedAt:fresh,decision:'rejected',reasons:['Approximate pickup location is 36 mi away, outside your 5 mi radius.']});
  const state=(await store.getAppState()).listings[0];assert.equal(state.decision,'needs_checking');assert.equal(state.cityCheck.status,'matches');assert.ok(state.reasons.every(reason=>!reason.includes('radius')));
  calls.items=[raw('old-radius')];calls.details['old-radius']=calls.items[0];
  await engine.tick({forceScoutId:cached.id});assert.deepEqual(calls.screens,['old-radius']);
  assert.ok(calls.order.indexOf('screen:old-radius')>=0);if(calls.emails.length)assert.ok(calls.order.indexOf('email:old-radius')>calls.order.indexOf('screen:old-radius'));
  assert.equal((await store.getMatch(cached.id,'old-radius')).cityCheck.status,'matches');
  console.log('PASS historical radius-only rejects remain unverified until an actual model review; same-city coordinates cannot trigger old radius rejection');

  reset();resetCalls();
  const raced=await store.createScout(brief());calls.items=[raw('wrong-old-city')];calls.hook=()=>store.updateScout(raced.id,{location:sj,neighborhood:sj.label});
  await engine.tick({forceScoutId:raced.id});assert.equal((await store.listMatches(raced.id)).length,0);assert.deepEqual(calls.screens,[]);
  console.log('PASS location edit during an in-flight source search prevents old-city results from repopulating matches');

  reset();resetCalls();
  const priceScout=await store.createScout({...brief(),location:sj,neighborhood:sj.label});
  await store.upsertMatch(priceScout.id,'price-target',{...listing(priceScout.id,'price-target'),title:'Free executive office chair',description:'Used leather executive office chair',brand:null,model:null});
  await engine.resale(priceScout.id,'price-target');
  assert.equal(calls.searches[0].scout.neighborhood,'San Francisco');assert.equal(calls.searches[0].scout.location,undefined);assert.equal(calls.searches[0].paid,true);
  console.log('PASS resale reference stays explicitly centered on San Francisco when the pickup scout selects a different city');
} finally {globalThis.fetch=originalFetch;}
console.log('All city integration checks passed using actual routes/store/engine with provider mocks. No credentials or network calls.');

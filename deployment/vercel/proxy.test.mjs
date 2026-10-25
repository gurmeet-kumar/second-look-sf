import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require=createRequire(import.meta.url);
const {build}=require('esbuild');
const folder=mkdtempSync(path.join(tmpdir(),'second-look-proxy-'));
const outfile=path.join(folder,'proxy.cjs');
await build({entryPoints:[fileURLToPath(new URL('./proxy.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',outfile,logLevel:'silent'});
const {handleProxy,issueSession,verifySession,SESSION_COOKIE}=require(outfile);
const env={SECOND_LOOK_BACKEND_URL:'https://second-look-sf-finds.cocoa-trout-0039.chatgpt.site',SECOND_LOOK_BACKEND_TOKEN:'test-only-service-token',SECOND_LOOK_ADMIN_PASSWORD:'test-only-long-demo-password',SECOND_LOOK_SESSION_SECRET:'test-only-session-secret-with-more-than-32-characters'};
const now=1_800_000_000_000;
const authCookie=`${SESSION_COOKIE}=${issueSession(env.SECOND_LOOK_SESSION_SECRET,now)}`;
const calls=[];
const state={scouts:[{id:'scout-1',query:'chair',email:'private@example.invalid',status:'active',lastError:'secret provider failure',location:{id:'5391959',label:'San Francisco, CA'}},{id:'deleted',query:'private old query',status:'deleted'}],deletedScouts:[{id:'old'}],listings:[{id:'item-1',scoutId:'scout-1',title:'Free chair',internalToken:'hidden'},{id:'item-old',scoutId:'old'}],activity:[{message:'private@example.invalid'}],workByScout:{'scout-1':{pendingJobs:2,runningJobs:0,failedJobs:0,runnableJobs:2,nextRetryAt:null,secret:'hidden'},old:{pendingJobs:5}},system:{demoEmail:'private@example.invalid',schedulerStatus:'Connected',lastWorkerAt:'2026-10-24T00:00:00Z',creditsRemaining:100,requestsUsed:4,requestBudget:200,modelAvailable:true},secret:'hidden'};
const fetcher=async(url,init)=>{calls.push({url:String(url),init});return Response.json(state);};
const request=(method,url,body='',cookie='')=>({method,url,body,headers:new Headers({host:'second-look.vercel.app',origin:'https://second-look.vercel.app',...(cookie?{cookie}:{})})});
const run=(req,options={})=>handleProxy(req,{env,now,fetcher,...options});
let checks=0;
async function test(name,fn){await fn();checks++;console.log(`PASS ${name}`);}

try {
  await test('the deployed ESM entry loads with explicit module extensions',async()=>{
    const esm=path.join(folder,'esm');mkdirSync(esm);writeFileSync(path.join(esm,'package.json'),'{}');
    await build({entryPoints:[fileURLToPath(new URL('../../api/proxy.ts',import.meta.url)),fileURLToPath(new URL('./proxy.ts',import.meta.url))],outbase:fileURLToPath(new URL('../../',import.meta.url)),outdir:esm,bundle:false,platform:'node',format:'esm',logLevel:'silent'});
    writeFileSync(path.join(esm,'package.json'),JSON.stringify({type:'module'}));
    const entry=await import(pathToFileURL(path.join(esm,'api/proxy.js')).href);
    assert.equal(entry.requestUrl({url:'/api/proxy',query:{__second_look_path:'scouts/scout-1/scan'}}),'/api/scouts/scout-1/scan');
    assert.equal(entry.requestUrl({url:'/api/proxy?__second_look_path=locations&q=Chicago&bad=drop'}),'/api/locations?q=Chicago');
    assert.equal(entry.requestUrl({url:'/api/proxy'}),null);
    assert.equal(entry.requestUrl({url:'/api/proxy',query:{__second_look_path:['state','session']}}),null);
    assert.equal(entry.requestUrl({url:'/api/proxy',query:{__second_look_path:'../worker/tick'}}),null);
    const response={statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.value=JSON.parse(value);}};
    await entry.default({method:'GET',url:'/api/proxy',query:{__second_look_path:'session'},headers:{}},response);
    assert.equal(response.statusCode,200);assert.equal(response.value.canManage,false);
    await entry.default({method:'POST',url:'/api/proxy',query:{__second_look_path:'scouts/scout-1/scan'},headers:{host:'second-look.vercel.app',origin:'https://second-look.vercel.app'},body:{}},response);
    assert.equal(response.statusCode,401);
    await entry.default({method:'POST',url:'/api/proxy',query:{__second_look_path:'worker/tick'},headers:{},body:{}},response);
    assert.equal(response.statusCode,404);
  });
  await test('anonymous reads are sanitized and do not forward client credentials',async()=>{
    calls.length=0;
    const result=await run(request('GET','/api/state','','clientCookie=private'));
    assert.equal(result.status,200);
    assert.equal(result.body.scouts[0].email,'');assert.equal(result.body.scouts[0].lastError,null);
    assert.equal(result.body.scouts.length,1);assert.deepEqual(result.body.deletedScouts,[]);assert.deepEqual(result.body.activity,[]);
    assert.equal(result.body.system.demoEmail,'');assert.equal(result.body.system.creditsRemaining,null);assert.equal(result.body.system.requestBudget,0);
    assert.equal(result.body.listings.length,1);assert.equal(result.body.listings[0].internalToken,undefined);assert.equal(result.body.secret,undefined);
    assert.equal(result.body.workByScout.old,undefined);assert.equal(result.body.workByScout['scout-1'].secret,undefined);
    assert.equal(calls[0].init.headers['OAI-Sites-Authorization'],`Bearer ${env.SECOND_LOOK_BACKEND_TOKEN}`);
    assert.equal(calls[0].init.headers.cookie,undefined);assert.equal(calls[0].init.redirect,'manual');
    assert.equal(JSON.stringify(result).includes(env.SECOND_LOOK_BACKEND_TOKEN),false);
  });
  await test('every mutation is protected and worker endpoints are unavailable',async()=>{
    calls.length=0;
    for(const [method,url] of [['POST','/api/scouts'],['PATCH','/api/scouts/scout-1'],['DELETE','/api/scouts/scout-1'],['POST','/api/scouts/scout-1/scan'],['POST','/api/scouts/scout-1/restore'],['PATCH','/api/listings/item-1'],['POST','/api/listings/item-1/resale']]) assert.equal((await run(request(method,url,'{}'))).status,401);
    assert.equal((await run(request('POST','/api/worker/tick','{}',authCookie))).status,404);
    assert.equal((await run(request('GET','/api/not-an-app-route'))).status,404);assert.equal(calls.length,0);
  });
  await test('signed session expires and rejects tampering',async()=>{
    assert.equal(verifySession(authCookie,env.SECOND_LOOK_SESSION_SECRET,now),true);
    assert.equal(verifySession(authCookie,env.SECOND_LOOK_SESSION_SECRET,now+43_200_000),false);
    assert.equal(verifySession(authCookie+'x',env.SECOND_LOOK_SESSION_SECRET,now),false);
    assert.equal(verifySession(authCookie,'another-secret-with-at-least-32-chars',now),false);
  });
  await test('login and logout require origin and set protected cookie flags',async()=>{
    assert.deepEqual((await run(request('GET','/api/session'))).body,{canManage:false,loginAvailable:true,publicDemo:false});
    assert.equal((await run(request('POST','/api/session',JSON.stringify({password:'wrong'})))).status,401);
    const result=await run(request('POST','/api/session',JSON.stringify({password:env.SECOND_LOOK_ADMIN_PASSWORD})));
    assert.equal(result.status,200);assert.equal(result.body.canManage,true);
    assert.match(result.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Strict/);
    const evil=request('POST','/api/session',JSON.stringify({password:env.SECOND_LOOK_ADMIN_PASSWORD}));evil.headers.set('origin','https://evil.example');
    assert.equal((await run(evil)).status,403);
    const logout=await run(request('DELETE','/api/session','',authCookie));assert.equal(logout.body.canManage,false);assert.match(logout.headers['Set-Cookie'],/Max-Age=0/);
  });
  await test('authenticated writes use fixed upstream origin and bounded routes',async()=>{
    calls.length=0;
    const result=await run(request('POST','/api/scouts/scout-1/scan','{"continueOnly":true}',authCookie));
    assert.equal(result.status,200);assert.equal(calls[0].init.headers.Origin,env.SECOND_LOOK_BACKEND_URL);
    assert.equal(calls[0].init.body,'{"continueOnly":true}');
    const evil=request('DELETE','/api/scouts/scout-1','',authCookie);evil.headers.set('origin','https://evil.example');
    assert.equal((await run(evil)).status,403);
    assert.equal((await run(request('POST','/api/scouts','x'.repeat(8_193),authCookie))).status,413);
    assert.equal((await run(request('GET','/api/state/../../worker/tick','',authCookie))).status,404);
    assert.equal((await run(request('GET','/api/state','',authCookie))).body.system.demoEmail,'private@example.invalid');
  });
  await test('upstream errors, redirects, missing configuration and timeouts never leak secrets',async()=>{
    for(const response of [new Response(env.SECOND_LOOK_BACKEND_TOKEN,{status:500}),new Response(null,{status:302,headers:{Location:'https://evil.example'}}),new Response('not-json',{status:200})]) {
      const result=await run(request('GET','/api/state'),{fetcher:async()=>response});assert.equal(result.status,502);assert.equal(JSON.stringify(result).includes(env.SECOND_LOOK_BACKEND_TOKEN),false);
    }
    assert.equal((await run(request('GET','/api/state'),{fetcher:async()=>{throw new Error(env.SECOND_LOOK_BACKEND_TOKEN);}})).status,502);
    assert.equal((await run(request('GET','/api/state'),{env:{...env,SECOND_LOOK_BACKEND_URL:'https://evil.example'}})).status,503);
    assert.equal((await run(request('GET','/api/state'),{env:{...env,SECOND_LOOK_BACKEND_TOKEN:''}})).status,503);
    assert.equal((await run(request('POST','/api/session','{}'),{env:{...env,SECOND_LOOK_SESSION_SECRET:''}})).status,401);
  });
  await test('city lookups forward only the bounded query parameter',async()=>{
    calls.length=0;assert.equal((await run(request('GET','/api/locations?q=Chicago%2C%20IL&url=https://evil.example'))).status,200);
    assert.equal(calls[0].url,`${env.SECOND_LOOK_BACKEND_URL}/api/locations?q=Chicago%2C+IL`);
    assert.equal((await run(request('GET',`/api/locations?q=${'a'.repeat(121)}`))).status,400);
  });
  await test('open shared demo permits anonymous management while preserving origin checks and worker isolation',async()=>{
    const openEnv={...env,SECOND_LOOK_DEMO_ACCESS:'open',SECOND_LOOK_ADMIN_PASSWORD:'',SECOND_LOOK_SESSION_SECRET:''};
    assert.deepEqual((await run(request('GET','/api/session'),{env:openEnv})).body,{canManage:true,loginAvailable:false,publicDemo:true});
    const reached=[];
    const openFetcher=async(url,init)=>{reached.push({url:String(url),init});return Response.json({scout:{id:'scout-1',email:'private@example.invalid',lastError:'private provider error'},nested:{demoEmail:'private@example.invalid'}});};
    const routes=[['POST','/api/scouts'],['PATCH','/api/scouts/scout-1'],['DELETE','/api/scouts/scout-1'],['POST','/api/scouts/scout-1/scan'],['POST','/api/scouts/scout-1/restore'],['PATCH','/api/listings/item-1'],['POST','/api/listings/item-1/resale']];
    for(const [method,url] of routes) {
      const result=await run(request(method,url,'{}'),{env:openEnv,fetcher:openFetcher});
      assert.equal(result.status,200);assert.equal(result.body.scout.email,'');assert.equal(result.body.scout.lastError,null);assert.equal(result.body.nested.demoEmail,'');
      assert.equal(JSON.stringify(result).includes('private@example.invalid'),false);
      const evil=request(method,url,'{}');evil.headers.set('origin','https://evil.example');
      assert.equal((await run(evil,{env:openEnv,fetcher:openFetcher})).status,403);
      const missing=request(method,url,'{}');missing.headers.delete('origin');
      assert.equal((await run(missing,{env:openEnv,fetcher:openFetcher})).status,403);
    }
    assert.equal(reached.length,routes.length);
    assert.equal((await run(request('POST','/api/worker/tick','{}'),{env:openEnv,fetcher:openFetcher})).status,404);
    assert.equal(reached.length,routes.length);
    assert.equal((await run(request('POST','/api/scouts','x'.repeat(8_193)),{env:openEnv,fetcher:openFetcher})).status,413);
    assert.equal((await run(request('DELETE','/api/session'),{env:openEnv})).body.canManage,true);
  });
  await test('open demo state stays sanitized even with a valid owner cookie and opening is explicit',async()=>{
    for(const cookie of ['',authCookie]) {
      const result=await run(request('GET','/api/state','',cookie),{env:{...env,SECOND_LOOK_DEMO_ACCESS:'open'}});
      assert.equal(result.body.scouts[0].email,'');assert.equal(result.body.scouts[0].lastError,null);
      assert.deepEqual(result.body.deletedScouts,[]);assert.deepEqual(result.body.activity,[]);assert.equal(result.body.system.demoEmail,'');assert.equal(result.body.system.creditsRemaining,null);
      assert.equal(JSON.stringify(result.body).includes('private@example.invalid'),false);
    }
    for(const setting of [undefined,'','closed','true','OPEN']) assert.equal((await run(request('POST','/api/scouts','{}'),{env:{...env,SECOND_LOOK_DEMO_ACCESS:setting}})).status,401);
    const insecure=request('POST','/api/scouts','{}');insecure.headers.set('origin','http://second-look.vercel.app');
    assert.equal((await run(insecure,{env:{...env,SECOND_LOOK_DEMO_ACCESS:'open'}})).status,403);
  });
  console.log(`All ${checks} Vercel proxy test groups passed.`);
} finally {rmSync(folder,{recursive:true,force:true});}

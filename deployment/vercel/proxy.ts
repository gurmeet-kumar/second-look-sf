import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = '__Host-second-look-admin';
const SESSION_SECONDS = 12 * 60 * 60;
const BODY_LIMIT = 8_192;
const BACKEND_ORIGIN = 'https://second-look-sf-finds.cocoa-trout-0039.chatgpt.site';
const cityCache=new Map<string,{expires:number;data:unknown}>();
type Settings = { backendUrl: string; backendToken: string; adminPassword: string; sessionSecret: string; publicDemo: boolean };
type ProxyRequest = { method: string; url: string; headers: Headers; body: string };
type Result = { status: number; body: unknown; headers?: Record<string,string> };
export type ProxyOptions = { env?: Record<string,string | undefined>; fetcher?: typeof fetch; now?: number };
const reply = (status: number, body: unknown, headers?: Record<string,string>): Result => ({ status, body, headers });
const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());

function settings(env: Record<string,string | undefined>): Settings {
  const raw = env.SECOND_LOOK_BACKEND_URL || BACKEND_ORIGIN;
  const parsed = new URL(raw);
  // A service credential is only valid for this exact private Site. Never send
  // it to a configurable arbitrary host, a redirect, or a URL with credentials.
  if (parsed.origin !== BACKEND_ORIGIN || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) throw new Error('Invalid backend configuration');
  return { backendUrl: parsed.origin, backendToken: env.SECOND_LOOK_BACKEND_TOKEN || '', adminPassword: env.SECOND_LOOK_ADMIN_PASSWORD || '', sessionSecret: env.SECOND_LOOK_SESSION_SECRET || '', publicDemo:env.SECOND_LOOK_DEMO_ACCESS==='open' };
}

function loginAvailable(config: Settings): boolean { return config.adminPassword.length >= 12 && config.sessionSecret.length >= 32; }
function sign(value: string, secret: string): string { return createHmac('sha256',secret).update(value).digest('base64url'); }
export function issueSession(secret: string, now = Date.now()): string {
  const value=Buffer.from(JSON.stringify({v:1,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+SESSION_SECONDS,nonce:randomBytes(18).toString('base64url')})).toString('base64url');
  return `${value}.${sign(value,secret)}`;
}
export function verifySession(cookie: string | null, secret: string, now = Date.now()): boolean {
  if (secret.length < 32 || !cookie || cookie.length > 4_096) return false;
  const token=cookie.split(';').map(part=>part.trim()).find(part=>part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length+1);
  if (!token) return false;
  const [value,signature,...extra]=token.split('.');
  if (!value || !signature || extra.length || !same(signature,sign(value,secret))) return false;
  try {
    const claims=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
    const seconds=Math.floor(now/1000);
    return claims.v===1 && Number.isInteger(claims.iat) && Number.isInteger(claims.exp) && claims.iat<=seconds+30 && claims.exp>seconds && claims.exp-claims.iat===SESSION_SECONDS && typeof claims.nonce==='string';
  } catch { return false; }
}
function cookie(token: string, expires = SESSION_SECONDS): string { return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${expires}`; }
function sameOrigin(request: ProxyRequest): boolean {
  const raw=request.headers.get('origin'); const host=request.headers.get('host');
  if (!raw || !host || host.includes('/') || host.includes(',')) return false;
  try { const origin=new URL(raw); return origin.protocol==='https:' && origin.host===host && origin.origin===raw; } catch { return false; }
}
function pick(value: any, keys: string[]): Record<string,unknown> { const out:Record<string,unknown>={}; for(const key of keys) if(value && value[key]!==undefined) out[key]=value[key]; return out; }
export function sanitizeState(state: any): Record<string,unknown> {
  const scouts=(Array.isArray(state?.scouts)?state.scouts:[]).filter((s:any)=>s.status!=='deleted').map((s:any)=>({...pick(s,['id','query','neighborhood','radiusMiles','location','maxWidthIn','maxDepthIn','maxHeightIn','condition','includeUnknowns','maxAgeHours','status','createdAt','lastCheckAt','lastSuccessAt','nextCheckAt']),email:'',lastError:null}));
  const ids=new Set(scouts.map((s:any)=>s.id));
  const listingKeys=['id','scoutId','url','title','description','price','city','photo','photos','sourceCity','sourceState','cityCheck','firstSeenAt','sourceCreatedAt','decision','sourceDateText','sourceDateObservedAt','freshness','requestedFeatureCheck','reasons','unknowns','questions','evidence','dimensions','brand','model','conditionNote','visualNote','visualStatus','distanceMiles','userState','resale'];
  const listings=(Array.isArray(state?.listings)?state.listings:[]).filter((l:any)=>ids.has(l.scoutId)).map((l:any)=>pick(l,listingKeys));
  const workByScout:Record<string,unknown>={};
  for(const id of ids) if(typeof id==='string' && state?.workByScout?.[id]) workByScout[id]=pick(state.workByScout[id],['pendingJobs','runningJobs','failedJobs','runnableJobs','nextRetryAt']);
  return {scouts,deletedScouts:[],listings,activity:[],workByScout,system:{demoEmail:'',schedulerStatus:state?.system?.schedulerStatus==='Connected'?'Connected':'Not connected',lastWorkerAt:state?.system?.lastWorkerAt||null,creditsRemaining:null,requestsUsed:0,requestBudget:0,modelAvailable:Boolean(state?.system?.modelAvailable)}};
}

function redactDemoResponse(value: unknown): unknown {
  if(Array.isArray(value)) return value.map(redactDemoResponse);
  if(!value || typeof value!=='object') return value;
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='email'||key==='demoEmail'?'':key==='lastError'?null:redactDemoResponse(item)]));
}

function allowedMethods(path: string): string[] | null {
  if(path==='/api/state' || path==='/api/locations') return ['GET'];
  if(path==='/api/scouts') return ['POST'];
  if(/^\/api\/scouts\/[A-Za-z0-9_-]{1,100}$/.test(path)) return ['PATCH','DELETE'];
  if(/^\/api\/scouts\/[A-Za-z0-9_-]{1,100}\/(?:scan|restore)$/.test(path)) return ['POST'];
  if(/^\/api\/listings\/[A-Za-z0-9_-]{1,100}$/.test(path)) return ['PATCH'];
  if(/^\/api\/listings\/[A-Za-z0-9_-]{1,100}\/resale$/.test(path)) return ['POST'];
  return null;
}

export async function handleProxy(request: ProxyRequest, options: ProxyOptions = {}): Promise<Result> {
  let config:Settings;
  try { config=settings(options.env || process.env); } catch { return reply(503,{error:'The demo connection is not configured.'}); }
  const now=options.now ?? Date.now();
  const isOwner=loginAvailable(config) && verifySession(request.headers.get('cookie'),config.sessionSecret,now);
  const publicDemo=config.publicDemo;
  const canManage=publicDemo || isOwner;
  const method=request.method.toUpperCase();
  let url:URL;
  try { url=new URL(request.url,'https://vercel.invalid'); } catch { return reply(400,{error:'Invalid request.'}); }
  const path=url.pathname;
  if (Buffer.byteLength(request.body,'utf8')>BODY_LIMIT) return reply(413,{error:'The request is too large.'});
  if(path==='/api/session') {
    if(method==='GET') return reply(200,{canManage,loginAvailable:!publicDemo && loginAvailable(config),publicDemo});
    if(!['POST','DELETE'].includes(method)) return reply(405,{error:'This action is unavailable.'},{Allow:'GET, POST, DELETE'});
    if(!sameOrigin(request)) return reply(403,{error:'This action must come from the app.'});
    if(method==='DELETE') return reply(200,{canManage:publicDemo,publicDemo},{'Set-Cookie':cookie('',0)});
    if(publicDemo) return reply(200,{canManage:true,publicDemo:true});
    let input:any;
    try { input=JSON.parse(request.body); } catch { return reply(401,{error:'Unable to sign in.'}); }
    if(!loginAvailable(config) || typeof input?.password!=='string' || input.password.length>1024 || !same(input.password,config.adminPassword)) return reply(401,{error:'Unable to sign in.'});
    return reply(200,{canManage:true},{'Set-Cookie':cookie(issueSession(config.sessionSecret,now))});
  }
  const methods=allowedMethods(path);
  if(!methods) return reply(404,{error:'This page is unavailable.'});
  if(!methods.includes(method)) return reply(405,{error:'This action is unavailable.'},{Allow:methods.join(', ')});
  if(method!=='GET') {
    if(!canManage) return reply(401,{error:'Sign in as the demo owner to make changes.'});
    if(!sameOrigin(request)) return reply(403,{error:'This action must come from the app.'});
  }
  if(!config.backendToken) return reply(503,{error:'The demo connection is not configured.'});
  const upstream=new URL(path,config.backendUrl);
  let cityCacheKey:string | null=null;
  if(path==='/api/locations') {
    const query=url.searchParams.get('q') || '';
    if(query.length>120) return reply(400,{error:'Try a shorter city name.'});
    upstream.searchParams.set('q',query);
    cityCacheKey=upstream.toString();
    const cached=cityCache.get(cityCacheKey);
    if(cached && cached.expires>now) return reply(200,cached.data);
  }
  const headers:Record<string,string>={'OAI-Sites-Authorization':`Bearer ${config.backendToken}`,'Content-Type':'application/json',Accept:'application/json'};
  if(method!=='GET') headers.Origin=config.backendUrl;
  try {
    const response=await (options.fetcher || fetch)(upstream,{method,headers,...(method!=='GET'?{body:request.body||'{}'}:{}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(path==='/api/locations'?10_000:55_000)});
    if(response.status>=300 && response.status<400) return reply(502,{error:'The demo connection could not be verified.'});
    if(!response.ok) return reply(response.status===404?404:response.status===429?429:502,{error:response.status===429?'The service is busy. Please try again shortly.':'The requested action could not complete. Please try again.'});
    const text=await response.text();
    if(Buffer.byteLength(text,'utf8')>3_000_000) return reply(502,{error:'The service returned an unexpected response.'});
    let data:unknown;
    try { data=JSON.parse(text); } catch { return reply(502,{error:'The service returned an unexpected response.'}); }
    if(cityCacheKey) {
      if(cityCache.size>=100) cityCache.delete(cityCache.keys().next().value!);
      cityCache.set(cityCacheKey,{expires:now+60_000,data});
    }
    const output=path==='/api/state' && (publicDemo || !isOwner)?sanitizeState(data):publicDemo?redactDemoResponse(data):data;
    return reply(response.status,output);
  } catch { return reply(502,{error:'The demo connection took too long. Please try again.'}); }
}

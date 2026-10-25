import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleProxy } from '../deployment/vercel/proxy.js';

export const config = { maxDuration: 60 };

type ApiRequest = IncomingMessage & {body?:unknown;query?:Record<string,string | string[] | undefined>};

export function requestUrl(request: Pick<ApiRequest,'url'|'query'>): string | null {
  const parsed=new URL(request.url||'/', 'https://vercel.invalid');
  const captures=parsed.searchParams.getAll('__second_look_path');
  const capture=request.query?.__second_look_path ?? (captures.length===1?captures[0]:undefined);
  if(typeof capture!=='string' || capture.length>400 || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(capture) || capture==='proxy') return null;
  const result=new URL(`/api/${capture}`,'https://vercel.invalid');
  if(capture==='locations') {
    const q=request.query?.q ?? parsed.searchParams.get('q');
    if(Array.isArray(q)) return null;
    if(q) result.searchParams.set('q',q);
  }
  return result.pathname+result.search;
}

export default async function handler(request: ApiRequest, response: ServerResponse) {
  response.setHeader('Cache-Control','no-store');
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Content-Type','application/json; charset=utf-8');
  try {
    const url=requestUrl(request);
    if(!url) { response.statusCode=404; response.end(JSON.stringify({error:'This page is unavailable.'})); return; }
    const headers=new Headers();
    for(const [key,value] of Object.entries(request.headers)) if(value!==undefined) headers.set(key,Array.isArray(value)?value.join(', '):value);
    let body='';
    if(request.body!==undefined) body=typeof request.body==='string'?request.body:Buffer.isBuffer(request.body)?request.body.toString('utf8'):JSON.stringify(request.body);
    else if(!['GET','HEAD'].includes(request.method||'GET')) {
      for await(const chunk of request) {
        body+=Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk);
        if(Buffer.byteLength(body,'utf8')>8_192) { response.statusCode=413; response.end(JSON.stringify({error:'The request is too large.'})); return; }
      }
    }
    const result=await handleProxy({method:request.method||'GET',url,headers,body});
    response.statusCode=result.status;
    for(const [key,value] of Object.entries(result.headers||{})) response.setHeader(key,value);
    response.end(JSON.stringify(result.body));
  } catch {
    response.statusCode=500;
    response.end(JSON.stringify({error:'The demo could not complete this request.'}));
  }
}

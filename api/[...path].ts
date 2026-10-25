import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleProxy } from '../deployment/vercel/proxy';

export const config = { maxDuration: 60 };

export default async function handler(request: IncomingMessage & {body?:unknown}, response: ServerResponse) {
  response.setHeader('Cache-Control','no-store');
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Content-Type','application/json; charset=utf-8');
  try {
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
    const result=await handleProxy({method:request.method||'GET',url:request.url||'/',headers,body});
    response.statusCode=result.status;
    for(const [key,value] of Object.entries(result.headers||{})) response.setHeader(key,value);
    response.end(JSON.stringify(result.body));
  } catch {
    response.statusCode=500;
    response.end(JSON.stringify({error:'The demo could not complete this request.'}));
  }
}

import { env } from 'cloudflare:workers';
import { getSetting, incrementSetting, setSetting } from './store';
import { SCREENING_SCHEMA, buildScreeningPrompt, parseScreeningFacts, type ScreeningFacts } from './screening';
import { type Listing, type RawItem, type Scout } from './types';
import { MARKETPLACE_RETRIEVAL_MILES, scoutCenter } from './location';
import { DEFAULT_MAX_AGE_HOURS, sourcePostedAt } from './freshness';

export class ProviderError extends Error {
  constructor(message: string, public retryAfterMs = 60_000, public status = 500) { super(message); }
}
const runtime = env as Cloudflare.Env & { SITE_URL?: string };
export const siteOrigin = () => runtime.SITE_URL || 'https://second-look-sf-finds.cocoa-trout-0039.chatgpt.site';
function cleanError(text: string) {
  let safe = text;
  for (const value of [env.OPENAI_API_KEY, env.GROQ_API_KEY, env.RESEND_API_KEY, env.SCRAPECREATORS_API_KEY, env.APP_WORKER_SECRET]) if (value) safe = safe.replaceAll(value, '[hidden]');
  return safe.slice(0, 400);
}
async function api(url: string, init: RequestInit, timeout = 12_000): Promise<Record<string, any>> {
  let response: Response;
  try { response = await fetch(url, { ...init, headers: { 'User-Agent': 'SecondLook/1.0', ...init.headers }, signal: AbortSignal.timeout(timeout) }); }
  catch { throw new ProviderError('The data service did not respond in time. The scout will retry.'); }
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    const delay = Math.max(60_000, Math.min(86_400_000, Number(response.headers.get('retry-after') || 60) * 1000));
    throw new ProviderError(cleanError(body.error?.message || body.message || `Data service returned ${response.status}.`), delay, response.status);
  }
  return body;
}

async function scrape(path: string, params: Record<string, string>): Promise<Record<string, any>> {
  if (!env.SCRAPECREATORS_API_KEY) throw new ProviderError('Marketplace access has not been configured.');
  const day = new Date().toISOString().slice(0,10);
  if (await getSetting<string>('requests_day') !== day) { await setSetting('requests_day',day); await setSetting('requests_used',0); }
  const used = await getSetting<number>('requests_used', 0) ?? 0;
  const budget = await getSetting<number>('request_budget', 200) ?? 200;
  if (used >= budget) throw new ProviderError('The daily Marketplace request budget has been reached. Checks resume tomorrow; existing finds remain available.', 86_400_000, 402);
  await incrementSetting('requests_used');
  const result = await api(`https://api.scrapecreators.com/v1/facebook/marketplace/${path}?${new URLSearchParams(params)}`, { headers: { 'x-api-key': env.SCRAPECREATORS_API_KEY } });
  if (typeof result.credits_remaining === 'number') await setSetting('credits_remaining', result.credits_remaining);
  if (result.success === false) throw new ProviderError('Marketplace could not complete this check.');
  return result;
}
export async function searchItems(scout: Scout, paid = false, query = scout.query): Promise<RawItem[]> {
  const center = scoutCenter(scout);
  if (!center) throw new ProviderError('This scout needs a valid U.S. city. Edit its location before running another check.', 60_000, 400);
  // Live checks found source newest-first displaced genuine recent matches with
  // unrelated recommendations. Ask for the date window with relevance ordering,
  // then independently verify age and sort the returned source dates ourselves.
  const ageHours=scout.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const result = await scrape('search', { query, lat: String(center.lat), lng: String(center.lng), radius_km: String(Math.ceil((paid ? 25 : MARKETPLACE_RETRIEVAL_MILES) * 1.609344)), sort_by: 'suggested', availability: 'available', delivery_method: 'local_pickup', ...(paid ? { min_price: '1' } : { max_price: '0',date_listed:String(ageHours===720?30:ageHours===168?7:1) }) });
  const listings:RawItem[]=(Array.isArray(result.listings) ? result.listings : []).filter((x: RawItem) => x?.id && x?.title).slice(0, 30).map((item:RawItem)=>({...item,...(item.listing_date_text?{source_date_observed_at:new Date().toISOString()}:{})}));
  return paid?listings:listings.sort((a,b)=>(Date.parse(sourcePostedAt(b.creation_time)||'')||0)-(Date.parse(sourcePostedAt(a.creation_time)||'')||0));
}
export async function itemDetails(id: string): Promise<RawItem> {
  const item=await scrape('item', { id }) as RawItem;
  return {...item,...(item.listing_date_text?{source_date_observed_at:new Date().toISOString()}:{})};
}

export async function screenItem(scout: Scout, item: RawItem): Promise<{ facts: ScreeningFacts; visualStatus: Listing['visualStatus'] }> {
  if (env.OPENAI_API_KEY) return screenWithOpenAI(scout, item);
  if (!env.GROQ_API_KEY) throw new ProviderError('AI screening has not been configured.');
  const next = await getSetting<number>('model_next_at', 0) ?? 0;
  if (next > Date.now()) throw new ProviderError('AI screening is queued within the free account limits.', next - Date.now(), 429);
  const imageFailed = await getSetting<boolean>(`image_unavailable:${item.id}`,false);
  const photo = imageFailed ? undefined : item.photos?.[0]?.url || item.primary_photo?.url;
  const content: any[] = [{ type: 'text', text: buildScreeningPrompt(scout, item) }];
  if (photo?.startsWith('https://')) content.push({ type: 'image_url', image_url: { url: photo } });
  // Limit a demo free account to one new assessment per minute; jobs persist between runs.
  await setSetting('model_next_at', Date.now() + 60_000);
  const request = (withImage: boolean) => api('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.GROQ_MODEL || 'qwen/qwen3.8-27b', messages: [{ role: 'user', content: withImage ? content : content.slice(0, 1) }], reasoning_effort: 'none', max_completion_tokens: 1600, temperature: 0.1, response_format: { type: 'json_schema', json_schema: { name: 'marketplace_assessment', strict: true, schema: SCREENING_SCHEMA } } }),
  });
  let response: Record<string, any>; let visualStatus: Listing['visualStatus'] = content.length > 1 ? 'assessed' : imageFailed ? 'unavailable' : 'not_requested';
  try { response = await request(content.length > 1); }
  catch (error) {
    if (content.length > 1 && error instanceof ProviderError && [400, 413, 422].includes(error.status)) { await setSetting(`image_unavailable:${item.id}`,true); throw new ProviderError('The photo could not be assessed. Text screening is queued for retry.',1_000,422); }
    else { await setSetting('model_available', false); throw error; }
  }
  const choice = response.choices?.[0];
  if (choice?.finish_reason === 'length') throw new ProviderError('The assessment was incomplete. It will be retried.');
  let facts: ScreeningFacts;
  try { facts = parseScreeningFacts(JSON.parse(choice?.message?.content || 'null')); }
  catch { throw new ProviderError('The AI assessment could not be validated. It will be retried.'); }
  await setSetting('model_available', true);
  if (response.usage?.total_tokens) await incrementSetting('model_tokens_used', response.usage.total_tokens);
  return { facts, visualStatus };
}

async function screenWithOpenAI(scout: Scout, item: RawItem): Promise<{ facts: ScreeningFacts; visualStatus: Listing['visualStatus'] }> {
  const estimatedSpent = (await getSetting<number>('openai_cost_microusd',0) ?? 0) / 1_000_000;
  if (estimatedSpent >= 3) throw new ProviderError('The $3 demo AI usage limit has been reached. Your existing finds remain available.', 86_400_000, 402);
  const imageFailed = await getSetting<boolean>(`image_unavailable:${item.id}`,false);
  const photo = imageFailed ? undefined : item.photos?.[0]?.url || item.primary_photo?.url;
  const content: any[] = [{ type: 'input_text', text: buildScreeningPrompt(scout, item) }];
  if (photo?.startsWith('https://')) content.push({ type: 'input_image', image_url: photo, detail: 'low' });
  const request = (withImage: boolean) => api('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-5.4-mini', store: false, input: [{ role: 'user', content: withImage ? content : content.slice(0, 1) }], reasoning: { effort: 'none' }, max_output_tokens: 2200, text: { format: { type: 'json_schema', name: 'marketplace_assessment', strict: true, schema: SCREENING_SCHEMA } } }),
  }, 12_000);
  let response: Record<string, any>; let visualStatus: Listing['visualStatus'] = content.length > 1 ? 'assessed' : imageFailed ? 'unavailable' : 'not_requested';
  try { response = await request(content.length > 1); }
  catch (error) {
    if (content.length > 1 && error instanceof ProviderError && [400, 413, 422].includes(error.status)) { await setSetting(`image_unavailable:${item.id}`,true); throw new ProviderError('The photo could not be assessed. Text screening is queued for retry.',1_000,422); }
    else { await setSetting('model_available', false); throw error; }
  }
  if (response.status !== 'completed') throw new ProviderError('The assessment was incomplete. It will be retried.');
  const text = (response.output || []).flatMap((entry: any) => entry.content || []).filter((entry: any) => entry.type === 'output_text').map((entry: any) => entry.text).join('');
  let facts: ScreeningFacts;
  try { facts = parseScreeningFacts(JSON.parse(text)); } catch { throw new ProviderError('The AI assessment could not be validated. It will be retried.'); }
  const usage = response.usage;
  if (usage) {
    await incrementSetting('model_tokens_used', usage.total_tokens || 0);
    await storeEstimatedCost((usage.input_tokens || 0) * 0.75 / 1_000_000 + (usage.output_tokens || 0) * 4.5 / 1_000_000);
  }
  await setSetting('model_available', true);
  return { facts, visualStatus };
}
async function storeEstimatedCost(amount: number) {
  const microDollars = await incrementSetting('openai_cost_microusd', Math.ceil(amount * 1_000_000));
  await setSetting('openai_cost_usd', microDollars / 1_000_000);
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export async function sendFindEmail(scout: Scout, listing: Listing, alertId: string): Promise<string> {
  if (!env.RESEND_API_KEY || !env.DEMO_EMAIL) throw new ProviderError('Email delivery has not been configured.');
  const appUrl = `${siteOrigin()}/?scout=${encodeURIComponent(scout.id)}&item=${encodeURIComponent(listing.id)}`;
  const label = listing.decision === 'strong_fit' ? 'Strong fit' : 'Needs checking';
  const reasons = listing.reasons.slice(0, 3).join(' ');
  const unknowns = listing.unknowns.join(' ');
  const posted=listing.sourceCreatedAt ? `Posted ${new Date(listing.sourceCreatedAt).toLocaleString('en-US',{timeZone:'America/Los_Angeles',dateStyle:'medium',timeStyle:'short'})} Pacific` : listing.sourceDateText ? `Marketplace says: ${listing.sourceDateText}` : 'Posting date unavailable';
  const advertised=listing.price===0?'Listed at $0':listing.price===null?'Price unavailable':`Listed at $${listing.price}`;
  const text = `${label}: ${listing.title}\n${advertised} · ${listing.city}\n${posted}\n\n${reasons}\n${unknowns ? `Still to check: ${unknowns}\n` : ''}\nReview: ${appUrl}\nFacebook: ${listing.url}\n\nPause this scout in the app to stop alerts. Seller claims and availability are not independently verified.`;
  const response = await api('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `second-look/${alertId}` }, body: JSON.stringify({ from: 'Second Look <onboarding@resend.dev>', to: [env.DEMO_EMAIL], subject: `${label}: a recent ${scout.query} worth a second look`, text, html: `<div style="background:#f7f6f1;padding:32px;font-family:Arial,sans-serif;color:#202620"><div style="max-width:520px;margin:auto;background:white;padding:28px;border-radius:18px"><p style="color:#285744;font-weight:bold;letter-spacing:2px">SECOND LOOK.</p><h1 style="font-size:25px">${escapeHtml(listing.title)}</h1><p><b>${escapeHtml(advertised)}</b> · ${escapeHtml(listing.city)} · ${label}</p><p>${escapeHtml(posted)}</p><p>${escapeHtml(reasons)}</p>${unknowns ? `<p style="background:#fff3dd;padding:14px">Still to check: ${escapeHtml(unknowns)}</p>` : ''}<p><a style="display:inline-block;background:#285744;color:white;padding:13px 20px;text-decoration:none;border-radius:10px" href="${appUrl}">Review this find</a></p><p><a href="${escapeHtml(listing.url)}">Open the original Facebook listing</a></p><hr style="border:0;border-top:1px solid #eee"/><p style="font-size:12px;color:#67716a">Seller claims and availability are not independently verified. Pause your scout in the app to stop alerts.</p></div></div>` }) });
  if (!response.id) throw new ProviderError('The email service did not confirm acceptance.');
  return response.id as string;
}

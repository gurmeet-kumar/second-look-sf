import { env } from 'cloudflare:workers';
import { ProviderError, itemDetails, screenItem, searchItems, sendFindEmail } from './providers';
import { evaluate } from './screening';
import { applyFreshness, sourcePostedAt } from './freshness';
import { applyRequirementChecks } from './requirements';
import { applyCityScope, needsCityRecheck, searchScopeKey, sourceCityMetadata } from './location';
import { comparableListings, resalePlans, resaleReference, usableResaleCache } from './resale';
import * as store from './store';
import { type Job, type Listing, type RawItem, type ResaleReference, type Scout } from './types';

const nowIso = () => new Date().toISOString();
function listingFrom(scout: Scout, item: RawItem): Listing {
  return { id: item.id, scoutId: scout.id, url: `https://www.facebook.com/marketplace/item/${encodeURIComponent(item.id)}/`, title: item.title, description: item.description || '', price: typeof item.price?.amount === 'number' ? item.price.amount : null, city: item.location_text || item.location?.display_name || item.location?.city || 'Location needs checking', photo: item.photos?.[0]?.url || item.primary_photo?.url || null, photos: item.photos?.map(p => p.url).filter(Boolean) || (item.primary_photo?.url ? [item.primary_photo.url] : []), firstSeenAt: nowIso(), ...sourceMetadata(item), decision: 'pending', reasons: [], unknowns: [], questions: [], evidence: [], dimensions: { widthIn: null, depthIn: null, heightIn: null }, brand: null, model: null, conditionNote: null, visualNote: null, visualStatus: 'not_requested', distanceMiles: null, userState: 'new', resale: null };
}
function sourceMetadata(item:RawItem,fallback?:Listing):Pick<Listing,'sourceCreatedAt'|'sourceDateText'|'sourceDateObservedAt'|'sourceCity'|'sourceState'> {
  const sourceDateText=item.listing_date_text || fallback?.sourceDateText || null;
  return {...sourceCityMetadata(item),sourceCreatedAt:sourcePostedAt(item.creation_time)||fallback?.sourceCreatedAt||null,sourceDateText,sourceDateObservedAt:item.source_date_observed_at || (item.listing_date_text?nowIso():fallback?.sourceDateObservedAt)||null};
}
const canAlert=(listing:Listing,scout:Scout)=>listing.freshness?.status==='recent' && listing.cityCheck?.status==='matches' && !needsCityRecheck(listing) && (listing.decision==='strong_fit'||listing.decision==='needs_checking'&&scout.includeUnknowns);
async function queueEligibleAlert(scout:Scout,listing:Listing) {
  // Recheck age before reserving an alert; includeUnknowns never bypasses an
  // unverified posting date. Date policy is separate from item-fit assessment.
  const latest=await store.getScout(scout.id);
  if(!latest || latest.status!=='active' || searchScopeKey(latest)!==searchScopeKey(scout) || !canAlert(applyFreshness(applyRequirementChecks(applyCityScope(listing,latest),latest),latest.maxAgeHours),latest)) return;
  const alert=await store.reserveAlert(scout.id,listing.id)||await store.getAlert(scout.id,listing.id);
  if(alert?.status==='pending') await store.addJob({scoutId:scout.id,itemId:listing.id,stage:'email',payload:{itemId:listing.id},restartDone:true});
}
function obviousFailure(item: RawItem): string | null {
  return obviousFailures(item)[0] || null;
}
function obviousFailures(item: RawItem): string[] {
  const reasons: string[]=[];
  if (typeof item.price?.amount === 'number' && item.price.amount !== 0) reasons.push('The listing is not free.');
  if (item.is_sold || item.is_pending || item.is_hidden || item.is_live === false) reasons.push('The listing is unavailable or pending.');
  return reasons;
}
const itemCategories = [
  /\b(?:desks?|workstations?|standing tables?|sit[- ]stand)\b/i,
  /\b(?:chairs?|stools?|seating)\b/i,
  /\b(?:monitors?|computer displays?|computer screens?)\b/i,
  /\b(?:sofas?|couches|couch|loveseats?)\b/i,
  /\b(?:shel(?:f|ves|ving)|bookcases?|bookshelves)\b/i,
  /\b(?:beds?|mattresses?|mattress)\b/i,
  /\b(?:bicycles?|bikes?)\b/i,
  /\b(?:printers?|scanners?)\b/i,
  /\b(?:televisions?|tvs?)\b/i,
  /\b(?:refrigerators?|fridges?|freezers?)\b/i,
];
function clearTitleMismatch(scout: Scout, item: RawItem): string | null {
  const wanted = itemCategories.filter(category => category.test(scout.query));
  if (wanted.length !== 1 || wanted[0].test(item.title)) return null;
  // Vague bundles and descriptions can include the requested item. Only skip
  // a title explicitly naming one different, recognized item category.
  if (/\b(?:moving|sale|bundle|lot|assorted|various|furniture|household|everything|items|stuff|and)\b|[+&/]/i.test(item.title)) return null;
  const named = itemCategories.filter(category => category.test(item.title));
  return named.length === 1 ? `The title explicitly describes a different item: ${item.title}.` : null;
}
function cheapAssessment(scout: Scout, item: RawItem, listing: Listing): Listing {
  const failures=obviousFailures(item);
  const wrongType=clearTitleMismatch(scout,item);
  if(wrongType) failures.push(wrongType);
  const checked=applyRequirementChecks(applyCityScope({...listing,...sourceCityMetadata(item),...(failures.length?{decision:'rejected' as const,reasons:[...new Set([...listing.reasons,...failures])]}:{})},scout),scout);
  return checked;
}
async function scan(scout: Scout) {
  const items = await searchItems(scout);
  const latest = await store.getScout(scout.id);
  if (latest?.status !== 'active' || searchScopeKey(latest)!==searchScopeKey(scout)) return;
  const priority = (item:RawItem) => Number(applyCityScope(listingFrom(scout,item),scout).cityCheck?.status==='matches')*10 - Number(Boolean(obviousFailure(item)||clearTitleMismatch(scout,item)))*100 + Number(itemCategories.some(category=>category.test(scout.query)&&category.test(item.title)))*3;
  items.sort((a,b)=>priority(b)-priority(a));
  const existingMatches=await store.getMatchesForItems(scout.id,items.map(item=>item.id));
  const candidates:{item:RawItem;listing:Listing;queue:boolean;refreshOnly?:boolean}[]=[];
  let queued = 0;
  for (const item of items) {
    const existing = existingMatches.get(item.id);
    if (existing) {
      const listing=cheapAssessment(scout,item,{...existing,...sourceMetadata(item,existing)});
      const queue=(listing.decision==='pending'||needsCityRecheck(listing)) && listing.decision!=='rejected' && applyFreshness(listing,scout.maxAgeHours).freshness?.status!=='older';
      candidates.push({item,listing,queue,refreshOnly:listing.decision!=='rejected'});
      if(queue)queued++;
      continue;
    }
    const listing=cheapAssessment(scout,item,listingFrom(scout,item));
    const queue=listing.decision!=='rejected'&&applyFreshness(listing,scout.maxAgeHours).freshness?.status!=='older';
    candidates.push({item,listing,queue});
    if(queue) queued++;
  }
  await store.saveSearchCandidates(scout.id,candidates);
  for(const candidate of candidates) if(candidate.refreshOnly && candidate.listing.decision!=='pending') await queueEligibleAlert(scout,candidate.listing);
  await store.updateScout(scout.id, { lastSuccessAt: nowIso(), lastError: null });
  await store.addActivity(scout.id, 'search_complete', items.length ? `Checked ${items.length} listings; ${queued} new candidates queued for details.` : 'Search completed. No matching listings returned this time.');
}

async function processJob(job: Job) {
  const scout = await store.getScout(job.scoutId);
  if (!scout || scout.status !== 'active' || !await store.ownsJobLease(job)) return;
  const payload = JSON.parse(job.payload) as { itemId: string };
  const itemId = job.itemId || payload.itemId;
  const current = await store.getMatch(scout.id, itemId);
  if (!current) return;
  // Known-old search metadata is enough to stop before an item or model call.
  // Keep the base assessment untouched so widening the window can restore it.
  if(applyFreshness(applyRequirementChecks(current,scout),scout.maxAgeHours).freshness?.status==='older') return;
  const continueAfterFetch = async () => {
    const latest = await store.getScout(scout.id);
    if (!latest || searchScopeKey(latest)!==searchScopeKey(scout)) return false;
    if (latest.status !== 'active') throw new ProviderError('Scout paused. Pending work will continue after you resume it.',1_000,429);
    return store.ownsJobLease(job);
  };
  if (job.stage === 'detail') {
    const details = await itemDetails(itemId);
    if (!await continueAfterFetch()) return;
    await store.putItem(details);
    const item=await store.getItem(itemId)||details;
    const detailed=await store.upsertMatch(scout.id, itemId, cheapAssessment(scout,item,{ ...listingFrom(scout, item), ...sourceMetadata(item,current), userState: current.userState, firstSeenAt: current.firstSeenAt }));
    if(detailed.decision==='rejected') return;
    if(applyFreshness(detailed,scout.maxAgeHours).freshness?.status==='older') return;
    await store.addJob({ scoutId: scout.id, itemId, stage: 'screen', payload: { itemId } });
  } else if (job.stage === 'screen') {
    const item = await store.getItem(itemId);
    if (!item) throw new Error('Item details are missing.');
    const checked=cheapAssessment(scout,item,{...current,...sourceMetadata(item,current)});
    if(checked.decision==='rejected') { await store.upsertMatch(scout.id,itemId,checked); return; }
    if(applyFreshness(checked,scout.maxAgeHours).freshness?.status==='older')return;
    const { facts, visualStatus } = await screenItem(scout, item);
    if (!await continueAfterFetch()) return;
    await store.setSetting(`facts:${scout.id}:${itemId}`, { facts, visualStatus });
    const result = await store.upsertMatch(scout.id, itemId, evaluate(scout, item, facts, visualStatus));
    await store.addActivity(scout.id, 'screening_complete', `${result.decision === 'strong_fit' ? 'Strong fit' : result.decision === 'needs_checking' ? 'Needs checking' : 'Filtered out'}: ${item.title}`);
    await queueEligibleAlert(scout,result);
  } else if (job.stage === 'email') {
    const alert = await store.getAlert(scout.id, itemId);
    if (!alert || alert.status !== 'pending' || current.userState === 'dismissed') return;
    if (Date.now()-Date.parse(alert.createdAt)>23*60*60*1000) {
      await store.markAlert(alert.id,'failed',null,'This alert is stale or its earlier delivery is uncertain. Check the inbox before retrying.');
      await store.addActivity(scout.id,'email_stale','Skipped an old alert; check its listing and your inbox before retrying.'); return;
    }
    const latestScout=await store.getScout(scout.id);
    const latestMatch=await store.getMatch(scout.id,itemId);
    if(!latestScout || latestScout.status!=='active' || !latestMatch || !await store.ownsJobLease(job))return;
    const eligible=applyFreshness(applyRequirementChecks(applyCityScope(latestMatch,latestScout),latestScout),latestScout.maxAgeHours);
    if(!canAlert(eligible,latestScout))return;
    const id = await sendFindEmail(latestScout, eligible, alert.id);
    await store.markAlert(alert.id, 'sent', id);
    await store.addActivity(scout.id, 'email_accepted', `Email accepted by the provider: ${current.title}`);
  }
}

export async function tick(options: { forceScoutId?: string; scheduled?: boolean; continueOnly?: boolean } = {}): Promise<{ message: string; processed: number; pending: number; progress?: store.WorkSummary; timing: { elapsedMs: number; searchMs: number; processedStages: number } }> {
  const started = Date.now();
  await store.setSetting('last_worker_at', nowIso());
  if (options.scheduled) {
    await store.setSetting('scheduler_status', 'Connected');
  }
  if (options.forceScoutId) await store.advanceScoutJobs(options.forceScoutId,!options.continueOnly);
  const candidates = options.continueOnly ? [] : options.forceScoutId ? [await store.getScout(options.forceScoutId)].filter(Boolean) as Scout[] : await store.dueScouts();
  let processed = 0; let searchMs = 0; let processedStages = 0;
  for (const candidate of candidates.slice(0, 1)) {
    // Manual checks drain pending work before performing another paid search.
    if (options.forceScoutId && await store.countPendingJobs(options.forceScoutId) > 0) break;
    const scout = await store.claimScout(candidate.id, Boolean(options.forceScoutId));
    if (!scout || scout.status !== 'active') continue;
    const searchStarted = Date.now();
    try { await scan(scout); processed++; }
    catch (error) {
      const message = error instanceof Error ? error.message : 'The search was interrupted.';
      await store.updateScout(scout.id, { lastError: message });
      await store.addActivity(scout.id, 'search_error', message);
    }
    searchMs += Date.now()-searchStarted;
  }
  let claimed = 0; let rateLimited = false;
  // Each provider call times out within 12s. Stop starting waves after 12.5s,
  // leaving time for the final wave and database writes before a 28s cron limit.
  while (claimed < 12 && Date.now()-started < 12_500 && !rateLimited) {
    const jobs: Job[] = [];
    for (let index=0; index<3 && claimed<12; index++) {
      const job = await store.claimJob(Date.now(),options.forceScoutId);
      if (!job) break;
      jobs.push(job); claimed++;
    }
    if (!jobs.length) break;
    await Promise.all(jobs.map(async job => {
      try { await processJob(job); await store.completeJob(job); processed++; processedStages++; }
      catch (error) {
        const message = error instanceof Error ? error.message : 'Screening was interrupted.';
        const unavailableDetail=job.stage==='detail' && error instanceof ProviderError && (error.status===404 || /(?:item|listing).{0,50}(?:no longer available|not found|has been removed|has been deleted)/i.test(message));
        if(unavailableDetail && await store.ownsJobLease(job)) {
          const payload=JSON.parse(job.payload) as {itemId:string};
          await store.upsertMatch(job.scoutId,job.itemId||payload.itemId,{decision:'rejected',reasons:['The original Marketplace listing is no longer available.']});
          await store.completeJob(job); processed++; processedStages++;
          await store.addActivity(job.scoutId,'listing_unavailable','A listing is no longer available; removed it from the screening queue.');
          return;
        }
        await store.retryJob(job,message,error instanceof ProviderError ? error.retryAfterMs : 60_000);
        if (!(error instanceof ProviderError && error.status===429)) await store.addActivity(job.scoutId,job.attempts>=5?'job_failed':'job_retry',`${message} ${job.attempts>=5?'Use Check now to retry interrupted work.':'Retrying later.'}`);
        if (error instanceof ProviderError && error.status===429) rateLimited=true;
      }
    }));
  }
  const pending = await store.countPendingJobs(options.forceScoutId);
  const progress = options.forceScoutId ? await store.getWorkSummary(options.forceScoutId) : undefined;
  const timing = { elapsedMs:Date.now()-started,searchMs,processedStages };
  const message = progress?.runningJobs ? 'This scout is processing listings.' : progress && !progress.runnableJobs && progress.pendingJobs ? 'This scout is waiting for a provider retry; its progress is saved.' : pending ? `${pending} screening or alert tasks are queued for this scout.` : 'Check complete.';
  return { message,processed,pending,progress,timing };
}

export async function resale(scoutId: string, itemId: string, options: { forceRefresh?: boolean } = {}): Promise<ResaleReference> {
  const scout = await store.getScout(scoutId); const listing = await store.getMatch(scoutId, itemId);
  if (!scout || !listing) throw new Error('This find is unavailable.');
  if (!options.forceRefresh && usableResaleCache(listing.resale)) return listing.resale;
  const plans = resalePlans(listing);
  let result = resaleReference(null, []);
  const candidates: RawItem[] = [];
  // One exact search and, only when needed, one conservative category fallback.
  // Generic items use just the category search; none of these searches call AI.
  for (const plan of plans.slice(0, 2)) {
    let batch: RawItem[];
    // Asking-price research covers the SF market independently of the user's
    // pickup radius. The matcher still requires an explicit San Francisco city.
    try { batch = await searchItems({ ...scout, location: undefined, neighborhood: 'San Francisco', radiusMiles: 25 }, true, plan.query); }
    catch (error) {
      if (!candidates.length) throw error;
      result = { ...result, note: `${result.note} The additional comparison search could not complete; try again later.` };
      break;
    }
    candidates.push(...batch);
    const reference = resaleReference(plan, comparableListings(listing, candidates, plan));
    // Preserve stronger exact partial evidence when the fallback finds less.
    if (reference.status === 'ready' || reference.count > result.count || !result.basis || result.count === 0 && reference.basis === 'similar_items') result = reference;
    if (result.status === 'ready') break;
  }
  await store.upsertMatch(scoutId, itemId, { resale: result });
  await store.addActivity(scoutId, 'resale_checked', result.status === 'ready' ? `Checked ${result.count} ${result.basis === 'similar_items' ? 'similar-item' : 'brand/model'} asking prices.` : `Found ${result.count} qualifying comparison${result.count === 1 ? '' : 's'}; at least three are needed for a range.`);
  return result;
}

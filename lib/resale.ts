import { sourcePostedAt } from './freshness';
import type { Comparable, Listing, RawItem, ResaleReference } from './types';

const DAY = 86_400_000;
export const COMPARABLE_MAX_AGE_DAYS = 30;
type Category = 'executive_chair' | 'ergonomic_chair' | 'office_chair' | 'gaming_chair' | 'desk_riser' | 'electric_desk' | 'manual_desk' | 'standing_desk' | 'desk' | 'monitor';
export type ResalePlan = { query: string; basis: 'exact_model' | 'similar_items'; category?: Category; sizeIn?: number; brand?: string; model?: string };

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) || [];
const clean = (value: string | null) => value?.trim() && !/^(?:unknown|none|n\/?a|generic|unbranded|not identified)$/i.test(value.trim()) ? value.trim() : null;
const bundle = (text: string) => /\b(?:bundle|pair|set of|lot of|assorted|various|moving sale|chairs|desks|monitors)\b|\b(?:[2-9]|\d{2,})\s+(?:(?:office|gaming|executive|desk|dining)\s+)?(?:chairs|desks|monitors)\b|\b\d+\s+available\b|\b(?:chairs?.{0,25}(?:and|\+|&).{0,25}(?:tables?|desks?)|(?:tables?|desks?).{0,25}(?:and|\+|&).{0,25}chairs?)\b/i.test(text);
const accessoryOrFault = (text: string) => /\b(?:parts? only|for parts|for repair|repair project|needs? (?:repair|fixing)|broken|not working|does(?:n't| not) work|damaged|cracked|missing (?:parts?|pieces?|legs?|base|screen)|accessor(?:y|ies)|box only|stand only|frame only|legs only|top only|base only|cables? only|monitor arms?|chair mats?|chair covers?|seat cushions?|gas cylinders?|replacement (?:parts?|arms?|wheels?|legs?|screen)|desk (?:legs|frame|top) only)\b/i.test(text);
// A component as the title's head noun is different from a complete item
// advertising a feature, such as "chair with adjustable headrest".
const componentTitle = (text: string) => /\bchairs?\s+(?:replacement\s+)?(?:wheels?|casters?|armrests?|headrests?|(?:gas\s+)?cylinders?|bases?|covers?|cushions?)\b|\bdesks?\s+(?:replacement\s+)?(?:legs?|frames?|tops?)\b|\bmonitors?\s+(?:replacement\s+)?(?:stands?|arms?|bases?|screen protectors?)\b|\b(?:wheels?|casters?|armrests?|headrests?|(?:gas\s+)?cylinders?|cushions?)\s+for\s+(?:an?\s+)?(?:\w+\s+){0,3}chairs?\b/i.test(text);
const newCondition = (text: string) => /\b(?:brand new|new in (?:the )?box|new sealed|sealed in box|unused|unopened|bnib|nib)\b|^\s*(?:free\s+)?new\b(?!\s+york\b)/im.test(text);
const isChair = (text: string) => /\bchairs?\b/i.test(text);
const isDesk = (text: string) => /\bdesks?\b/i.test(text);
const isStanding = (text: string) => /\b(?:standing|sit[ -]?stand|height[ -]adjustable)\b/i.test(text);
const isElectric = (text: string) => /\b(?:electric|motorized|motorised|powered|motor)\b/i.test(text) && !/\b(?:non[- ]?|not\s+(?:(?:an?|the)\s+)?|no\s+)electric\b/i.test(text);

/** These are category searches, derived from this item rather than the user's wish list. */
function similarPlan(listing: Listing): ResalePlan | null {
  const title = listing.title;
  const text = `${title}\n${listing.description}`;
  if (bundle(title) || accessoryOrFault(title) || componentTitle(title)) return null;
  // A desk's description may mention a chair that is not included. Explicit
  // product names in the title take precedence over those incidental mentions.
  const titleChair = isChair(title);
  const titleDesk = isDesk(title.replace(/\bdesk\s+chairs?\b/ig, 'chair'));
  const titleMonitor = /\bmonitor\b/i.test(title);
  if (Number(titleChair) + Number(titleDesk) + Number(titleMonitor) > 1) return null;
  if ((titleChair || !titleDesk && !titleMonitor) && isChair(text)) {
    if (/\b(?:dining|stool|rocking|lounge|recliner|accent|wheelchair)\b/i.test(title)) return null;
    if (/\bgaming\b/i.test(title)) return { query: 'gaming chair', basis: 'similar_items', category: 'gaming_chair' };
    if (/\b(?:office|desk|executive)\b/i.test(text) && /\b(?:executive|leather)\b/i.test(text)) return { query: 'executive office chair', basis: 'similar_items', category: 'executive_chair' };
    if (/\b(?:office|desk)\b/i.test(text) && /\b(?:ergonomic|mesh)\b/i.test(text)) return { query: 'ergonomic office chair', basis: 'similar_items', category: 'ergonomic_chair' };
    if (/\b(?:office|desk|task)\b/i.test(text)) return { query: 'office chair', basis: 'similar_items', category: 'office_chair' };
    if (/\bgaming\b/i.test(text)) return { query: 'gaming chair', basis: 'similar_items', category: 'gaming_chair' };
    return null;
  }
  if ((titleDesk || !titleChair && !titleMonitor) && isDesk(text)) {
    if (/\b(?:riser|converter)\b/i.test(text)) return { query: 'desk with riser', basis: 'similar_items', category: 'desk_riser' };
    if (isStanding(text) && isElectric(text)) return { query: 'electric standing desk', basis: 'similar_items', category: 'electric_desk' };
    if (isStanding(text) && /\b(?:manual|crank)\b/i.test(text)) return { query: 'manual standing desk', basis: 'similar_items', category: 'manual_desk' };
    if (isStanding(text)) return { query: 'standing desk', basis: 'similar_items', category: 'standing_desk' };
    return { query: 'office desk', basis: 'similar_items', category: 'desk' };
  }
  if ((titleMonitor || !titleChair && !titleDesk) && /\bmonitor\b/i.test(text) && !/\b(?:baby|blood pressure|studio|audio|speakers?|television|tv)\b/i.test(text)) {
    const size = /\b(\d{2}(?:\.\d+)?)\s*(?:inch(?:es)?|in\b|["”])/i.exec(text);
    const sizeIn = size ? Number(size[1]) : 0;
    if (sizeIn >= 15 && sizeIn <= 60) return { query: `${sizeIn} inch monitor`, basis: 'similar_items', category: 'monitor', sizeIn };
  }
  return null;
}

export function resalePlans(listing: Listing): ResalePlan[] {
  const brand = clean(listing.brand); const model = clean(listing.model);
  const fallback = similarPlan(listing);
  const plans: ResalePlan[] = brand && model && words(brand).length && words(model).length ? [{ query: `${brand} ${model}`, basis: 'exact_model', brand, model, category: fallback?.category, sizeIn: fallback?.sizeIn }] : [];
  if (fallback && !plans.some(plan => plan.query.toLowerCase() === fallback.query.toLowerCase())) plans.push(fallback);
  return plans;
}

function categoryMatches(plan: ResalePlan, item: RawItem): boolean {
  const title = item.title; const text = `${title}\n${item.description || ''}`;
  switch (plan.category) {
    case 'executive_chair': return isChair(title) && /\b(?:executive|leather)\b/i.test(title) && !/\b(?:gaming|dining|stool|lounge|accent|rocking|recliner|wheelchair)\b/i.test(title);
    case 'ergonomic_chair': return isChair(title) && /\b(?:ergonomic|mesh)\b/i.test(title) && !/\b(?:gaming|dining|stool|lounge|accent|rocking|recliner|wheelchair)\b/i.test(title);
    case 'office_chair': return isChair(title) && /\b(?:office|desk|task|executive|ergonomic)\b/i.test(title) && !/\b(?:gaming|dining|stool|lounge|accent|rocking|recliner|wheelchair)\b/i.test(title);
    case 'gaming_chair': return isChair(title) && /\bgaming\b/i.test(title) && !/\b(?:dining|stool|wheelchair)\b/i.test(title);
    case 'desk_riser': return isDesk(text) && /\briser\b/i.test(text) && !isElectric(text) && !/\b(?:riser|converter) only\b|^\s*(?:standing\s+)?(?:desk\s+)?(?:riser|converter)\b/i.test(title) && /\bdesk\s+(?:with|and)\b|\briser\s+(?:included|attached|detachable)\b/i.test(text);
    case 'electric_desk': return isDesk(title) && isStanding(text) && isElectric(text) && !/\b(?:manual|crank)\b/i.test(text) && !/\b(?:riser|converter)\b/i.test(title);
    case 'manual_desk': return isDesk(title) && isStanding(text) && /\b(?:manual|crank)\b/i.test(text) && !isElectric(text) && !/\b(?:riser|converter)\b/i.test(title);
    case 'standing_desk': return isDesk(title) && isStanding(text) && !/\b(?:riser|converter)\b/i.test(title);
    case 'desk': return isDesk(title) && !isStanding(text) && !/\b(?:riser|converter|child|kids?|vanity)\b/i.test(text);
    case 'monitor': {
      const size = /\b(\d{2}(?:\.\d+)?)\s*(?:inch(?:es)?|in\b|["”])/i.exec(text);
      return /\bmonitor\b/i.test(title) && !/\b(?:baby|blood pressure|studio|audio|speakers?|television|tv)\b/i.test(text) && Boolean(size && plan.sizeIn && Math.abs(Number(size[1]) - plan.sizeIn) <= .5);
    }
    default: return true;
  }
}

export function comparableListings(listing: Listing, items: RawItem[], plan: ResalePlan, now = Date.now()): Comparable[] {
  const seen = new Set<string>();
  const targetUsed = !newCondition(`${listing.title}\n${listing.description}`);
  const results: Comparable[] = [];
  for (const item of items) {
    const price = item.price?.amount;
    const text = `${item.title}\n${item.description || ''}`;
    const city = (item.location?.city || item.location?.display_name || item.location_text || '').trim();
    const postedAt = sourcePostedAt(item.creation_time, now);
    if (item.id === listing.id || seen.has(item.id) || typeof price !== 'number' || !Number.isFinite(price) || price <= 1 || item.is_sold || item.is_pending || item.is_hidden || item.is_live === false) continue;
    // The source often searches the whole Bay Area; South San Francisco is a different city.
    if (!/^san francisco(?:\s*,|\s*$)/i.test(city) || !postedAt || now - Date.parse(postedAt) > COMPARABLE_MAX_AGE_DAYS * DAY) continue;
    if (bundle(item.title) || accessoryOrFault(text) || componentTitle(item.title) || targetUsed && newCondition(text)) continue;
    const condition = item.attributes?.filter(attribute => /condition/i.test(attribute.attribute_name)).map(attribute => attribute.value || attribute.label || '').join(' ') || '';
    if (targetUsed && /^(?:new|new in box|brand new)$/i.test(condition.trim())) continue;
    if (plan.basis === 'exact_model') {
      const titleWords = new Set(words(item.title));
      // Keep single digits and word boundaries: ErgoChair 2 is not ErgoChair 20.
      if (![...words(plan.brand || ''), ...words(plan.model || '')].every(token => titleWords.has(token))) continue;
      // Exact names can omit generic category adjectives; check the basic product type only.
      if (plan.category?.includes('chair') && !isChair(item.title) && !/chair/i.test(plan.model || '')) continue;
      if (plan.category?.includes('desk') && !isDesk(item.title) && !/desk/i.test(plan.model || '')) continue;
    } else if (!categoryMatches(plan, item)) continue;
    seen.add(item.id);
    results.push({ id: item.id, title: item.title, price, url: `https://www.facebook.com/marketplace/item/${encodeURIComponent(item.id)}/`, city: 'San Francisco', postedAt, matchNote: plan.basis === 'exact_model' ? 'Brand and model are named in the title; condition and specifications may differ.' : 'Similar item category from the listing text; brand, model, condition and specifications may differ.', conditionNote: 'Advertised asking price, not a completed sale. Inspect the original listing and confirm availability.' });
  }
  return results;
}

export function resaleReference(plan: ResalePlan | null, comps: Comparable[], now = Date.now()): ResaleReference {
  const ready = comps.length >= 3;
  const prices = comps.map(comp => comp.price).sort((a, b) => a - b);
  const similar = plan?.basis === 'similar_items';
  const note = !plan
    ? 'The item does not have an identified brand/model or a supported, specific chair, desk or monitor category. No comparison search or price estimate was made.'
    : `${ready ? '' : `Found ${comps.length} qualifying local listing${comps.length === 1 ? '' : 's'}; at least three are required for a range. `}${similar ? 'Similar-item asking prices, not a valuation of this item. Brand, model, condition and specifications can differ.' : 'Brand/model asking-price comparisons, not completed sales. Condition and specifications can differ.'} Only explicitly San Francisco listings with confirmed posting dates within 30 days are included; free, $1 placeholder, unavailable, parts, bundle and incompatible-condition listings are excluded. Confirm availability and the actual asking price with the seller. No resale proceeds are guaranteed.`;
  return { status: ready ? 'ready' : 'insufficient', low: ready ? prices.length >= 5 ? prices[Math.floor((prices.length - 1) * .25)] : prices[0] : null, high: ready ? prices.length >= 5 ? prices[Math.ceil((prices.length - 1) * .75)] : prices[prices.length - 1] : null, count: comps.length, comps, queriedAt: new Date(now).toISOString(), note, ...(plan ? { basis: plan.basis, confidence: similar ? 'low' as const : 'model_match' as const, query: plan.query } : {}), geography: 'San Francisco', version: 2 };
}

export function usableResaleCache(result: ResaleReference | null, now = Date.now()): result is ResaleReference {
  if (result?.version !== 2) return false;
  const age = now - Date.parse(result.queriedAt);
  const ttl = result.status === 'ready' ? DAY : 120_000;
  if (!Number.isFinite(age) || age < 0 || age >= ttl) return false;
  return result.comps.every(comp => {
    const date = sourcePostedAt(comp.postedAt, now);
    return Boolean(date && now - Date.parse(date) <= COMPARABLE_MAX_AGE_DAYS * DAY);
  });
}

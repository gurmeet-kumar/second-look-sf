import { NEIGHBORHOODS, type Listing, type RawItem, type Scout, type ScoutLocation } from './types';

/** A retrieval hint for Marketplace, never a user-facing pickup restriction. */
export const MARKETPLACE_RETRIEVAL_MILES = 50;
export const LOCATION_ATTRIBUTION = 'City data from GeoNames via Open-Meteo.';
const GEOCODING_ORIGIN = 'https://geocoding-api.open-meteo.com';
export class LocationLookupError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const cache = new Map<string, { expires: number; value: ScoutLocation }>();
const states = 'AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming'.split('|').map(value => value.split(':'));
const clean = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const stateName = (value: string) => {
  const normalized = clean(value).replace(/ \d{5}(?: \d{4})?$/, '');
  return states.find(([code, name]) => clean(code) === normalized.replace(/ /g,'') || clean(name) === normalized)?.[1] || null;
};
const cityName = (value: string) => {
  const name = clean(value).replace(/^city of /, '').replace(/\bst\b/g, 'saint');
  if (['sf', 'san fran'].includes(name)) return 'san francisco';
  if (['nyc', 'new york city'].includes(name)) return 'new york';
  return name;
};

function canonicalLocation(value: unknown): ScoutLocation | null {
  if (!value || typeof value !== 'object') return null;
  const place = value as Record<string, unknown>;
  if (place.country_code !== 'US' || typeof place.feature_code !== 'string' || !/^(?:PPL|PPLA[1-5]?|PPLC|PPLG|PPLL|PPLR)$/.test(place.feature_code)) return null;
  if (!Number.isSafeInteger(place.id) || Number(place.id) <= 0 || typeof place.name !== 'string' || !place.name.trim() || typeof place.admin1 !== 'string' || !place.admin1.trim()) return null;
  if (typeof place.latitude !== 'number' || typeof place.longitude !== 'number' || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) || Math.abs(place.latitude) > 90 || Math.abs(place.longitude) > 180) return null;
  const city = place.name.trim().slice(0, 100), state = place.admin1.trim().slice(0, 100);
  return { id: String(place.id), label: `${city}, ${state}`, city, state, countryCode: 'US', latitude: place.latitude, longitude: place.longitude };
}
async function geocode(path: string, params: Record<string, string>): Promise<unknown> {
  let response: Response;
  try { response = await fetch(`${GEOCODING_ORIGIN}${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(8_000), headers: { Accept: 'application/json' } }); }
  catch { throw new LocationLookupError('City lookup is taking too long. Please try again.', 503); }
  if (!response.ok) throw new LocationLookupError('City lookup is temporarily unavailable. Please try again.', 503);
  try { return await response.json(); } catch { throw new LocationLookupError('City lookup returned an unreadable response. Please try again.', 503); }
}
function remember(location: ScoutLocation): ScoutLocation {
  if (cache.size >= 150) cache.delete(cache.keys().next().value!);
  cache.set(location.id, { value: location, expires: Date.now() + 3_600_000 });
  return location;
}
export async function searchLocations(query: string): Promise<ScoutLocation[]> {
  const name = query.trim();
  if (name.length < 2) return [];
  if (name.length > 80) throw new LocationLookupError('Enter a city name shorter than 80 characters.');
  const body = await geocode('/v1/search', { name, count: '12', language: 'en', format: 'json', countryCode: 'US' }) as { results?: unknown[] };
  const locations = (Array.isArray(body?.results) ? body.results : []).map(canonicalLocation).filter((place): place is ScoutLocation => Boolean(place));
  return [...new Map(locations.map(place => [place.id, remember(place)])).values()];
}
export async function resolveLocation(id: string): Promise<ScoutLocation> {
  if (!/^[1-9]\d{0,9}$/.test(id)) throw new LocationLookupError('Choose a city from the search results.');
  const existing = cache.get(id);
  if (existing && existing.expires > Date.now()) return existing.value;
  const location = canonicalLocation(await geocode('/v1/get', { id }));
  if (!location || location.id !== id) throw new LocationLookupError('Choose a supported U.S. city from the search results.');
  return remember(location);
}

export function scoutCity(scout: Pick<Scout, 'location' | 'neighborhood'>): { city: string; state: string; label: string } | null {
  if (scout.location?.countryCode === 'US' && scout.location.city && scout.location.state) return scout.location;
  // Every original preset was a San Francisco neighborhood, not a different city.
  if (Object.prototype.hasOwnProperty.call(NEIGHBORHOODS, scout.neighborhood)) return { city: 'San Francisco', state: 'California', label: 'San Francisco, California' };
  return null;
}
export function scoutCenter(scout: Pick<Scout, 'location' | 'neighborhood'>): { lat: number; lng: number } | null {
  if (scout.location?.countryCode === 'US' && Number.isFinite(scout.location.latitude) && Number.isFinite(scout.location.longitude) && Math.abs(scout.location.latitude) <= 90 && Math.abs(scout.location.longitude) <= 180) return { lat: scout.location.latitude, lng: scout.location.longitude };
  return Object.prototype.hasOwnProperty.call(NEIGHBORHOODS, scout.neighborhood) ? { ...NEIGHBORHOODS['San Francisco'] } : null;
}
export const searchScopeKey = (scout: Scout) => JSON.stringify([scout.query, scout.location?.id || scoutCity(scout)?.label || null]);
export function sourceCityMetadata(item: RawItem): Pick<Listing, 'sourceCity' | 'sourceState'> {
  const city = typeof item.location?.city === 'string' ? item.location.city : null;
  const display = item.location_text || item.location?.display_name || '';
  const recovered = city ? statedCity({city:display,sourceCity:city,sourceState:item.location?.state || item.location?.state_code || null}) : null;
  return { sourceCity: city, sourceState: recovered?.state || item.location?.state || item.location?.state_code || null };
}

function statedCity(listing: Pick<Listing, 'city' | 'sourceCity' | 'sourceState'>): { city: string; state: string | null } | null {
  const explicit = listing.sourceCity?.trim();
  const text = explicit || listing.city.trim();
  const parts = text.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length > 2 && /^(?:us|usa|united states(?: of america)?)$/i.test(parts[parts.length - 1])) parts.pop();
  // A structured city or city/state display is usable. Free-form regions and
  // neighborhood instructions are rejected below rather than geocoded/inferred.
  let state = stateName(listing.sourceState || '') || (parts.length >= 2 ? stateName(parts[parts.length - 1]) : null);
  if (!explicit && (parts.length > 2 || parts.length === 2 && !state)) return null;
  const city = parts[0];
  if (!city || !/^[\p{L}\p{M} .’'\-]{2,100}$/u.test(city) || /\b(?:area|county|region|near|unknown|checking|downtown)\b/i.test(city)) return null;
  if (!state && explicit && listing.city !== text) {
    const display = statedCity({city:listing.city});
    if (display && cityName(display.city) === cityName(city)) state = display.state;
  }
  return { city, state };
}
const oldRadiusReason = /^Approximate (?:pickup )?location is .+ (?:away, outside your .+ mi radius|mi from .+)\.$/;
const oldDistanceUnknown = 'Pickup distance cannot be checked from the available location.';
const cityUnknown = 'The listing does not establish its pickup city.';
const reviewUnknown = 'Other item requirements still need checking after the location filter changed.';
export const needsCityRecheck = (listing: Pick<Listing,'unknowns'>) => listing.unknowns.includes(reviewUnknown);
const positiveReason = /^(?:Matches your search for |Stated (?:width|depth|height) fits |Seller reports working condition\.)/;
/** Reevaluate city as an independent filter, including historical cached finds. */
export function applyCityScope(listing: Listing, scout: Scout): Listing {
  const { freshness: _freshness, screeningDecision, screeningReasons, screeningUnknowns, screeningQuestions, cityCheck: _oldCity, ...base } = listing;
  const originalReasons = screeningReasons ?? listing.reasons;
  const requiresReview = (screeningUnknowns ?? listing.unknowns).includes(reviewUnknown);
  const removedRadius = originalReasons.some(reason => oldRadiusReason.test(reason));
  let reasons = originalReasons.filter(reason => !oldRadiusReason.test(reason) && !/^The listing is in .+, outside your selected city of .+\.$/.test(reason));
  let unknowns = (screeningUnknowns ?? listing.unknowns).filter(reason => reason !== oldDistanceUnknown && reason !== cityUnknown && reason !== reviewUnknown && !/^The listing states .+ but does not establish its state\.$/.test(reason));
  let questions = (screeningQuestions ?? listing.questions).filter(question => !['What is the approximate pickup neighborhood?','Which city is the pickup in?','Which city and state is the pickup in?'].includes(question));
  let decision = screeningDecision ?? listing.decision;
  const oldCityOnlyRejection = originalReasons.some(reason => /^The listing is in .+, outside your selected city of .+\.$/.test(reason));
  if (decision === 'rejected' && (removedRadius || oldCityOnlyRejection) && reasons.every(reason => positiveReason.test(reason))) {
    decision = 'needs_checking'; unknowns.push(reviewUnknown);
  }
  if (requiresReview && decision !== 'rejected') unknowns.push(reviewUnknown);
  const selected = scoutCity(scout), source = statedCity(listing);
  let check: NonNullable<Listing['cityCheck']>;
  if (!selected || !source) {
    check = { status: 'unconfirmed', summary: cityUnknown }; unknowns.push(cityUnknown); questions.unshift('Which city and state is the pickup in?');
    if (decision === 'strong_fit') decision = 'needs_checking';
  } else if (cityName(source.city) !== cityName(selected.city) || source.state && stateName(source.state) !== stateName(selected.state)) {
    check = { status: 'mismatch', summary: `The listing is in ${source.city}${source.state ? `, ${source.state}` : ''}, outside your selected city of ${selected.label}.` };
    reasons.push(check.summary); decision = 'rejected';
  } else if (!source.state) {
    check = { status: 'unconfirmed', summary: `The listing states ${source.city} but does not establish its state.` }; unknowns.push(check.summary); questions.unshift('Which city and state is the pickup in?');
    if (decision === 'strong_fit') decision = 'needs_checking';
  } else check = { status: 'matches', summary: `The listing states pickup in ${selected.label}.` };
  return { ...base, decision, reasons: [...new Set(reasons)], unknowns: [...new Set(unknowns)], questions: [...new Set(questions)].slice(0, 5), cityCheck: check };
}

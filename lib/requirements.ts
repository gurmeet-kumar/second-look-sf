import type { Listing, Scout } from './types';

const STANDING_UNKNOWN = 'Standing or height-adjustable capability is not established by the listing.';
const ADJUSTABLE_UNKNOWN = 'Height-adjustable capability is not established by the listing.';
const STANDING_MISMATCH = 'The seller explicitly says this is not a standing desk or is for seated use only.';
const ADJUSTABLE_MISMATCH = 'The seller explicitly says the desk height is fixed or not adjustable.';
const STANDING_QUESTION = 'Can this desk be used at standing height, and does it adjust between sitting and standing?';
const ADJUSTABLE_QUESTION = 'Can the height of this desk be adjusted between sitting and standing?';
const ownMessages = new Set([STANDING_UNKNOWN, ADJUSTABLE_UNKNOWN, STANDING_MISMATCH, ADJUSTABLE_MISMATCH]);
const ownQuestions = new Set([STANDING_QUESTION, ADJUSTABLE_QUESTION]);
const unique = (values: string[]) => [...new Set(values)];
const deskWords = /\b(?:desk|table|workstation)s?\b/i;
const otherObjects = /\b(?:chairs?|stools?|monitors?|screens?|shelf|shelves|lamps?|sofas?|beds?)\b/i;

/** Avoid rounding a location just outside a radius into an apparently equal one. */
export function pickupDistanceText(distance: number, radius: number): string {
  if (distance > radius && Math.round(distance * 10) / 10 <= radius) {
    const hundredths = Math.round(distance * 100) / 100;
    return hundredths > radius ? `${hundredths.toFixed(2)} mi` : `just over ${radius} mi`;
  }
  return `${distance.toFixed(1)} mi`;
}

function requirement(query: string): 'standing' | 'adjustable' | null {
  if (!/\b(?:desk|table|workstation)s?\b/i.test(query)) return null;
  if (/\b(?:height[-\s]*adjustable|adjustable(?:[-\s]*height)?|sit[-\s]*(?:to[-\s]*)?stand)\b/i.test(query)) return 'adjustable';
  return /\b(?:standing|stand[-\s]*up)\b/i.test(query) ? 'standing' : null;
}

function sourceClauses(listing: Listing): string[] {
  // Use seller text and already-validated attribute quotes. A photo or a model's
  // unsupported interpretation cannot establish standing/adjustment capability.
  const sources = [listing.title, listing.description, ...listing.evidence.filter(e => e.source === 'attribute').map(e => e.text)];
  return sources.flatMap(text => (text || '').split(/\r?\n|(?<=[.!?;])\s+|\s+\b(?:but|whereas|while)\b\s+/i)).map(text => text.trim()).filter(Boolean);
}

function relevantNegative(clause: string, listing: Listing): boolean {
  if (otherObjects.test(clause) && !deskWords.test(clause)) return false;
  if (deskWords.test(clause)) return true;
  // A short "Not adjustable" sentence can refer to a desk title. Do not apply a
  // negative about a separately named chair, monitor, etc. to the desk.
  return deskWords.test(listing.title) && clause.length < 100 && !otherObjects.test(clause);
}

function featureCheck(listing: Listing, kind: 'standing' | 'adjustable'): NonNullable<Listing['requestedFeatureCheck']> {
  const clauses = sourceClauses(listing);
  const seatedOnly = clauses.find(clause => relevantNegative(clause, listing) && /\b(?:not|isn['’]t)\s+(?:an?\s+)?(?:standing|stand[-\s]*up|sit[-\s]*(?:to[-\s]*)?stand)\s+(?:desk|table|workstation)\b(?!\s+(?:converter|riser|frame|accessory|mat)\b)|\b(?:seated|sitting)\s+(?:(?:desk|table)\s+)?(?:use\s+)?only\b/i.test(clause));
  const fixed = kind === 'adjustable' ? clauses.find(clause => relevantNegative(clause, listing) && /\b(?:(?:not|isn['’]t)\s+(?:height[-\s]*)?adjustable|non[-\s]*adjustable|fixed[-\s]*height|height\s+(?:is\s+)?fixed|(?:does\s+not|doesn['’]t|cannot|can['’]t)\s+adjust(?:\s+(?:the\s+)?height)?)\b/i.test(clause)) : null;
  const label = kind === 'adjustable' ? 'Height-adjustable desk' : 'Standing-desk capability';
  if (seatedOnly) return { label, status: 'mismatch', summary: STANDING_MISMATCH, quote: seatedOnly };
  if (fixed) return { label, status: 'mismatch', summary: ADJUSTABLE_MISMATCH, quote: fixed };
  const accessoryOnlyTitle = /\b(?:standing|stand[-\s]*up|sit[-\s]*(?:to[-\s]*)?stand|height[-\s]*adjustable)\s+desk\s+(?:mat|converter|riser|frame|accessory|top|legs?)\b/i.test(listing.title)
    && !/[,;+&]|\b(?:with|and|includes?|complete|full)\b/i.test(listing.title);
  const claimPattern = kind === 'adjustable'
    ? /\b(?:height[-\s]*adjustable|adjustable[-\s]*height|sit[-\s]*(?:to[-\s]*)?stand|adjustable\s+(?:standing\s+)?(?:desk|table)|(?:desk|table|height)\s+(?:is\s+)?(?:height[-\s]*)?adjustable)\b/ig
    : /\b(?:standing\s+(?:desk|table|workstation)|stand[-\s]*up\s+(?:desk|table)|height[-\s]*adjustable|adjustable[-\s]*height|sit[-\s]*(?:to[-\s]*)?stand|adjustable\s+(?:desk|table)|(?:desk|table|height)\s+(?:is\s+)?(?:height[-\s]*)?adjustable)\b/ig;
  for (const clause of clauses) {
    for (const match of clause.matchAll(claimPattern)) {
      const prefix = clause.slice(Math.max(0, match.index! - 85), match.index);
      const suffix = clause.slice(match.index! + match[0].length);
      if (accessoryOnlyTitle || /^\s+(?:mat|converter|riser|frame|accessory|top|legs?)\b/i.test(suffix)
        || /\b(?:mat|converter|riser|frame|accessory|top|legs?)\s+(?:for|from|of|to fit)\s+(?:an?\s+)?$/i.test(prefix)) continue;
      // Mentions of a desired/replacement item do not describe the offered item.
      if (/\b(?:not|isn['’]t|never|no|without)\s+(?:an?\s+)?$/i.test(prefix) || /\b(?:looking for|seeking|want(?:ed|ing)?|need(?:ed|ing)?|replac(?:e|ing|ed)(?:\s+it)?\s+with|upgrad(?:e|ing|ed)\s+to|switch(?:ing|ed)?\s+to|getting)\s+(?:(?:an?|new|another|my|this)\s+)*$/i.test(prefix)) continue;
      // A generic adjective in a sentence about another item is not desk proof.
      if (!deskWords.test(clause) && (otherObjects.test(clause) || otherObjects.test(listing.title) && !deskWords.test(listing.title))) continue;
      return { label, status: 'supported', summary: kind === 'adjustable' ? 'The listing states height adjustment; its function is not independently verified.' : 'The listing states standing-desk capability; its function is not independently verified.', quote: clause };
    }
  }
  return { label, status: 'unconfirmed', summary: kind === 'adjustable' ? ADJUSTABLE_UNKNOWN : STANDING_UNKNOWN };
}

/** Add every established requirement issue without spending an additional API call. */
export function applyRequirementChecks(listing: Listing, scout: Scout): Listing {
  // Restore the screening base if the caller passes an already-freshness-overlaid
  // listing. Freshness is reapplied afterwards, never persisted as the fit result.
  const { freshness: _freshness, screeningDecision, screeningReasons, screeningUnknowns, screeningQuestions, requestedFeatureCheck: _oldCheck, ...base } = listing;
  let decision = screeningDecision ?? listing.decision;
  let reasons = [...(screeningReasons ?? listing.reasons)].filter(reason => !ownMessages.has(reason));
  let unknowns = [...(screeningUnknowns ?? listing.unknowns)].filter(reason => !ownMessages.has(reason));
  let questions = [...(screeningQuestions ?? listing.questions)].filter(question => !ownQuestions.has(question));
  const evidence = [...listing.evidence].filter(item => item.field !== 'Requested desk capability');
  if (typeof listing.distanceMiles === 'number' && Number.isFinite(listing.distanceMiles)) {
    reasons = reasons.map(reason => /^Approximate (?:pickup )?location is .+ mi away, outside your .+ mi radius\.$/.test(reason)
      ? `Approximate pickup location is ${pickupDistanceText(listing.distanceMiles!,scout.radiusMiles)} away, outside your ${scout.radiusMiles} mi radius.` : reason);
  }
  const kind = requirement(scout.query);
  if (!kind) return { ...base, decision, reasons: unique(reasons), unknowns: unique(unknowns), questions: unique(questions), evidence };
  const check = featureCheck({ ...base, evidence } as Listing, kind);
  if (check.status !== 'supported') {
    reasons = reasons.filter(reason => !/^Matches your search for /i.test(reason));
    if (check.status === 'mismatch') { decision = 'rejected'; reasons.push(check.summary); }
    else {
      unknowns.push(check.summary);
      questions.unshift(kind === 'adjustable' ? ADJUSTABLE_QUESTION : STANDING_QUESTION);
      if (decision === 'strong_fit') decision = 'needs_checking';
    }
  }
  if (check.quote) evidence.push({ field: 'Requested desk capability', text: check.quote, source: listing.evidence.some(e => e.source === 'attribute' && e.text === check.quote) ? 'attribute' : 'description' });
  return { ...base, decision, reasons: unique(reasons), unknowns: unique(unknowns), questions: unique(questions).slice(0, 5), evidence, requestedFeatureCheck: check };
}

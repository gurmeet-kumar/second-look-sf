import type { Decision, Listing } from './types';

export const DEFAULT_MAX_AGE_HOURS = 24;
export const VALID_MAX_AGE_HOURS = [24, 168, 720] as const;
const HOUR = 60 * 60 * 1000;
const FUTURE_GRACE_MS = 5 * 60 * 1000;
const UNKNOWN_DATE = 'Posting date is not available; recency cannot be confirmed.';
const DATE_QUESTION = 'When was this listing posted, and is the item still available for pickup?';

type FreshnessListing = Listing & {
  sourceDateText?: string | null;
  sourceDateObservedAt?: string | null;
  freshness?: { status: 'recent' | 'older' | 'unknown'; maxAgeHours: number; ageHours: number | null };
  screeningDecision?: Decision;
  screeningReasons?: string[];
  screeningUnknowns?: string[];
  screeningQuestions?: string[];
};

/** Accept source timestamps only; browser-dependent date guesses are not posting evidence. */
export function sourcePostedAt(value: unknown, now = Date.now()): string | null {
  let timestamp: number;
  if (typeof value === 'number' && Number.isFinite(value)) {
    timestamp = value < 100_000_000_000 ? value * 1000 : value;
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (/^\d{10}(?:\.\d{1,3})?$|^\d{13}$/.test(text)) {
      const numeric = Number(text);
      timestamp = numeric < 100_000_000_000 ? numeric * 1000 : numeric;
    } else {
      const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})$/i.exec(text);
      if (!iso) return null;
      const [, year, month, day, hour, minute, second = '0', fraction, offset] = iso;
      const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
      if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > daysInMonth || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
      if (offset !== 'Z' && offset !== 'z') {
        const digits = offset.replace(/[^\d]/g, '');
        if (Number(digits.slice(0, 2)) > 23 || Number(digits.slice(2)) > 59) return null;
      }
      const normalizedFraction = fraction ? `.${fraction.slice(0, 3).padEnd(3, '0')}` : '';
      const normalizedOffset = offset.toUpperCase() === 'Z' ? 'Z' : offset.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
      timestamp = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second.padStart(2, '0')}${normalizedFraction}${normalizedOffset}`);
    }
  } else return null;
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now + FUTURE_GRACE_MS) return null;
  try { return new Date(timestamp).toISOString(); } catch { return null; }
}

function maxAge(value: number): number {
  return VALID_MAX_AGE_HOURS.some(hours => hours === value) ? value : DEFAULT_MAX_AGE_HOURS;
}
function windowLabel(hours: number): string {
  return hours === 24 ? '24 hours' : `${hours / 24} days`;
}
function sourceDateLabel(timestamp: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(timestamp));
}
function unique(values: string[]): string[] { return [...new Set(values)]; }

/** Relative source text can prove a listing old, but cannot prove an exact or recent date. */
function relativeAgeLowerBound(text: string | null | undefined, observedAt: string | null | undefined, now: number): number | null {
  const match = /^\s*(?:listed|posted)\s+(\d+)\s+(minutes?|hours?|days?|weeks?|months?|years?)\s+ago(?:\s+in\b.*)?\s*$/i.exec(text || '');
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 1) return null;
  const unit = match[2].toLowerCase().replace(/s$/, '');
  const unitHours: Record<string, number> = { minute: 1 / 60, hour: 1, day: 24, week: 168, month: 28 * 24, year: 365 * 24 };
  // Allow rounding/calendar-day ambiguity and shortest months; never manufacture an exact date.
  const uncertainty = unit === 'minute' ? 1 / 60 : unit === 'hour' ? 1 : 24;
  const observed = sourcePostedAt(observedAt, now);
  const elapsedHours = observed ? Math.max(0, (now - Date.parse(observed)) / HOUR) : 0;
  return Math.max(0, count * unitHours[unit] - uncertainty) + elapsedHours;
}

/** Overlay a scout's time window without changing the underlying screening assessment. */
export function applyFreshness(listing: Listing, maxAgeHours = DEFAULT_MAX_AGE_HOURS, now = Date.now()): Listing {
  const original = listing as FreshnessListing;
  const decision = original.screeningDecision ?? listing.decision;
  const reasons = [...(original.screeningReasons ?? listing.reasons)];
  const unknowns = [...(original.screeningUnknowns ?? listing.unknowns)];
  const questions = [...(original.screeningQuestions ?? listing.questions)];
  const hours = maxAge(maxAgeHours);
  const postedAt = sourcePostedAt(listing.sourceCreatedAt, now);
  const ageHours = postedAt ? Math.max(0, (now - Date.parse(postedAt)) / HOUR) : null;
  const relativeMinimum = postedAt ? null : relativeAgeLowerBound(original.sourceDateText, original.sourceDateObservedAt, now);
  const older = ageHours !== null ? ageHours > hours : relativeMinimum !== null && relativeMinimum > hours;
  const status = older ? 'older' : postedAt ? 'recent' : 'unknown';
  const result: FreshnessListing = {
    ...listing, sourceCreatedAt: postedAt, decision, reasons, unknowns, questions,
    screeningDecision: decision, screeningReasons: [...reasons], screeningUnknowns: [...unknowns], screeningQuestions: [...questions],
    freshness: { status, maxAgeHours: hours, ageHours },
  };
  if (older) {
    const date = postedAt ? `on ${sourceDateLabel(postedAt)}` : `according to the source (\u201c${original.sourceDateText?.trim()}\u201d)`;
    const reason = `The listing was posted ${date} and is outside your last ${windowLabel(hours)} window. Age does not confirm availability.`;
    result.decision = 'rejected';
    result.reasons = unique(decision === 'rejected' ? [...reasons, reason] : [reason, ...reasons]);
  } else if (status === 'unknown' && decision !== 'rejected' && decision !== 'pending') {
    result.decision = 'needs_checking';
    result.unknowns = unique([...unknowns, UNKNOWN_DATE]);
    result.questions = unique([...questions, DATE_QUESTION]);
  }
  return result;
}

// @ts-check
/**
 * AAD 2026 PASS TAXONOMY
 * ======================
 * The gate does not care how a pass was sold. It cares about exactly two
 * questions:
 *
 *   1. Is this a CONFERENCE pass at all?  (tours and merchandise are not)
 *   2. Which DAYS is it entitled to?      (weekly vs daily)
 *
 * Both source CSVs (event tickets, WooCommerce, PayPal) mix passes with
 * add-ons. Filtering must therefore be ROW-LEVEL, by product name — not per
 * file. A single legacy CSV containing "event tickets plus products" is
 * handled the same way as three separate files.
 *
 * The five conference products:
 *   1. Standard Conference Daytime Pass   (weekly & day tickets)
 *   2. Full Conference (Non-residential)
 *   3. Residential Delegate               (weekly & daily tickets)
 *   4. The All-Inclusive Delegate
 *   5. Youth Inclusion                    (daily tickets only)
 *
 * Anything else — tours, excursions, merchandise, sponsor items — is tagged
 * `excluded` and DENIED AT THE GATE WITH A PRECISE REASON, rather than being
 * dropped and reported as "unregistered". A delegate holding a real tour
 * ticket should be told "this is a tour package, not a conference pass", not
 * "invalid".
 */

import { AAD_EVENTS } from './events.js';

/** All conference days for this event, in order. */
export function conferenceDates() {
  return AAD_EVENTS
    .filter(e => e.gateGroup === 'conference')
    .map(e => e.date)
    .sort();
}

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   pattern: RegExp,
 *   dailyOnly?: boolean,
 *   eveningAccess?: boolean|null,
 *   notes?: string
 * }} PassTier
 */

/** The five conference products. Order matters: first match wins. */
/** @type {PassTier[]} */
export const PASS_TIERS = [
  {
    id: 'all_inclusive',
    label: 'The All-Inclusive Delegate',
    pattern: /all[\s-]*inclusive/i,
    eveningAccess: true,
    notes: 'Everything, including evening functions.'
  },
  {
    id: 'full_nonres',
    label: 'Full Conference (Non-residential)',
    pattern: /full[\s-]*conference|non[\s-]*residential/i,
    eveningAccess: null
  },
  {
    id: 'residential',
    label: 'Residential Delegate',
    // Negative lookahead on 'non-' as a second line of defence, in case the
    // ordering above is ever changed.
    pattern: /(?<!non[\s-]*)residential|accommodation|overnight|bed\s*(and|&)\s*breakfast|\bb\s*&\s*b\b/i,
    eveningAccess: null,
    notes: 'Weekly and daily variants both exist.'
  },
  {
    id: 'youth',
    label: 'Youth Inclusion',
    pattern: /youth|learner|school|student|under[\s-]*2[0-9]/i,
    dailyOnly: true,
    eveningAccess: false,
    notes: 'Daily tickets only.'
  },
  {
    id: 'standard_daytime',
    label: 'Standard Conference Daytime Pass',
    pattern: /standard|daytime|day\s*pass|general\s*(admission|pass)/i,
    eveningAccess: false,
    notes: 'Weekly and day variants both exist. Daytime only — no evening functions.'
  }
];

/**
 * Rows that are NOT conference passes. These stay in the manifest so the gate
 * can name them precisely, but they are never admitted and never counted as
 * delegates.
 * @type {{ id: string, label: string, pattern: RegExp }[]}
 */
export const EXCLUSION_RULES = [
  {
    id: 'tour',
    label: 'Tour / excursion package',
    // "Soweto Heritage Tour", "Cultural excursion", "Site visit"…
    pattern: /\btour\b|\btours\b|soweto|heritage\s*(tour|walk)|excursion|site\s*visit|cultural\s*(tour|experience|walk)|city\s*tour|shuttle|transfer\b/i
  },
  {
    id: 'event',
    label: 'Event-specific ticket',
    pattern: /\bstorytelling\s+dinner\b|have\s+you\s+met\s+johannesburg/i
  },
  {
    id: 'product',
    label: 'Non-ticket product',
    pattern: /merch|t-?shirt|hoodie|cap\b|mug|tote|bag\b|bottle|notebook|programme\s*book|gift|hamper|badge\s*reprint/i
  },
  {
    id: 'sponsor',
    label: 'Sponsor / exhibitor item',
    pattern: /sponsor|exhibit|booth|stand\b|stall|partnership\s*package/i
  }
];

/** Cadence detection — is this a weekly (all-days) or a single-day pass? */
const WEEKLY_PATTERN = /\bweekly\b|full\s*week|all\s*(5|five)?\s*days?|week\s*pass|5[\s-]*day|whole\s*conference/i;
const DAILY_PATTERN = /\bdaily\b|\bday\s*pass\b|\bsingle\s*day\b|\b1[\s-]*day\b|\bone[\s-]*day\b|\bday\s*[1-5]\b|\b[1-5]\s*day\b/i;

/**
 * @typedef {{
 *   tierId: string|null,
 *   tierLabel: string|null,
 *   excluded: boolean,
 *   exclusionId: string|null,
 *   exclusionReason: string|null,
 *   cadence: 'weekly'|'daily'|'unknown',
 *   eveningAccess: boolean|null,
 *   unmapped: boolean
 * }} PassClassification
 */

/**
 * Classify a single row by its product / ticket type text.
 *
 * @param {string} [type]  The product or ticket-type text
 * @param {string} [label] Any secondary label (item title, subject, description)
 * @param {string} [hint]  Extra text to consider when the first two are thin
 * @returns {PassClassification}
 */
export function classifyPass(type = '', label = '', hint = '') {
  const text = `${type} ${label} ${hint}`.replace(/\s+/g, ' ').trim();

  /** @type {PassClassification} */
  const result = {
    tierId: null,
    tierLabel: null,
    excluded: false,
    exclusionId: null,
    exclusionReason: null,
    cadence: 'unknown',
    eveningAccess: null,
    unmapped: false
  };

  if (!text) {
    result.unmapped = true;
    return result;
  }

  // 1. Is it a conference pass? Tiers are checked FIRST because a residential
  //    or all-inclusive pass may also contain the word "package".
  const tier = PASS_TIERS.find(t => t.pattern.test(text));
  if (tier) {
    result.tierId = tier.id;
    result.tierLabel = tier.label;
    result.eveningAccess = tier.eveningAccess === undefined ? null : tier.eveningAccess;
    result.cadence = deriveCadence(text, tier);
    return result;
  }

  // 2. Not a conference pass — is it a known exclusion we can name?
  const exclusion = EXCLUSION_RULES.find(r => r.pattern.test(text));
  if (exclusion) {
    result.excluded = true;
    result.exclusionId = exclusion.id;
    result.exclusionReason = exclusion.label;
    return result;
  }

  // 3. Unknown text. Do NOT exclude — an unrecognised conference pass must
  //    still get through the door. Flag it for the operator instead.
  result.unmapped = true;
  return result;
}

/**
 * Work out weekly vs daily.
 * @param {string} text
 * @param {PassTier} tier
 * @returns {'weekly'|'daily'|'unknown'}
 */
function deriveCadence(text, tier) {
  if (tier.dailyOnly) return 'daily';
  if (WEEKLY_PATTERN.test(text)) return 'weekly';
  if (DAILY_PATTERN.test(text)) return 'daily';
  // A "Full Conference" pass covers the whole conference by definition.
  // Residential and All-Inclusive are most often sold as weekly packages.
  // Being explicit here matters: 'unknown' falls back to the legacy rules,
  // which happened to admit correctly but was not guaranteed or tested.
  if (tier.id === 'full_nonres' || tier.id === 'residential' || tier.id === 'all_inclusive') {
    return 'weekly';
  }
  return 'unknown';
}

/**
 * Turn a classification into the exact list of dates a ticket may be used on.
 * This is what makes "day ticket on the wrong day" precise, and what lets a
 * weekly pass walk through any conference gate all week.
 *
 * @param {PassClassification} cls
 * @param {string} [fallbackDate] Date to assume for a daily pass with no date
 * @returns {string[]|null} null = unknown, fall back to legacy rules
 */
export function resolveValidDates(cls, fallbackDate) {
  const all = conferenceDates();
  if (cls.excluded) return [];

  if (cls.cadence === 'weekly') return all;

  if (cls.cadence === 'daily') {
    // A daily pass is only good for the day it was bought for. If the export
    // does not carry that date, assume the session being loaded into.
    return fallbackDate ? [fallbackDate] : null;
  }

  return null; // unknown cadence — legacy behaviour applies
}

/**
 * Human-readable summary of a tier's entitlement, for the import report and
 * the walk-in form.
 * @param {string} tierId
 * @returns {string}
 */
export function describeTier(tierId) {
  const tier = PASS_TIERS.find(t => t.id === tierId);
  if (!tier) return 'Unrecognised pass type';
  const cadence = tier.dailyOnly ? 'daily only' : 'weekly or daily';
  const evening = tier.eveningAccess === true
    ? 'evening functions included'
    : tier.eveningAccess === false
      ? 'daytime only'
      : 'evening access not specified';
  return `${tier.label} — ${cadence}, ${evening}`;
}

export const CONFERENCE_TIER_OPTIONS = PASS_TIERS.map(t => ({
  id: t.id,
  label: t.label,
  dailyOnly: Boolean(t.dailyOnly)
}));

/**
 * Extract an explicit AAD 2026 conference date when WooCommerce or PayPal
 * encodes the day inside the product/variation title (e.g. "Day Pass - Day 2",
 * "Youth Inclusion (28 Oct)", "Standard Daytime - Thursday") instead of a
 * dedicated attendance-date column.
 *
 * @param {string} text
 * @returns {string|null} YYYY-MM-DD or null
 */
export function extractConferenceDateFromText(text = '') {
  const s = String(text || '');
  if (!s) return null;

  const iso = s.match(/\b(2026-10-(?:2[5-9]|30))\b/);
  if (iso) return iso[1];

  if (/soweto/i.test(s)) return '2026-10-25';
  if (/storytelling|have\s+you\s+met\s+johannesburg/i.test(s)) return '2026-10-28';

  const dayNum = s.match(/\bday\s*([1-5])\b/i);
  if (dayNum) {
    const map = {
      '1': '2026-10-26',
      '2': '2026-10-27',
      '3': '2026-10-28',
      '4': '2026-10-29',
      '5': '2026-10-30'
    };
    return map[dayNum[1]] || null;
  }

  const octDay = s.match(/\b(2[6-9]|30)(?:st|nd|rd|th)?\s*oct(?:ober)?\b/i)
    || s.match(/\boct(?:ober)?\s*(2[6-9]|30)(?:st|nd|rd|th)?\b/i);
  if (octDay) {
    return `2026-10-${octDay[1]}`;
  }

  const weekday = s.match(/\b(monday|tuesday|wednesday|thursday|friday)\b/i);
  if (weekday) {
    const wmap = {
      monday: '2026-10-26',
      tuesday: '2026-10-27',
      wednesday: '2026-10-28',
      thursday: '2026-10-29',
      friday: '2026-10-30'
    };
    return wmap[weekday[1].toLowerCase()] || null;
  }

  return null;
}

/**
 * Infer the AAD event/session ID for separately sold event tickets whose
 * product title identifies the session but whose export lacks an event_id.
 * @param {string} text
 * @returns {string|null}
 */
export function inferAadEventIdFromText(text = '') {
  const s = String(text || '');
  if (/storytelling\s+dinner|have\s+you\s+met\s+johannesburg/i.test(s)) return 'aad26-dinner';
  if (/soweto|heritage\s*tour|excursion/i.test(s)) return 'aad26-tour-soweto';
  return null;
}

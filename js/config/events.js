// @ts-check
/**
 * @typedef {'full'|'day'|'evening'|'tour'|'virtual'} AccessScope
 * @typedef {{
 *   id: string,
 *   name: string,
 *   date: string,
 *   access: AccessScope,
 *   window?: string,
 *   gateGroup: string
 * }} AadEvent
 */

/** @type {AadEvent[]} */
export const AAD_EVENTS = [
  { id: 'aad26-tour-soweto', name: 'Soweto Heritage Tour', date: '2026-10-25',
    access: 'tour', window: '08:00–17:00', gateGroup: 'tours' },
  { id: 'aad26-d1', name: 'AAD 2026 · Day 1', date: '2026-10-26', access: 'full', gateGroup: 'conference' },
  { id: 'aad26-d2', name: 'AAD 2026 · Day 2', date: '2026-10-27', access: 'full', gateGroup: 'conference' },
  { id: 'aad26-d3', name: 'AAD 2026 · Day 3', date: '2026-10-28', access: 'full', gateGroup: 'conference' },
  { id: 'aad26-dinner', name: 'Have You Met Johannesburg? Storytelling Dinner', date: '2026-10-28',
    access: 'evening', window: '18:30–22:00', gateGroup: 'evening' },
  { id: 'aad26-d4', name: 'AAD 2026 · Day 4', date: '2026-10-29', access: 'full', gateGroup: 'conference' },
  { id: 'aad26-d5', name: 'AAD 2026 · Day 5 — Closing', date: '2026-10-30', access: 'full', gateGroup: 'conference' },
  { id: 'aad26-virtual', name: 'Virtual Delegate', date: '2026-10-26', access: 'virtual', gateGroup: 'none' },
];

/**
 * Find an event by exact ID first, then by date (disambiguating shared dates
 * such as 2026-10-28 Conference Day 3 vs Storytelling Dinner).
 *
 * @param {string} idOrDate
 * @param {string} [preferredAccess] Optional access scope ('evening'|'tour'|'virtual'|'full'|'day')
 * @returns {AadEvent|undefined}
 */
export function getAadEvent(idOrDate, preferredAccess) {
  if (!idOrDate) return undefined;

  const exactId = AAD_EVENTS.find(e => e.id === idOrDate);
  if (exactId) return exactId;

  const byDate = AAD_EVENTS.filter(e => e.date === idOrDate);
  if (byDate.length === 0) return undefined;
  if (byDate.length === 1) return byDate[0];

  if (preferredAccess) {
    const accessMatch = byDate.find(e => e.access === preferredAccess);
    if (accessMatch) return accessMatch;
  }

  return byDate.find(e => e.gateGroup === 'conference') || byDate[0];
}

/**
 * Pick the best default session ID for a fresh device boot based on SAST date.
 * @param {string} [sastDate] YYYY-MM-DD
 * @returns {string}
 */
export function resolveDefaultEventId(sastDate) {
  const today = sastDate || new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  const confToday = AAD_EVENTS.find(e => e.date === today && e.gateGroup === 'conference');
  if (confToday) return confToday.id;

  const anyToday = AAD_EVENTS.find(e => e.date === today);
  if (anyToday) return anyToday.id;

  return 'aad26-d1';
}

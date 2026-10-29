// @ts-check
/**
 * SESSION SCOPING FOR MULTI-DAY & MULTI-SESSION CONFERENCES
 * =========================================================
 * Duplicate detection must answer:
 *     "Has this ticket already been admitted at THIS session?"
 *
 * Scoping solely by calendar date (`ticketId::2026-10-28`) caused a critical
 * collision on Wednesday 28 Oct, where both `aad26-d3` (Conference Day 3) and
 * `aad26-dinner` (Storytelling Dinner) share 2026-10-28 — denying All-Inclusive
 * delegates at dinner because they attended morning plenaries.
 *
 * Keys are now scoped by `eventId` (`ticketId::aad26-d3`), while `findPriorScan`
 * transparently honours existing `ticketId::YYYY-MM-DD` records on daytime
 * conference sessions so live devices upgraded mid-week keep all prior scans.
 */

/**
 * Composite key for the duplicate guard.
 * @param {string} ticketId
 * @param {string} [sessionScope] Prefer `eventId` (e.g. 'aad26-d3'); falls back to date or 'na'
 * @returns {string}
 */
export function scannedKey(ticketId, sessionScope) {
  return `${String(ticketId)}::${sessionScope || 'na'}`;
}

/**
 * Look up a prior admission in `scannedSet` with backwards-compatibility for
 * v1.3.x date-scoped conference keys (`ticketId::YYYY-MM-DD`).
 *
 * @param {Record<string, any>} scannedSet
 * @param {string} ticketId
 * @param {string} [activeEventId]
 * @param {string} [activeEventDate]
 * @param {string} [gateGroup]
 * @returns {{ key: string, entry: any } | null}
 */
export function findPriorScan(scannedSet, ticketId, activeEventId, activeEventDate, gateGroup = 'conference') {
  if (!scannedSet || !ticketId) return null;

  if (activeEventId) {
    const primaryKey = scannedKey(ticketId, activeEventId);
    if (scannedSet[primaryKey]) {
      return { key: primaryKey, entry: scannedSet[primaryKey] };
    }
  }

  // Backwards-compatible fallback ONLY for daytime conference sessions so
  // evening dinners / tours on the same calendar date never collide.
  if (activeEventDate && gateGroup === 'conference') {
    const legacyDateKey = scannedKey(ticketId, activeEventDate);
    if (scannedSet[legacyDateKey]) {
      return { key: legacyDateKey, entry: scannedSet[legacyDateKey] };
    }
  }

  // Direct date-key fallback when caller only passed a date into activeEventId
  if (activeEventDate && !activeEventId) {
    const dateKey = scannedKey(ticketId, activeEventDate);
    if (scannedSet[dateKey]) {
      return { key: dateKey, entry: scannedSet[dateKey] };
    }
  }

  return null;
}

/**
 * Was this set written in the v1.0 date-less format?
 * @param {Record<string, any>} set
 * @returns {boolean}
 */
export function isLegacyScannedSet(set) {
  if (!set || typeof set !== 'object') return false;
  const keys = Object.keys(set);
  if (keys.length === 0) return false;
  return keys.every(k => !k.includes('::'));
}

/**
 * Rewrite a legacy scanned set into session-scoped keys.
 * @param {Record<string, any>} set
 * @param {string} [sessionScope] Event ID or YYYY-MM-DD
 * @returns {Record<string, any>}
 */
export function migrateScannedSet(set, sessionScope) {
  if (!set || typeof set !== 'object') return {};
  if (!isLegacyScannedSet(set)) return { ...set };

  /** @type {Record<string, any>} */
  const migrated = {};
  for (const [ticketId, value] of Object.entries(set)) {
    migrated[scannedKey(ticketId, sessionScope)] = value;
  }
  return migrated;
}

/**
 * A blank counter block for a fresh event session.
 * @param {number} [loaded]
 */
export function blankCounters(loaded = 0) {
  return {
    loaded,
    checkedIn: 0,
    prechecked: 0,
    duplicates: 0,
    invalid: 0,
    cancelled: 0
  };
}

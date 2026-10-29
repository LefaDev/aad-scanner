// @ts-check
/**
 * TOLERANT TICKET LOOKUP (MEMOIZED O(1))
 * ======================================
 * Resolves formatting mismatches between QR codes ("AAD-1002", "aad 1002",
 * "WC-1002", "1002") and CSV store exports.
 *
 * Memoizes the normalised index per immutable `tickets` map via WeakMap so
 * repeat scans execute in O(1) instead of rebuilding O(N) keys per scan.
 */

/** @type {WeakMap<object, { exact: Record<string, any>, normalised: Record<string, string>, entries: Array<[string, string]> }>} */
const indexCache = new WeakMap();

/**
 * Normalise an id for comparison: upper-case, strip separators.
 * @param {string} id
 * @returns {string}
 */
export function normaliseTicketKey(id) {
  return String(id || '')
    .toUpperCase()
    .replace(/[\s\-_.#/\\]/g, '')
    .trim();
}

/**
 * Build (or retrieve cached) normalised lookup index for a ticket map.
 * @param {Record<string, any>} tickets
 * @returns {{ exact: Record<string, any>, normalised: Record<string, string> }}
 */
export function buildLookupIndex(tickets) {
  if (!tickets || typeof tickets !== 'object') {
    return { exact: {}, normalised: {} };
  }

  const cached = indexCache.get(tickets);
  if (cached) {
    return { exact: cached.exact, normalised: cached.normalised };
  }

  /** @type {Record<string, string>} */
  const normalised = {};
  for (const id of Object.keys(tickets)) {
    const key = normaliseTicketKey(id);
    if (key && !(key in normalised)) {
      normalised[key] = id;
    }
  }

  const compiled = {
    exact: tickets,
    normalised,
    entries: Object.entries(normalised)
  };
  indexCache.set(tickets, compiled);
  return { exact: compiled.exact, normalised: compiled.normalised };
}

/**
 * Resolve a scanned code to a ticket.
 * @param {Record<string, any>} tickets
 * @param {string} rawId
 * @returns {{ ticket: any|null, matchedVia: 'exact'|'normalised'|'suffix'|'none', resolvedId?: string }}
 */
export function resolveTicket(tickets, rawId) {
  if (!rawId || !tickets) return { ticket: null, matchedVia: 'none' };

  if (Object.prototype.hasOwnProperty.call(tickets, rawId)) {
    return { ticket: tickets[rawId], matchedVia: 'exact', resolvedId: rawId };
  }

  const key = normaliseTicketKey(rawId);
  if (!key) return { ticket: null, matchedVia: 'none' };

  // Ensure index is compiled and cached
  buildLookupIndex(tickets);
  const cached = indexCache.get(tickets);
  const normalised = cached ? cached.normalised : {};
  const entries = cached ? cached.entries : [];

  if (Object.prototype.hasOwnProperty.call(normalised, key)) {
    const hitId = normalised[key];
    return { ticket: tickets[hitId], matchedVia: 'normalised', resolvedId: hitId };
  }

  // Last resort: suffix match ("WC-1002" vs "1002") when unambiguous and >= 4 chars.
  if (key.length >= 4) {
    /** @type {string[]} */
    const candidates = [];
    for (let i = 0; i < entries.length; i++) {
      const [norm, id] = entries[i];
      if (norm === key) continue;
      if (norm.endsWith(key) || key.endsWith(norm)) {
        candidates.push(id);
        if (candidates.length > 1) break; // Early exit on ambiguity
      }
    }
    if (candidates.length === 1) {
      return { ticket: tickets[candidates[0]], matchedVia: 'suffix', resolvedId: candidates[0] };
    }
  }

  return { ticket: null, matchedVia: 'none' };
}

// @ts-check
/**
 * @typedef {{
 *   raw: string,
 *   ticketId?: string,
 *   eventId?: string,
 *   securityCode?: string,
 *   orderId?: string
 * }} ParsedPayload
 */

/**
 * Clean string of BOM, zero-width spaces, and excess whitespace
 * @param {string} str 
 * @returns {string}
 */
export function sanitizeString(str) {
  if (!str) return '';
  return str
    .replace(/^[\uFEFF\xA0]+/, '') // Strip BOM
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Strip zero-width chars
    .trim();
}

/**
 * Parse an incoming QR scan payload
 * @param {string} rawInput 
 * @returns {ParsedPayload}
 */
export function parsePayload(rawInput) {
  const raw = sanitizeString(rawInput);
  if (!raw) {
    return { raw: '' };
  }

  /** @type {ParsedPayload} */
  const result = { raw };

  // 1. URL pattern
  if (raw.includes('://') || raw.startsWith('http')) {
    try {
      const url = new URL(raw);
      const params = url.searchParams;
      result.ticketId = params.get('ticket_id') || params.get('id') || params.get('ticket') || params.get('ticketId') || undefined;
      result.eventId = params.get('event_id') || params.get('event') || params.get('event_qr_code') || undefined;
      result.securityCode = params.get('security_code') || params.get('code') || params.get('sec') || undefined;
      result.orderId = params.get('order_id') || params.get('order') || undefined;

      // Also check pathname if query params weren't present: e.g. /ticket/AAD-1002
      if (!result.ticketId) {
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length > 0) {
          result.ticketId = parts[parts.length - 1];
        }
      }

      if (result.ticketId) {
        return sanitizeParsed(result);
      }
    } catch (_) {
      // Continue to next heuristic if URL parsing fails
    }
  }

  // 2. JSON pattern
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const obj = JSON.parse(raw);
      result.ticketId = obj.ticket_id || obj.ticketId || obj.id || obj.ticket || obj.attendee_id;
      result.eventId = obj.event_id || obj.eventId || obj.event;
      result.securityCode = obj.security_code || obj.securityCode || obj.code;
      result.orderId = obj.order_id || obj.orderId || obj.order;

      if (result.ticketId) {
        return sanitizeParsed(result);
      }
    } catch (_) {
      // Continue if not valid JSON
    }
  }

  // 3. Labelled-key regexes: ticket[_ -]*id[:=]?, etc.
  const ticketIdMatch = raw.match(/(?:ticket[_\s-]*id|ticket|attendee[_\s-]*id)[:=\s]+([^\s,;|]+)/i);
  if (ticketIdMatch) result.ticketId = ticketIdMatch[1];

  const eventIdMatch = raw.match(/(?:event[_\s-]*id|event)[:=\s]+([^\s,;|]+)/i);
  if (eventIdMatch) result.eventId = eventIdMatch[1];

  const secCodeMatch = raw.match(/(?:security[_\s-]*code|sec[_\s-]*code|code)[:=\s]+([^\s,;|]+)/i);
  if (secCodeMatch) result.securityCode = secCodeMatch[1];

  const orderIdMatch = raw.match(/(?:order[_\s-]*id|order)[:=\s]+([^\s,;|]+)/i);
  if (orderIdMatch) result.orderId = orderIdMatch[1];

  if (result.ticketId) {
    return sanitizeParsed(result);
  }

  // 4. Delimited string: e.g. TICKET_ID|EVENT_ID|SEC_CODE or tab-separated
  if (raw.includes('|') || raw.includes('\t')) {
    const delimiter = raw.includes('|') ? '|' : '\t';
    const parts = raw.split(delimiter).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 1) {
      result.ticketId = parts[0];
      if (parts.length >= 2) result.eventId = parts[1];
      if (parts.length >= 3) result.securityCode = parts[2];
      return sanitizeParsed(result);
    }
  }

  // 5. Fallback: Entire trimmed string is ticket_id
  result.ticketId = raw;
  return sanitizeParsed(result);
}

/**
 * Sanitize fields within parsed payload
 * @param {ParsedPayload} parsed 
 * @returns {ParsedPayload}
 */
function sanitizeParsed(parsed) {
  if (parsed.ticketId) parsed.ticketId = sanitizeString(parsed.ticketId);
  if (parsed.eventId) parsed.eventId = sanitizeString(parsed.eventId);
  if (parsed.securityCode) parsed.securityCode = sanitizeString(parsed.securityCode);
  if (parsed.orderId) parsed.orderId = sanitizeString(parsed.orderId);
  return parsed;
}

/**
 * Normalize security code for comparison
 * @param {string|undefined} code 
 * @param {boolean} [lookalikeMapping=false] 
 * @returns {string}
 */
export function normalizeSecurityCode(code, lookalikeMapping = false) {
  if (!code) return '';
  let clean = code.toUpperCase().replace(/[\s\-_]/g, '');
  if (lookalikeMapping) {
    clean = clean.replace(/O/g, '0').replace(/I/g, '1').replace(/B/g, '8');
  }
  return clean;
}

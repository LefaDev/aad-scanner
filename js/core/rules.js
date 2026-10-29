// @ts-check
import { STATUS_PHRASES, STATUS_ICONS, getActionLine } from '../config/strings.js';
import { getAadEvent } from '../config/events.js';
import { getGate } from '../config/gates.js';
import { normalizeSecurityCode } from './parser.js';
import { resolveTicket } from './lookup.js';
import { findPriorScan } from './session.js';

/**
 * @typedef {import('./state.js').Ticket} Ticket
 * @typedef {import('./state.js').ScanResult} ScanResult
 * @typedef {import('./parser.js').ParsedPayload} ParsedPayload
 */

/**
 * Derive access scope from ticket type or label
 * @param {string} [type] 
 * @param {string} [label] 
 * @returns {{ scope: 'full'|'day'|'evening'|'tour'|'virtual', unmapped: boolean }}
 */
export function deriveAccessScope(type = '', label = '') {
  const combined = `${type} ${label}`.toLowerCase();
  if (combined.includes('virtual')) {
    return { scope: 'virtual', unmapped: false };
  }
  if (/tour|soweto|heritage/.test(combined)) {
    return { scope: 'tour', unmapped: false };
  }
  if (/dinner|storytelling|experience|evening/.test(combined)) {
    return { scope: 'evening', unmapped: false };
  }
  if (/day|daytime|daily/.test(combined)) {
    return { scope: 'day', unmapped: false };
  }
  if (/full|residential|all-access|all\s*inclusive|conference|delegate/.test(combined)) {
    return { scope: 'full', unmapped: false };
  }
  return { scope: 'full', unmapped: true };
}

/**
 * Check if a ticket has VIP or Speaker status
 * @param {Ticket} ticket 
 * @returns {string|null} 'VIP' | 'SPEAKER' | 'PRESS' | null
 */
export function detectSpecialBadge(ticket) {
  const text = `${ticket.ticket_type || ''} ${ticket.ticket_label || ''} ${ticket.holder_name || ''}`.toUpperCase();
  if (text.includes('SPEAKER') || text.includes('KEYNOTE')) return 'SPEAKER';
  if (text.includes('VIP')) return 'VIP';
  if (text.includes('PRESS') || text.includes('MEDIA')) return 'PRESS';
  return null;
}

/**
 * Validate a scanned ticket against the active manifest and gate rules
 * @param {ParsedPayload} payload 
 * @param {Record<string, any>} manifestTickets 
 * @param {string} activeEventId 
 * @param {string} activeGateId 
 * @param {Record<string, any>} scannedSet 
 * @param {string} operatorName 
 * @param {boolean} [lookalikeMapping=false] 
 * @returns {ScanResult}
 */
export function validateTicket(
  payload,
  manifestTickets,
  activeEventId,
  activeGateId,
  scannedSet,
  operatorName,
  lookalikeMapping = false
) {
  const now = new Date();
  const scanTime = now.toLocaleTimeString('en-ZA', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const activeEvent = getAadEvent(activeEventId);
  const activeGate = getGate(activeGateId);
  const gateName = activeGate ? activeGate.name : activeGateId;

  // Unreadable or empty code
  if (!payload.ticketId) {
    return {
      valid: false,
      status: 'invalid',
      phrase: STATUS_PHRASES.invalid,
      icon: STATUS_ICONS.invalid,
      holderName: 'Unknown Ticket',
      ticketType: 'Unreadable Code',
      ticketId: 'UNKNOWN',
      orderId: '—',
      gateName,
      scanTime,
      actionLine: 'Unreadable QR code or empty input. Please re-scan.',
      rawPayload: payload.raw
    };
  }

  // Tolerant lookup (memoized O(1))
  const resolved = resolveTicket(manifestTickets, payload.ticketId);
  const ticket = resolved.ticket;

  // 1. No ticket in active manifest
  if (!ticket) {
    return {
      valid: false,
      status: 'invalid',
      phrase: STATUS_PHRASES.invalid,
      icon: STATUS_ICONS.invalid,
      holderName: 'Unregistered Ticket',
      ticketType: 'Not in Manifest',
      ticketId: payload.ticketId,
      orderId: payload.orderId || '—',
      gateName,
      scanTime,
      actionLine: getActionLine('invalid'),
      source: undefined,
      rawPayload: payload.raw
    };
  }

  const badge = detectSpecialBadge(ticket);
  const holderName = ticket.holder_name || ticket.purchaser_name || 'Ticket Holder';
  const ticketType = ticket.ticket_type || ticket.ticket_label || 'Delegate Pass';
  const orderId = ticket.order_id || '—';
  const scopeInfo = deriveAccessScope(ticket.ticket_type, ticket.ticket_label);
  const ticketScope = ticket.access_scope || scopeInfo.scope;

  const isTourSession = (activeEvent && activeEvent.access === 'tour') || (activeGate && activeGate.group === 'tours');
  const isEveningSession = (activeEvent && activeEvent.access === 'evening') || (activeGate && activeGate.group === 'evening');
  const isTicketTour = ticket.exclusion_id === 'tour' || ticketScope === 'tour' || /tour|excursion/i.test(ticket.exclusion_reason || '');
  const isMatchingEventTicket = ticket.exclusion_id === 'event'
    && Boolean(activeEvent && ticket.event_id && ticket.event_id === activeEvent.id);
  const passMeta = {
    source: ticket.source,
    passTier: ticket.pass_tier,
    passTierLabel: ticket.pass_tier_label,
    cadence: ticket.cadence,
    validDates: ticket.valid_dates
  };

  // 1b. Non-conference items (tours, event functions, merchandise):
  //     Allow tours at tour sessions and event tickets at their matching event;
  //     deny all other excluded products (and deny tour tickets at conference halls).
  if (ticket.excluded && !(isTourSession && isTicketTour) && !isMatchingEventTicket) {
    const reason = ticket.exclusion_reason || 'This item is not a conference pass';
    return {
      valid: false,
      status: 'invalid',
      phrase: 'NOT A CONFERENCE PASS',
      icon: 'icon-ban',
      holderName,
      ticketType,
      ticketId: ticket.ticket_id,
      orderId,
      gateName,
      scanTime,
      securityCode: ticket.security_code,
      actionLine: `${reason}. Direct the delegate to the relevant desk — this does not admit to conference sessions.`,
      reasonCode: 'not_conference',
      isVip: !!badge,
      source: ticket.source,
      rawPayload: payload.raw
    };
  }

  // Conversely, a standard conference pass without tour entitlement cannot board a tour bus
  if (isTourSession && !isTicketTour && ticket.pass_tier !== 'all_inclusive') {
    return {
      valid: false,
      status: 'wrong_event',
      phrase: 'NO TOUR ENTITLEMENT',
      icon: STATUS_ICONS.wrong_event,
      holderName,
      ticketType,
      ticketId: ticket.ticket_id,
      orderId,
      gateName,
      scanTime,
      securityCode: ticket.security_code,
      actionLine: 'Conference pass does not include this excursion. Direct delegate to the tour desk.',
      reasonCode: 'not_tour',
      isVip: !!badge,
      source: ticket.source,
      rawPayload: payload.raw
    };
  }

  // 1c. Evening functions are not included in daytime-only passes.
  //     Checked on BOTH evening gate AND evening event (e.g. Storytelling Dinner).
  if (isEveningSession && (ticket.evening_access === false || (ticketScope === 'day' && ticket.evening_access !== true))) {
    return {
      valid: false,
      status: 'invalid',
      phrase: 'NO EVENING ACCESS',
      icon: 'icon-ban',
      holderName,
      ticketType,
      ticketId: ticket.ticket_id,
      orderId,
      gateName,
      scanTime,
      securityCode: ticket.security_code,
      actionLine: 'This pass is daytime only. Scan at a conference gate, or send the delegate to the registration desk.',
      reasonCode: 'no_evening_access',
      isVip: !!badge,
      source: ticket.source,
      rawPayload: payload.raw
    };
  }

  // 2. Ticket event_date / event_id entitlement check
  const ticketDate = ticket.event_date;
  const activeDate = activeEvent ? activeEvent.date : null;

  const validDates = Array.isArray(ticket.valid_dates) && ticket.valid_dates.length
    ? ticket.valid_dates
    : null;
  const dayEntitled = validDates
    ? (activeDate ? validDates.includes(activeDate) : true)
    : null;

  // Explicit single-event ticket (e.g. Storytelling Dinner ticket scanned on Day 3 Conference)
  if (
    ticket.event_id &&
    activeEvent &&
    ticket.event_id !== activeEvent.id &&
    ticketScope !== 'full' &&
    !(isTourSession && isTicketTour && (!ticketDate || ticketDate === activeDate))
  ) {
    const targetEvent = getAadEvent(ticket.event_id, ticketScope);
    const targetName = targetEvent ? targetEvent.name : ticket.event_name || 'Scheduled Session';
    return {
      valid: false,
      status: 'wrong_event',
      phrase: STATUS_PHRASES.wrong_event,
      icon: STATUS_ICONS.wrong_event,
      holderName,
      ticketType,
      ticketId: ticket.ticket_id,
      orderId,
      gateName,
      scanTime,
      securityCode: ticket.security_code,
      actionLine: getActionLine('wrong_event', { eventName: targetName, eventDate: ticketDate || (targetEvent && targetEvent.date) }),
      isVip: !!badge,
      rawPayload: payload.raw
    };
  }

  // Rule 2: Wrong day
  if (activeDate && ticketDate && ticketDate !== activeDate && dayEntitled !== true && !ticket.date_unverified) {
    const isConferenceOrEveningForAllInclusive =
      (activeEvent && activeEvent.gateGroup === 'conference' && ticketScope === 'full') ||
      (isEveningSession && (ticket.evening_access === true || ticket.pass_tier === 'all_inclusive'));

    if (!isConferenceOrEveningForAllInclusive) {
      const targetEvent = getAadEvent(ticket.event_id || ticketDate, ticketScope);
      const targetName = targetEvent ? targetEvent.name : ticket.event_name || 'Scheduled Session';
      return {
        valid: false,
        status: 'wrong_event',
        phrase: STATUS_PHRASES.wrong_event,
        icon: STATUS_ICONS.wrong_event,
        holderName,
        ticketType,
        ticketId: ticket.ticket_id,
        orderId,
        gateName,
        scanTime,
        securityCode: ticket.security_code,
      actionLine: getActionLine('wrong_event', { eventName: targetName, eventDate: ticketDate }),
      isVip: !!badge,
      ...passMeta,
      rawPayload: payload.raw
    };
  }
  }

  // Walk-ins with explicit validDates that do NOT include today
  if (validDates && dayEntitled === false) {
    return {
      valid: false,
      status: 'wrong_event',
      phrase: STATUS_PHRASES.wrong_event,
      icon: STATUS_ICONS.wrong_event,
      holderName,
      ticketType,
      ticketId: ticket.ticket_id,
      orderId,
      gateName,
      scanTime,
      securityCode: ticket.security_code,
      actionLine: getActionLine('wrong_event', { eventName: 'Registered Days', eventDate: validDates.join(', ') }),
      isVip: !!badge,
      ...passMeta,
      rawPayload: payload.raw
    };
  }

  // 3. Virtual pass at a physical gate
  if (ticketScope === 'virtual' && activeGate && activeGate.group !== 'virtual') {
    return {
      valid: false,
      status: 'virtual_denied',
      phrase: STATUS_PHRASES.virtual_denied,
      icon: STATUS_ICONS.virtual_denied,
      holderName,
      ticketType,
      ticketId: ticket.ticket_id,
      orderId,
      gateName,
      scanTime,
      securityCode: ticket.security_code,
      actionLine: getActionLine('virtual_denied'),
      isVip: !!badge,
      rawPayload: payload.raw
    };
  }

  // 4. Cancelled / refunded / voided status
  const orderStatus = (ticket.order_status || '').toLowerCase();
  if (ticket.isCancelled || /cancel|refund|void/.test(orderStatus)) {
    return {
      valid: false,
      status: 'cancelled',
      phrase: STATUS_PHRASES.cancelled,
      icon: STATUS_ICONS.cancelled,
      holderName,
      ticketType,
      ticketId: ticket.ticket_id,
      orderId,
      gateName,
      scanTime,
      securityCode: ticket.security_code,
      actionLine: getActionLine('cancelled', { orderId }),
      isVip: !!badge,
      rawPayload: payload.raw
    };
  }

  // 5. Manifest has a security_code that does not match
  if (ticket.security_code && payload.securityCode) {
    const normManifest = normalizeSecurityCode(ticket.security_code, lookalikeMapping);
    const normPayload = normalizeSecurityCode(payload.securityCode, lookalikeMapping);
    if (normManifest !== normPayload) {
      return {
        valid: false,
        status: 'invalid',
        phrase: STATUS_PHRASES.invalid,
        icon: STATUS_ICONS.invalid,
        holderName,
        ticketType,
        ticketId: ticket.ticket_id,
        orderId,
        gateName,
        scanTime,
        securityCode: ticket.security_code,
        actionLine: getActionLine('invalid', { reason: 'security_mismatch' }),
        isVip: !!badge,
        rawPayload: payload.raw
      };
    }
  }

  // 6. Already admitted at THIS session (scoped by eventId, with Day 1..5 legacy date fallback
  //    for conference gates only — so Day 3 Plenaries never block Wednesday's Dinner).
  const activeDateKey = activeEvent ? activeEvent.date : '';
  const priorHit = findPriorScan(
    scannedSet,
    ticket.ticket_id,
    activeEvent ? activeEvent.id : activeEventId,
    activeDateKey,
    activeEvent ? activeEvent.gateGroup : 'conference'
  );
  const prior = priorHit ? priorHit.entry : null;

  const seats = Math.max(1, Number(ticket.quantity) || 1);
  const admitsToday = prior ? (Number(prior.count) || 1) : 0;
  const seatsRemaining = Math.max(0, seats - admitsToday);

  if (prior && seatsRemaining <= 0) {
    return {
      valid: false,
      status: 'duplicate',
      phrase: STATUS_PHRASES.duplicate,
      icon: STATUS_ICONS.duplicate,
      holderName,
      ticketType,
      ticketId: ticket.ticket_id,
      orderId,
      gateName,
      scanTime,
      securityCode: ticket.security_code,
      firstScanTime: prior.time,
      firstScanGate: prior.gate,
      actionLine: seats > 1
        ? `All ${seats} seat(s) on this order have already been admitted at this session (first at ${prior.time}, ${prior.gate}).`
        : getActionLine('duplicate', { firstScanTime: prior.time, firstScanGate: prior.gate }),
      seats,
      admitsToday,
      isVip: !!badge,
      rawPayload: payload.raw
    };
  }

  // 7. Pre-checked in manifest but not yet scanned on this device
  if (ticket.preCheckedIn) {
    return {
      valid: true,
      status: 'prechecked',
      phrase: STATUS_PHRASES.prechecked,
      icon: STATUS_ICONS.prechecked,
      holderName,
      ticketType,
      ticketId: ticket.ticket_id,
      orderId,
      gateName,
      scanTime,
      securityCode: ticket.security_code,
      actionLine: 'Pre-checked in manifest. Admitted with audit flag.',
      seats,
      admitsToday: admitsToday + 1,
      isVip: !!badge,
      rawPayload: payload.raw
    };
  }

  // Out-of-window soft warning for evening / tour sessions
  let softWarning;
  if (ticket.date_unverified) {
    softWarning = 'DATE UNVERIFIED — ADMITTED';
  }
  if (activeEvent && activeEvent.window) {
    const [startStr, endStr] = activeEvent.window.split('–').map(s => s.trim());
    if (startStr && endStr) {
      const currentHoursMinutes = now.getHours() * 60 + now.getMinutes();
      const [sh, sm] = startStr.split(':').map(Number);
      const [eh, em] = endStr.split(':').map(Number);
      const startMins = sh * 60 + sm;
      const endMins = eh * 60 + em;
      if (currentHoursMinutes < startMins || currentHoursMinutes > endMins) {
        softWarning = softWarning ? `${softWarning} · OUTSIDE SESSION WINDOW` : 'OUTSIDE SESSION WINDOW';
      }
    }
  }

  // 8. Normal admission
  return {
    valid: true,
    status: 'valid',
    phrase: STATUS_PHRASES.valid,
    icon: STATUS_ICONS.valid,
    holderName,
    ticketType,
    ticketId: ticket.ticket_id,
    orderId,
    gateName,
    scanTime,
    securityCode: ticket.security_code,
    actionLine: seats > 1
      ? `Admitted — seat ${admitsToday + 1} of ${seats} on this order.`
      : (softWarning ? 'Admitted (advisory flag logged).' : 'Admitted. Delegate may enter.'),
    softWarning,
    seats,
    admitsToday: admitsToday + 1,
    isVip: !!badge,
    matchedVia: resolved.matchedVia,
    resolvedTicketId: resolved.resolvedId,
    source: ticket.source,
    passTier: ticket.pass_tier,
    passTierLabel: ticket.pass_tier_label,
    cadence: ticket.cadence,
    validDates: ticket.valid_dates,
    rawPayload: payload.raw
  };
}

/**
 * SUPERVISOR OVERRIDE
 * @param {ScanResult} result The denial being overridden
 * @param {string} reason Free-text reason, required
 * @param {string} operator Operator authorising it
 * @returns {ScanResult}
 */
export function overrideAdmission(result, reason, operator) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) {
    throw new Error('An override reason is required.');
  }

  return {
    ...result,
    valid: true,
    status: 'valid',
    phrase: 'OVERRIDDEN — ADMIT',
    actionLine: `Supervisor override by ${operator || 'staff'}: ${cleanReason}`,
    overriddenFrom: result.status,
    overrideReason: cleanReason,
    overrideOperator: operator || 'staff',
    softWarning: 'MANUAL OVERRIDE LOGGED'
  };
}

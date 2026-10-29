// @ts-check
/**
 * MULTI-SOURCE MANIFEST IMPORTER
 * ==============================
 * Replaces the single-shot `handleManifestFile` behaviour, which REPLACED the
 * whole manifest on every upload — meaning the WooCommerce export and the
 * PayPal export could never coexist in the app.
 *
 * Design rules
 * ------------
 *  R1  Merge, don't replace. Importing a second store ADDS to the manifest.
 *  R2  Never let a purchase date become an attendance date (the #1 cause of
 *      false "wrong day" denials with PayPal/Woo exports).
 *  R3  A ticket id collision is surfaced, never silently overwritten — a
 *      silently dropped ticket is an angry delegate at the door.
 *  R4  Build a normalised lookup index so "AAD-1002", "aad 1002" and "1002"
 *      all resolve to the same ticket despite how the QR was generated.
 *  R5  An unrecognised column list is reported, so an operator knows they
 *      picked the wrong export before the doors open.
 *
 * Two vocabularies are kept deliberately separate:
 *   rawNorm[]  — 'billing_email', 'transaction_id', 'invoice_number'
 *                Used for source detection and per-store field priority.
 *   canonical[] — 'holder_email', 'order_id', 'event_date'
 *                Used for structure: what is a date, what is noise.
 */

import { parseCsvRows, normalizeDate } from './csv.js';
import { normalizeHeader, isPurchaseDateHeader, PASSTHROUGH_COLUMNS } from '../config/columns.js';
import { detectSource, getSourceProfile, SOURCE_PROFILES } from '../config/sources.js';
import { parsePayload } from './parser.js';
import { deriveAccessScope } from './rules.js';
import { classifyPass, resolveValidDates, extractConferenceDateFromText, inferAadEventIdFromText } from '../config/passes.js';
import { normaliseTicketKey, buildLookupIndex, resolveTicket } from './lookup.js';

/**
 * @typedef {import('./state.js').Ticket} Ticket
 * @typedef {{
 *   id: string, label: string, blurb: string,
 *   matched: string[], confidence: number
 * }} DetectedSource
 * @typedef {{
 *   detected: DetectedSource,
 *   rawHeaders: string[],
 *   unmappedHeaders: string[],
 *   hasAttendanceDate: boolean,
 *   hasPurchaseDateOnly: boolean,
 *   rowCount: number
 * }} CsvAnalysis
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Headers we know are real fields (anything here is never "unmapped"). */
const KNOWN_CANONICAL = new Set([
  'ticket_id', 'qr_payload', 'order_id', 'order_status', 'ticket_type',
  'ticket_label', 'event_id', 'event_date', 'event_name', 'security_code',
  'check_in', 'holder_name', 'holder_email', 'organisation', 'phone',
  'purchaser_name', 'purchaser_email', 'access_scope', 'seat_info', 'quantity',
  'source', 'purchase_date'
]);

const PASSTHROUGH = new Set(PASSTHROUGH_COLUMNS);

/**
 * slug('From Email Address') -> 'from_email_address'
 * @param {string} h
 */
function slug(h) {
  return String(h)
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Classify every column exactly once, so analysis and import always agree.
 * @param {string[]} rawHeaders
 */
function classifyColumns(rawHeaders) {
  const rawNorm = rawHeaders.map(slug);
  const canonical = rawHeaders.map(h => normalizeHeader(h));

  /** raw header index -> canonical key (null = ignore) */
  /** @type {(string|null)[]} */
  const roleOf = [];
  /** @type {string[]} */
  const unmapped = [];
  /** @type {number[]} */
  const purchaseDateIdx = [];
  /** @type {number[]} */
  const attendanceDateIdx = [];

  rawHeaders.forEach((raw, i) => {
    const canon = canonical[i];
    const purchaseish = isPurchaseDateHeader(raw);

    if (canon === 'event_date' && purchaseish) {
      // R2 — a purchase date is never an attendance date.
      roleOf[i] = 'purchase_date';
      purchaseDateIdx.push(i);
      return;
    }
    if (canon === 'event_date') {
      roleOf[i] = 'event_date';
      attendanceDateIdx.push(i);
      return;
    }
    if (KNOWN_CANONICAL.has(canon)) {
      roleOf[i] = canon;
      return;
    }
    if (purchaseish) {
      roleOf[i] = 'purchase_date';
      purchaseDateIdx.push(i);
      return;
    }
    if (PASSTHROUGH.has(rawNorm[i])) {
      roleOf[i] = null; // recognised, intentionally unused
      return;
    }
    roleOf[i] = null;
    unmapped.push(raw);
  });

  return { rawNorm, canonical, roleOf, unmapped, purchaseDateIdx, attendanceDateIdx };
}

/**
 * Inspect a CSV without importing it. Drives the "what am I about to load?"
 * confirmation step in the UI.
 * @param {string} csvText
 * @returns {CsvAnalysis}
 */
export function analyseCsv(csvText) {
  const rows = parseCsvRows(csvText);
  const rawHeaders = rows.length > 0 ? rows[0] : [];
  const cols = classifyColumns(rawHeaders);
  const detection = detectSource(cols.rawNorm);

  return {
    detected: {
      id: detection.profile.id,
      label: detection.profile.label,
      blurb: detection.profile.blurb,
      matched: detection.matched,
      confidence: detection.confidence
    },
    rawHeaders,
    unmappedHeaders: cols.unmapped,
    hasAttendanceDate: cols.attendanceDateIdx.length > 0,
    hasPurchaseDateOnly: cols.purchaseDateIdx.length > 0 && cols.attendanceDateIdx.length === 0,
    rowCount: Math.max(0, rows.length - 1)
  };
}

/**
 * Pick the first non-empty value from a priority list, reading BOTH the raw
 * export vocabulary ('invoice_number') and canonical keys ('order_id').
 * @param {Record<string,string>} raw
 * @param {Record<string,string>} canon
 * @param {string[]} priority
 * @returns {string}
 */
function pick(raw, canon, priority) {
  for (const key of priority) {
    const a = raw[key];
    if (a && a.trim()) return a.trim();
    const b = canon[key];
    if (b && b.trim()) return b.trim();
  }
  return '';
}

/**
 * Import a CSV into a manifest, merging with whatever is already loaded.
 *
 * @param {string} csvText
 * @param {{
 *   manifest?: { meta?: any, tickets: Record<string, Ticket>, sources?: any[] } | null,
 *   fileName?: string,
 *   sourceId?: string,
 *   eventId?: string,
 *   defaultDate?: string,
 *   knownEventDates?: string[],
 *   operator?: string
 * }} options
 */
export function importCsv(csvText, options = {}) {
  const {
    manifest: existing = null,
    fileName = 'manifest.csv',
    sourceId = '',
    eventId = '',
    defaultDate = '',
    knownEventDates = [],
    operator = ''
  } = options;

  const rows = parseCsvRows(csvText);
  const warnings = [];

  if (rows.length < 2) {
    return {
      manifest: existing || { meta: {}, tickets: {}, sources: [] },
      report: emptyReport(fileName, 'File has no data rows below the header.')
    };
  }

  const rawHeaders = rows[0];
  const cols = classifyColumns(rawHeaders);
  const detection = detectSource(cols.rawNorm);
  const profile = sourceId ? getSourceProfile(sourceId) : detection.profile;
  const label = profile.label;

  if (sourceId && detection.confidence > 0 && detection.profile.id !== sourceId) {
    warnings.push(
      `You selected ${label}, but this file looks like a ${detection.profile.label} export ` +
      `(${detection.matched.slice(0, 3).join(', ')}). Check you picked the right file.`
    );
  } else if (!sourceId && detection.confidence === 0) {
    warnings.push('Columns were not recognised as Event Tickets Plus, WooCommerce or PayPal. Using the generic mapping.');
  }

  if (cols.attendanceDateIdx.length === 0) {
    warnings.push(
      'No attendance-date column found (only order/transaction dates). ' +
      `Every ticket will be valid for the session you are loading into — ${label} exports do not contain a conference day.`
    );
  }

  const baseTickets = existing && existing.tickets ? existing.tickets : {};
  /** @type {Record<string, Ticket>} */
  const merged = { ...baseTickets };
  /** @type {Record<string, Ticket>} */
  const incoming = {};
  /**
   * Multi-attendee orders: the same ticket id appearing several times in one
   * file means several delegates on one code, not a duplicate sale.
   * @type {Record<string, string[]>}
   */
  const roster = {};

  const skipped = [];
  /** @type {Array<{ticketId:string, keptFrom:string, droppedFrom:string, holder:string}>} */
  const collisions = [];
  let cancelled = 0, prechecked = 0, dateSoftened = 0, loaded = 0, excludedCount = 0;

  const knownDates = new Set(knownEventDates.filter(Boolean));

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];

    // Two views of the same row
    /** @type {Record<string,string>} */
    const raw = {};
    /** @type {Record<string,string>} */
    const canon = {};
    for (let i = 0; i < rawHeaders.length; i++) {
      const val = row[i] !== undefined ? String(row[i]).trim() : '';
      const rk = cols.rawNorm[i];
      if (rk && !raw[rk]) raw[rk] = val;
      const role = cols.roleOf[i];
      if (role && !canon[role]) canon[role] = val;
    }

    // --- Ticket id resolution ---
    let ticketId = pick(raw, canon, profile.idPriority);
    let eventIdFromRow = canon.event_id || '';
    let securityCode = canon.security_code || '';
    let orderIdFromPayload = '';

    const qrValue = canon.qr_payload || raw.qr_data || raw.qr_code || raw.ticket_url || raw.url || '';
    if (qrValue) {
      const parsed = parsePayload(qrValue);
      if (parsed.ticketId) ticketId = parsed.ticketId;
      if (parsed.eventId) eventIdFromRow = parsed.eventId;
      if (parsed.securityCode) securityCode = parsed.securityCode;
      if (parsed.orderId) orderIdFromPayload = parsed.orderId;
    }

    if (!ticketId) {
      skipped.push({
        rowNumber: r + 1,
        reason: 'No ticket id / order id in this row',
        raw: row.join(',').slice(0, 200)
      });
      continue;
    }

    // --- Status & pre-check ---
    const statusVal = canon.order_status || '';
    const isCancelled = profile.statusCancels.test(statusVal);
    if (isCancelled) cancelled++;

    const checkInVal = (canon.check_in || '').toLowerCase();
    const preCheckedIn = !isCancelled &&
      (/^(yes|y|true|1)$/.test(checkInVal) || /checked|scanned|already|admitted/.test(checkInVal));
    if (preCheckedIn) prechecked++;

    // --- Dates (R2) ---
    const attendanceRaw = cols.attendanceDateIdx.length > 0 ? (row[cols.attendanceDateIdx[0]] || '') : '';
    let eventDate = defaultDate;
    if (attendanceRaw) {
      const parsed = normalizeDate(attendanceRaw);
      if (parsed && ISO_DATE.test(parsed) && (knownDates.size === 0 || knownDates.has(parsed))) {
        eventDate = parsed;
      } else {
        dateSoftened++;
      }
    } else {
      dateSoftened++;
    }

    // --- Type, scope, badge ---
    const ticketType = pick(raw, canon, profile.typePriority) || canon.ticket_label || profile.label + ' Ticket';
    const ticketLabel = canon.ticket_label || ticketType;
    if (!eventIdFromRow) {
      eventIdFromRow = inferAadEventIdFromText(`${ticketType} ${ticketLabel} ${canon.event_name || ''}`) || '';
    }
    const holderName =
      pick(raw, canon, profile.namePriority.filter(k => k !== 'billing_first_name' && k !== 'billing_last_name')) ||
      `${canon.billing_first_name || raw.billing_first_name || ''} ${canon.billing_last_name || raw.billing_last_name || ''}`.trim() ||
      canon.purchaser_name ||
      'Ticket Holder';
    const holderEmail = pick(raw, canon, profile.emailPriority);

    // --- Pass classification (conference tier, exclusion, weekly vs daily) ---
    const passClass = classifyPass(ticketType, ticketLabel, canon.event_name || '');
    if (passClass.excluded) excludedCount++;

    // Entitlement: an explicit list of usable dates beats a single date field.
    // A daily pass with no attendance date in the export cannot be resolved,
    // so it is flagged rather than guessed — see the dateUnverified guard in
    // rules.js, which admits with a warning instead of denying a paid delegate.
    const hasAttendanceDate = Boolean(attendanceRaw);
    const inferredDateFromTitle = !hasAttendanceDate
      ? extractConferenceDateFromText(`${ticketType} ${ticketLabel} ${raw.variation_detail || ''} ${canon.event_name || ''}`)
      : null;
    if (inferredDateFromTitle) {
      eventDate = inferredDateFromTitle;
    }
    let validDates = resolveValidDates(passClass, eventDate);
    let dateUnverified = false;
    if (!passClass.excluded && passClass.cadence === 'daily' && !hasAttendanceDate && !inferredDateFromTitle) {
      validDates = null;
      dateUnverified = true;
    }

    const scopeData = deriveAccessScope(ticketType, ticketLabel);
    const accessScope = passClass.tierId
      ? (passClass.cadence === 'weekly' ? 'full' : passClass.cadence === 'daily' ? 'day' : scopeData.scope)
      : scopeData.scope;

    const isSpecial = /vip|speaker|press|media|keynote/i.test(`${ticketType} ${ticketLabel} ${holderName}`);

    // How many delegates does this one code/order admit?
    const rawQty = parseInt(String(canon.quantity || '').replace(/[^0-9]/g, ''), 10);
    // Clamp: a bad export value (9999) must not open the door to 9999 people.
    // 50 is far above any realistic group booking for this event.
    const MAX_SEATS = 50;
    const rowQuantity = Number.isFinite(rawQty) && rawQty > 0
      ? Math.min(rawQty, MAX_SEATS)
      : 1;

    // If the scan key IS the payment reference, prefer the invoice/custom
    // number as the human-readable order reference so the two columns are not
    // the same value in the audit export.
    let orderRef = canon.order_id || orderIdFromPayload || '';
    if (orderRef === ticketId) {
      orderRef = raw.invoice_number || raw.custom_number || orderRef;
    }

    /** @type {any} */
    const ticketObj = {
      ticket_id: ticketId,
      order_id: orderRef || undefined,
      order_status: canon.order_status || undefined,
      ticket_type: ticketType || undefined,
      ticket_label: ticketLabel || undefined,
      event_id: eventIdFromRow || undefined,
      event_date: eventDate || undefined,
      event_name: canon.event_name || undefined,
      security_code: securityCode || undefined,
      check_in: canon.check_in || undefined,
      holder_name: holderName,
      holder_email: holderEmail || undefined,
      organisation: canon.organisation || raw.billing_company || undefined,
      phone: canon.phone || undefined,
      purchaser_name: canon.purchaser_name || undefined,
      purchaser_email: canon.purchaser_email || undefined,
      access_scope: canon.access_scope || accessScope,
      seat_info: canon.seat_info || undefined,
      // Seats this one code may admit, per day. Usually 1.
      quantity: rowQuantity,
      source: canon.source || profile.id,
      purchase_date: canon.purchase_date || undefined,
      // --- AAD pass taxonomy ---
      pass_tier: passClass.tierId || undefined,
      pass_tier_label: passClass.tierLabel || undefined,
      cadence: passClass.cadence,
      valid_dates: validDates || undefined,
      evening_access: passClass.eveningAccess,
      excluded: passClass.excluded,
      exclusion_id: passClass.exclusionId || undefined,
      exclusion_reason: passClass.exclusionReason || undefined,
      date_unverified: dateUnverified || undefined,
      preCheckedIn,
      isCancelled,
      isVip: isSpecial,
      unmapped: passClass.unmapped
    };

    // --- R3: collisions surfaced, never swallowed ---
    if (incoming[ticketId]) {
      // Same code, several rows in ONE file = several delegates on one order
      // (e.g. a company buying three weekly passes together). That is not a
      // duplicate sale, so widen the seat count instead of dropping a person.
      const existing = incoming[ticketId];
      roster[ticketId] = roster[ticketId] || [existing.holder_name || ''];
      if (holderName && !roster[ticketId].includes(holderName)) {
        roster[ticketId].push(holderName);
      }
      const seats = Math.max(existing.quantity || 1, rowQuantity, roster[ticketId].length);
      existing.quantity = seats;
      existing.roster = [...roster[ticketId]];
      // Keep the most generous per-row quantity seen for this code.
      continue;
    }

    const alreadyThere = merged[ticketId];
    if (alreadyThere) {
      const samePerson = Boolean(holderEmail) &&
        (alreadyThere.holder_email || '').toLowerCase() === holderEmail.toLowerCase();
      if (!samePerson) {
        collisions.push({
          ticketId,
          keptFrom: alreadyThere.source || 'already loaded',
          droppedFrom: label,
          holder: holderName
        });
      }
      // Keep the existing ticket so already-printed QRs still resolve.
      continue;
    }

    incoming[ticketId] = ticketObj;
    // `loaded` means "conference delegates we can admit", which is the number
    // that matters at the door. Tours and merchandise are tracked separately.
    if (!passClass.excluded) loaded++;
  }

  // --- Merge & stamp ---
  const tickets = { ...merged, ...incoming };
  const prevSources = Array.isArray(existing && existing.sources) ? [...existing.sources] : [];
  const stamp = {
    profileId: profile.id,
    label,
    fileName,
    loadedAt: new Date().toISOString(),
    rowCount: loaded
  };
  const idx = prevSources.findIndex(s => s.profileId === stamp.profileId && s.fileName === stamp.fileName);
  if (idx >= 0) prevSources[idx] = stamp; else prevSources.push(stamp);

  const missingColumns = [];
  if (!tickets[Object.keys(tickets)[0]] === false) { /* noop */ }
  if (!cols.roleOf.some(r => r === 'ticket_id' || r === 'order_id' || r === 'qr_payload')) {
    missingColumns.push('ticket id (ticket_id / order_id / qr_data)');
  }
  if (!cols.roleOf.includes('holder_name')) missingColumns.push('name');
  if (!cols.roleOf.includes('holder_email')) missingColumns.push('email');

  const conferenceCount = Object.values(tickets).filter(t => !t.excluded).length;
  const excludedTotal = Object.values(tickets).filter(t => t.excluded).length;

  const manifest = {
    meta: {
      eventId: eventId || (existing && existing.meta ? existing.meta.eventId : ''),
      fileName,
      rowCount: Object.keys(tickets).length,
      conferenceCount,
      excludedCount: excludedTotal,
      loadedAt: new Date().toISOString(),
      source: profile.id,
      operator,
      importedFiles: prevSources.length
    },
    tickets,
    sources: prevSources
  };

  if (missingColumns.length > 0) {
    warnings.push(`Missing expected column(s): ${missingColumns.join(', ')}. Those fields will be blank.`);
  }
  const multiSeat = Object.values(tickets).filter(t => !t.excluded && Number(t.quantity) > 1);
  if (multiSeat.length > 0) {
    const totalSeats = multiSeat.reduce((n, t) => n + Number(t.quantity), 0);
    warnings.push(
      `${multiSeat.length} order(s) carry more than one seat (${totalSeats} delegates on ${multiSeat.length} code(s)). ` +
      'Each delegate scans the same code and is admitted individually.'
    );
  }

  if (excludedCount > 0) {
    warnings.push(
      `${excludedCount} row(s) in this file are tours or products, not conference passes. ` +
      'They are excluded from the delegate count and will be denied at the gate with a clear reason.'
    );
  }
  if (collisions.length > 0) {
    warnings.push(
      `${collisions.length} ticket id(s) appear in both files with different holders. ` +
      'The first was kept — review these before the doors open.'
    );
  }

  return {
    manifest,
    report: {
      sourceLabel: label,
      detectedLabel: detection.profile.label,
      detectionConfidence: detection.confidence,
      fileName,
      rowsRead: rows.length - 1,
      loaded,
      merged: prevSources.length,
      skipped,
      collisions,
      dateSoftened,
      cancelled,
      prechecked,
      unmappedColumns: cols.unmapped,
      missingColumns,
      totalAfterMerge: Object.keys(tickets).length,
      conferenceTotal: conferenceCount,
      excludedTotal,
      excludedThisFile: excludedCount,
      tierBreakdown: summariseTiers(tickets),
      warnings
    }
  };
}

/**
 * Count delegates per conference pass tier, and everything excluded.
 * @param {Record<string, any>} tickets
 * @returns {{ tiers: Array<{ label: string, count: number }>, excluded: Array<{ label: string, count: number }> }}
 */
function summariseTiers(tickets) {
  /** @type {Record<string, number>} */
  const tiers = {};
  /** @type {Record<string, number>} */
  const excluded = {};

  for (const t of Object.values(tickets)) {
    if (t.excluded) {
      const key = t.exclusion_reason || 'Excluded';
      excluded[key] = (excluded[key] || 0) + 1;
      continue;
    }
    const key = t.pass_tier_label || 'Unrecognised pass type';
    tiers[key] = (tiers[key] || 0) + 1;
  }

  return {
    tiers: Object.entries(tiers).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    excluded: Object.entries(excluded).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  };
}

/**
 * @param {string} fileName
 * @param {string} reason
 */
function emptyReport(fileName, reason) {
  return {
    sourceLabel: 'Unknown', detectedLabel: 'Unknown', detectionConfidence: 0, fileName,
    rowsRead: 0, loaded: 0, merged: 0,
    skipped: [{ rowNumber: 1, reason, raw: '' }],
    collisions: [], dateSoftened: 0, cancelled: 0, prechecked: 0,
    unmappedColumns: [], missingColumns: [], totalAfterMerge: 0,
    warnings: [reason]
  };
}

// Lookup helpers live in ./lookup.js so rules.js can share them without a
// circular import. Re-exported here for convenience.
export { normaliseTicketKey, buildLookupIndex, resolveTicket };

export { SOURCE_PROFILES };

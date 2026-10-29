// @ts-check
import { normalizeHeader } from '../config/columns.js';
import { parsePayload } from './parser.js';
import { deriveAccessScope } from './rules.js';
import { neutralizeCsvFormula } from './security.js';

/**
 * @typedef {import('./state.js').Ticket} Ticket
 */

/**
 * Parse raw CSV text according to RFC 4180
 * @param {string} text 
 * @returns {string[][]} Array of row cell arrays
 */
export function parseCsvRows(text) {
  if (!text) return [];

  // Strip BOM
  let str = text.replace(/^\uFEFF/, '');
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const nextChar = str[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" -> "
          currentCell += '"';
          i++;
        } else {
          insideQuotes = false;
        }
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\r') {
        if (nextChar === '\n') i++;
        currentRow.push(currentCell.trim());
        currentCell = '';
        if (currentRow.some(c => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else if (char === '\n') {
        currentRow.push(currentCell.trim());
        currentCell = '';
        if (currentRow.some(c => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else {
        currentCell += char;
      }
    }
  }

  // Push final cell and row if exists
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(c => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Normalise a date string to YYYY-MM-DD
 * @param {string} [dateStr] 
 * @returns {string|undefined}
 */
export function normalizeDate(dateStr) {
  if (!dateStr) return undefined;
  const clean = dateStr.trim();
  // ISO: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }
  return clean;
}

/**
 * Process CSV text into a structured ticket manifest index
 * @param {string} csvText 
 * @param {string} defaultDate 
 * @returns {{
 *   tickets: Record<string, Ticket>,
 *   rowCount: number,
 *   skippedRows: Array<{ rowNumber: number, reason: string, raw: string }>,
 *   summary: {
 *     total: number,
 *     loaded: number,
 *     skipped: number,
 *     cancelled: number,
 *     prechecked: number,
 *     unmapped: number
 *   }
 * }}
 */
export function parseManifestCsv(csvText, defaultDate = '2026-10-26') {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) {
    return {
      tickets: {},
      rowCount: 0,
      skippedRows: [],
      summary: { total: 0, loaded: 0, skipped: 0, cancelled: 0, prechecked: 0, unmapped: 0 }
    };
  }

  const rawHeaders = rows[0];
  const headers = rawHeaders.map(h => normalizeHeader(h));

  /** @type {Record<string, Ticket>} */
  const tickets = {};
  const skippedRows = [];
  let cancelledCount = 0;
  let precheckedCount = 0;
  let unmappedCount = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    /** @type {Record<string, string>} */
    const item = {};

    headers.forEach((h, idx) => {
      item[h] = row[idx] !== undefined ? row[idx].trim() : '';
    });

    // Check QR payload derivation
    let ticketId = item.ticket_id;
    let eventId = item.event_id;
    let securityCode = item.security_code;

    if (item.qr_payload) {
      const parsed = parsePayload(item.qr_payload);
      if (parsed.ticketId) ticketId = parsed.ticketId;
      if (parsed.eventId) eventId = parsed.eventId;
      if (parsed.securityCode) securityCode = parsed.securityCode;
    }

    if (!ticketId) {
      skippedRows.push({
        rowNumber: r + 1,
        reason: 'Missing ticket ID',
        raw: row.join(',')
      });
      continue;
    }

    const orderStatus = (item.order_status || '').toLowerCase();
    const isCancelled = /cancel|refund|void/.test(orderStatus);
    if (isCancelled) cancelledCount++;

    const checkInVal = (item.check_in || '').toLowerCase();
    const preCheckedIn = !isCancelled && (/^yes$/.test(checkInVal) || /checked|scanned|already/.test(checkInVal));
    if (preCheckedIn) precheckedCount++;

    const isVip = /vip|speaker/i.test(`${item.ticket_type} ${item.ticket_label} ${item.holder_name}`);
    const scopeData = deriveAccessScope(item.ticket_type, item.ticket_label);
    if (scopeData.unmapped) unmappedCount++;

    const eventDate = normalizeDate(item.event_date) || defaultDate;

    /** @type {Ticket} */
    const ticketObj = {
      ticket_id: ticketId,
      order_id: item.order_id || undefined,
      order_status: item.order_status || undefined,
      ticket_type: item.ticket_type || undefined,
      ticket_label: item.ticket_label || undefined,
      event_id: eventId || undefined,
      event_date: eventDate,
      event_name: item.event_name || undefined,
      security_code: securityCode || undefined,
      check_in: item.check_in || undefined,
      holder_name: item.holder_name || undefined,
      holder_email: item.holder_email || undefined,
      purchaser_name: item.purchaser_name || undefined,
      purchaser_email: item.purchaser_email || undefined,
      access_scope: item.access_scope || scopeData.scope,
      seat_info: item.seat_info || undefined,
      preCheckedIn,
      isCancelled,
      isVip,
      unmapped: scopeData.unmapped
    };

    tickets[ticketId] = ticketObj;
  }

  const loadedCount = Object.keys(tickets).length;

  return {
    tickets,
    rowCount: loadedCount,
    skippedRows,
    summary: {
      total: rows.length - 1,
      loaded: loadedCount,
      skipped: skippedRows.length,
      cancelled: cancelledCount,
      prechecked: precheckedCount,
      unmapped: unmappedCount
    }
  };
}

/**
 * Format a single CSV cell safely (RFC 4180 + OWASP CWE-1236 formula defence).
 * @param {unknown} val
 * @returns {string}
 */
export function escapeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  const safe = neutralizeCsvFormula(val);
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Format rows as RFC 4180 CSV with spreadsheet formula-injection neutralisation
 * @param {Array<Record<string, any>>} rows 
 * @param {string[]} columns 
 * @returns {string}
 */
export function stringifyCsv(rows, columns) {
  const headerLine = columns.map(c => escapeCsvCell(c)).join(',');
  const rowLines = rows.map(row => columns.map(c => escapeCsvCell(row[c])).join(','));

  return [headerLine, ...rowLines].join('\r\n');
}

// @ts-check
import { stringifyCsv, escapeCsvCell } from './csv.js';

/**
 * Trigger a browser file download of CSV content (with UTF-8 BOM for Excel diacritics)
 * @param {string} content 
 * @param {string} filename 
 */
export function downloadFile(content, filename) {
  const withBom = content.startsWith('\uFEFF') ? content : '\uFEFF' + content;
  const blob = new Blob([withBom], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Format an array of cells into an RFC 4180 + formula-safe CSV line
 * @param {unknown[]} cells
 * @returns {string}
 */
function csvRow(cells) {
  return cells.map(escapeCsvCell).join(',');
}

/**
 * Export scan log to CSV (includes override attribution for auditability)
 * @param {any[]} logEntries 
 * @param {string} [eventName='aad2026'] 
 */
export function exportScanLog(logEntries, eventName = 'aad2026') {
  const columns = [
    'scanned_at',
    'event_id',
    'ticket_id',
    'status',
    'holder_name',
    'ticket_type',
    'order_id',
    'gate_name',
    'operator',
    'is_override',
    'override_reason',
    'raw_payload'
  ];

  const rows = logEntries.map(e => ({
    scanned_at: e.scannedAt,
    event_id: e.eventId || eventName,
    ticket_id: e.ticketId,
    status: e.status,
    holder_name: e.holderName,
    ticket_type: e.ticketType,
    order_id: e.orderId,
    gate_name: e.gateName,
    operator: e.operator,
    is_override: e.details && e.details.isOverride ? 'yes' : 'no',
    override_reason: (e.details && e.details.overrideReason) || '',
    raw_payload: e.rawPayload
  }));

  const csv = stringifyCsv(rows, columns);
  const dateStr = new Date().toISOString().split('T')[0];
  downloadFile(csv, `aad-scan-log-${eventName}-${dateStr}.csv`);
}

/**
 * Export summary report to CSV with proper quote & formula escaping
 * @param {any} reportData 
 * @param {string} [eventName='aad2026'] 
 */
export function exportReportCsv(reportData, eventName = 'aad2026') {
  const lines = [
    csvRow(['AAD 2026 Access Control Summary Report']),
    csvRow(['Generated At', reportData.generatedAt]),
    csvRow(['Operator', reportData.operator]),
    csvRow(['Device ID', reportData.deviceId]),
    '',
    csvRow(['Headline Figures']),
    csvRow(['Loaded in Manifest', reportData.headline.loaded]),
    csvRow(['Total Checked In', reportData.headline.admitted]),
    csvRow(['No-Shows (Expected - Admitted)', reportData.headline.noShows]),
    csvRow(['Denial Rate', reportData.headline.denialRate]),
    csvRow(['Total Denials', reportData.headline.denials]),
    '',
    csvRow(['Breakdown by Package']),
    csvRow(['Package / Ticket Type', 'Manifest Count', 'Admitted', 'Attendance %'])
  ];

  for (const [pkg, stat] of Object.entries(reportData.packages)) {
    // @ts-ignore
    const pct = stat.total > 0 ? ((stat.admitted / stat.total) * 100).toFixed(1) + '%' : '0.0%';
    // @ts-ignore
    lines.push(csvRow([pkg, stat.total, stat.admitted, pct]));
  }

  lines.push('');
  lines.push(csvRow(['Breakdown by Gate']));
  lines.push(csvRow(['Gate Name', 'Total Scans', 'Admitted', 'Denied']));
  for (const [gate, stat] of Object.entries(reportData.gates)) {
    // @ts-ignore
    lines.push(csvRow([gate, stat.total, stat.admitted, stat.denied]));
  }

  lines.push('');
  lines.push(csvRow(['Arrivals by 15-Minute Window']));
  lines.push(csvRow(['Time Window', 'Arrivals']));
  for (const [time, count] of Object.entries(reportData.arrivalBuckets)) {
    lines.push(csvRow([time, count]));
  }

  const csv = lines.join('\r\n');
  const dateStr = new Date().toISOString().split('T')[0];
  downloadFile(csv, `aad-gate-report-${eventName}-${dateStr}.csv`);
}

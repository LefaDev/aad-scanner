// @ts-check
/**
 * AAD Gate Validator — en-ZA string constants & operational copy
 */

export const STATUS_PHRASES = {
  valid: 'ADMIT',
  prechecked: 'PRE-CHECKED',
  duplicate: 'ALREADY SCANNED',
  invalid: 'NOT VALID',
  cancelled: 'CANCELLED',
  wrong_event: 'WRONG DAY',
  virtual_denied: 'VIRTUAL PASS'
};

export const STATUS_ICONS = {
  valid: 'icon-check-circle',
  prechecked: 'icon-clock',
  duplicate: 'icon-alert-triangle',
  invalid: 'icon-x-circle',
  cancelled: 'icon-ban',
  wrong_event: 'icon-calendar-x',
  virtual_denied: 'icon-monitor-off'
};

/**
 * Generate operational next-action line for denials
 * @param {string} status 
 * @param {Record<string, any>} [details]
 * @returns {string}
 */
export function getActionLine(status, details = {}) {
  switch (status) {
    case 'duplicate':
      return `First scanned at ${details.firstScanTime || 'earlier session'} · ${details.firstScanGate || 'other gate'}. Send to helpdesk if the delegate disputes this.`;
    case 'wrong_event':
      return `This pass is for ${details.eventName || 'another session'} on ${details.eventDate || 'another date'}.`;
    case 'virtual_denied':
      return 'Virtual delegates do not receive gate access. Direct them to the virtual helpdesk.';
    case 'cancelled':
      return `Order ${details.orderId || 'record'} was cancelled or refunded. Do not admit.`;
    case 'invalid':
      if (details.reason === 'security_mismatch') {
        return 'Security code does not match this ticket.';
      }
      return 'No matching ticket in the loaded manifest. Check the code or search the log.';
    default:
      return '';
  }
}

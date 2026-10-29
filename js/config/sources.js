// @ts-check
/**
 * SOURCE PROFILES — Event Tickets Plus, WooCommerce & PayPal normalisation
 * ---------------------------------------------------------------
 * The gate validator does not need to know *how* a ticket was sold. It needs
 * five things per delegate: a ticket id, a name, an email, a ticket type and
 * the DAY the ticket is valid for.
 *
 * Both WooCommerce and PayPal exports already contain those, but under
 * different column names, and — critically — both contain a `Date` column that
 * is the PURCHASE date, not the event date. Treating that as `event_date`
 * denies every single ticket as "wrong day". See PURCHASE_DATE_COLUMNS below.
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   blurb: string,
 *   signatures: string[],
 *   idPriority: string[],
 *   emailPriority: string[],
 *   namePriority: string[],
 *   typePriority: string[],
 *   dateColumns: string[],
 *   statusCancels: RegExp
 * }} SourceProfile
 */

/** @type {SourceProfile[]} */
export const SOURCE_PROFILES = [
  {
    id: 'woocommerce',
    label: 'WooCommerce',
    blurb: 'WooCommerce → Orders → Export (CSV)',
    // Headers that practically only WooCommerce emits
    signatures: [
      'billing_email', 'billing_first_name', 'billing_last_name', 'line_item_name',
      'order_number', 'item_name', 'order_id', 'order_status', 'customer_email',
      'order_item_name', 'product_name', 'wc_order_id'
    ],
    idPriority: [
      'ticket_id', 'ticket_code', 'qr_payload', 'order_id', 'order_number', 'orderid'
    ],
    emailPriority: ['holder_email', 'billing_email', 'customer_email', 'email'],
    namePriority: [
      'holder_name', 'billing_name', 'customer_name', 'name',
      'billing_first_name', 'billing_last_name'
    ],
    typePriority: ['ticket_type', 'line_item_name', 'product_name', 'item_name', 'product'],
    // Never let these become the event date
    dateColumns: ['order_date', 'date_created', 'date', 'date_paid', 'completed_at', 'paid_date'],
    statusCancels: /cancel|refund|void|failed|trash|fraud/i
  },
  {
    id: 'paypal',
    label: 'PayPal',
    blurb: 'PayPal → Activity → Download (CSV)',
    signatures: [
      'transaction_id', 'txn_id', 'reference_txn_id', 'invoice_number', 'gross',
      'net', 'fee', 'from_email_address', 'to_email_address', 'balance', 'balance_impact',
      'item_title', 'custom_number', 'transaction_status', 'payment_status'
    ],
    // CONFIRMED 2026-10-26: AAD ticket QRs for PayPal purchases encode the
    // PayPal TRANSACTION ID, so that is the scan key. Custom/Invoice numbers
    // stay as fallbacks in case some batches were issued differently.
    idPriority: [
      'ticket_id', 'ticket_code', 'qr_payload', 'transaction_id', 'txn_id',
      'custom_number', 'invoice_number', 'order_id'
    ],
    emailPriority: ['holder_email', 'from_email_address', 'email', 'payer_email'],
    namePriority: ['holder_name', 'from_name', 'name', 'payer_name', 'full_name'],
    typePriority: ['ticket_type', 'item_title', 'item_name', 'product', 'description'],
    dateColumns: ['date', 'time', 'transaction_date', 'payment_date', 'initiated_date'],
    statusCancels: /refund|reversed|cancel|denied|failed|chargeback/i
  },
  {
    id: 'event_tickets',
    label: 'Event Tickets Plus',
    blurb: 'Event Tickets Plus attendee / ticket export',
    // ET+ attendee reports commonly include attendee-specific fields. These
    // signatures help distinguish the roster from a WooCommerce order export.
    signatures: ['attendee_name', 'attendee_email', 'ticket_number', 'ticket_id', 'event_name', 'event_id', 'check_in'],
    idPriority: ['ticket_id', 'ticket_code', 'qr_payload', 'attendee_id', 'code', 'order_id'],
    emailPriority: ['holder_email', 'attendee_email', 'email', 'customer_email'],
    namePriority: ['holder_name', 'attendee_name', 'name', 'full_name', 'customer_name'],
    typePriority: ['ticket_type', 'ticket_label', 'ticket', 'package', 'product_name', 'product'],
    dateColumns: ['date', 'order_date', 'purchase_date'],
    statusCancels: /cancel|refund|void|reversed|denied|failed/i
  },
  {
    id: 'generic',
    label: 'Generic / Other',
    blurb: 'Any CSV with a ticket id, name, email and ticket type',
    signatures: [],
    idPriority: ['ticket_id', 'ticket_code', 'attendee_id', 'code', 'id'],
    emailPriority: ['holder_email', 'email', 'attendee_email', 'customer_email'],
    namePriority: ['holder_name', 'attendee_name', 'name', 'full_name', 'customer_name'],
    typePriority: ['ticket_type', 'ticket_label', 'ticket', 'package', 'product'],
    dateColumns: ['date', 'order_date', 'purchase_date', 'transaction_date', 'created_at'],
    statusCancels: /cancel|refund|void|reversed|denied|failed/i
  }
];

/**
 * Any header matching these is a PURCHASE date, never an attendance date.
 * Guarded centrally in importer.js so a single bad alias can never deny a gate.
 * @type {string[]}
 */
export const PURCHASE_DATE_COLUMNS = [
  'date', 'time', 'order_date', 'date_created', 'date_paid', 'completed_at',
  'paid_date', 'purchase_date', 'transaction_date', 'payment_date',
  'initiated_date', 'created_at', 'updated_at', 'timestamp'
];

/** Headers that legitimately describe attendance entitlement. */
export const ATTENDANCE_DATE_COLUMNS = [
  'event_date', 'eventdate', 'ticket_date', 'session_date', 'attendance_date',
  'day_attended', 'attends_on', 'valid_date', 'valid_for', 'conference_day'
];

/**
 * Guess which store a CSV came from, by counting signature header hits.
 * @param {string[]} normalisedHeaders
 * @returns {{ profile: SourceProfile, confidence: number, matched: string[] }}
 */
export function detectSource(normalisedHeaders) {
  let best = { profile: getSourceProfile('generic'), confidence: 0, matched: /** @type {string[]} */ ([]) };

  for (const profile of SOURCE_PROFILES) {
    if (profile.signatures.length === 0) continue;
    const matched = normalisedHeaders.filter(h => profile.signatures.includes(h));
    // Confidence = hits, tie-broken by ratio of the profile we recognised
    const confidence = matched.length;
    if (confidence > best.confidence) {
      best = { profile, confidence, matched };
    }
  }

  return best;
}

/**
 * Get a profile by id, falling back to generic.
 * @param {string} id
 * @returns {SourceProfile}
 */
export function getSourceProfile(id) {
  return SOURCE_PROFILES.find(p => p.id === id) || SOURCE_PROFILES.find(p => p.id === 'generic') || SOURCE_PROFILES[0];
}

// @ts-check
/**
 * Canonical template columns and accepted aliases.
 *
 * MULTI-SOURCE SUPPORT (Event Tickets Plus + PayPal, with WooCommerce compatibility):
 *  1. `event_date` no longer accepts a bare `date` column. A bare `date` in a
 *     WooCommerce or PayPal export is the PURCHASE date. Mapping it to the
 *     event date makes every ticket deny as "wrong day". See sources.js.
 *  2. Added PayPal identifiers (invoice_number, custom_number, transaction_id)
 *     and WooCommerce ones (order_number, billing_email, line_item_name).
 *  3. Added organisation / phone / source / purchase_date for walk-ins and
 *     cross-source audits.
 *  4. `purchaser_email` typo `purchase_email_address` replaced with the real
 *     WooCommerce header `purchaser_email_address`.
 */

export const CANONICAL_COLUMNS = [
  'ticket_id',
  'order_id',
  'order_status',
  'ticket_type',
  'ticket_label',
  'event_id',
  'event_date',
  'event_name',
  'security_code',
  'check_in',
  'holder_name',
  'holder_email',
  'organisation',
  'phone',
  'purchaser_name',
  'purchaser_email',
  'access_scope',
  'seat_info',
  'quantity',
  'source',
  'purchase_date'
];

/** @type {Record<string, string[]>} */
export const COLUMN_ALIASES = {
  ticket_id: [
    'ticket_id', 'ticket_code', 'ticket_no', 'ticket_number', 'ticketid',
    'attendee_id', 'code', 'id'
  ],
  qr_payload: [
    'qr_data', 'qr', 'qr_code', 'qr_content', 'qr_text', 'ticket_url', 'url', 'qr_data_url'
  ],
  order_id: [
    'order_id', 'orderid', 'order', 'order_number', 'order_no',
    'invoice_number', 'invoice', 'invoice_no', 'custom_number',
    'transaction_id', 'txn_id', 'transaction', 'payment_id', 'reference'
  ],
  order_status: [
    'order_status', 'orderstatus', 'status', 'transaction_status', 'payment_status',
    'payment_state', 'order_state'
  ],
  ticket_type: [
    'ticket_type', 'tickettype', 'product', 'package', 'product_name',
    'line_item_name', 'order_item_name', 'item_name', 'item_title', 'ticket_category'
  ],
  ticket_label: [
    'ticket_label', 'ticket', 'ticket_name', 'tier', 'pass_type', 'description',
    'subject', 'memo', 'note_subject'
  ],
  event_id: ['event_id', 'eventid', 'event_code', 'event_key'],
  // NOTE: deliberately no bare `date` / `time` here — see file header.
  event_date: [
    'event_date', 'eventdate', 'event_day', 'ticket_date', 'session_date',
    'attendance_date', 'day_attended', 'attends_on', 'valid_date', 'valid_for',
    'conference_day', 'day'
  ],
  event_name: ['event_name', 'eventname', 'event_title', 'session_name'],
  security_code: ['security_code', 'securitycode', 'sec_code', 'validation_code', 'barcode'],
  check_in: ['check_in', 'checkin', 'checked_in', 'checkedin', 'scanned', 'attended', 'admitted'],
  holder_name: [
    'ticket_holder_name', 'holder_name', 'attendee_name', 'attendee', 'full_name',
    'billing_name', 'from_name', 'name', 'customer_name', 'billing_full_name'
  ],
  holder_email: [
    'ticket_holder_email_address', 'holder_email', 'attendee_email', 'billing_email',
    'customer_email', 'from_email_address', 'payer_email', 'email', 'email_address'
  ],
  organisation: [
    'organisation', 'organization', 'company', 'company_name', 'org',
    'billing_company', 'employer', 'affiliation', 'institution'
  ],
  phone: ['phone', 'telephone', 'mobile', 'cell', 'phone_number', 'billing_phone', 'contact_number'],
  purchaser_name: ['purchaser_name', 'buyer_name', 'payer_name', 'purchaser', 'sold_to_name'],
  purchaser_email: [
    'purchaser_email', 'purchaser_email_address', 'buyer_email', 'payer_email_address',
    'purchase_email', 'sold_to_email'
  ],
  access_scope: ['access_scope', 'scope', 'access_level', 'entitlement'],
  seat_info: ['seat_info', 'seat', 'seat_number', 'table', 'table_number'],
  quantity: [
    'quantity', 'qty', 'seats', 'seat_count', 'attendees', 'attendee_count',
    'line_item_quantity', 'ticket_quantity', 'number_of_tickets', 'num_tickets', 'pax'
  ],
  source: ['source', 'channel', 'sales_channel', 'store', 'platform', 'gateway'],
  purchase_date: [
    'purchase_date', 'order_date', 'date_created', 'date_paid', 'completed_at',
    'transaction_date', 'payment_date', 'initiated_date', 'paid_date', 'time'
  ]
};

/**
 * Columns that are ambiguous — the same header means different things in
 * different exports. We resolve them per-source in importer.js.
 * @type {Record<string, string[]>}
 */
export const AMBIGUOUS_COLUMNS = {
  date: ['event_date', 'purchase_date'],
  name: ['holder_name', 'purchaser_name'],
  status: ['order_status'],
  description: ['ticket_label', 'ticket_type']
};

/**
 * Columns we recognise as part of a known export but deliberately do not map
 * to a manifest field. Listing them stops the importer crying "unmapped" about
 * harmless extras like billing_first_name in a WooCommerce export.
 * @type {string[]}
 */
export const PASSTHROUGH_COLUMNS = [
  'billing_first_name', 'billing_last_name', 'billing_address_1', 'billing_address_2',
  'billing_city', 'billing_state', 'billing_postcode', 'billing_country',
  'shipping_first_name', 'shipping_last_name', 'shipping_address_1', 'shipping_city',
  'customer_note', 'customer_id', 'user_id', 'item_cost', 'order_currency',
  'currency', 'gross', 'fee', 'net', 'balance', 'balance_impact', 'timezone',
  'from_name', 'to_name', 'to_email_address', 'transaction_type', 'payment_type',
  'shipping_address', 'note', 'coupon_code', 'discount_total', 'order_subtotal',
  'order_total', 'tax_total', 'payment_method', 'payment_method_title', 'cart_hash',
  'date_completed', 'post_type', 'item_type', 'variation_detail', 'product_id',
  'item_subtotal', 'line_item_total', 'attendee', 'answers',
  // PayPal activity-download bookkeeping
  'type', 'transaction_type', 'timezone', 'to_email_address', 'note'
];

/**
 * Normalise a raw column header string.
 * @param {string} header
 * @returns {string}
 */
export function normalizeHeader(header) {
  const clean = String(header)
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (canonical === clean || aliases.includes(clean)) {
      return canonical;
    }
  }
  return clean;
}

/**
 * True when a header is a purchase/transaction timestamp rather than an
 * attendance date. Used to veto `event_date` assignment.
 * @param {string} rawHeader
 * @returns {boolean}
 */
export function isPurchaseDateHeader(rawHeader) {
  const clean = String(rawHeader).replace(/^\uFEFF/, '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!clean) return false;
  // A bare `date` / `time` is always a transaction timestamp in these exports.
  if (clean === 'date' || clean === 'time' || clean === 'timestamp') return true;
  return COLUMN_ALIASES.purchase_date.includes(clean);
}

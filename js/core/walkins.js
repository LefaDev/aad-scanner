// @ts-check
/**
 * WALK-IN REGISTRATION — domain logic
 * ===================================
 * A walk-in is a delegate who turns up without a pre-purchased ticket. At the
 * desk we need to, in one action:
 *
 *   1. capture name / email / organisation / day(s) attended,
 *   2. issue a unique, human-readable ticket code,
 *   3. make that code immediately scannable for the rest of the conference,
 *   4. record the admission so the attendance report counts them,
 *   5. export a clean CSV for the registrar — with NO database involved.
 *
 * Storage is IndexedDB (see core/storage.js). Cloud sync is additive and
 * entirely optional, so the desk keeps working if the venue Wi-Fi does not.
 */

import { saveWalkIn, listWalkIns, deleteWalkIn, getWalkInIndex, countWalkIns } from './storage.js';
import { AAD_EVENTS } from '../config/events.js';
import { stringifyCsv } from './csv.js';
import { classifyPass } from '../config/passes.js';

/**
 * @typedef {{
 *   ticket_id: string,
 *   name: string,
 *   email: string,
 *   organisation: string,
 *   days: string[],
 *   event_date: string,
 *   source: 'walk_in',
 *   ticket_type: string,
 *   paid: boolean,
 *   amount: number|null,
 *   operator: string,
 *   gate_id: string,
 *   notes: string,
 *   created_at: string,
 *   synced?: boolean
 * }} WalkInRecord
 */

export const WALK_IN_PREFIX = 'WI';
export const NO_EMAIL_PLACEHOLDER = 'no-email@walkin.local';

/** The conference days a walk-in can be registered for. */
export function conferenceDays() {
  return AAD_EVENTS
    .filter(e => e.gateGroup === 'conference')
    .map(e => ({ date: e.date, name: e.name }));
}

/** Today in Africa/Johannesburg as YYYY-MM-DD. */
export function todayInSast() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return fmt.format(new Date());
}

/**
 * Issue the next walk-in code for a given day.
 * Format: WI-1026-0001  (day-month, then a per-day sequence)
 * Kept alphanumeric + hyphens so keyboard-wedge scanners and humans both cope.
 * @param {string} eventDate YYYY-MM-DD
 * @returns {Promise<string>}
 */
export async function nextWalkInCode(eventDate) {
  const existing = await listWalkIns(eventDate);
  let maxSeq = 0;
  const dayKey = eventDate.slice(5).replace('-', ''); // 1026
  for (const rec of existing) {
    const m = String(rec.ticket_id || '').match(/^WI-(\d{4})-(\d+)$/);
    if (m && m[1] === dayKey) {
      const n = parseInt(m[2], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  return `${WALK_IN_PREFIX}-${dayKey}-${String(maxSeq + 1).padStart(4, '0')}`;
}

/**
 * Validate a walk-in form submission.
 * @param {{name?:string,email?:string,organisation?:string,days?:string[],noEmail?:boolean}} form
 * @returns {{ ok: boolean, errors: Record<string,string> }}
 */
export function validateWalkIn(form) {
  /** @type {Record<string,string>} */
  const errors = {};

  const name = (form.name || '').trim();
  if (!name) errors.name = 'Name is required.';
  else if (name.length < 2) errors.name = 'Name looks too short.';

  const noEmail = Boolean(form.noEmail);
  const email = (form.email || '').trim();
  if (!noEmail) {
    if (!email) errors.email = 'Email is required (or tick “no email”).';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'That email address is not valid.';
  }

  const days = form.days || [];
  if (!Array.isArray(days) || days.length === 0) errors.days = 'Select at least one day attended.';

  const org = (form.organisation || '').trim();
  if (org.length > 120) errors.organisation = 'Organisation is too long.';

  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Has this email already been registered as a walk-in?
 * Cheap guard against one person queuing twice at two desks.
 * @param {string} email
 * @param {string} [eventDate]
 * @returns {Promise<WalkInRecord|null>}
 */
export async function findWalkInByEmail(email, eventDate) {
  const clean = (email || '').trim().toLowerCase();
  if (!clean || clean === NO_EMAIL_PLACEHOLDER) return null;
  const rows = await listWalkIns(eventDate);
  return /** @type {any} */ (rows.find(r => String(r.email).toLowerCase() === clean) || null);
}

/**
 * Create and persist a walk-in registration.
 *
 * @param {{
 *   name: string, email?: string, organisation?: string, days: string[],
 *   noEmail?: boolean, ticketType?: string, paid?: boolean, amount?: number|null,
 *   operator?: string, gateId?: string, notes?: string, eventDate?: string,
 *   allowDuplicate?: boolean
 * }} form
 * @param {{ operator?: string, gateId?: string }} [ctx]
 * @returns {Promise<{ ok: boolean, record?: WalkInRecord, errors?: Record<string,string>, duplicate?: WalkInRecord }>}
 */
export async function createWalkIn(form, ctx = {}) {
  const validation = validateWalkIn(form);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  const eventDate = form.eventDate || (form.days && form.days[0]) || todayInSast();
  const email = form.noEmail ? NO_EMAIL_PLACEHOLDER : (form.email || '').trim();

  if (!form.allowDuplicate) {
    const duplicate = await findWalkInByEmail(email, eventDate);
    if (duplicate) return { ok: false, errors: { email: `Already registered today as ${duplicate.ticket_id}.` }, duplicate };
  }

  const ticketId = await nextWalkInCode(eventDate);
  const days = [...new Set(form.days)].sort();

  /** @type {WalkInRecord} */
  const record = {
    ticket_id: ticketId,
    name: (form.name || '').trim(),
    email,
    organisation: (form.organisation || '').trim(),
    days,
    event_date: eventDate,
    source: 'walk_in',
    ticket_type: form.ticketType || 'Standard Conference Daytime Pass',
    paid: Boolean(form.paid),
    amount: form.amount === undefined || form.amount === null || Number.isNaN(form.amount)
      ? null
      : Number(form.amount),
    operator: ctx.operator || form.operator || 'Gate Staff',
    gate_id: ctx.gateId || form.gateId || 'gate-02',
    notes: (form.notes || '').trim(),
    created_at: new Date().toISOString()
  };

  await saveWalkIn(record);
  return { ok: true, record };
}

/**
 * Remove a walk-in (correction of a mis-keyed registration).
 * @param {string} ticketId
 */
export async function removeWalkIn(ticketId) {
  await deleteWalkIn(ticketId);
}

/**
 * Convert walk-in records into manifest Ticket objects so the existing
 * validation engine can scan them with no special-casing.
 * @param {WalkInRecord[]} records
 * @returns {Record<string, any>}
 */
export function walkInsToTickets(records) {
  /** @type {Record<string, any>} */
  const tickets = {};
  for (const r of records) {
    // Use the same taxonomy as imported passes so reporting and the gate
    // behave identically for walk-ins and pre-sold tickets.
    const passClass = classifyPass(r.ticket_type || '', '');
    tickets[r.ticket_id] = {
      ticket_id: r.ticket_id,
      order_id: r.ticket_id,
      order_status: 'completed',
      ticket_type: r.ticket_type,
      ticket_label: r.ticket_type,
      event_date: r.event_date,
      // Full conference access if every conference day was selected.
      access_scope: r.days.length >= 5 ? 'full' : 'day',
      valid_dates: r.days,
      check_in: '',
      holder_name: r.name,
      holder_email: r.email,
      organisation: r.organisation,
      purchaser_name: r.name,
      purchaser_email: r.email,
      source: 'walk_in',
      pass_tier: passClass.tierId || undefined,
      pass_tier_label: passClass.tierLabel || r.ticket_type,
      cadence: r.days && r.days.length >= 5 ? 'weekly' : 'daily',
      evening_access: passClass.eveningAccess,
      excluded: false,
      preCheckedIn: false,
      isCancelled: false,
      isVip: /vip|speaker|press/i.test(r.ticket_type),
      unmapped: false
    };
  }
  return tickets;
}

/**
 * Merge walk-ins into the live ticket map.
 * @param {Record<string, any>} tickets
 * @returns {Promise<Record<string, any>>}
 */
export async function withWalkIns(tickets) {
  const records = await listWalkIns();
  return { ...tickets, ...walkInsToTickets(/** @type {any} */ (records)) };
}

/**
 * Count of walk-ins per day, for the desk's own dashboard.
 * @returns {Promise<Record<string, number>>}
 */
export async function walkInCountsByDay() {
  const rows = await listWalkIns();
  /** @type {Record<string, number>} */
  const counts = {};
  for (const r of rows) {
    for (const d of r.days || [r.event_date]) {
      counts[d] = (counts[d] || 0) + 1;
    }
  }
  return counts;
}

export const WALK_IN_CSV_COLUMNS = [
  'ticket_id', 'name', 'email', 'organisation', 'day_attended',
  'event_date', 'ticket_type', 'paid', 'amount', 'operator', 'gate_id', 'notes', 'created_at'
];

/**
 * Export walk-ins as CSV — the deliverable the registrar actually asks for.
 * One row per delegate-day so pivot tables in Excel just work.
 * @param {WalkInRecord[]} [records]
 * @returns {Promise<{ csv: string, rowCount: number, filename: string }>}
 */
export async function exportWalkInsCsv(records) {
  const rows = records || /** @type {any} */ (await listWalkIns());

  /** @type {any[]} */
  const flat = [];
  for (const r of rows) {
    const days = (r.days && r.days.length ? r.days : [r.event_date]);
    for (const day of days) {
      flat.push({
        ticket_id: r.ticket_id,
        name: r.name,
        email: r.email,
        organisation: r.organisation,
        day_attended: day,
        event_date: r.event_date,
        ticket_type: r.ticket_type,
        paid: r.paid ? 'yes' : 'no',
        amount: r.amount === null || r.amount === undefined ? '' : r.amount.toFixed(2),
        operator: r.operator,
        gate_id: r.gate_id,
        notes: r.notes,
        created_at: r.created_at
      });
    }
  }

  const csv = stringifyCsv(flat, WALK_IN_CSV_COLUMNS);
  const stamp = todayInSast();
  return { csv, rowCount: flat.length, filename: `aad-walkins-${stamp}.csv` };
}

/**
 * Aggregate stats for the walk-in desk UI.
 * @returns {Promise<{ total: number, today: number, paid: number, unpaid: number, revenue: number, orgs: number, noEmail: number }>}
 */
export async function walkInStats() {
  const rows = await listWalkIns();
  const today = todayInSast();
  const orgs = new Set();
  let paid = 0, revenue = 0, noEmail = 0, todayCount = 0;

  for (const r of rows) {
    if (r.organisation) orgs.add(r.organisation.toLowerCase());
    if (r.paid) { paid++; revenue += r.amount || 0; }
    if (r.email === NO_EMAIL_PLACEHOLDER) noEmail++;
    if (r.event_date === today) todayCount++;
  }

  return {
    total: rows.length,
    today: todayCount,
    paid,
    unpaid: rows.length - paid,
    revenue,
    orgs: orgs.size,
    noEmail
  };
}

// Re-exported for the UI layer. js/ui/walkin.js reads the registration list
// directly, and a missing named export here is a hard link-time error that
// stops the ENTIRE app from booting (not just this screen).
export { countWalkIns, listWalkIns };

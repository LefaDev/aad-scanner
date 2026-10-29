// @ts-check
import { resolveDefaultEventId } from '../config/events.js';
import { getOrCreateDeviceId } from './storage.js';

/**
 * @typedef {{
 *   ticket_id: string,
 *   order_id?: string,
 *   order_status?: string,
 *   ticket_type?: string,
 *   ticket_label?: string,
 *   event_id?: string,
 *   event_date?: string,
 *   event_name?: string,
 *   security_code?: string,
 *   check_in?: string,
 *   holder_name?: string,
 *   holder_email?: string,
 *   purchaser_name?: string,
 *   purchaser_email?: string,
 *   access_scope?: string,
 *   seat_info?: string,
 *   quantity?: number,
 *   excluded?: boolean,
 *   exclusion_id?: string,
 *   exclusion_reason?: string,
 *   evening_access?: boolean|null,
 *   pass_tier?: string,
 *   pass_tier_label?: string,
 *   valid_dates?: string[],
 *   date_unverified?: boolean,
 *   source?: string,
 *   preCheckedIn?: boolean,
 *   isCancelled?: boolean,
 *   isVip?: boolean,
 *   unmapped?: boolean
 * }} Ticket
 *
 * @typedef {{
 *   valid: boolean,
 *   status: 'valid'|'prechecked'|'duplicate'|'invalid'|'cancelled'|'wrong_event'|'virtual_denied',
 *   phrase: string,
 *   icon: string,
 *   holderName: string,
 *   ticketType: string,
 *   ticketId: string,
 *   orderId: string,
 *   gateName: string,
 *   scanTime: string,
 *   securityCode?: string,
 *   actionLine: string,
 *   softWarning?: string,
 *   isVip?: boolean,
 *   rawPayload: string,
 *   firstScanTime?: string,
 *   firstScanGate?: string,
 *   seats?: number,
 *   admitsToday?: number,
 *   matchedVia?: string,
 *   resolvedTicketId?: string,
 *   overriddenFrom?: string,
 *   overrideReason?: string,
 *   overrideOperator?: string
 * }} ScanResult
 *
 * @typedef {{
 *   id: string,
 *   scannedAt: string,
 *   eventId?: string,
 *   ticketId: string,
 *   status: string,
 *   holderName: string,
 *   ticketType: string,
 *   orderId: string,
 *   gateId: string,
 *   gateName: string,
 *   operator: string,
 *   rawPayload: string,
 *   details?: Record<string, any>
 * }} LogEntry
 *
 * @typedef {{
 *   loaded: number,
 *   checkedIn: number,
 *   prechecked: number,
 *   duplicates: number,
 *   invalid: number,
 *   cancelled: number
 * }} Counters
 */

const initialState = {
  activeEventId: resolveDefaultEventId(),
  activeGateId: 'gate-02',
  operatorName: 'Gate Staff',
  deviceId: getOrCreateDeviceId(),
  manifest: /** @type {any} */ (null),
  counters: {
    loaded: 0,
    checkedIn: 0,
    prechecked: 0,
    duplicates: 0,
    invalid: 0,
    cancelled: 0
  },
  scannedSet: /** @type {Record<string, { time: string, gate: string, count?: number }>} */ ({}),
  log: /** @type {LogEntry[]} */ ([]),
  currentResult: /** @type {ScanResult|null} */ (null),
  settings: {
    cloudSync: false,
    supabaseUrl: '',
    supabaseAnonKey: '',
    autoSubmitMs: 120,
    dupGuardMs: 700,
    beepVolume: 0.5,
    vibration: true,
    keepAwake: true,
    lookalikeMapping: false,
    supervisorPinHash: ''
  },
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  cloudStatus: 'disconnected',
  syncing: false,
  sessionRestored: false,
  sessionStartedAt: new Date().toISOString()
};

/** @type {typeof initialState} */
let state = Object.freeze({ ...initialState });

/** @type {Set<(state: typeof initialState) => void>} */
const listeners = new Set();

/**
 * Get immutable snapshot of current state
 * @returns {typeof initialState}
 */
export function getState() {
  return state;
}

/**
 * Update state with a partial patch
 * @param {Partial<typeof initialState>} patch 
 */
export function setState(patch) {
  state = Object.freeze({
    ...state,
    ...patch
  });
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (err) {
      console.error('Error in state listener:', err);
    }
  }
}

/**
 * Subscribe to state changes
 * @param {(state: typeof initialState) => void} fn 
 * @returns {() => void} Unsubscribe function
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Reset session counts, log and scanned set (counting only conference passes in `loaded`)
 */
export function resetSession() {
  const loadedCount = state.manifest && state.manifest.tickets
    ? Object.values(state.manifest.tickets).filter((/** @type {any} */ t) => !t.excluded).length
    : 0;
  setState({
    counters: {
      loaded: loadedCount,
      checkedIn: 0,
      prechecked: 0,
      duplicates: 0,
      invalid: 0,
      cancelled: 0
    },
    scannedSet: {},
    log: [],
    currentResult: null,
    sessionStartedAt: new Date().toISOString()
  });
}

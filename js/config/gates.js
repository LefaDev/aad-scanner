// @ts-check
/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   group: string
 * }} Gate
 */

/** @type {Gate[]} */
export const GATES = [
  { id: 'gate-01', name: 'Main Entrance', group: 'conference' },
  { id: 'gate-02', name: 'Delegate Registration', group: 'conference' },
  { id: 'gate-03', name: 'Plenary Hall', group: 'conference' },
  { id: 'gate-04', name: 'Evening Reception', group: 'evening' },
  { id: 'gate-05', name: 'Tour Departure — Birchwood', group: 'tours' },
  { id: 'gate-06', name: 'Virtual Helpdesk', group: 'virtual' },
];

/**
 * Get gate by ID
 * @param {string} gateId 
 * @returns {Gate|undefined}
 */
export function getGate(gateId) {
  // Fall back to the first gate so a stale saved id degrades to a real gate
  // name instead of leaving the header blank.
  return GATES.find(g => g.id === gateId) || GATES[0];
}

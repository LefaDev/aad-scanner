// @ts-check
/**
 * @typedef {import('./state.js').Counters} Counters
 * @typedef {import('./state.js').ScanResult} ScanResult
 */

/**
 * Update counters based on a new scan result
 * @param {Counters} currentCounters 
 * @param {ScanResult['status']} status 
 * @returns {Counters}
 */
export function updateCounters(currentCounters, status) {
  const next = { ...currentCounters };

  switch (status) {
    case 'valid':
      next.checkedIn += 1;
      break;
    case 'prechecked':
      next.prechecked += 1;
      next.checkedIn += 1;
      break;
    case 'duplicate':
      next.duplicates += 1;
      break;
    case 'invalid':
    case 'wrong_event':
    case 'virtual_denied':
      next.invalid += 1;
      break;
    case 'cancelled':
      next.cancelled += 1;
      break;
  }

  return next;
}

/**
 * Reconcile counters when a supervisor overrides a previous denial.
 * Decrements the exact denial bucket that `updateCounters` incremented.
 *
 * @param {Counters} currentCounters
 * @param {string} [overriddenStatus]
 * @returns {Counters}
 */
export function reconcileOverrideCounters(currentCounters, overriddenStatus) {
  const next = { ...currentCounters };
  if (overriddenStatus === 'duplicate') {
    next.duplicates = Math.max(0, next.duplicates - 1);
  } else if (overriddenStatus === 'cancelled') {
    next.cancelled = Math.max(0, next.cancelled - 1);
  } else {
    next.invalid = Math.max(0, next.invalid - 1);
  }
  next.checkedIn += 1;
  return next;
}

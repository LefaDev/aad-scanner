// @ts-check
import { $ } from './dom.js';

/**
 * @typedef {import('../core/state.js').Counters} Counters
 */

/** @type {Record<string, number>} */
const previousValues = {
  loaded: 0,
  checkedIn: 0,
  prechecked: 0,
  duplicates: 0,
  invalid: 0,
  cancelled: 0
};

/**
 * Animate a counter element from start to end value
 * @param {HTMLElement} el 
 * @param {number} start 
 * @param {number} end 
 * @param {number} [duration=180] 
 */
function animateValue(el, start, end, duration = 180) {
  if (start === end) {
    el.textContent = end.toLocaleString();
    return;
  }

  // Check reduced motion preference
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    el.textContent = end.toLocaleString();
    return;
  }

  const startTime = performance.now();

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const current = Math.round(start + (end - start) * progress);
    el.textContent = current.toLocaleString();

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      el.textContent = end.toLocaleString();
    }
  }

  requestAnimationFrame(step);
}

/**
 * Render all 6 stat counter cards
 * @param {Counters} counters 
 */
export function renderStats(counters) {
  const mapping = [
    { key: 'loaded', id: 'stat-val-loaded' },
    { key: 'checkedIn', id: 'stat-val-checkedin' },
    { key: 'prechecked', id: 'stat-val-prechecked' },
    { key: 'duplicates', id: 'stat-val-duplicates' },
    { key: 'invalid', id: 'stat-val-invalid' },
    { key: 'cancelled', id: 'stat-val-cancelled' }
  ];

  mapping.forEach(({ key, id }) => {
    const el = $(`#${id}`);
    if (el) {
      const targetVal = counters[key] || 0;
      const prevVal = previousValues[key] || 0;
      animateValue(el, prevVal, targetVal);
      previousValues[key] = targetVal;
    }
  });
}

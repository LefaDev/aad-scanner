// @ts-check

/**
 * Safe query selector with type assertion
 * @template {HTMLElement} T
 * @param {string} selector 
 * @param {ParentNode} [parent=document] 
 * @returns {T|null}
 */
export function $(selector, parent = document) {
  return parent.querySelector(selector);
}

/**
 * Safe query selector all
 * @template {HTMLElement} T
 * @param {string} selector 
 * @param {ParentNode} [parent=document] 
 * @returns {T[]}
 */
export function $$(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}

/**
 * Escape HTML to prevent XSS
 * @param {string|number|null|undefined} str 
 * @returns {string}
 */
export function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render SVG icon markup referencing icons.svg
 * @param {string} iconId 
 * @param {string} [className='icon'] 
 * @returns {string}
 */
export function iconSvg(iconId, className = 'icon') {
  return `<svg class="${className}" aria-hidden="true"><use href="assets/icons.svg#${iconId}"></use></svg>`;
}

/**
 * Copy text to clipboard with user feedback
 * @param {string} text 
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    return true;
  } catch (_) {
    return false;
  }
}

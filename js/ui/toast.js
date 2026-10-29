// @ts-check
import { iconSvg } from './dom.js';

/** @type {HTMLElement|null} */
let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

/**
 * Show a toast message safely (DOM XSS-proof: uses textContent for untrusted strings)
 * @param {string} message 
 * @param {'info'|'success'|'warn'|'error'} [type='info'] 
 * @param {number} [duration=3500] 
 */
export function showToast(message, type = 'info', duration = 3500) {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconName =
    type === 'success'
      ? 'icon-check-circle'
      : (type === 'error' || type === 'warn')
        ? 'icon-alert-triangle'
        : 'icon-scan';

  // Safe static icon markup + textContent for untrusted message strings
  toast.innerHTML = iconSvg(iconName);
  const textSpan = document.createElement('span');
  textSpan.textContent = String(message == null ? '' : message);
  toast.appendChild(textSpan);

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 180ms ease-out';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 200);
  }, duration);
}

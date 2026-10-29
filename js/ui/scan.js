// @ts-check
import { $, iconSvg } from './dom.js';
import { HardwareScanner } from '../core/scanner.js';
import { CameraQrScanner } from '../core/camera.js';
import { getState } from '../core/state.js';
import { showToast } from './toast.js';

/** @type {CameraQrScanner|null} */
let cameraInstance = null;

/**
 * Initialize scan card input, optical camera fallback, and focus enforcement
 * @param {(payload: string) => void} onScanSubmitted 
 * @returns {HardwareScanner}
 */
export function initScanInput(onScanSubmitted) {
  const inputEl = /** @type {HTMLInputElement} */ ($('#scan-input'));
  const submitBtn = $('#scan-submit-btn');
  const indicatorEl = $('#scan-indicator');
  const cameraBtn = /** @type {HTMLButtonElement|null} */ ($('#camera-scan-toggle-btn'));
  const cameraDrawer = $('#camera-scan-drawer');
  const cameraVideo = /** @type {HTMLVideoElement|null} */ ($('#camera-scan-video'));

  const handleDetectedPayload = (payload) => {
    setReadingState(true);
    try {
      onScanSubmitted(payload);
    } finally {
      setTimeout(() => setReadingState(false), 200);
    }
  };

  const scanner = new HardwareScanner({
    inputElement: inputEl,
    onScan: handleDetectedPayload,
    getAutoSubmitMs: () => getState().settings.autoSubmitMs || 120,
    getDupGuardMs: () => getState().settings.dupGuardMs || 700
  });

  if (submitBtn) {
    submitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      scanner.submitCurrentBuffer();
      refocusScanInput();
    });
  }

  // Optional optical camera QR fallback for phones/tablets without Zebra HID
  if (cameraBtn && cameraDrawer && cameraVideo) {
    if (!CameraQrScanner.isSupported()) {
      cameraBtn.title = 'Camera QR detection requires Chrome/Edge or Safari 17.2+';
    }

    cameraInstance = new CameraQrScanner({
      videoElement: cameraVideo,
      onDetect: (raw) => {
        handleDetectedPayload(raw);
      },
      onError: (msg) => {
        showToast(msg, 'warn');
        cameraDrawer.setAttribute('hidden', '');
        cameraBtn.innerHTML = `${iconSvg('icon-camera', 'icon')} <span>Camera scan</span>`;
      },
      dupGuardMs: () => Math.max(1200, getState().settings.dupGuardMs || 700)
    });

    cameraBtn.addEventListener('click', async () => {
      if (!cameraInstance) return;
      if (cameraInstance.active) {
        cameraInstance.stop();
        cameraDrawer.setAttribute('hidden', '');
        cameraBtn.innerHTML = `${iconSvg('icon-camera', 'icon')} <span>Camera scan</span>`;
        refocusScanInput();
      } else {
        const started = await cameraInstance.start();
        if (started) {
          cameraDrawer.removeAttribute('hidden');
          cameraBtn.innerHTML = `${iconSvg('icon-x', 'icon')} <span>Stop camera</span>`;
        }
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && cameraInstance && cameraInstance.active) {
        cameraInstance.stop();
        cameraDrawer.setAttribute('hidden', '');
        cameraBtn.innerHTML = `${iconSvg('icon-camera', 'icon')} <span>Camera scan</span>`;
      }
    });
  }

  function setReadingState(isReading) {
    if (!indicatorEl) return;
    if (isReading) {
      indicatorEl.innerHTML = `
        <span class="pulse-dot" style="background-color: var(--color-primary)"></span>
        <span>READING…</span>
      `;
    } else {
      indicatorEl.innerHTML = `
        <span class="pulse-dot"></span>
        <span>WAITING FOR SCAN</span>
      `;
    }
  }

  function refocusScanInput() {
    const openDialog = document.querySelector('dialog[open]');
    if (openDialog) return;
    const activePanel = document.querySelector('[data-panel="validator"]:not([hidden])');
    if (activePanel && inputEl && document.activeElement !== inputEl) {
      const activeEl = document.activeElement;
      if (activeEl && activeEl.matches('input, select, textarea')) return;
      inputEl.focus();
    }
  }

  window.addEventListener('focus', refocusScanInput);

  document.addEventListener('close', () => {
    setTimeout(refocusScanInput, 0);
  }, true);

  document.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (!target.closest('button, a, input, select, textarea, dialog, [role="button"]')) {
      refocusScanInput();
    }
  });

  setTimeout(refocusScanInput, 100);

  return scanner;
}

export function stopActiveCamera() {
  const cameraBtn = $('#camera-scan-toggle-btn');
  const cameraDrawer = $('#camera-scan-drawer');
  if (cameraInstance && cameraInstance.active) {
    cameraInstance.stop();
    if (cameraDrawer) cameraDrawer.setAttribute('hidden', '');
    if (cameraBtn) cameraBtn.innerHTML = `${iconSvg('icon-camera', 'icon')} <span>Camera scan</span>`;
  }
}

export function focusScanInput() {
  const inputEl = $('#scan-input');
  if (inputEl) {
    inputEl.focus();
  }
}

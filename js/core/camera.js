// @ts-check
/**
 * OPTICAL CAMERA QR FALLBACK
 * ==========================
 * Zebra keyboard-wedge scanners are the primary hardware at AAD gates,
 * but batteries die and Bluetooth HID pairings drop mid-rush.
 *
 * Uses the browser's built-in BarcodeDetector API + rear camera stream with
 * zero external CDN scripts so the app remains 100% offline-capable and CSP-clean.
 */

export class CameraQrScanner {
  /**
   * @param {{
   *   videoElement: HTMLVideoElement,
   *   onDetect: (rawValue: string) => void,
   *   onError?: (message: string) => void,
   *   dupGuardMs?: () => number
   * }} options
   */
  constructor(options) {
    this.video = options.videoElement;
    this.onDetect = options.onDetect;
    this.onError = options.onError || (() => {});
    this.getDupGuardMs = options.dupGuardMs || (() => 1200);

    /** @type {MediaStream|null} */
    this.stream = null;
    /** @type {any} */
    this.detector = null;
    this.active = false;
    /** @type {number|null} */
    this.rafId = null;
    this.lastCode = '';
    this.lastTime = 0;
  }

  /**
   * Check whether the browser supports native camera barcode detection.
   * @returns {boolean}
   */
  static isSupported() {
    return Boolean(
      typeof window !== 'undefined' &&
      'BarcodeDetector' in window &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    );
  }

  async start() {
    if (this.active) return true;
    if (!CameraQrScanner.isSupported()) {
      this.onError('Camera QR detection requires Chrome/Edge on Android or Desktop, or Safari 17.2+.');
      return false;
    }

    try {
      const DetectorCtor = /** @type {any} */ (window).BarcodeDetector;
      let formats = ['qr_code', 'code_128', 'code_39'];
      if (typeof DetectorCtor.getSupportedFormats === 'function') {
        const supported = await DetectorCtor.getSupportedFormats();
        formats = formats.filter(f => supported.includes(f));
        if (formats.length === 0) formats = ['qr_code'];
      }
      this.detector = new DetectorCtor({ formats });

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', 'true');
      await this.video.play();

      this.active = true;
      this.scanLoop();
      return true;
    } catch (err) {
      this.stop();
      const msg = err && err.name === 'NotAllowedError'
        ? 'Camera permission denied. Allow camera access in browser settings.'
        : 'Could not start camera: ' + (err && err.message ? err.message : 'Unknown error');
      this.onError(msg);
      return false;
    }
  }

  stop() {
    this.active = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
  }

  async scanLoop() {
    if (!this.active || !this.detector) return;

    if (this.video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
      try {
        const barcodes = await this.detector.detect(this.video);
        if (barcodes && barcodes.length > 0) {
          const raw = String(barcodes[0].rawValue || '').trim();
          const now = Date.now();
          const guardMs = Math.max(900, this.getDupGuardMs());
          if (raw && !(raw === this.lastCode && (now - this.lastTime) < guardMs)) {
            this.lastCode = raw;
            this.lastTime = now;
            this.onDetect(raw);
          }
        }
      } catch (_) {
        // Ignore transient frame decode errors
      }
    }

    if (this.active) {
      this.rafId = requestAnimationFrame(() => this.scanLoop());
    }
  }
}

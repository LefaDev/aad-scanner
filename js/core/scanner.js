// @ts-check

/**
 * Hardware Scanner & Input Controller
 */
export class HardwareScanner {
  /**
   * @param {{
   *   inputElement: HTMLInputElement,
   *   onScan: (payload: string) => void,
   *   getAutoSubmitMs: () => number,
   *   getDupGuardMs: () => number
   * }} options 
   */
  constructor(options) {
    this.input = options.inputElement;
    this.onScan = options.onScan;
    this.getAutoSubmitMs = options.getAutoSubmitMs;
    this.getDupGuardMs = options.getDupGuardMs;

    this.idleTimer = null;
    this.lastPayload = '';
    this.lastScanTimestamp = 0;
    this.isComposing = false;
    this.scanQueue = [];
    this.isProcessingQueue = false;

    this.bindEvents();
  }

  bindEvents() {
    // Composition events for IME resilience
    this.input.addEventListener('compositionstart', () => {
      this.isComposing = true;
    });

    this.input.addEventListener('compositionend', () => {
      this.isComposing = false;
      this.handleInputStroke();
    });

    // Keystroke handling
    this.input.addEventListener('keydown', (e) => {
      // Ignore functional modifier combinations
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Escape'].includes(e.key)) return;
      if (e.key.startsWith('F') && e.key.length > 1) return; // F1 - F12

      if (e.key === 'Enter') {
        e.preventDefault();
        this.submitCurrentBuffer();
      }
    });

    this.input.addEventListener('input', () => {
      if (!this.isComposing) {
        this.handleInputStroke();
      }
    });

    // Global keydown fallback to catch scanner keystrokes if focus wandered slightly
    window.addEventListener('keydown', (e) => {
      // Don't intercept if dialog is open
      const openDialog = document.querySelector('dialog[open]');
      if (openDialog) return;

      const active = document.activeElement;
      // Don't intercept if typing in another input / textarea / select
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
        if (active !== this.input) return;
      }

      // If user presses keys while outside, refocus the scan field
      if (active !== this.input && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
        this.input.focus();
      }
    });
  }

  handleInputStroke() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    const autoSubmitMs = this.getAutoSubmitMs();
    if (autoSubmitMs > 0) {
      this.idleTimer = setTimeout(() => {
        if (this.input.value.trim().length >= 4) {
          this.submitCurrentBuffer();
        }
      }, autoSubmitMs);
    }
  }

  submitCurrentBuffer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    const raw = this.input.value.trim();
    this.input.value = '';

    if (!raw) return;

    // Duplicate guard: identical raw payload within dupGuardMs is swallowed
    const now = Date.now();
    const dupGuardMs = this.getDupGuardMs();
    if (raw === this.lastPayload && (now - this.lastScanTimestamp) < dupGuardMs) {
      // Hardware double-fire swallowed
      return;
    }

    this.lastPayload = raw;
    this.lastScanTimestamp = now;

    // Queue scan synchronously
    this.scanQueue.push(raw);
    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.scanQueue.length > 0) {
      const payload = this.scanQueue.shift();
      if (payload) {
        try {
          this.onScan(payload);
        } catch (err) {
          console.error('Error processing scan:', err);
        }
      }
    }

    this.isProcessingQueue = false;
  }
}

// @ts-check

/** @type {AudioContext|null} */
let audioCtx = null;

/**
 * Get or create AudioContext, resumed on user interaction
 * @returns {AudioContext|null}
 */
function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Play a synthesized tone
 * @param {AudioContext} ctx 
 * @param {number} freq 
 * @param {number} durationMs 
 * @param {OscillatorType} type 
 * @param {number} startTime 
 * @param {number} volume 
 */
function playTone(ctx, freq, durationMs, type, startTime, volume) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);

  // Attack and decay envelope
  const durationSec = durationMs / 1000;
  gain.gain.setValueAtTime(0.001, startTime);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + durationSec + 0.05);
}

/**
 * Play result sound effect based on status
 * @param {string} status 
 * @param {number} volume 
 */
export function playResultAudio(status, volume = 0.5) {
  if (volume <= 0) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  switch (status) {
    case 'valid':
      // 880Hz 120ms -> 1180Hz 160ms, sine
      playTone(ctx, 880, 120, 'sine', now, volume);
      playTone(ctx, 1180, 160, 'sine', now + 0.13, volume);
      break;

    case 'prechecked':
      // 660Hz 120ms x2, triangle
      playTone(ctx, 660, 120, 'triangle', now, volume);
      playTone(ctx, 660, 120, 'triangle', now + 0.16, volume);
      break;

    case 'duplicate':
      // 330Hz 200ms x2, square
      playTone(ctx, 330, 200, 'square', now, volume * 0.7);
      playTone(ctx, 330, 200, 'square', now + 0.24, volume * 0.7);
      break;

    case 'invalid':
    case 'wrong_event':
    case 'virtual_denied':
    case 'cancelled':
    default:
      // 200Hz 350ms, square
      playTone(ctx, 200, 350, 'square', now, volume * 0.8);
      break;
  }
}

/**
 * Trigger device haptic vibration
 * @param {boolean} isValid 
 * @param {boolean} enabled 
 */
export function triggerHaptic(isValid, enabled = true) {
  if (!enabled || typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try {
    if (isValid) {
      navigator.vibrate(60);
    } else {
      navigator.vibrate([80, 60, 80]);
    }
  } catch (_) {}
}

/**
 * Screen Wake Lock Manager
 */
let wakeLock = null;

export async function requestWakeLock() {
  if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (_) {}
  }
}

export function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

// @ts-check
/**
 * SECURITY UTILITIES
 * ==================
 * Zero-dependency helpers for supervisor PIN hashing, CSV formula-injection
 * neutralisation (OWASP CWE-1236), and stable device-id generation.
 */

const PIN_SALT = 'aad-2026-gate-supervisor-v1:';

/**
 * Compute a deterministic SHA-256 hex digest of a supervisor PIN.
 * Falls back to FNV-1a64 only in non-secure test environments without WebCrypto.
 * @param {string} pin
 * @returns {Promise<string>}
 */
export async function hashPin(pin) {
  const clean = String(pin || '').trim();
  if (!clean) return '';
  const input = PIN_SALT + clean;

  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const bytes = new TextEncoder().encode(input);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Deterministic fallback for legacy/non-HTTPS test harnesses
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Constant-time string comparison to avoid trivial timing leaks.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Verify a candidate PIN against a stored hash.
 * @param {string} candidatePin
 * @param {string} expectedHash
 * @returns {Promise<boolean>}
 */
export async function verifyPin(candidatePin, expectedHash) {
  if (!expectedHash) return true;
  const candidateHash = await hashPin(candidatePin);
  if (!candidateHash) return false;
  return timingSafeEqualStr(candidateHash, expectedHash);
}

/**
 * Neutralise Spreadsheet Formula Injection (OWASP / CWE-1236).
 * Untrusted QR payloads or walk-in fields starting with =, +, -, @, Tab, or CR
 * can trigger DDE/formula execution when registrars open CSV exports in Excel.
 * Plain negative/positive numeric values (e.g. "-250.00") are preserved.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function neutralizeCsvFormula(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (!str) return '';

  const trimmedLead = str.replace(/^[ \t]+/, '');
  const first = str[0];
  const leadTrigger = trimmedLead[0];

  const isTrigger =
    first === '=' || first === '+' || first === '-' || first === '@' ||
    first === '\t' || first === '\r' ||
    leadTrigger === '=' || leadTrigger === '+' || leadTrigger === '-' || leadTrigger === '@';

  if (!isTrigger) return str;

  // Allow genuine signed numbers like -42 or +1500.00
  if (/^[+-]?\d+(\.\d+)?$/.test(str.trim())) {
    return str;
  }

  return `'${str}`;
}

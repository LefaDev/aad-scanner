# Senior Engineering Audit & Optimisation Report
**Target Application:** [AAD 2026 Registration Validator](https://aadconf-2026-attendee-scanner.netlify.app/)  
**Audited Production Build:** `aad-gate-v1.3.2` (Zero-build Vanilla ES Modules + Offline PWA + IndexedDB v2 + Optional Supabase REST)  
**Optimised Build Delivered:** `aad-gate-v1.4.0` (`/home/user/aad-scanner/`) + Automated QA Suite (`tests/gate-validator.test.mjs`)

---

## 1. Executive Architecture Verdict

### What the MVP Already Gets Right (Keep)
1. **Zero-Build Vanilla ES Module Architecture:** Shipping native ES modules (`js/config/*`, `js/core/*`, `js/ui/*`), self-hosted Woff2 fonts, local SVG sprites, and vendored `qrcode.js` with zero external CDNs is the right call for an offline conference gate tool—zero bundler supply-chain risk and instant debugging in browser DevTools.
2. **Offline-First Storage:** Storing manifests, session logs, cloud sync queues, and walk-in registrations in IndexedDB (`aad_gate_validator_db` v2) ensures venue Wi-Fi drops at Birchwood never halt the queue.
3. **Domain-Aware CSV Normalisation:** `importer.js` correctly isolates WooCommerce/PayPal purchase timestamps (`PURCHASE_DATE_COLUMNS`) from attendance dates and supports tolerant ID formatting.

### High-Risk Failure Modes Uncovered in `v1.3.2` (Fixed in `v1.4.0`)
Despite strong foundations, a line-by-line audit of `aad-gate-v1.3.2` uncovered **7 live operational bugs** (two of which will actively turn away valid delegates on Days 2–5 and Wednesday night's Dinner), **4 security & POPIA vulnerabilities** (including a QR-triggerable DOM XSS sink), and **3 performance/hardware gaps**.

---

## 2. Critical Operational & Multi-Day Bugs (Systems & State)

| # | Severity | Location in `v1.3.2` | Root Cause & Live Event Impact | `v1.4.0` Fix Applied |
|---|---|---|---|---|
| **1** | **CRITICAL** | `js/core/state.js:75-78`<br>`js/ui/settings.js:115-181` | **Active Day, Gate, Operator & Device ID Reset on Reload:** `activeEventId` (`'aad26-d1'`), `activeGateId` (`'gate-02'`), and `operatorName` (`'Gate Staff'`) were never persisted to `localStorage`, and `deviceId` regenerated randomly on every reload. On Days 2–5 (`27–30 Oct`), refreshing any scanner resets it silently to **Day 1**! | Persisted `activeEventId`, `activeGateId`, `operatorName`, and a stable `aad_gate_device_id` in `localStorage`. Fresh devices auto-select today's SAST session (`resolveDefaultEventId`), and the header displays a red **`Check Day`** warning chip if the selected session date differs from today's SAST date. |
| **2** | **CRITICAL** | `js/core/session.js:27`<br>`js/core/cloud.js:28-30`<br>`js/config/events.js:34` | **Wednesday `2026-10-28` Day 3 vs. Storytelling Dinner Collision:** Both `scannedKey(ticketId, eventDate)` and Supabase's unique index `gate_scans_one_admit ON (ticket_id, event_date)` keyed admissions by calendar date instead of `event_id`. Every All-Inclusive delegate checked into **Day 3 Conference** in the morning would be falsely denied as **`ALREADY SCANNED`** at the **Storytelling Dinner** that night! Also `getAadEvent('2026-10-28')` always returned Day 3, never Dinner. | Scoped `scannedKey` by `eventId` (`ticketId::aad26-d3` vs `ticketId::aad26-dinner`) with a backwards-compatible `findPriorScan` fallback for `v1.3` date-scoped conference keys (`gateGroup === 'conference'`), so live devices keep 100% of Day 1 history without blocking evening functions. Updated `getAadEvent(idOrDate, preferredAccess)` and Supabase unique index `gate_scans_one_admit_v2`. |
| **3** | **HIGH** | `js/app.js:469-475`<br>`js/core/cloud.js:141-168` | **Broken `Sync event` Deduplication & Multi-Seat `409` Race:** Clicking **Sync event** wrote remote admits to `nextSet[r.ticket_id]` (a legacy date-less key ignored by `rules.js:290`!), so manual cloud sync failed to block cross-gate duplicates. Additionally, multi-seat group orders (`quantity > 1`) hit HTTP `409` on seat `2..N` in Supabase, and neither Walk-ins nor Overrides synced to cloud or auto-flushed on Wi-Fi reconnect. | `Sync event` now writes `scannedKey(tId, activeEventId)` with aggregated seat counts and persists to IndexedDB. Added `seat_no` support to `gate_scans` (with automatic `PGRST204` legacy-column fallback), wired `recordCloudScan` on Walk-ins & Overrides, and added automatic `flushCloudQueue()` on `window.online`. |
| **4** | **HIGH** | `js/core/rules.js:131-151`<br>`js/config/passes.js:100` | **Tour Bus Self-Denial:** `passes.js` flags all tour tickets (`Soweto Heritage Tour`) as `excluded: true`, and `rules.js` unconditionally denied `ticket.excluded` as **`NOT A CONFERENCE PASS`** even when `activeEvent` was `aad26-tour-soweto` and `activeGate` was `Tour Departure — Birchwood`. | `rules.js` now admits tour-classified tickets when `isTourSession` is active while denying non-tour conference passes at tour departure (`NO TOUR ENTITLEMENT`) and denying tour items at conference halls. |
| **5** | **HIGH** | `sw.js:76`<br>`js/app.js:665-670` | **Service Worker Mid-Queue Forced Reload:** `sw.js` called `self.skipWaiting()` unconditionally inside `install`, while `app.js` triggered `window.location.reload()` on `controllerchange`—bypassing the `"Update now / Later"` prompt and force-reloading tablets mid-scan or mid-walk-in form entry. | `sw.js` (`aad-gate-v1.4.0`) only auto-calls `skipWaiting()` when `openClients.length === 0` (first install). Active scanner tabs hold the update safely until the volunteer clicks **Update now**. Upgraded `/js/` & `/css/` fetch strategy to **Stale-While-Revalidate**. |
| **6** | **MEDIUM** | `js/ui/settings.js:170-180`<br>`js/core/state.js:157` | **Gate-Switch Session Clobbering & Ghost Session Restore:** Switching gates on the same day (`gateChanged && !eventChanged`) overwrote the target gate's IndexedDB session with the previous gate's counts/logs instead of calling `loadSession`. Clicking **Clear** reset memory without deleting the IndexedDB session, causing page reload to resurrect cleared scans. | `updateContext` now loads the target session whenever `eventChanged || gateChanged`. Clearing a session calls `deleteSession(eventId, gateId)` in IndexedDB, and `resetSession()` counts only non-excluded conference passes. |
| **7** | **MEDIUM** | `js/app.js:259-264`<br>`js/app.js:524`<br>`js/core/storage.js:264` | **Override Counter Drift, Legacy Sample Importer & Broadcast Drop:** `handleOverride` always decremented `counters.invalid` even when overriding a `cancelled` or `duplicate` ticket; `loadSampleManifest` called legacy `parseManifestCsv(text, activeEventId)` (passing an event ID as `defaultDate`); `broadcastScan` dropped its 5th `eventDate` argument. | Added `reconcileOverrideCounters()` in `counters.js`; unified `loadSampleManifest()` onto `importCsv()` + `withWalkIns()`; updated `broadcastScan` to transmit `eventDate`, `eventId`, and `count`. |

---

## 3. Security Protocols & POPIA Compliance Hardening

### 3.1 DOM XSS Elimination (`js/ui/toast.js`)
- **Vulnerability (`v1.3.2`):** `showToast(message)` injected `${message}` directly into `toast.innerHTML`. Because `app.js:437` passed `conflictTicketId` (raw QR input) and `app.js:321` passed `holderName` (CSV input) into `showToast`, scanning a crafted QR payload (`<img src=x onerror=...>`) on a duplicate check could execute arbitrary JS in the volunteer's browser and exfiltrate `localStorage.aad_gate_settings` + IndexedDB delegate PII.
- **Remediation (`v1.4.0`):** Refactored `showToast` to bind message text strictly via `textSpan.textContent`, audited all `innerHTML` sinks across `js/ui/*.js` (`shell.js`, `settings.js`, `result.js`, `activity.js`, `report-modal.js`, `walkin.js`), and standardized on a single `esc()` helper.

### 3.2 Spreadsheet Formula Injection Defence (`OWASP CWE-1236`)
- **Vulnerability (`v1.3.2`):** `stringifyCsv()` in `js/core/csv.js` did not neutralise leading formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`) in `raw_payload` (untrusted QR strings) or walk-in fields, and `exportReportCsv()` in `js/core/export.js` interpolated strings without quote escaping.
- **Remediation (`v1.4.0`):** Implemented `neutralizeCsvFormula()` (`js/core/security.js`), prefixing non-numeric formula triggers with `'` across all CSV exports, escaped all cells in `exportReportCsv`, added `is_override` & `override_reason` audit columns to scan log exports, and prepended a UTF-8 BOM (`\uFEFF`) so Excel renders African diacritics cleanly.

### 3.3 Strict Content-Security-Policy (CSP) & Zero Inline Handlers
- **Vulnerability (`v1.3.2`):** Live Netlify HTTP headers lacked `Content-Security-Policy`, and `index.html` contained 4 inline `onclick="..."` attributes (`lines 428, 601, 692, 727`).
- **Remediation (`v1.4.0`):** Removed all inline event handlers from `index.html`, wired them in ES modules, and added production Netlify `_headers` enforcing `script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; connect-src 'self' https://*.supabase.co` plus `no-store` caching on `/sw.js`.

### 3.4 Supervisor Override PIN Lock (`WebCrypto SHA-256`)
- **Vulnerability (`v1.3.2`):** Any volunteer could tap `"Admit anyway (supervisor)"` without authentication.
- **Remediation (`v1.4.0`):** Added an optional **Supervisor Override PIN** in `Settings → Event & Gate`. PINs are hashed with salted `crypto.subtle.digest('SHA-256')` (`js/core/security.js`) and verified in constant time (`timingSafeEqualStr`) inside `result.js` before executing an override.

### 3.5 POPIA Data Minimisation & Post-Conference Device Wipe
- **Remediation (`v1.4.0`):**
  1. `sanitizeCloudRow()` (`js/core/cloud.js`) strips `holder_email`, `purchaser_email`, and `security_code` so sensitive delegate contact/secret data is **never** written to the `anon`-accessible Supabase table, and tightens RLS `WITH CHECK` & date-window bounds.
  2. Added **Purge All Device Data (POPIA)** in `Settings → Data & Manifest` (`purgeAllLocalData()`) so rented tablets and volunteer phones can be wiped clean after Friday's Closing Ceremony (`2026-10-30`).
- **Post-MVP V2 Recommendation:** Replace direct browser-to-Supabase `anon` keys with a thin Netlify Function (`/.netlify/functions/gate-sync`) authenticated via a short-lived gate shift passcode, holding the Supabase service key strictly in Netlify environment variables.

---

## 4. Performance & Hardware Resilience Optimisations

1. **`O(1)` WeakMap-Memoized Ticket Lookup (`js/core/lookup.js`):**
   - Previously, `resolveTicket()` rebuilt `buildLookupIndex(tickets)` across all `Object.keys(tickets)` on *every* non-exact scan (`O(N)` allocations per scan).
   - `v1.4.0` memoizes the compiled lookup table per immutable `tickets` reference in a `WeakMap` and short-circuits ambiguous suffix loops on the 2nd hit—completing **5,000 fuzzy lookups across 2,500 tickets in ~16ms** (`~3.2µs` per scan).
2. **Zero-Dependency Optical Camera QR Fallback (`js/core/camera.js` + `js/ui/scan.js`):**
   - Added a **Camera scan** toggle inside the Validator hero card powered by native `BarcodeDetector` + rear camera `getUserMedia` (no external libraries, 100% local/offline). Automatically stops camera tracks when switching panels or backgrounding the tab to preserve tablet battery.

---

## 5. Automated QA Suite & Pre-Shift Gate Checklist

### Automated QA Verification (`node --test tests/gate-validator.test.mjs`)
All **10 automated test suites pass (`0` failures)** in `< 200ms`:
1. Payload parser formats (URL, JSON, key-value, pipe-delimited, BOM/zero-width sanitisation, `O→0 / I→1 / B→8` lookalikes).
2. Multi-event date disambiguation (`2026-10-28` Day 3 vs. Dinner; `2026-10-26` Day 1 vs. Virtual).
3. Multi-source CSV importer (`R2` WooCommerce purchase-date guard, PayPal `Transaction ID` mapping, multi-seat group bookings, cross-store merge).
4. Wednesday `2026-10-28` regression test (All-Inclusive admitted at Day 3 AND Dinner; Daytime pass blocked at Dinner even on `gate-01`).
5. Soweto Heritage Tour boarding admission at `Tour Departure — Birchwood` + rejection at conference halls.
6. Backwards-compatible `v1.3` `ticketId::YYYY-MM-DD` duplicate-guard preservation across mid-conference upgrades.
7. Supervisor override exact counter bucket reconciliation (`cancelled`, `duplicate`, `invalid`).
8. Security regression suite (OWASP CWE-1236 CSV formula neutralisation, SHA-256 PIN verification, POPIA cloud row scrubbing, zero inline HTML handlers).
9. High-volume `WeakMap` lookup latency benchmark (`5,000` fuzzy scans `< 150ms`).
10. Zero-build static linker check (verifies every `import { ... }` named export across all 34 ES modules and every `sw.js` precache file path).

### Safe Mid-Conference Deployment & Morning Gate Checklist
1. **Deploy `/home/user/aad-scanner/` to Netlify** (exclude `tests/` or leave as static—no secrets). Existing IndexedDB v2 data (`manifests`, `sessions`, `walk_ins`, `cloud_queue`) is 100% preserved.
2. **If using Supabase Cloud Sync:** Run the safe migration lines in `Settings → Cloud Sync → Copy SQL` (`alter table ... add column if not exists seat_no` + `gate_scans_one_admit_v2`) before Wednesday's Storytelling Dinner (`2026-10-28 18:30`). Even before running the SQL, `v1.4.0` gracefully falls back if `seat_no` is absent.
3. **Each Morning (07:30 SAST):**
   - Open app while on venue Wi-Fi once so `aad-gate-v1.4.0` installs; tap **Update now** on the top-right banner.
   - Verify **Active session** matches today's date (no red `Check Day` chip) and **Gate Location** + **Operator Name** are set.
   - Set a **Supervisor Override PIN** on unmanned/volunteer gates.
   - At end of shift, tap **Export log** and **Export walk-ins (CSV)** as offline registrar backups.

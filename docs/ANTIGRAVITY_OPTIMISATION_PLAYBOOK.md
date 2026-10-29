# Google Antigravity Optimisation Playbook (No-MCP Workflow)
**Target Project:** `aadconf-2026-attendee-scanner` (`v1.3.2` → `v1.4.0`)  
**Mode:** Native Antigravity IDE Agent + Built-in Terminal (Zero MCPs, Zero `npm` Dependencies)

---

## Before You Run Any Prompts (2-Minute Setup in Antigravity)

1. **Open the project in Antigravity IDE** (the code editor view rather than a detached chat window) so you can review file diffs inline and use **Terminal → New Terminal**.
2. **Create a safety Git branch first** (in Antigravity's Terminal):
   ```bash
   git checkout -b release/v1.4.0-optimised
   ```
   *(If you don't use Git locally, duplicate your project folder once as a backup before starting.)*
3. **Set Agent Execution Policy:** Use Antigravity's **Planning / Agent** mode so it edits files and runs `node --test` directly in your local terminal—no MCP servers needed.

---

## Recommended Workflow: Run These 5 Sequential Prompts

Running these **5 focused prompts in order** keeps the agent's context sharp and verifies each layer before moving to the next. Wait for each prompt to finish before pasting the next one.

---

### Prompt 1 — Standing Guardrails, Netlify Edge Protection & Strict CSP Headers
*Paste this first so Antigravity creates `AGENTS.md` (which stays active for every subsequent prompt) and protects your static root publish folder.*

```text
We are optimising this offline-first conference gate PWA (aad-gate-v1.3.2 -> v1.4.0). Do NOT use any MCP servers, bundlers, or npm packages. Keep 100% zero-build vanilla ES modules with // @ts-check.

Task 1: Create `AGENTS.md` in the project root with standing rules enforcing:
- Zero-build vanilla ES modules only (no Vite/Webpack/npm runtime deps, no external CDNs).
- Preserve IndexedDB `DB_NAME = 'aad_gate_validator_db'` and `DB_VERSION = 2` (`manifests`, `sessions`, `cloud_queue`, `walk_ins`) for 100% backwards-compatibility on live conference tablets.
- Every browser-facing change must increment `CACHE_NAME` in `sw.js` and keep `PRECACHE_ASSETS` in sync; never call `self.skipWaiting()` unconditionally when window clients are open.
- Strict CSP (`script-src 'self'`): zero inline `onclick=` or `<script>` blocks in HTML; escape all `innerHTML` interpolations with `esc()` from `js/ui/dom.js`; neutralise CSV formula injection (`=`, `+`, `-`, `@`, `\t`, `\r`) in exports; never transmit `holder_email` or `security_code` to Supabase.

Task 2: Create `.gitignore` ignoring `.env*`, `*.pem`, `*.key`, `.agents/mcp_config.json`, `.agent/mcp_config.json`, `*.bak`, `node_modules/`, `.DS_Store`, and `*.log`.

Task 3: Create `_headers` at the root for Netlify with:
- Global headers (`/*`): `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()`, and `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self' https://*.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`
- `/sw.js`: `Cache-Control: no-cache, no-store, must-revalidate`
- `/index.html` and `/manifest.webmanifest`: `Cache-Control: public, max-age=0, must-revalidate`

Task 4: Because Netlify publishes from `.` (root), create `_redirects` with forced `404!` rules blocking public HTTP access to `/.agents/*`, `/.agent/*`, `/tests/*`, `/AGENTS.md`, `/GEMINI.md`, and `/netlify.toml`. Also create `netlify.toml` setting `[build] publish = "."` and `command = "node --test tests/gate-validator.test.mjs"`.
```

---

### Prompt 2 — Fix Critical Multi-Day, Session Collision, Tour Gate & Cloud Sync Bugs
*This resolves all 7 live operational bugs before Days 2–5 and Wednesday night's Storytelling Dinner.*

```text
Fix the following operational state, multi-session, cloud sync, and Service Worker bugs while keeping 100% IndexedDB v2 backwards compatibility:

1. Disambiguate Shared Event Dates (`js/config/events.js`):
   - Update `getAadEvent(idOrDate, preferredAccess)` so it matches exact `e.id === idOrDate` FIRST. When matching by `date` (e.g. `2026-10-28` shared by `aad26-d3` Day 3 and `aad26-dinner` Storytelling Dinner, or `2026-10-26` shared by `aad26-d1` and `aad26-virtual`), prefer `e.access === preferredAccess` if supplied, otherwise prefer `e.gateGroup === 'conference'`.
   - Export `resolveDefaultEventId(sastDate)` returning today's SAST (`Africa/Johannesburg`) conference event ID if within conference dates, defaulting to `'aad26-d1'`.

2. Persist Active Context & Device ID Across Reloads (`js/core/storage.js`, `js/core/state.js`, `js/ui/settings.js`, `js/ui/shell.js`, `js/app.js`):
   - In `js/core/storage.js`, add `getOrCreateDeviceId()` persisted in `localStorage` (`aad_gate_device_id`), `deleteSession(eventId, gateId)` to delete a key from the `sessions` object store, `purgeAllLocalData()` to clear all 4 IndexedDB stores + `aad_gate_settings`, and update `loadManifest()` to check `SHARED_MANIFEST_KEY` first. Also fix `broadcastScan(ticketId, scanTime, gateName, counters, eventDate, eventId, count = 1)` so `eventDate`, `eventId`, and `count` are included in the posted message.
   - In `js/core/state.js`, initialize `activeEventId: resolveDefaultEventId()`, `deviceId: getOrCreateDeviceId()`, guard `navigator.onLine` for Node test compatibility, and fix `resetSession()` so `counters.loaded` counts only non-excluded passes (`!t.excluded`).
   - Persist `activeEventId`, `activeGateId`, and `operatorName` inside `aad_gate_settings` whenever settings, theme, sound, event, gate, or operator changes, and restore them in `app.js` `bootstrap()`.
   - In `js/ui/shell.js` `renderActiveContext`, escape `eventName`/`eventDate` with `esc()`, count only `!t.excluded` passes, and display a `chip-duplicate` warning (`Check Day: Today is YYYY-MM-DD`) if `eventDate !== todayInSast()` during `2026-10-25`..`2026-10-30`.

3. Fix Wednesday `2026-10-28` Day 3 vs. Dinner Collision (`js/core/session.js`, `js/core/rules.js`):
   - Scope `scannedKey(ticketId, sessionScope)` by `eventId` (e.g. `ticketId::aad26-d3` vs `ticketId::aad26-dinner`).
   - Add `findPriorScan(scannedSet, ticketId, activeEventId, activeEventDate, gateGroup = 'conference')` in `session.js`: check `scannedKey(ticketId, activeEventId)` first; ONLY when `gateGroup === 'conference'`, fall back to `scannedKey(ticketId, activeEventDate)` so existing v1.3 Day 1 scans still deduplicate without leaking into `evening` or `tours` sessions on the same date.

4. Fix Soweto Tour Self-Denial & Evening Gate Check (`js/core/importer.js`, `js/core/rules.js`):
   - In `importer.js`, include `exclusion_id: passClass.exclusionId || undefined` on `ticketObj`.
   - In `rules.js`:
     - Detect `isTourSession = activeEvent?.access === 'tour' || activeGate?.group === 'tours'` and `isEveningSession = activeEvent?.access === 'evening' || activeGate?.group === 'evening'`.
     - Allow tour tickets (`ticket.exclusion_id === 'tour' || ticketScope === 'tour'`) when `isTourSession` is true instead of rejecting under `if (ticket.excluded)`; conversely, deny non-tour conference passes (except `all_inclusive`) at a tour session with `status: 'wrong_event'`, `phrase: 'NO TOUR ENTITLEMENT'`.
     - Deny daytime-only passes when `isEveningSession` is true (`NO EVENING ACCESS`), even if the operator forgot to switch `activeGateId` to `gate-04`.
     - If `ticket.event_id` is explicitly set to a different single-session event (and `ticketScope !== 'full'`), return `wrong_event` using `getAadEvent(ticket.event_id, ticketScope)`.

5. Fix Gate-Switch Session Overwrite, Clear Session Ghost Restore, Sample Loader & Override Counters (`js/core/counters.js`, `js/ui/settings.js`, `js/app.js`):
   - Add `reconcileOverrideCounters(currentCounters, overriddenStatus)` in `counters.js` so overriding `cancelled` decrements `cancelled`, overriding `duplicate` decrements `duplicates`, and others decrement `invalid`, while incrementing `checkedIn`. Use it in `handleOverride` in `app.js`.
   - In `settings.js` `updateContext`, load the target session via `loadSession(activeEventId, activeGateId)` whenever `eventChanged || gateChanged` (fixing the bug where switching gates on the same day overwrote the target gate's session).
   - Call `deleteSession(activeEventId, activeGateId)` whenever "Clear" or "Start a new session" is confirmed so cleared sessions don't reappear on reload.
   - Refactor `loadSampleManifest()` in `app.js` to use `importCsv()` + `withWalkIns()` instead of legacy `parseManifestCsv(text, activeEventId)`.

6. Fix Cloud Sync Deduplication & Reconnect Flush (`js/core/cloud.js`, `js/app.js`, `js/ui/shell.js`):
   - Add `seat_no` support and `sanitizeCloudRow()` in `cloud.js` (omitting `holder_email` and `security_code` for POPIA data minimisation, capping string lengths, serialising `flushCloudQueue` against concurrent races, and retrying without `seat_no` if Supabase returns HTTP 400 `PGRST204` on an unmigrated v1.3 table). Update `SUPABASE_SQL_SETUP` with `seat_no` and unique index `gate_scans_one_admit_v2 on public.gate_scans (ticket_id, coalesce(event_id, event_date::text), seat_no) where status in ('valid','prechecked')`.
   - Update `fetchRemoteAdmits(url, anonKey, date, eventId)` to filter by `event_id` when provided.
   - Fix `#control-sync-btn` in `app.js` to write `scannedKey(tId, state.activeEventId)` with aggregated seat counts (instead of bare `nextSet[r.ticket_id]`), sync Walk-ins & Overrides via `recordCloudScan`, and auto-call `flushCloudQueue` when `window.online` fires in `shell.js`.

7. Safe Service Worker Lifecycle (`sw.js`):
   - Bump `CACHE_NAME` to `'aad-gate-v1.4.0'`.
   - Remove unconditional `self.skipWaiting()` in `install`: only auto-call `self.skipWaiting()` when `(await self.clients.matchAll({ type: 'window' })).length === 0` so open scanner tabs never force-reload mid-scan, waiting instead for `{ type: 'SKIP_WAITING' }` from the update toast.
   - Use Stale-While-Revalidate for same-origin `/js/` and `/css/` GET requests.
```

---

### Prompt 3 — Security Protocols, Supervisor PIN Lock & POPIA Wipe
*Hardens XSS sinks, CSV formula injection, CSP compliance, supervisor overrides, and post-event device cleanup.*

```text
Apply the following security and POPIA compliance upgrades across the codebase:

1. Create `js/core/security.js` (and add `./js/core/security.js` to `PRECACHE_ASSETS` in `sw.js`):
   - `hashPin(pin)`: salted SHA-256 hex digest using `crypto.subtle.digest` (with deterministic fallback if WebCrypto is unavailable).
   - `timingSafeEqualStr(a, b)` and `verifyPin(candidatePin, expectedHash)`.
   - `neutralizeCsvFormula(value)`: neutralise OWASP CWE-1236 spreadsheet formula injection by prefixing strings starting (even after leading spaces/tabs) with `=`, `+`, `-`, `@`, `\t`, or `\r` with a single quote `'`, while preserving genuine signed numbers like `-250.00`.

2. Eliminate DOM XSS & Unify Escaping (`js/ui/toast.js`, `js/ui/walkin.js`, `css/components.css`):
   - Refactor `showToast(message, type)` in `js/ui/toast.js` so `message` is inserted strictly via `span.textContent` (never `innerHTML`), and support `'warn'` alongside `'info' | 'success' | 'error'` (add `.toast.toast-warn` border-left styling in `css/components.css`).
   - Replace duplicate `escapeHtml` in `js/ui/walkin.js` and `js/ui/settings.js` with `esc` imported from `js/ui/dom.js`.

3. Harden CSV & Report Exports (`js/core/csv.js`, `js/core/export.js`):
   - Export `escapeCsvCell(val)` in `js/core/csv.js` using `neutralizeCsvFormula(val)` and proper RFC 4180 quote doubling; use it in `stringifyCsv`.
   - Refactor `exportReportCsv` in `js/core/export.js` to format every row via `escapeCsvCell`, enrich `exportScanLog` with `event_id`, `is_override`, and `override_reason` columns, and prepend a UTF-8 BOM (`\uFEFF`) in `downloadFile()` for Excel diacritic compatibility.

4. Remove All Inline Event Handlers for Strict CSP (`index.html`, `js/app.js`, `js/ui/settings.js`):
   - Remove every `onclick="..."` attribute in `index.html` (the Launch Summary Report button, `#manifest-drop-zone`, `#report-dialog` close X button, and `#detail-dialog` close X button). Assign clean IDs and wire them via `addEventListener` in `js/app.js` and `js/ui/settings.js` (including keyboard `Enter`/`Space` support on `#manifest-drop-zone`). Update sidebar version text to `v1.4.0`.

5. Add Supervisor Override PIN & POPIA Device Wipe (`assets/icons.svg`, `index.html`, `js/core/state.js`, `js/ui/settings.js`, `js/ui/result.js`, `css/components.css`):
   - Add `icon-lock` symbol to `assets/icons.svg` and `supervisorPinHash: ''` to `state.settings`.
   - In `index.html` (`Settings -> Event & Gate`), add an optional Supervisor Override PIN input + `Set PIN` and `Remove PIN` buttons (verifying existing PIN before changing/removing).
   - In `js/ui/result.js`, if `supervisorPinHash` is active, render a compact password PIN input inside `[data-override-menu]` and verify via `verifyPin()` before calling `onOverrideHandler`.
   - In `index.html` (`Settings -> Data & Manifest`), add a `Purge All Device Data (POPIA)` button wired in `settings.js` (requiring prompt confirmation `"PURGE"`) that calls `purgeAllLocalData()` to wipe all IndexedDB stores and `localStorage` settings after the conference.
```

---

### Prompt 4 — Performance (`O(1)` Memoized Lookup) & Offline Camera QR Fallback
*Speeds up ticket resolution by ~100x and turns any volunteer phone/tablet camera into a backup scanner if a Zebra battery dies.*

```text
Add O(1) ticket lookup memoization and a zero-dependency optical camera QR scanner fallback:

1. Memoize Ticket Lookup (`js/core/lookup.js`):
   - Cache compiled normalised lookup tables per immutable `tickets` object reference using a `WeakMap` inside `buildLookupIndex(tickets)` so `resolveTicket(tickets, rawId)` runs in O(1) on repeat scans instead of rebuilding `Object.keys(tickets)` on every scan, and break early as soon as `candidates.length > 1` on suffix matching.

2. Add Native Camera QR Fallback (`assets/icons.svg`, `js/core/camera.js`, `js/ui/scan.js`, `js/app.js`, `index.html`, `css/components.css`, `sw.js`):
   - Add `icon-camera` symbol to `assets/icons.svg`.
   - Create `js/core/camera.js` exporting `CameraQrScanner` powered by native `window.BarcodeDetector` (`qr_code`, `code_128`, `code_39`) + `navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })` with duplicate-scan debounce and clean track shutdown in `stop()`. Add `./js/core/camera.js` to `PRECACHE_ASSETS` in `sw.js`.
   - Add a `Camera scan` toggle button (`#camera-scan-toggle-btn`) and collapsible `<video id="camera-scan-video">` viewport with reticle inside `.scan-card` in `index.html` and style it in `css/components.css`.
   - Wire it in `js/ui/scan.js` (`stopActiveCamera()` exported and called when `document.hidden` becomes true or when switching away from the `validator` panel in `js/app.js`).
```

---

### Prompt 5 — Automated Zero-Dependency QA Suite & Pre-Deploy Verification
*Creates a fast `node:test` verification suite (no `npm install`) and verifies the entire codebase in Antigravity's terminal.*

```text
Create a comprehensive, zero-dependency automated QA test suite at `tests/gate-validator.test.mjs` using Node's built-in `node:test` and `node:assert/strict` modules, then run it in the terminal and fix any issues until 100% pass:

Include tests covering:
1. `parsePayload` across URLs, JSON, labelled key-values, pipe-delimited codes, UTF-8 BOM stripping, and `normalizeSecurityCode` lookalikes (`O->0`, `I->1`, `B->8`).
2. `getAadEvent` shared-date disambiguation (`2026-10-28` Day 3 vs Storytelling Dinner; `2026-10-26` Day 1 vs Virtual).
3. `importCsv` WooCommerce purchase-date protection (`date_created` never overwrites `event_date`), multi-seat `quantity`, refund cancellation, and non-destructive PayPal merge.
4. Wednesday `2026-10-28` regression: an All-Inclusive delegate admitted at `aad26-d3` is blocked on a repeat `aad26-d3` scan, ADMITTED at `aad26-dinner` that evening, and blocked on a repeat `aad26-dinner` scan; a Standard Daytime pass is denied `NO EVENING ACCESS` at `aad26-dinner` even if `activeGateId` is `gate-01`.
5. `samples/sample-aad-manifest.csv` import + Soweto Heritage Tour (`AAD26-1012`) denied at Conference Main Entrance (`NOT A CONFERENCE PASS`) and ADMITTED at `aad26-tour-soweto` / `gate-05`, while `AAD26-1001` is denied `NO TOUR ENTITLEMENT` at the tour bus.
6. Backwards-compatible `findPriorScan` matching v1.3 `AAD26-1001::2026-10-26` keys on conference sessions without leaking into `evening` sessions.
7. `reconcileOverrideCounters` accurately decrementing `cancelled`, `duplicates`, and `invalid` buckets.
8. Security regressions: `neutralizeCsvFormula` & `stringifyCsv` neutralising `=cmd|...`, `+HYPERLINK(...)`, `  @SUM(...)` while keeping `-250.00`; WebCrypto `hashPin`/`verifyPin`; `sanitizeCloudRow` stripping `holder_email` and `security_code`; and verifying `index.html` contains zero inline `on[a-z]+=` event attributes.
9. Performance benchmark asserting 5,000 fuzzy `resolveTicket` calls across 2,500 tickets finish in < 150ms.
10. Static ES-module & Service Worker linker check verifying every `import { ... } from '...'` named export across `js/**/*.js` exists in its target module and every path in `sw.js` `PRECACHE_ASSETS` exists on disk.

Finally, run `node --check` on `sw.js` and every file under `js/`, run `node --test tests/gate-validator.test.mjs`, remove any temporary scratch files, and show me `git status` and the test output.
```

---

## Alternative: Single "All-in-One" Autonomous Prompt
*(Use this only if you want Antigravity's Planning Agent to execute the entire upgrade in one autonomous pass rather than step-by-step.)*

```text
Act as a Principal Web Systems & Security Engineer. Upgrade this zero-build offline conference gate PWA from v1.3.2 to v1.4.0 with ZERO npm dependencies, ZERO bundlers, ZERO external CDNs, and 100% IndexedDB v2 (`aad_gate_validator_db`) backwards compatibility.

Execute this plan in order and verify with `node --test`:
1. Guardrails & Edge Config: Add `AGENTS.md`, `.gitignore`, Netlify `_headers` (strict CSP `script-src 'self'`, `no-store` on `/sw.js`), `_redirects` (forced `404!` on `/.agents/*`, `/tests/*`, `/AGENTS.md`, `/netlify.toml`), and `netlify.toml` (`publish = "."`, `command = "node --test tests/gate-validator.test.mjs"`).
2. State & Session Fixes: Persist `activeEventId`, `activeGateId`, `operatorName`, and stable `deviceId` across reloads; auto-default fresh boots to today's SAST event (`resolveDefaultEventId`); show a `Check Day` chip when active session date != `todayInSast()`; scope `scannedKey` by `eventId` with `findPriorScan` fallback for v1.3 date-scoped conference keys so Wednesday `2026-10-28` Day 3 (`aad26-d3`) never blocks Storytelling Dinner (`aad26-dinner`); disambiguate `getAadEvent(idOrDate, preferredAccess)`; admit Soweto Tour tickets at tour sessions/gates while blocking conference-only passes there; fix gate-switch session clobbering (`loadSession` when `eventChanged || gateChanged`); delete IndexedDB session on Clear; reconcile exact override counter buckets (`cancelled`, `duplicates`, `invalid`); route `loadSampleManifest` through `importCsv` + `withWalkIns`; fix `broadcastScan` args.
3. Cloud & SW Safety: Fix `Sync event` to write `scannedKey(id, activeEventId)` with multi-seat counts; add `seat_no` + POPIA-minimised `sanitizeCloudRow` (strip emails & `security_code`) with `PGRST204` fallback and auto-flush on `window.online`; sync Walk-ins & Overrides; update `sw.js` (`aad-gate-v1.4.0`) to only auto-`skipWaiting()` when `openClients.length === 0` and use Stale-While-Revalidate for `/js/` and `/css/`.
4. Security & UX: Create `js/core/security.js` (salted WebCrypto SHA-256 `hashPin`/`verifyPin` + OWASP CWE-1236 `neutralizeCsvFormula`); fix DOM XSS in `showToast` (`textContent` + `'warn'` support); apply `escapeCsvCell` + UTF-8 BOM across `csv.js`/`export.js`; remove all inline `onclick=` from `index.html`; add optional Supervisor Override PIN in Settings + `result.js`; add `Purge All Device Data (POPIA)` in Settings; memoize `buildLookupIndex` via `WeakMap` in `lookup.js`; add native `BarcodeDetector` rear-camera QR fallback (`js/core/camera.js` + `scan.js`).
5. QA Gate: Write `tests/gate-validator.test.mjs` using `node:test` covering parser, importer, Day 3 vs Dinner, Soweto Tour, v1.3 migration, override counters, XSS/CSV/PIN/CSP security, 5,000-scan benchmark, and static ES-module + SW precache asset linker checks. Run `node --test tests/gate-validator.test.mjs` until 100% pass.
```

---

## Deploying Without MCPs (3 Clean Steps)

Once Antigravity finishes Prompt 5 and prints `# pass 10 / # fail 0` in the terminal:

1. **Sanity-check locally in Antigravity Terminal (30 seconds):**
   ```bash
   python3 -m http.server 8080
   ```
   Open `http://localhost:8080` in Antigravity's browser preview:
   - Check DevTools Console → confirm **0 errors** and **0 CSP warnings**.
   - Go to **Settings → Data & Manifest → Load Sample Manifest**, then scan `AAD26-1001` (Admit) and test setting a **Supervisor PIN**.

2. **Update Supabase SQL (Only if you use Cloud Sync — No MCP needed):**
   - In the app, go to **Settings → Cloud Sync → First-time Supabase SQL Setup → Copy SQL**.
   - Open your **Supabase Dashboard → SQL Editor** in your browser, paste, and click **Run** (safe, non-destructive `add column if not exists seat_no` + `gate_scans_one_admit_v2` index).

3. **Publish to Netlify (Pick whichever method you already use):**
   - **Option A — GitHub Auto-Deploy (Recommended):**
     ```bash
     git status   # Verify no stray scratch or .env files exist
     git add .
     git commit -m "feat(v1.4.0): multi-session safety, security hardening, camera fallback & QA suite"
     git push origin release/v1.4.0-optimised
     ```
      Netlify will automatically create a **Deploy Preview URL** for that branch AND run `node --test tests/gate-validator.test.mjs`. Once you verify the preview URL, merge into `main`.
   - **Option B — Manual Netlify Drop (Drag & Drop):**
     Open your site in the **Netlify Dashboard → Deploys**, and drag your project folder into the deploy dropzone (`_redirects` will automatically block `/tests/*` and `/AGENTS.md` from public visitors).

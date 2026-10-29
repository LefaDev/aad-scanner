# AAD 2026 Gate Validator — Standing Agent Rules

You are working on a **live conference gate-control offline PWA** (`aadconf-2026-attendee-scanner.netlify.app`). Every edit must preserve zero-downtime offline reliability and security.

## 1. Architecture Invariants (Do Not Break)
- **Zero-Build Vanilla ES Modules Only:** Do not introduce Vite, Webpack, TypeScript compilation, Tailwind build steps, or `npm` runtime dependencies. All browser modules live under `js/` with `// @ts-check` JSDoc types.
- **Zero External CDNs:** Every script (`vendor/qrcode.js`), font (`assets/fonts/*.woff2`), and icon (`assets/icons.svg`) must remain self-hosted so the app boots 100% offline.
- **IndexedDB Backwards Compatibility:** Keep `DB_NAME = 'aad_gate_validator_db'` and `DB_VERSION = 2` (`manifests`, `sessions`, `cloud_queue`, `walk_ins`). Never rename object stores or drop `findPriorScan()` backwards-compatibility for `v1.3` keys during active event days.

## 2. Service Worker & Caching Protocol
- **Always Bump `CACHE_NAME` in `sw.js`** on every code or CSS change (e.g. `aad-gate-v1.4.1`).
- **Keep `PRECACHE_ASSETS` in sync:** Whenever you add, rename, or remove a file under `js/`, `css/`, `assets/`, or `brand/`, update `PRECACHE_ASSETS` in `sw.js`.
- **Never re-add unconditional `self.skipWaiting()` on `install`:** Active gate tablets must never force-reload mid-scan; only skip waiting automatically when `openClients.length === 0` or on `{ type: 'SKIP_WAITING' }`.

## 3. Security & POPIA Rules
- **Strict CSP (`script-src 'self'`):** Never add inline event handlers (`onclick=`, `onload=`, `<script>...</script>`) in `index.html` or UI templates. Bind all events via `addEventListener` in `js/ui/*.js`.
- **DOM XSS Prevention:** Never interpolate untrusted QR payloads, ticket IDs, or CSV fields into `innerHTML` without `esc()` from `js/ui/dom.js`. Keep `showToast()` strictly on `textContent`.
- **CSV Formula Neutralisation:** Route all CSV exports through `escapeCsvCell` / `stringifyCsv` (`js/core/csv.js`) so leading `=`, `+`, `-`, `@`, `\t`, `\r` payloads remain neutralised (`CWE-1236`).
- **POPIA Cloud Minimisation:** Never transmit `holder_email`, `purchaser_email`, `security_code`, or Supabase `service_role` keys from browser code.
- **No MCPs / No Workspace Secrets:** This project does NOT use MCP servers. Never create `.env` files or `.agents/mcp_config.json` tokens inside the workspace (since Netlify publishes from `.`).

## 4. Mandatory QA Gate Before Any Commit or Deploy
Run both commands and require zero errors before deploying:
1. `node --test tests/gate-validator.test.mjs`
2. Verify `CACHE_NAME` in `sw.js` was incremented if any browser-facing file changed.

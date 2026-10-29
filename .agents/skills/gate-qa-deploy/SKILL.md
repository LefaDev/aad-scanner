---
name: gate-qa-deploy
description: Run mandatory syntax, ES-module linker, security, and Service Worker checks before deploying the AAD 2026 Gate Validator to Netlify.
---

# Gate Validator Pre-Deploy QA & Netlify Release Skill

Follow these exact steps whenever preparing a hotfix or release for `aadconf-2026-attendee-scanner.netlify.app`:

1. **Bump Service Worker Cache Version:**
   - Open `sw.js` and increment `CACHE_NAME` (for example `aad-gate-v1.4.0` -> `aad-gate-v1.4.1`).
   - Confirm every new `.js`, `.css`, or asset file is listed in `PRECACHE_ASSETS`.

2. **Clean Workspace Artifacts:**
   - Ensure no temporary agent scratch files, debug logs, `.env` files, or `.agents/mcp_config.json` credentials exist in the project root (since Netlify publishes from `.`).

3. **Run Automated QA Suite:**
   - Execute `node --test tests/gate-validator.test.mjs` in the terminal.
   - All 10 test suites (parser, CSV importer, Wednesday Day 3 vs. Dinner session scoping, Soweto Tour boarding, v1.3 migration, override counters, CWE-1236/CSP security, lookup benchmark, and ES-module linker) must pass with `fail 0`.

4. **Preview Deploy First, Then Production (No MCP Required):**
   - Push to a feature branch (e.g. `release/v1.4.x`) for a Netlify Deploy Preview URL or run a local check (`python3 -m http.server 8080`) and test loading the Sample Manifest + scanning `AAD26-1001` in mobile & desktop views.
   - Once verified, merge into `main` or drag-and-drop into Netlify Deploys.

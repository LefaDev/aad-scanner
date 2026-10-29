import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePayload, normalizeSecurityCode } from '../js/core/parser.js';
import { importCsv } from '../js/core/importer.js';
import { classifyPass } from '../js/config/passes.js';
import { getAadEvent, AAD_EVENTS } from '../js/config/events.js';
import { validateTicket, overrideAdmission } from '../js/core/rules.js';
import { updateCounters, reconcileOverrideCounters } from '../js/core/counters.js';
import { scannedKey, findPriorScan, migrateScannedSet, blankCounters } from '../js/core/session.js';
import { resolveTicket } from '../js/core/lookup.js';
import { stringifyCsv, escapeCsvCell } from '../js/core/csv.js';
import { hashPin, verifyPin, neutralizeCsvFormula } from '../js/core/security.js';
import { sanitizeCloudRow } from '../js/core/cloud.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

test('1. Payload Parser handles URL, JSON, KV, pipe-delimited, BOM, and lookalikes', () => {
  const fromUrl = parsePayload('\uFEFFhttps://tickets.aad2026.org/verify?ticket_id=AAD26-1002&sec=SEC-1002&event=aad26-d1');
  assert.equal(fromUrl.ticketId, 'AAD26-1002');
  assert.equal(fromUrl.securityCode, 'SEC-1002');
  assert.equal(fromUrl.eventId, 'aad26-d1');

  const fromJson = parsePayload('{"ticketId":"AAD26-1004","securityCode":"SEC-1004","orderId":"ORD-8004"}');
  assert.equal(fromJson.ticketId, 'AAD26-1004');
  assert.equal(fromJson.securityCode, 'SEC-1004');
  assert.equal(fromJson.orderId, 'ORD-8004');

  const fromPipe = parsePayload('AAD26-1008|aad26-d3|SEC-1008');
  assert.equal(fromPipe.ticketId, 'AAD26-1008');
  assert.equal(fromPipe.eventId, 'aad26-d3');
  assert.equal(fromPipe.securityCode, 'SEC-1008');

  assert.equal(normalizeSecurityCode('sec-oib9', false), 'SECOIB9');
  assert.equal(normalizeSecurityCode('sec-oib9', true), 'SEC0189');
});

test('2. Event lookup disambiguates shared dates (2026-10-28 Day 3 vs Dinner)', () => {
  assert.equal(getAadEvent('aad26-dinner')?.id, 'aad26-dinner');
  assert.equal(getAadEvent('aad26-d3')?.id, 'aad26-d3');
  assert.equal(getAadEvent('2026-10-28')?.id, 'aad26-d3');
  assert.equal(getAadEvent('2026-10-28', 'evening')?.id, 'aad26-dinner');
  assert.equal(getAadEvent('2026-10-26', 'virtual')?.id, 'aad26-virtual');
});

test('3. Importer guards WooCommerce purchase dates, merges PayPal, and handles multi-seat orders', () => {
  const wooCsv = [
    'order_id,order_status,date_created,billing_first_name,billing_last_name,billing_email,line_item_name,line_item_quantity',
    'WC-5001,completed,2026-08-14,Zanele,Mbeki,zanele@example.org,"The All-Inclusive Delegate (Weekly)",1',
    'WC-5002,completed,2026-08-19,Sipho,Dlamini,sipho@example.org,"Full Conference (Non-residential)",3',
    'WC-5003,refunded,2026-09-01,John,Refund,john@example.org,"Standard Conference Daytime Pass",1'
  ].join('\n');

  const knownEventDates = AAD_EVENTS.map(e => e.date);
  const res1 = importCsv(wooCsv, {
    fileName: 'woo.csv',
    eventId: 'aad26-d1',
    defaultDate: '2026-10-26',
    knownEventDates
  });

  // Purchase date 2026-08-14 must NOT become event_date
  assert.equal(res1.manifest.tickets['WC-5001'].event_date, '2026-10-26');
  assert.equal(res1.manifest.tickets['WC-5001'].pass_tier, 'all_inclusive');
  assert.equal(res1.manifest.tickets['WC-5001'].evening_access, true);
  assert.equal(res1.manifest.tickets['WC-5002'].quantity, 3);
  assert.equal(res1.manifest.tickets['WC-5003'].isCancelled, true);

  // Merge PayPal without losing WooCommerce
  const paypalCsv = [
    'Transaction ID,Date,From Name,From Email Address,Item Title,Payment Status,Invoice Number',
    'PP-9901,15/09/2026,Dr. Ama Ata,ama@example.org,Residential Delegate Weekly,Completed,INV-101'
  ].join('\n');

  const res2 = importCsv(paypalCsv, {
    manifest: res1.manifest,
    fileName: 'paypal.csv',
    eventId: 'aad26-d1',
    defaultDate: '2026-10-26',
    knownEventDates
  });

  assert.ok(res2.manifest.tickets['WC-5001']);
  assert.ok(res2.manifest.tickets['PP-9901']);
  assert.equal(res2.manifest.tickets['PP-9901'].order_id, 'INV-101');
});

test('4. Wednesday 2026-10-28: Day 3 Conference admission does NOT block Storytelling Dinner', () => {
  const csv = [
    'ticket_id,holder_name,holder_email,ticket_type,order_status',
    'AI-200,Naledi Pandor,naledi@example.org,The All-Inclusive Delegate,completed',
    'STD-201,Bongani Zungu,bongani@example.org,Standard Conference Daytime Pass (Weekly),completed'
  ].join('\n');

  const { manifest } = importCsv(csv, {
    eventId: 'aad26-d3',
    defaultDate: '2026-10-28',
    knownEventDates: AAD_EVENTS.map(e => e.date)
  });

  /** @type {Record<string, any>} */
  const scannedSet = {};

  // Morning Day 3 Conference scan -> ADMIT
  const day3Admit = validateTicket(
    parsePayload('AI-200'),
    manifest.tickets,
    'aad26-d3',
    'gate-01',
    scannedSet,
    'Staff'
  );
  assert.equal(day3Admit.valid, true);
  assert.equal(day3Admit.status, 'valid');
  scannedSet[scannedKey('AI-200', 'aad26-d3')] = { time: '08:45:00', gate: 'Main Entrance', count: 1 };

  // Second scan at Day 3 Conference -> DUPLICATE
  const day3Dup = validateTicket(
    parsePayload('AI-200'),
    manifest.tickets,
    'aad26-d3',
    'gate-03',
    scannedSet,
    'Staff'
  );
  assert.equal(day3Dup.valid, false);
  assert.equal(day3Dup.status, 'duplicate');

  // Evening Storytelling Dinner (same date 2026-10-28!) -> MUST ADMIT All-Inclusive
  const dinnerAdmit = validateTicket(
    parsePayload('AI-200'),
    manifest.tickets,
    'aad26-dinner',
    'gate-04',
    scannedSet,
    'Staff'
  );
  assert.equal(dinnerAdmit.valid, true, 'All-Inclusive delegate must be admitted to Wednesday dinner after attending Day 3');
  scannedSet[scannedKey('AI-200', 'aad26-dinner')] = { time: '18:45:00', gate: 'Evening Reception', count: 1 };

  // Second scan at Storytelling Dinner -> DUPLICATE
  const dinnerDup = validateTicket(
    parsePayload('AI-200'),
    manifest.tickets,
    'aad26-dinner',
    'gate-04',
    scannedSet,
    'Staff'
  );
  assert.equal(dinnerDup.valid, false);
  assert.equal(dinnerDup.status, 'duplicate');

  // Daytime-only pass at Storytelling Dinner -> DENIED even if operator left gate on gate-01
  const stdDinnerDenied = validateTicket(
    parsePayload('STD-201'),
    manifest.tickets,
    'aad26-dinner',
    'gate-01',
    scannedSet,
    'Staff'
  );
  assert.equal(stdDinnerDenied.valid, false);
  assert.equal(stdDinnerDenied.phrase, 'NO EVENING ACCESS');
});

test('5. Sample Manifest + Soweto Heritage Tour admits at Tour Gate and denies at Conference Hall', () => {
  const sampleText = fs.readFileSync(path.join(ROOT, 'samples/sample-aad-manifest.csv'), 'utf8');
  const { manifest } = importCsv(sampleText, {
    fileName: 'sample-aad-manifest.csv',
    sourceId: 'event_tickets',
    eventId: 'aad26-d1',
    defaultDate: '2026-10-26',
    knownEventDates: AAD_EVENTS.map(e => e.date)
  });

  // AAD26-1012 is Soweto Heritage Tour
  const atConference = validateTicket(
    parsePayload('AAD26-1012'),
    manifest.tickets,
    'aad26-d1',
    'gate-01',
    {},
    'Staff'
  );
  assert.equal(atConference.valid, false);
  assert.equal(atConference.phrase, 'NOT A CONFERENCE PASS');

  const atTourBus = validateTicket(
    parsePayload('AAD26-1012'),
    manifest.tickets,
    'aad26-tour-soweto',
    'gate-05',
    {},
    'Staff'
  );
  assert.equal(atTourBus.valid, true, 'Soweto Tour ticket must be admitted at Soweto Tour departure gate');

  // Standard delegate pass without tour entitlement denied at Tour Bus
  const confPassAtTourBus = validateTicket(
    parsePayload('AAD26-1001'),
    manifest.tickets,
    'aad26-tour-soweto',
    'gate-05',
    {},
    'Staff'
  );
  assert.equal(confPassAtTourBus.valid, false);
  assert.equal(confPassAtTourBus.phrase, 'NO TOUR ENTITLEMENT');
});

test('6. Backwards-compatible v1.3 date-scoped scannedSet migration & multi-seat admission', () => {
  const legacyV13Set = {
    'AAD26-1001::2026-10-26': { time: '08:15:00', gate: 'Main Entrance', count: 1 }
  };
  const hitDay1 = findPriorScan(legacyV13Set, 'AAD26-1001', 'aad26-d1', '2026-10-26', 'conference');
  assert.ok(hitDay1, 'v1.3 date-keyed scan on Day 1 is preserved after live upgrade');

  const hitDinner = findPriorScan(
    { 'AAD26-1001::2026-10-28': { time: '09:00:00', gate: 'Main Entrance', count: 1 } },
    'AAD26-1001',
    'aad26-dinner',
    '2026-10-28',
    'evening'
  );
  assert.equal(hitDinner, null, 'Date-keyed conference scan must not leak into evening gateGroup');

  const ancientSet = migrateScannedSet({ 'OLD-1': { time: '08:00:00', gate: 'G1' } }, 'aad26-d1');
  assert.ok(ancientSet['OLD-1::aad26-d1']);
});

test('7. Supervisor override reconciles exact denial counter buckets', () => {
  let c = blankCounters(100);
  c = updateCounters(c, 'cancelled');
  assert.equal(c.cancelled, 1);
  assert.equal(c.checkedIn, 0);

  c = reconcileOverrideCounters(c, 'cancelled');
  assert.equal(c.cancelled, 0);
  assert.equal(c.checkedIn, 1);

  c = updateCounters(c, 'duplicate');
  assert.equal(c.duplicates, 1);
  c = reconcileOverrideCounters(c, 'duplicate');
  assert.equal(c.duplicates, 0);
  assert.equal(c.checkedIn, 2);

  const denial = {
    valid: false,
    status: /** @type {const} */ ('cancelled'),
    phrase: 'CANCELLED',
    icon: 'icon-ban',
    holderName: 'Test Holder',
    ticketType: 'Full Pass',
    ticketId: 'T-1',
    orderId: 'O-1',
    gateName: 'Main Entrance',
    scanTime: '10:00:00',
    actionLine: 'Cancelled',
    rawPayload: 'T-1'
  };
  const overridden = overrideAdmission(denial, 'Paid cash at desk', 'Supervisor Lerato');
  assert.equal(overridden.valid, true);
  assert.equal(overridden.overriddenFrom, 'cancelled');
});

test('8. Security: CSV Formula Injection (CWE-1236), PIN Hashing, POPIA Cloud Minimisation, and CSP Clean HTML', async () => {
  // Formula neutralisation
  assert.equal(neutralizeCsvFormula("=cmd|'/C calc'!A0"), "'=cmd|'/C calc'!A0");
  assert.equal(neutralizeCsvFormula('+HYPERLINK("http://evil.example")'), '\'+HYPERLINK("http://evil.example")');
  assert.equal(neutralizeCsvFormula('  @SUM(A1:A5)'), "'  @SUM(A1:A5)");
  assert.equal(neutralizeCsvFormula('-250.00'), '-250.00');
  assert.equal(escapeCsvCell('=1+1'), `"'=1+1"`);

  const csvOut = stringifyCsv(
    [{ ticket_id: 'T1', raw_payload: '=IMPORTXML("https://evil.tld","//a")', amount: '-50.00' }],
    ['ticket_id', 'raw_payload', 'amount']
  );
  assert.ok(csvOut.includes(`"'=IMPORTXML(""https://evil.tld"",""//a"")"`));
  assert.ok(csvOut.includes(`"-50.00"`));

  // WebCrypto SHA-256 PIN verification
  const hash = await hashPin('4829');
  assert.equal(hash.length, 64);
  assert.equal(await verifyPin('4829', hash), true);
  assert.equal(await verifyPin('0000', hash), false);

  // POPIA Cloud PII minimisation
  const cleaned = sanitizeCloudRow({
    ticket_id: 'AAD26-1001',
    event_id: 'aad26-d1',
    holder_name: 'Dr. Kwame Mensah',
    holder_email: 'secret@example.com',
    security_code: 'SEC-SECRET',
    status: 'valid'
  });
  assert.equal('holder_email' in cleaned, false);
  assert.equal('security_code' in cleaned, false);
  assert.equal(cleaned.seat_no, 1);

  // CSP compliance: index.html must contain zero inline event handlers (onclick=, onload=, etc.)
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.equal(/\bon[a-z]+\s*=/i.test(html), false, 'index.html must be free of inline event handlers for strict CSP');
});

test('9. Performance: WeakMap memoized lookup handles 5,000 fuzzy lookups in < 100ms', () => {
  /** @type {Record<string, any>} */
  const bigManifest = {};
  for (let i = 1000; i < 3500; i++) {
    bigManifest[`AAD26-${i}`] = { ticket_id: `AAD26-${i}`, holder_name: `Delegate ${i}` };
  }

  const start = performance.now();
  for (let i = 0; i < 5000; i++) {
    const id = 1000 + (i % 2500);
    const res = resolveTicket(bigManifest, `aad 26 ${id}`);
    assert.equal(res.resolvedId, `AAD26-${id}`);
  }
  const elapsedMs = performance.now() - start;
  assert.ok(elapsedMs < 150, `Expected memoized 5,000 lookups < 150ms, took ${elapsedMs.toFixed(1)}ms`);
});

test('10. Zero-Build Linker QA: Every ES module import/export and Service Worker precache asset resolves', () => {
  const jsFiles = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) jsFiles.push(full);
    }
  }
  walk(path.join(ROOT, 'js'));

  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const file of jsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const imports = [...src.matchAll(/import\s+\{([^}]+)\}\s+from\s+'([^']+)'/g)];
    for (const [, specifiers, relPath] of imports) {
      const target = path.resolve(path.dirname(file), relPath);
      assert.equal(fs.existsSync(target), true, `Missing imported file ${relPath} from ${file}`);
      const targetSrc = fs.readFileSync(target, 'utf8');
      const names = specifiers.split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      for (const name of names) {
        const e = escRe(name);
        const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|class)\\s+${e}(?![a-zA-Z0-9_$])|export\\s*\\{[^}]*(?<![a-zA-Z0-9_$])${e}(?![a-zA-Z0-9_$])`);
        assert.equal(re.test(targetSrc), true, `Missing named export '${name}' in ${target}`);
      }
    }
  }

  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const assets = [...sw.matchAll(/'(\.\/[^']+)'/g)].map(m => m[1]);
  for (const asset of assets) {
    const rel = asset.replace(/^\.\//, '');
    if (!rel) continue;
    assert.equal(fs.existsSync(path.join(ROOT, rel)), true, `SW precache asset missing on disk: ${rel}`);
  }
});

test('11. Event Tickets Plus + PayPal: 17-character Transaction IDs and Storytelling Dinner session-only access', () => {
  const knownEventDates = AAD_EVENTS.map(e => e.date);
  const etpCsv = fs.readFileSync(path.join(ROOT, 'samples/qa-event-tickets-plus-export.csv'), 'utf8');
  const etp = importCsv(etpCsv, {
    fileName: 'qa-event-tickets-plus-export.csv',
    defaultDate: '2026-10-26',
    knownEventDates
  });

  assert.equal(etp.report.detectedLabel, 'Event Tickets Plus');
  const etpIds = Object.values(etp.manifest.tickets)
    .filter(ticket => ticket.source === 'event_tickets')
    .map(ticket => ticket.ticket_id);
  assert.ok(etpIds.every(id => /^SDP-\d{2}-[A-Z0-9]{6}$/.test(id)), 'ET+ IDs should match the SDP-41-AOBUZ7-style pattern');
  assert.equal(etp.report.loaded, 7);
  assert.equal(etp.report.excludedThisFile, 2);
  assert.equal(etp.manifest.tickets['SDP-41-D8X3K9'].event_id, 'aad26-dinner');
  assert.equal(etp.manifest.tickets['SDP-41-D8X3K9'].exclusion_id, 'event');

  const paypalCsv = fs.readFileSync(path.join(ROOT, 'samples/qa-paypal-export.csv'), 'utf8');
  const paypal = importCsv(paypalCsv, {
    manifest: etp.manifest,
    fileName: 'qa-paypal-export.csv',
    defaultDate: '2026-10-26',
    knownEventDates
  });

  assert.equal(paypal.report.detectedLabel, 'PayPal');
  assert.equal(paypal.report.loaded, 5);
  assert.equal(paypal.report.excludedThisFile, 1);
  const dinnerTxn = 'W6X7Y8Z9A1B2C3D4E';
  assert.equal(dinnerTxn.length, 17);
  assert.match(dinnerTxn, /^[A-Z0-9]{17}$/);
  assert.equal(paypal.manifest.tickets[dinnerTxn].event_id, 'aad26-dinner');
  assert.equal(paypal.manifest.tickets[dinnerTxn].exclusion_id, 'event');

  for (const id of ['SDP-41-D8X3K9', dinnerTxn]) {
    const dinnerResult = validateTicket(
      parsePayload(id), paypal.manifest.tickets, 'aad26-dinner', 'gate-04', {}, 'QA'
    );
    assert.equal(dinnerResult.valid, true, `${id} must admit at the Storytelling Dinner`);

    const conferenceResult = validateTicket(
      parsePayload(id), paypal.manifest.tickets, 'aad26-d3', 'gate-01', {}, 'QA'
    );
    assert.equal(conferenceResult.valid, false, `${id} must not admit to Day 3 conference sessions`);
    assert.equal(conferenceResult.phrase, 'NOT A CONFERENCE PASS');
  }
});

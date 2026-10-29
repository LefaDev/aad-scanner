// @ts-check
import { $, esc, iconSvg } from './ui/dom.js';
import { getState, setState, resetSession, subscribe } from './core/state.js';
import { parsePayload } from './core/parser.js';
import { validateTicket, overrideAdmission } from './core/rules.js';
import { updateCounters, reconcileOverrideCounters } from './core/counters.js';
import { importCsv } from './core/importer.js';
import {
  loadManifest,
  saveManifest,
  loadSession,
  saveSession,
  deleteSession,
  loadSettings,
  initBroadcast,
  broadcastScan
} from './core/storage.js';
import { playResultAudio, triggerHaptic, requestWakeLock } from './core/audio.js';
import { recordCloudScan, fetchRemoteAdmits, flushCloudQueue } from './core/cloud.js';
import { exportScanLog } from './core/export.js';
import { initShell, renderActiveContext } from './ui/shell.js';
import { initScanInput, focusScanInput, stopActiveCamera } from './ui/scan.js';
import { renderResult } from './ui/result.js';
import { renderStats } from './ui/stats.js';
import { initActivity, renderActivityList } from './ui/activity.js';
import { openReportModal } from './ui/report-modal.js';
import { initSettings } from './ui/settings.js';
import { initWalkInPanel } from './ui/walkin.js';
import { withWalkIns, walkInsToTickets } from './core/walkins.js';
import { scannedKey, findPriorScan, migrateScannedSet } from './core/session.js';
import { showToast } from './ui/toast.js';
import { AAD_EVENTS, getAadEvent } from './config/events.js';
import { getGate, GATES } from './config/gates.js';

/**
 * Main Application Bootstrap
 */
async function bootstrap() {
  console.log('Bootstrapping AAD 2026 Registration Validator v1.4.2...');

  // 1. Restore saved settings AND active session/gate/operator context from localStorage
  const savedSettings = loadSettings();
  if (savedSettings) {
    const {
      theme: _omitTheme,
      activeEventId,
      activeGateId,
      operatorName,
      ...pureSettings
    } = savedSettings;

    setState({
      settings: { ...getState().settings, ...pureSettings },
      ...(activeEventId && AAD_EVENTS.some(e => e.id === activeEventId) ? { activeEventId } : {}),
      ...(activeGateId ? { activeGateId } : {}),
      ...(operatorName ? { operatorName } : {})
    });
    document.documentElement.removeAttribute('data-theme');
  }

  if (!GATES.some(g => g.id === getState().activeGateId)) {
    setState({ activeGateId: GATES[0].id });
  }

  // 2. Initialize Shell & Controls (with automatic cloud queue flush on Wi-Fi reconnect)
  initShell(
    (panelId) => {
      if (panelId === 'validator') {
        focusScanInput();
        if (getState().settings.keepAwake) requestWakeLock();
      } else {
        stopActiveCamera();
      }
    },
    () => {
      const s = getState();
      if (s.settings.cloudSync && s.settings.supabaseUrl) {
        flushCloudQueue(s.settings).catch(() => {});
      }
    }
  );

  initActivity();

  initSettings(async () => {
    await loadSampleManifest();
  });

  // 3. Initialize Scanner (Hardware Wedge + Camera Fallback)
  initScanInput((rawPayload) => {
    handleScan(rawPayload);
  });

  // 4. Multi-tab synchronization via BroadcastChannel
  initBroadcast((msg) => {
    if (msg.type === 'SCAN_ADMITTED') {
      const { ticketId, scanTime, gateName, counters, eventDate, eventId, count } = msg;
      const current = getState();
      const scope = eventId || current.activeEventId || eventDate || currentEventDate();
      const updatedSet = {
        ...current.scannedSet,
        [scannedKey(ticketId, scope)]: {
          time: scanTime,
          gate: gateName,
          count: Number(count) || 1
        }
      };
      setState({
        scannedSet: updatedSet,
        counters: (eventId === current.activeEventId && counters) ? counters : current.counters
      });
      renderStats(getState().counters);
    }
  });

  // 5. Restore IndexedDB Manifest & Session
  await restorePersistedData();

  // 5b. Fold walk-ins captured at the door into the live manifest
  await mergeWalkInsIntoManifest();

  // 5c. Walk-in registration panel
  initWalkInPanel({ onAdmitted: handleWalkInAdmitted });

  // 6. Bind Control Bar & CSP-safe Dialog Close Buttons
  bindControlBar();
  bindCspDialogButtons();

  // 7. Subscribe UI modules to state
  subscribe((s) => {
    renderStats(s.counters);
  });

  // 8. Service Worker Registration
  registerServiceWorker();

  // 9. Flush any pending offline cloud scans if online at boot
  const bootState = getState();
  if (bootState.online && bootState.settings.cloudSync && bootState.settings.supabaseUrl) {
    flushCloudQueue(bootState.settings).catch(() => {});
  }

  renderInitialState();
}

/**
 * Wire dialog close and launch buttons in JS so index.html needs zero inline onclick= attributes
 */
function bindCspDialogButtons() {
  const reportsLaunchBtn = $('#reports-panel-launch-btn');
  if (reportsLaunchBtn) {
    reportsLaunchBtn.addEventListener('click', () => openReportModal());
  }

  const reportCloseX = $('#report-dialog-x-btn');
  const reportDialog = /** @type {HTMLDialogElement|null} */ ($('#report-dialog'));
  if (reportCloseX && reportDialog) {
    reportCloseX.addEventListener('click', () => reportDialog.close());
  }

  const detailCloseX = $('#detail-dialog-x-btn');
  const detailDialog = /** @type {HTMLDialogElement|null} */ ($('#detail-dialog'));
  if (detailCloseX && detailDialog) {
    detailCloseX.addEventListener('click', () => detailDialog.close());
  }
}

/**
 * Fold walk-ins captured at the door into the live ticket map.
 * @returns {Promise<any>}
 */
async function mergeWalkInsIntoManifest() {
  const state = getState();
  const base = state.manifest ? state.manifest.tickets : {};
  const merged = await withWalkIns(base);
  const manifest = state.manifest
    ? { ...state.manifest, tickets: merged }
    : { meta: {}, tickets: merged, sources: [] };

  setState({
    manifest,
    counters: { ...state.counters, loaded: countConferenceDelegates(merged) }
  });
  return manifest;
}

/**
 * @param {Record<string, any>} tickets
 * @returns {number}
 */
function countConferenceDelegates(tickets) {
  return Object.values(tickets).filter(t => !t.excluded).length;
}

function currentEventDate() {
  const ev = getAadEvent(getState().activeEventId);
  return ev ? ev.date : '';
}

function currentGateName() {
  const gate = getGate(getState().activeGateId);
  return gate ? gate.name : 'Active Gate';
}

function nowTime() {
  return new Date().toLocaleTimeString('en-ZA', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

/**
 * Walk-in registered & admitted at the desk (persists locally + syncs to cloud if enabled)
 * @param {any} record
 * @returns {Promise<{ gateName: string, time: string }>}
 */
async function handleWalkInAdmitted(record) {
  const state = getState();
  const tickets = { ...(state.manifest ? state.manifest.tickets : {}), ...walkInsToTickets([record]) };
  const manifest = {
    ...(state.manifest || { meta: {}, sources: [] }),
    tickets
  };

  await saveManifest(state.activeEventId, manifest);

  const time = nowTime();
  const gateName = currentGateName();
  const walkInDate = currentEventDate();
  const admitKey = scannedKey(record.ticket_id, state.activeEventId);

  const scannedSet = {
    ...state.scannedSet,
    [admitKey]: { time, gate: gateName, count: 1 }
  };

  const counters = {
    ...state.counters,
    loaded: countConferenceDelegates(tickets),
    checkedIn: state.counters.checkedIn + 1
  };

  const logEntry = {
    id: 'walkin-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
    scannedAt: new Date().toISOString(),
    eventId: state.activeEventId,
    ticketId: record.ticket_id,
    status: 'valid',
    holderName: record.name,
    ticketType: record.ticket_type,
    orderId: record.ticket_id,
    gateId: state.activeGateId,
    gateName,
    operator: state.operatorName,
    rawPayload: '[walk-in registration]',
    details: {
      actionLine: `Registered at the desk as a walk-in (${record.source}).`,
      source: 'walk_in',
      organisation: record.organisation,
      days: record.days,
      paid: record.paid,
      amount: record.amount
    }
  };

  const nextLog = [logEntry, ...state.log];

  setState({
    manifest,
    counters,
    scannedSet,
    log: nextLog
  });

  renderStats(counters);
  renderActivityList();
  broadcastScan(record.ticket_id, time, gateName, counters, walkInDate, state.activeEventId, 1);
  saveSession(state.activeEventId, state.activeGateId, {
    eventDate: walkInDate, counters, scannedSet, log: nextLog, operator: state.operatorName
  });

  if (state.settings.cloudSync && state.settings.supabaseUrl) {
    recordCloudScan({
      ticket_id: record.ticket_id,
      event_id: state.activeEventId,
      event_date: walkInDate || record.event_date,
      seat_no: 1,
      holder_name: record.name,
      ticket_type: record.ticket_type,
      status: 'valid',
      gate_name: gateName,
      operator: state.operatorName,
      device_id: state.deviceId,
      raw_payload: '[walk-in registration]'
    }, state.settings);
  }

  return { gateName, time };
}

/**
 * Supervisor override of a denial (reconciles exact denial counter + syncs to cloud)
 * @param {import('./core/state.js').ScanResult} denial
 * @param {string} reason
 */
function handleOverride(denial, reason) {
  const state = getState();
  let overridden;
  try {
    overridden = overrideAdmission(denial, reason, state.operatorName);
  } catch (err) {
    showToast(err.message, 'error');
    return;
  }

  const nextCounters = reconcileOverrideCounters(state.counters, denial.status);

  const overrideDate = currentEventDate();
  const activeEvent = getAadEvent(state.activeEventId);
  const priorHit = findPriorScan(
    state.scannedSet,
    overridden.ticketId,
    state.activeEventId,
    overrideDate,
    activeEvent ? activeEvent.gateGroup : 'conference'
  );
  const overrideKey = scannedKey(overridden.ticketId, state.activeEventId);
  const seatCount = ((priorHit && Number(priorHit.entry.count)) || 0) + 1;

  const scannedSet = {
    ...state.scannedSet,
    [overrideKey]: {
      time: overridden.scanTime,
      gate: overridden.gateName,
      count: seatCount
    }
  };

  const logEntry = {
    id: 'override-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
    scannedAt: new Date().toISOString(),
    eventId: state.activeEventId,
    ticketId: overridden.ticketId,
    status: 'valid',
    holderName: overridden.holderName,
    ticketType: overridden.ticketType,
    orderId: overridden.orderId,
    gateId: state.activeGateId,
    gateName: overridden.gateName,
    operator: state.operatorName,
    rawPayload: overridden.rawPayload,
    details: {
      actionLine: overridden.actionLine,
      overriddenFrom: overridden.overriddenFrom,
      overrideReason: overridden.overrideReason,
      overrideOperator: overridden.overrideOperator,
      isOverride: true
    }
  };

  const nextLog = [logEntry, ...state.log];

  setState({
    counters: nextCounters,
    scannedSet,
    log: nextLog,
    currentResult: overridden
  });

  const event = getAadEvent(state.activeEventId);
  const gate = getGate(state.activeGateId);
  renderResult(overridden, {
    loadedCount: nextCounters.loaded,
    eventName: event ? event.name : 'AAD 2026',
    gateName: gate ? gate.name : 'Active Gate'
  }, { onOverrideHandler: handleOverride });

  renderStats(nextCounters);
  renderActivityList();
  broadcastScan(overridden.ticketId, overridden.scanTime, overridden.gateName, nextCounters, overrideDate, state.activeEventId, seatCount);
  saveSession(state.activeEventId, state.activeGateId, {
    eventDate: overrideDate, counters: nextCounters, scannedSet, log: nextLog, operator: state.operatorName
  });

  if (state.settings.cloudSync && state.settings.supabaseUrl) {
    recordCloudScan({
      ticket_id: overridden.ticketId,
      event_id: state.activeEventId,
      event_date: overrideDate || new Date().toISOString().split('T')[0],
      seat_no: seatCount,
      holder_name: overridden.holderName,
      ticket_type: overridden.ticketType,
      status: 'valid',
      gate_name: overridden.gateName,
      operator: state.operatorName,
      device_id: state.deviceId,
      raw_payload: `[override:${overridden.overriddenFrom}] ${overridden.overrideReason}`
    }, state.settings);
  }

  showToast(`Override recorded: ${overridden.holderName} admitted by ${state.operatorName}`, 'warn');
}

/**
 * Handle incoming scan payload
 * @param {string} raw 
 */
async function handleScan(raw) {
  const state = getState();
  const payload = parsePayload(raw);

  const ticketsMap = state.manifest ? state.manifest.tickets : {};

  const result = validateTicket(
    payload,
    ticketsMap,
    state.activeEventId,
    state.activeGateId,
    state.scannedSet,
    state.operatorName,
    state.settings.lookalikeMapping
  );

  const nextCounters = updateCounters(state.counters, result.status);

  const nextScannedSet = { ...state.scannedSet };
  const event = getAadEvent(state.activeEventId);
  const eventDate = event ? event.date : '';
  let seatNumberAdmitted = 1;

  if (result.valid && result.ticketId) {
    const priorHit = findPriorScan(
      nextScannedSet,
      result.ticketId,
      state.activeEventId,
      eventDate,
      event ? event.gateGroup : 'conference'
    );
    seatNumberAdmitted = ((priorHit && Number(priorHit.entry.count)) || 0) + 1;
    const admitKey = scannedKey(result.ticketId, state.activeEventId);
    nextScannedSet[admitKey] = {
      time: result.scanTime,
      gate: result.gateName,
      count: seatNumberAdmitted
    };
    broadcastScan(result.ticketId, result.scanTime, result.gateName, nextCounters, eventDate, state.activeEventId, seatNumberAdmitted);
  }

  /** @type {import('./core/state.js').LogEntry} */
  const logEntry = {
    id: 'scan-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
    scannedAt: new Date().toISOString(),
    eventId: state.activeEventId,
    ticketId: result.ticketId,
    status: result.status,
    holderName: result.holderName,
    ticketType: result.ticketType,
    orderId: result.orderId,
    gateId: state.activeGateId,
    gateName: result.gateName,
    operator: state.operatorName,
    rawPayload: result.rawPayload,
    details: {
      actionLine: result.actionLine,
      softWarning: result.softWarning
    }
  };

  const nextLog = [logEntry, ...state.log];

  setState({
    counters: nextCounters,
    scannedSet: nextScannedSet,
    log: nextLog,
    currentResult: result
  });

  playResultAudio(result.status, state.settings.beepVolume);
  triggerHaptic(result.valid, state.settings.vibration);

  const gate = getGate(state.activeGateId);
  renderResult(result, {
    loadedCount: nextCounters.loaded,
    eventName: event ? event.name : 'AAD 2026',
    gateName: gate ? gate.name : 'Active Gate'
  }, { onOverrideHandler: handleOverride });

  renderActivityList();

  saveSession(state.activeEventId, state.activeGateId, {
    eventDate,
    counters: nextCounters,
    scannedSet: nextScannedSet,
    log: nextLog,
    operator: state.operatorName
  });

  // Cloud sync (POPIA-minimised: no security_code or email transmitted)
  if (state.settings.cloudSync && state.settings.supabaseUrl) {
    const cloudRow = {
      ticket_id: result.ticketId,
      event_id: state.activeEventId,
      event_date: eventDate || new Date().toISOString().split('T')[0],
      seat_no: seatNumberAdmitted,
      holder_name: result.holderName,
      ticket_type: result.ticketType,
      status: result.status,
      gate_name: result.gateName,
      operator: state.operatorName,
      device_id: state.deviceId,
      raw_payload: result.rawPayload
    };

    recordCloudScan(cloudRow, state.settings, (conflictTicketId) => {
      showToast(`Cross-gate duplicate: Ticket ${conflictTicketId} was already admitted at another gate!`, 'error');
    });
  }

  focusScanInput();
}

/**
 * Bind Control Bar Buttons
 */
function bindControlBar() {
  const syncBtn = $('#control-sync-btn');
  const reportBtn = $('#control-report-btn');
  const exportBtn = $('#control-export-log-btn');
  const clearBtn = $('#control-clear-btn');
  const sidebarExportBtn = $('#sidebar-export-log-btn');

  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      syncBtn.setAttribute('disabled', 'true');
      syncBtn.innerHTML = `${iconSvg('icon-refresh', 'icon')} <span>Syncing…</span>`;

      try {
        const state = getState();
        const event = getAadEvent(state.activeEventId);
        const eventDate = event ? event.date : '2026-10-26';

        if (state.settings.cloudSync && state.settings.supabaseUrl) {
          await flushCloudQueue(state.settings);
          const remoteAdmits = await fetchRemoteAdmits(
            state.settings.supabaseUrl,
            state.settings.supabaseAnonKey,
            eventDate,
            state.activeEventId
          );
          if (remoteAdmits && remoteAdmits.length > 0) {
            /** @type {Record<string, { time: string, gate: string, count: number }>} */
            const remoteByTicket = {};
            remoteAdmits.forEach(r => {
              const tId = r.ticket_id;
              if (!tId) return;
              const formattedTime = r.scanned_at
                ? new Date(r.scanned_at).toLocaleTimeString('en-ZA', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : 'earlier';
              if (!remoteByTicket[tId]) {
                remoteByTicket[tId] = { time: formattedTime, gate: r.gate_name || 'Remote Gate', count: 1 };
              } else {
                remoteByTicket[tId].count += 1;
              }
            });

            const nextSet = { ...getState().scannedSet };
            for (const [tId, meta] of Object.entries(remoteByTicket)) {
              const key = scannedKey(tId, state.activeEventId);
              const existing = nextSet[key];
              if (!existing || (Number(existing.count) || 1) < meta.count) {
                nextSet[key] = meta;
              }
            }
            setState({ scannedSet: nextSet });
            await saveSession(state.activeEventId, state.activeGateId, {
              eventDate,
              counters: getState().counters,
              scannedSet: nextSet,
              log: getState().log,
              operator: state.operatorName
            });
          }
        }

        const ticketCount = state.manifest ? countConferenceDelegates(state.manifest.tickets) : 0;
        showToast(`Event synced: ${ticketCount} passes cached and offline ready`, 'success');
      } finally {
        syncBtn.removeAttribute('disabled');
        syncBtn.innerHTML = `${iconSvg('icon-refresh', 'icon')} <span>Sync event</span>`;
      }
    });
  }

  if (reportBtn) {
    reportBtn.addEventListener('click', () => {
      openReportModal();
    });
  }

  const exportHandler = () => {
    exportScanLog(getState().log, getState().activeEventId);
    showToast('Scan log exported to CSV', 'info');
  };

  if (exportBtn) exportBtn.addEventListener('click', exportHandler);
  if (sidebarExportBtn) sidebarExportBtn.addEventListener('click', exportHandler);

  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear current scan counters and activity log?')) {
        const s = getState();
        resetSession();
        await deleteSession(s.activeEventId, s.activeGateId);
        renderActivityList();
        renderInitialState();
        showToast('Session counts and log cleared', 'info');
      }
    });
  }
}

/**
 * Load synthetic sample manifest via the unified multi-source importer
 */
async function loadSampleManifest() {
  try {
    showToast('Loading sample AAD manifest…', 'info');
    const res = await fetch('samples/sample-aad-manifest.csv');
    if (!res.ok) throw new Error('Sample CSV not found');
    const text = await res.text();
    const state = getState();
    const activeEvent = getAadEvent(state.activeEventId);

    const { manifest: imported } = importCsv(text, {
      manifest: state.manifest,
      fileName: 'sample-aad-manifest.csv',
      sourceId: 'event_tickets',
      eventId: state.activeEventId,
      defaultDate: activeEvent ? activeEvent.date : '2026-10-26',
      knownEventDates: AAD_EVENTS.map(e => e.date),
      operator: state.operatorName
    });

    const ticketsWithWalkIns = await withWalkIns(imported.tickets);
    const conferenceCount = countConferenceDelegates(ticketsWithWalkIns);
    const manifestData = {
      ...imported,
      meta: {
        ...imported.meta,
        conferenceCount,
        source: 'sample'
      },
      tickets: ticketsWithWalkIns
    };

    await saveManifest(state.activeEventId, manifestData);

    setState({
      manifest: manifestData,
      counters: {
        ...getState().counters,
        loaded: conferenceCount
      }
    });

    renderActiveContext(getState().activeEventId, getState().activeGateId);
    renderInitialState();
    showToast(`Loaded sample manifest: ${conferenceCount} conference passes ready`, 'success');
  } catch (err) {
    showToast('Failed to load sample data: ' + err.message, 'error');
  }
}

/**
 * Restore manifest and session from IndexedDB
 */
async function restorePersistedData() {
  try {
    const state = getState();
    const manifest = await loadManifest(state.activeEventId);
    if (manifest && manifest.tickets) {
      setState({
        manifest,
        counters: {
          ...state.counters,
          loaded: countConferenceDelegates(manifest.tickets)
        }
      });
    }

    const session = await loadSession(state.activeEventId, state.activeGateId);
    if (session) {
      const activeDate = currentEventDate();
      setState({
        counters: session.counters
          ? { ...session.counters, loaded: getState().counters.loaded }
          : getState().counters,
        scannedSet: migrateScannedSet(session.scannedSet || {}, state.activeEventId || session.eventDate || activeDate),
        log: session.log || [],
        sessionRestored: true,
        sessionStartedAt: session.sessionStartedAt || new Date().toISOString()
      });

      if (session.log && session.log.length > 0) {
        showSessionRestoredBanner(session.log.length, session.sessionStartedAt || session.updatedAt);
      }
    }
  } catch (err) {
    console.warn('Could not restore past session:', err);
  }
}

/**
 * Show session restored banner
 * @param {number} scanCount 
 * @param {string} startedAt 
 */
function showSessionRestoredBanner(scanCount, startedAt) {
  const banner = $('#session-restored-banner');
  if (!banner) return;
  const parsedDate = startedAt ? new Date(startedAt) : new Date();
  const timeFormatted = Number.isNaN(parsedDate.getTime())
    ? 'earlier'
    : parsedDate.toLocaleTimeString('en-ZA');

  banner.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%;">
      <div>
        <strong>Session restored:</strong> ${Number(scanCount) || 0} previous scans restored (started ${esc(timeFormatted)}).
      </div>
      <button type="button" id="start-new-session-btn" class="btn btn-outline btn-sm" style="border-color: currentColor;">
        Start a new session
      </button>
    </div>
  `;
  banner.removeAttribute('hidden');

  const newSessionBtn = $('#start-new-session-btn');
  if (newSessionBtn) {
    newSessionBtn.onclick = async () => {
      if (confirm('Start a new session? This will reset this session’s counters and stored scans.')) {
        const s = getState();
        resetSession();
        await deleteSession(s.activeEventId, s.activeGateId);
        banner.setAttribute('hidden', '');
        renderActivityList();
        renderInitialState();
        showToast('New session started', 'info');
      }
    };
  }
}

/**
 * Render initial UI states
 */
function renderInitialState() {
  const state = getState();
  const event = getAadEvent(state.activeEventId);
  const gate = getGate(state.activeGateId);

  renderActiveContext(state.activeEventId, state.activeGateId);
  renderStats(state.counters);
  renderResult(null, {
    loadedCount: state.counters.loaded,
    eventName: event ? event.name : 'AAD 2026',
    gateName: gate ? gate.name : 'Active Gate'
  });
  renderActivityList();
}

/**
 * Service Worker Registration & Safe Update Prompt
 */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          showUpdateToast(reg.waiting);
        }
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateToast(newWorker);
              }
            });
          }
        });
      }).catch((err) => {
        console.warn('SW registration skipped or failed:', err);
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    });
  }
}

/**
 * Show update prompt toast (operator chooses when to reload between queues)
 * @param {ServiceWorker} worker 
 */
function showUpdateToast(worker) {
  if (document.getElementById('sw-update-toast')) return;
  const container = document.createElement('div');
  container.id = 'sw-update-toast';
  container.className = 'toast toast-info';
  container.style.position = 'fixed';
  container.style.top = '16px';
  container.style.right = '16px';
  container.style.zIndex = '3000';
  container.innerHTML = `
    <span>A new gate build is ready.</span>
    <button type="button" id="sw-update-now" class="btn btn-primary btn-sm" style="margin-left: 8px;">Update now</button>
    <button type="button" id="sw-update-later" class="btn btn-outline btn-sm" style="margin-left: 4px; color: #fff; border-color: rgba(255,255,255,0.4);">Later</button>
  `;
  document.body.appendChild(container);

  const updateNowBtn = container.querySelector('#sw-update-now');
  if (updateNowBtn) {
    updateNowBtn.addEventListener('click', () => {
      worker.postMessage({ type: 'SKIP_WAITING' });
      container.remove();
    });
  }

  const updateLaterBtn = container.querySelector('#sw-update-later');
  if (updateLaterBtn) {
    updateLaterBtn.addEventListener('click', () => container.remove());
  }
}

bootstrap();

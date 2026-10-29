// @ts-check
import { $, $$, esc, copyToClipboard } from './dom.js';
import { getState, setState, resetSession } from '../core/state.js';
import {
  saveSettings,
  saveManifest,
  saveSession,
  loadSession,
  deleteSession,
  purgeAllLocalData
} from '../core/storage.js';
import { importCsv } from '../core/importer.js';
import { withWalkIns } from '../core/walkins.js';
import { testConnection, SUPABASE_SQL_SETUP } from '../core/cloud.js';
import { exportScanLog } from '../core/export.js';
import { hashPin, verifyPin } from '../core/security.js';
import { showToast } from './toast.js';
import { AAD_EVENTS, getAadEvent } from '../config/events.js';
import { GATES } from '../config/gates.js';
import { renderActiveContext, updateOnlineStatus } from './shell.js';
import { renderStats } from './stats.js';
import { renderActivityList } from './activity.js';
import { renderResult } from './result.js';
import { migrateScannedSet, blankCounters } from '../core/session.js';

/**
 * Helper to persist full settings + active context together so reloads keep
 * the selected Conference Day, Gate, and Operator Name.
 * @param {Partial<any>} [settingsPatch]
 */
function persistAllSettings(settingsPatch = {}) {
  const s = getState();
  const nextSettings = { ...s.settings, ...settingsPatch };
  setState({ settings: nextSettings });
  saveSettings({
    ...nextSettings,
    activeEventId: s.activeEventId,
    activeGateId: s.activeGateId,
    operatorName: s.operatorName
  });
}

/**
 * Initialize Settings Panel
 * @param {() => Promise<void>} onSampleDataRequested 
 */
export function initSettings(onSampleDataRequested) {
  $$('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.settings-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-target');
      $$('.settings-section').forEach(sec => {
        if (sec.id === target) {
          sec.removeAttribute('hidden');
        } else {
          sec.setAttribute('hidden', '');
        }
      });
    });
  });

  populateSettingsValues();
  bindEventAndGateControls();
  bindPinControls();
  bindCloudControls();
  bindScannerControls();
  bindDataControls(onSampleDataRequested);
}

export function populateSettingsValues() {
  const state = getState();

  const eventSelect = /** @type {HTMLSelectElement} */ ($('#settings-event-select'));
  const controlEventSelect = /** @type {HTMLSelectElement} */ ($('#control-event-select'));
  if (eventSelect) {
    eventSelect.innerHTML = AAD_EVENTS.map(e =>
      `<option value="${esc(e.id)}" ${e.id === state.activeEventId ? 'selected' : ''}>${esc(e.name)} (${esc(e.date)})</option>`
    ).join('');
  }
  if (controlEventSelect) {
    controlEventSelect.innerHTML = `<option value="">— Select event —</option>` + AAD_EVENTS.map(e =>
      `<option value="${esc(e.id)}" ${e.id === state.activeEventId ? 'selected' : ''}>${esc(e.name)} · ${esc(e.date)}</option>`
    ).join('');
  }

  const gateSelect = /** @type {HTMLSelectElement} */ ($('#settings-gate-select'));
  if (gateSelect) {
    gateSelect.innerHTML = GATES.map(g =>
      `<option value="${esc(g.id)}" ${g.id === state.activeGateId ? 'selected' : ''}>${esc(g.name)}</option>`
    ).join('');
  }

  const operatorInput = /** @type {HTMLInputElement} */ ($('#settings-operator-name'));
  if (operatorInput) operatorInput.value = state.operatorName;

  const supabaseUrlInput = /** @type {HTMLInputElement} */ ($('#settings-supabase-url'));
  const supabaseKeyInput = /** @type {HTMLInputElement} */ ($('#settings-supabase-key'));
  if (supabaseUrlInput) supabaseUrlInput.value = state.settings.supabaseUrl || '';
  if (supabaseKeyInput) supabaseKeyInput.value = state.settings.supabaseAnonKey || '';

  const autoSubmitInput = /** @type {HTMLInputElement} */ ($('#settings-auto-submit-ms'));
  const dupGuardInput = /** @type {HTMLInputElement} */ ($('#settings-dup-guard-ms'));
  const beepVolInput = /** @type {HTMLInputElement} */ ($('#settings-beep-volume'));
  const vibrationInput = /** @type {HTMLInputElement} */ ($('#settings-vibration-toggle'));
  const keepAwakeInput = /** @type {HTMLInputElement} */ ($('#settings-keep-awake-toggle'));
  const lookalikeInput = /** @type {HTMLInputElement} */ ($('#settings-lookalike-toggle'));

  if (autoSubmitInput) autoSubmitInput.value = String(state.settings.autoSubmitMs);
  if (dupGuardInput) dupGuardInput.value = String(state.settings.dupGuardMs);
  if (beepVolInput) beepVolInput.value = String(state.settings.beepVolume);
  if (vibrationInput) vibrationInput.checked = state.settings.vibration;
  if (keepAwakeInput) keepAwakeInput.checked = state.settings.keepAwake;
  if (lookalikeInput) lookalikeInput.checked = state.settings.lookalikeMapping;

  const sqlSnippet = $('#settings-supabase-sql');
  if (sqlSnippet) sqlSnippet.textContent = SUPABASE_SQL_SETUP;

  updatePinStatusUI();
}

function updatePinStatusUI() {
  const statusEl = $('#settings-pin-status');
  if (!statusEl) return;
  const hasPin = Boolean(getState().settings.supervisorPinHash);
  statusEl.textContent = hasPin
    ? 'Supervisor PIN lock ACTIVE — manual overrides require the PIN.'
    : 'No PIN set — any gate operator may record a reason-logged override.';
  statusEl.style.color = hasPin ? 'var(--status-valid)' : 'var(--neutral-muted)';
}

function bindPinControls() {
  const pinInput = /** @type {HTMLInputElement|null} */ ($('#settings-supervisor-pin'));
  const savePinBtn = $('#settings-save-pin-btn');
  const clearPinBtn = $('#settings-clear-pin-btn');

  if (savePinBtn && pinInput) {
    savePinBtn.addEventListener('click', async () => {
      const rawPin = pinInput.value.trim();
      if (rawPin.length < 4) {
        showToast('Supervisor PIN must be at least 4 characters.', 'warn');
        return;
      }
      const existingHash = getState().settings.supervisorPinHash;
      if (existingHash) {
        const currentPin = prompt('Enter current Supervisor PIN to replace it:') || '';
        if (!(await verifyPin(currentPin, existingHash))) {
          showToast('Current PIN did not match.', 'error');
          return;
        }
      }
      const digest = await hashPin(rawPin);
      persistAllSettings({ supervisorPinHash: digest });
      pinInput.value = '';
      updatePinStatusUI();
      showToast('Supervisor Override PIN activated.', 'success');
    });
  }

  if (clearPinBtn) {
    clearPinBtn.addEventListener('click', async () => {
      const existingHash = getState().settings.supervisorPinHash;
      if (!existingHash) {
        showToast('No Supervisor PIN is currently set.', 'info');
        return;
      }
      const currentPin = prompt('Enter current Supervisor PIN to remove lock:') || '';
      if (!(await verifyPin(currentPin, existingHash))) {
        showToast('Incorrect Supervisor PIN.', 'error');
        return;
      }
      persistAllSettings({ supervisorPinHash: '' });
      if (pinInput) pinInput.value = '';
      updatePinStatusUI();
      showToast('Supervisor Override PIN removed.', 'info');
    });
  }
}

function bindEventAndGateControls() {
  const eventSelect = /** @type {HTMLSelectElement} */ ($('#settings-event-select'));
  const controlEventSelect = /** @type {HTMLSelectElement} */ ($('#control-event-select'));
  const gateSelect = /** @type {HTMLSelectElement} */ ($('#settings-gate-select'));
  const operatorInput = /** @type {HTMLInputElement} */ ($('#settings-operator-name'));

  const updateContext = async () => {
    const previous = getState();
    const activeEventId = eventSelect ? eventSelect.value : previous.activeEventId;
    const activeGateId = gateSelect ? gateSelect.value : previous.activeGateId;
    const operatorName = (operatorInput ? operatorInput.value.trim() : '') || previous.operatorName || 'Gate Staff';

    const eventChanged = activeEventId !== previous.activeEventId;
    const gateChanged = activeGateId !== previous.activeGateId;

    // 1. Preserve previous session under its own (eventId/gateId) key before switching
    if (eventChanged || gateChanged) {
      const prevEvent = getAadEvent(previous.activeEventId);
      await saveSession(previous.activeEventId, previous.activeGateId, {
        eventDate: prevEvent ? prevEvent.date : '',
        counters: previous.counters,
        scannedSet: previous.scannedSet,
        log: previous.log,
        operator: previous.operatorName
      });
    }

    setState({ activeEventId, activeGateId, operatorName });
    persistAllSettings();
    renderActiveContext(activeEventId, activeGateId);
    if (controlEventSelect) controlEventSelect.value = activeEventId;
    if (eventSelect) eventSelect.value = activeEventId;

    // 2. Load target session whenever EITHER event OR gate changed (prevents overwriting target gate!)
    if (eventChanged || gateChanged) {
      const targetEvent = getAadEvent(activeEventId);
      const session = await loadSession(activeEventId, activeGateId);
      const loadedCount = previous.manifest && previous.manifest.tickets
        ? Object.values(previous.manifest.tickets).filter((/** @type {any} */ t) => !t.excluded).length
        : 0;

      const counters = session && session.counters
        ? { ...session.counters, loaded: loadedCount }
        : blankCounters(loadedCount);

      setState({
        counters,
        scannedSet: migrateScannedSet(
          (session && session.scannedSet) || {},
          activeEventId || (session && session.eventDate) || (targetEvent ? targetEvent.date : '')
        ),
        log: (session && session.log) || [],
        currentResult: null
      });

      renderStats(getState().counters);
      renderActivityList();
      renderResult(null, {
        loadedCount,
        eventName: targetEvent ? targetEvent.name : 'AAD 2026',
        gateName: (GATES.find(g => g.id === activeGateId) || GATES[0]).name
      });

      if (session && session.log && session.log.length > 0) {
        showToast(`Loaded ${targetEvent ? targetEvent.name : activeEventId}: ${session.log.length} earlier scan(s) restored.`, 'info');
      } else {
        showToast(`Switched to ${targetEvent ? targetEvent.name : activeEventId}. Ready to scan.`, 'info');
      }
    } else {
      // Only operator name changed
      const ev = getAadEvent(activeEventId);
      await saveSession(activeEventId, activeGateId, {
        eventDate: ev ? ev.date : '',
        counters: getState().counters,
        scannedSet: getState().scannedSet,
        log: getState().log,
        operator: operatorName
      });
    }
  };

  if (eventSelect) eventSelect.addEventListener('change', updateContext);
  if (controlEventSelect) controlEventSelect.addEventListener('change', () => {
    if (controlEventSelect.value) {
      if (eventSelect) eventSelect.value = controlEventSelect.value;
      updateContext();
    }
  });
  if (gateSelect) gateSelect.addEventListener('change', updateContext);
  if (operatorInput) operatorInput.addEventListener('change', updateContext);
}

function bindCloudControls() {
  const urlInput = /** @type {HTMLInputElement} */ ($('#settings-supabase-url'));
  const keyInput = /** @type {HTMLInputElement} */ ($('#settings-supabase-key'));
  const revealKeyBtn = $('#settings-reveal-key-btn');
  const testBtn = $('#settings-cloud-test-btn');
  const saveBtn = $('#settings-cloud-save-btn');
  const disconnectBtn = $('#settings-cloud-disconnect-btn');
  const copySqlBtn = $('#settings-copy-sql-btn');
  const statusEl = $('#settings-cloud-status');

  if (revealKeyBtn && keyInput) {
    revealKeyBtn.addEventListener('click', () => {
      const isPassword = keyInput.type === 'password';
      keyInput.type = isPassword ? 'text' : 'password';
      revealKeyBtn.textContent = isPassword ? 'Hide' : 'Reveal';
    });
  }

  if (copySqlBtn) {
    copySqlBtn.addEventListener('click', async () => {
      await copyToClipboard(SUPABASE_SQL_SETUP);
      showToast('Supabase SQL copied to clipboard', 'info');
    });
  }

  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      testBtn.setAttribute('disabled', 'true');
      testBtn.textContent = 'Testing…';
      const url = urlInput.value.trim();
      const key = keyInput.value.trim();
      const result = await testConnection(url, key);
      testBtn.removeAttribute('disabled');
      testBtn.textContent = 'Test connection';

      if (statusEl) {
        statusEl.textContent = result.message;
        statusEl.style.color = result.success ? 'var(--status-valid)' : 'var(--color-accent-red)';
      }
      showToast(result.message, result.success ? 'success' : 'error');
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const url = urlInput.value.trim();
      const key = keyInput.value.trim();
      persistAllSettings({
        cloudSync: true,
        supabaseUrl: url,
        supabaseAnonKey: key
      });
      updateOnlineStatus(navigator.onLine);
      showToast('Cloud settings saved & connected', 'success');
      if (statusEl) {
        statusEl.textContent = 'Connected. Writes will sync to Supabase.';
        statusEl.style.color = 'var(--status-valid)';
      }
    });
  }

  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', () => {
      persistAllSettings({ cloudSync: false });
      updateOnlineStatus(navigator.onLine);
      showToast('Cloud sync disconnected (Local mode only)', 'info');
      if (statusEl) {
        statusEl.textContent = 'Disconnected. Operating in local mode.';
        statusEl.style.color = 'var(--neutral-muted)';
      }
    });
  }
}

function bindScannerControls() {
  const autoSubmitInput = /** @type {HTMLInputElement} */ ($('#settings-auto-submit-ms'));
  const dupGuardInput = /** @type {HTMLInputElement} */ ($('#settings-dup-guard-ms'));
  const beepVolInput = /** @type {HTMLInputElement} */ ($('#settings-beep-volume'));
  const vibrationInput = /** @type {HTMLInputElement} */ ($('#settings-vibration-toggle'));
  const keepAwakeInput = /** @type {HTMLInputElement} */ ($('#settings-keep-awake-toggle'));
  const lookalikeInput = /** @type {HTMLInputElement} */ ($('#settings-lookalike-toggle'));

  const saveScannerSettings = () => {
    persistAllSettings({
      autoSubmitMs: Number(autoSubmitInput.value) || 120,
      dupGuardMs: Number(dupGuardInput.value) || 700,
      beepVolume: Number(beepVolInput.value),
      vibration: vibrationInput.checked,
      keepAwake: keepAwakeInput.checked,
      lookalikeMapping: lookalikeInput.checked
    });
  };

  [autoSubmitInput, dupGuardInput, beepVolInput, vibrationInput, keepAwakeInput, lookalikeInput].forEach(el => {
    if (el) el.addEventListener('change', saveScannerSettings);
  });
}

/**
 * @param {() => Promise<void>} onSampleDataRequested 
 */
function bindDataControls(onSampleDataRequested) {
  const fileInput = /** @type {HTMLInputElement} */ ($('#manifest-file-input'));
  const dropZone = $('#manifest-drop-zone');
  const sampleBtn = $('#settings-load-sample-btn');
  const exportLogBtn = $('#settings-export-log-btn');
  const clearSessionBtn = $('#settings-clear-session-btn');
  const purgeDeviceBtn = $('#settings-purge-device-btn');

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files ? fileInput.files[0] : null;
      if (file) {
        handleManifestFile(file);
        fileInput.value = '';
      }
    });
  }

  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--color-highlight)';
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.style.borderColor = 'var(--neutral-border)';
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--neutral-border)';
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        handleManifestFile(e.dataTransfer.files[0]);
      }
    });
  }

  if (sampleBtn) {
    sampleBtn.addEventListener('click', async () => {
      await onSampleDataRequested();
    });
  }

  if (exportLogBtn) {
    exportLogBtn.addEventListener('click', () => {
      exportScanLog(getState().log, getState().activeEventId);
    });
  }

  if (clearSessionBtn) {
    clearSessionBtn.addEventListener('click', async () => {
      const confirmWord = prompt('Type "CLEAR" to confirm clearing the active session counts and log:');
      if (confirmWord === 'CLEAR') {
        const s = getState();
        resetSession();
        await deleteSession(s.activeEventId, s.activeGateId);
        renderActivityList();
        renderStats(getState().counters);
        showToast('Session counts and log cleared', 'info');
      }
    });
  }

  if (purgeDeviceBtn) {
    purgeDeviceBtn.addEventListener('click', async () => {
      const confirmWord = prompt(
        'POPIA DEVICE WIPE: Type "PURGE" to permanently erase ALL manifests, delegate data, walk-ins, scan logs, and cloud keys from this browser:'
      );
      if (confirmWord === 'PURGE') {
        await purgeAllLocalData();
        setState({ manifest: null });
        resetSession();
        renderActiveContext(getState().activeEventId, getState().activeGateId);
        renderActivityList();
        renderStats(getState().counters);
        showToast('All local device data purged.', 'success');
      }
    });
  }
}

/**
 * Handle reading and indexing a manifest CSV file (preserving door walk-ins)
 * @param {File} file 
 */
export async function handleManifestFile(file) {
  const summaryEl = $('#manifest-import-summary');
  const sourceSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('manifest-source-select'));

  try {
    const text = await file.text();
    const state = getState();

    const knownEventDates = AAD_EVENTS.map(e => e.date);
    const todaySession = AAD_EVENTS.find(e => e.id === state.activeEventId);

    const { manifest: importedManifest, report } = importCsv(text, {
      manifest: state.manifest,
      fileName: file.name,
      sourceId: sourceSelect ? sourceSelect.value : '',
      eventId: state.activeEventId,
      defaultDate: todaySession ? todaySession.date : '',
      knownEventDates,
      operator: state.operatorName
    });

    const ticketsWithWalkIns = await withWalkIns(importedManifest.tickets);
    const conferenceCount = Object.values(ticketsWithWalkIns).filter((/** @type {any} */ t) => !t.excluded).length;
    const manifest = {
      ...importedManifest,
      meta: {
        ...importedManifest.meta,
        conferenceCount
      },
      tickets: ticketsWithWalkIns
    };

    await saveManifest(state.activeEventId, manifest);

    setState({
      manifest,
      counters: {
        ...state.counters,
        loaded: conferenceCount
      }
    });

    renderActiveContext(getState().activeEventId, getState().activeGateId);

    if (summaryEl) {
      summaryEl.innerHTML = renderImportReport(report);
    }

    if (report.loaded === 0 && report.collisions.length === 0) {
      showToast('No new conference passes added — this file was already loaded.', 'warn');
    } else {
      showToast(
        `${report.sourceLabel}: ${report.loaded} conference pass(es) added · ${conferenceCount} delegates in total`,
        'success'
      );
    }
  } catch (err) {
    console.error('Error importing manifest:', err);
    showToast('Failed to parse CSV manifest: ' + err.message, 'error');
  }
}

/**
 * Human-readable import report.
 * @param {any} report
 * @returns {string}
 */
function renderImportReport(report) {
  const warnings = (report.warnings || []);
  const skipped = report.skipped || [];
  const collisions = report.collisions || [];

  const warningsHtml = warnings.length ? `
    <ul style="margin:10px 0 0; padding-left:18px; font-size:13px; color: var(--neutral-darkest);">
      ${warnings.map((/** @type {string} */ w) => `<li>${esc(w)}</li>`).join('')}
    </ul>` : '';

  const collisionsHtml = collisions.length ? `
    <details style="margin-top:10px;">
      <summary style="cursor:pointer; font-size:13px; font-weight:600; color: var(--color-accent-red);">
        ${collisions.length} duplicated ticket id(s) — review before opening
      </summary>
      <ul style="font-size:12px; margin-top:6px; padding-left:20px;">
        ${collisions.slice(0, 15).map((/** @type {any} */ c) => `<li><code>${esc(c.ticketId)}</code> — kept from ${esc(c.keptFrom)}, ignored in ${esc(c.droppedFrom)} (${esc(c.holder)})</li>`).join('')}
      </ul>
    </details>` : '';

  const skippedHtml = skipped.length ? `
    <details style="margin-top:8px;">
      <summary style="cursor:pointer; font-size:13px; font-weight:600; color: var(--color-accent-red);">
        View skipped rows (${skipped.length})
      </summary>
      <ul style="font-size:12px; margin-top:6px; padding-left:20px;">
        ${skipped.slice(0, 10).map((/** @type {any} */ s) => `<li>Row ${s.rowNumber}: ${esc(s.reason)} — <code>${esc(String(s.raw).slice(0, 60))}</code></li>`).join('')}
      </ul>
    </details>` : '';

  const unmappedHtml = (report.unmappedColumns || []).length ? `
    <div style="margin-top:8px; font-size:12px; color: var(--neutral-muted);">
      Ignored columns: ${esc((report.unmappedColumns || []).slice(0, 12).join(', '))}
    </div>` : '';

  const tiers = (report.tierBreakdown && report.tierBreakdown.tiers) || [];
  const excludedGroups = (report.tierBreakdown && report.tierBreakdown.excluded) || [];

  const tiersHtml = tiers.length ? `
    <div style="margin-top:10px; width:100%;">
      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--neutral-muted); margin-bottom:6px;">
        Conference delegates by pass
      </div>
      <table style="width:100%; font-size:13px; border-collapse:collapse;">
        ${tiers.map((/** @type {any} */ t) => `<tr>
          <td style="padding:3px 0; border-bottom:1px solid var(--neutral-light);">${esc(t.label)}</td>
          <td style="padding:3px 0; border-bottom:1px solid var(--neutral-light); text-align:right; font-weight:700; font-family:var(--font-mono);">${t.count}</td>
        </tr>`).join('')}
      </table>
    </div>` : '';

  const excludedHtml = excludedGroups.length ? `
    <div style="margin-top:10px; width:100%;">
      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--color-accent-warm); margin-bottom:6px;">
        Excluded from conference hall count
      </div>
      <table style="width:100%; font-size:13px; border-collapse:collapse;">
        ${excludedGroups.map((/** @type {any} */ t) => `<tr>
          <td style="padding:3px 0; border-bottom:1px solid var(--neutral-light); color:var(--neutral-dark);">${esc(t.label)}</td>
          <td style="padding:3px 0; border-bottom:1px solid var(--neutral-light); text-align:right; font-weight:700; font-family:var(--font-mono); color:var(--neutral-dark);">${t.count}</td>
        </tr>`).join('')}
      </table>
      <div style="font-size:12px; color:var(--neutral-muted); margin-top:4px;">
        Tours and event-specific tickets admit only at their matching session; merchandise never admits.
      </div>
    </div>` : '';

  return `
    <div class="active-event-strip" style="background-color: var(--surface-panel); flex-direction: column; align-items: flex-start; gap: 6px;">
      <div style="font-weight: 700; color: var(--status-valid);">
        ${report.loaded} conference pass(es) added from ${esc(report.sourceLabel)}
        ${report.detectedLabel !== report.sourceLabel ? `<span style="font-weight:400; color: var(--neutral-dark);">(detected as ${esc(report.detectedLabel)})</span>` : ''}
      </div>
      <div style="font-size: 13px; color: var(--neutral-dark);">
        ${report.rowsRead} rows read · ${report.loaded} conference · ${report.excludedThisFile || 0} non-conference ·
        ${skipped.length} skipped · ${report.cancelled} cancelled · ${report.prechecked} pre-checked ·
        <strong>${report.conferenceTotal} delegates in total</strong>
      </div>
      ${tiersHtml}
      ${excludedHtml}
      ${report.dateSoftened > 0 ? `<div style="font-size:12px; color: var(--neutral-muted);">
        ${report.dateSoftened} ticket(s) had no usable conference date and were assigned the active session.
      </div>` : ''}
      ${warningsHtml}
      ${collisionsHtml}
      ${skippedHtml}
      ${unmappedHtml}
    </div>
  `;
}

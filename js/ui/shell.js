// @ts-check
import { $, $$, esc, iconSvg } from './dom.js';
import { getState, setState } from '../core/state.js';
import { getGate } from '../config/gates.js';
import { getAadEvent } from '../config/events.js';
import { saveSettings } from '../core/storage.js';
import { todayInSast } from '../core/walkins.js';
import { showToast } from './toast.js';

/**
 * Initialize app shell, panel navigation, header chips and theme
 * @param {(targetPanel: string) => void} [onPanelChange]
 * @param {() => void} [onReconnect]
 */
export function initShell(onPanelChange, onReconnect) {
  function switchPanel(panelId, pushHash = true) {
    const validPanels = ['validator', 'walkin', 'log', 'reports', 'settings'];
    if (!validPanels.includes(panelId)) panelId = 'validator';

    $$('.nav-item, .mobile-tab-item').forEach(item => {
      const target = item.getAttribute('data-target');
      if (target === panelId) {
        item.classList.add('active');
        item.setAttribute('aria-current', 'page');
      } else {
        item.classList.remove('active');
        item.removeAttribute('aria-current');
      }
    });

    $$('[data-panel]').forEach(panel => {
      if (panel.getAttribute('data-panel') === panelId) {
        panel.removeAttribute('hidden');
        const heading = panel.querySelector('h1, h2');
        if (heading) heading.setAttribute('tabindex', '-1');
      } else {
        panel.setAttribute('hidden', '');
      }
    });

    if (pushHash && window.location.hash !== `#${panelId}`) {
      window.location.hash = panelId;
    }

    if (typeof onPanelChange === 'function') {
      onPanelChange(panelId);
    }
  }

  $$('.nav-item, .mobile-tab-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const target = btn.getAttribute('data-target');
      if (target) switchPanel(target);
    });
  });

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace(/^#/, '');
    if (hash) switchPanel(hash, false);
  });

  const initialHash = window.location.hash.replace(/^#/, '');
  if (initialHash) {
    switchPanel(initialHash, false);
  }

  // Sound Toggle Button
  const soundToggleBtn = $('#sound-toggle-btn');
  if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', () => {
      const s = getState();
      const current = s.settings;
      const nextVolume = current.beepVolume > 0 ? 0 : 0.5;
      const updated = { ...current, beepVolume: nextVolume };
      setState({ settings: updated });
      saveSettings({
        ...updated,
        activeEventId: s.activeEventId,
        activeGateId: s.activeGateId,
        operatorName: s.operatorName
      });
      updateSoundButtonUI(nextVolume);
      showToast(nextVolume > 0 ? 'Sound enabled' : 'Sound muted', 'info');
    });
  }

  // Online / Offline Listener (auto-flushes pending cloud queue on reconnect)
  window.addEventListener('online', () => {
    setState({ online: true });
    updateOnlineStatus(true);
    showToast('Network online — syncing queued scans', 'success');
    if (typeof onReconnect === 'function') {
      onReconnect();
    }
  });

  window.addEventListener('offline', () => {
    setState({ online: false });
    updateOnlineStatus(false);
    showToast('Network offline. App running in offline mode.', 'info');
  });

  updateOnlineStatus(navigator.onLine);
  updateSoundButtonUI(getState().settings.beepVolume);
}

/**
 * @param {number} volume 
 */
function updateSoundButtonUI(volume) {
  const btn = $('#sound-toggle-btn');
  if (!btn) return;
  const isMuted = volume <= 0;
  btn.innerHTML = iconSvg(isMuted ? 'icon-volume-x' : 'icon-volume-2');
  btn.setAttribute('aria-label', isMuted ? 'Unmute sounds' : 'Mute sounds');
  btn.setAttribute('title', isMuted ? 'Unmute sounds' : 'Mute sounds');
}

/**
 * @param {boolean} isOnline 
 */
export function updateOnlineStatus(isOnline) {
  const indicator = $('#connection-indicator');
  if (indicator) {
    indicator.className = `connection-indicator ${isOnline ? 'online' : 'offline'}`;
    indicator.innerHTML = `
      <span class="connection-dot"></span>
      <span class="connection-text">${isOnline ? 'ONLINE' : 'OFFLINE'}</span>
    `;
  }

  const headerChip = $('#header-cloud-chip');
  if (headerChip) {
    const cloudSync = getState().settings.cloudSync;
    if (!cloudSync) {
      headerChip.textContent = 'Local only';
      headerChip.classList.remove('active');
    } else {
      headerChip.textContent = isOnline ? 'Cloud sync' : 'Cloud offline';
      headerChip.classList.toggle('active', isOnline);
    }
  }
}

/**
 * Render active gate and event labels across shell (with SAST date-mismatch guard)
 * @param {string} eventId 
 * @param {string} gateId 
 */
export function renderActiveContext(eventId, gateId) {
  const event = getAadEvent(eventId);
  const gate = getGate(gateId);

  const gateLabel = $('#announcement-gate-label');
  if (gateLabel) {
    gateLabel.textContent = gate ? gate.name.toUpperCase() : 'GATE CONTROL';
  }

  const sidebarGate = $('#sidebar-gate-name');
  if (sidebarGate) {
    sidebarGate.textContent = gate ? gate.name : 'Active Gate';
  }

  const activeStrip = $('#active-event-strip-container');
  if (activeStrip) {
    const manifest = getState().manifest;
    const ticketCount = manifest && manifest.tickets
      ? Object.values(manifest.tickets).filter((/** @type {any} */ t) => !t.excluded).length
      : 0;
    const eventName = event ? event.name : 'AAD 2026';
    const eventDate = event ? event.date : '2026-10-26';
    const todaySast = todayInSast();
    const isConferenceWindow = todaySast >= '2026-10-25' && todaySast <= '2026-10-30';
    const dateMismatch = isConferenceWindow && eventDate !== todaySast;

    activeStrip.innerHTML = `
      <div class="active-event-text" style="flex-wrap: wrap;">
        <strong>Active session:</strong>
        <span>${esc(eventName)} (${esc(eventDate)})</span>
        <span class="chip chip-gold">${ticketCount} passes loaded</span>
        <span class="chip ${ticketCount > 0 ? 'chip-valid' : 'chip-prechecked'}">${ticketCount > 0 ? 'Offline ready' : 'Waiting for manifest'}</span>
        ${dateMismatch ? `<span class="chip chip-duplicate" title="Selected session date does not match today's SAST date (${esc(todaySast)})">Check Day: Today is ${esc(todaySast)}</span>` : ''}
      </div>
    `;
  }
}

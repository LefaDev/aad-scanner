// @ts-check
/**
 * WALK-IN REGISTRATION — UI controller
 * ====================================
 * Left: the form. Right: desk stats + today's registrations.
 * On submit it issues a code, prints a badge and (optionally) records the
 * admission through the same counter/log path the scanner uses, so walk-ins
 * appear in the attendance report exactly like pre-sold tickets.
 */

import { $, esc } from './dom.js';
import { showToast } from './toast.js';
import { getState } from '../core/state.js';
import {
  conferenceDays, todayInSast, createWalkIn, removeWalkIn, listWalkIns,
  walkInStats, exportWalkInsCsv, NO_EMAIL_PLACEHOLDER
} from '../core/walkins.js';
import { downloadFile } from '../core/export.js';

/** @type {(() => Promise<void>)|null} */
let refreshStats = null;

/**
 * Render a QR code as inline SVG using the vendored encoder.
 * Falls back to a plain code block if the library is unavailable, so a badge
 * can still be issued (the code is human-typeable).
 * @param {string} text
 * @returns {string} HTML
 */
function qrSvg(text) {
  const lib = /** @type {any} */ (window).qrcode;
  if (typeof lib !== 'function') {
    return `<div class="badge-code" style="font-size:13px;">${esc(text)}</div>`;
  }
  try {
    const qr = lib(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const cell = 4;
    const size = count * cell;
    let path = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) path += `M${c * cell} ${r * cell}h${cell}v${cell}h-${cell}z`;
      }
    }
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Ticket QR code">
      <rect width="${size}" height="${size}" fill="#fff"/>
      <path d="${path}" fill="#000"/>
    </svg>`;
  } catch (err) {
    console.warn('QR render failed, falling back to text code:', err);
    return `<div class="badge-code" style="font-size:13px;">${esc(text)}</div>`;
  }
}

/** @param {string} iso */
function prettyDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Build the badge dialog once and reuse it.
 * @returns {HTMLDialogElement}
 */
function ensureBadgeDialog() {
  const existing = /** @type {HTMLDialogElement|null} */ (document.getElementById('badge-dialog'));
  if (existing) return existing;

  const dialog = document.createElement('dialog');
  dialog.id = 'badge-dialog';
  dialog.className = 'app-dialog';
  dialog.innerHTML = `
    <div class="dialog-header no-print">
      <h2>Delegate badge</h2>
      <button type="button" class="icon-btn" data-close-badge aria-label="Close">
        <svg class="icon"><use href="assets/icons.svg#icon-x"></use></svg>
      </button>
    </div>
    <div id="badge-body" class="badge-sheet"></div>
    <div class="dialog-actions no-print" style="display:flex;gap:10px;justify-content:flex-end;padding:0 18px 18px;">
      <button type="button" class="btn btn-outline" data-close-badge>Close</button>
      <button type="button" class="btn btn-outline" id="badge-print-btn">
        <svg class="icon"><use href="assets/icons.svg#icon-printer"></use></svg>
        <span>Print badge</span>
      </button>
      <button type="button" class="btn btn-primary" id="badge-next-btn">Next delegate</button>
    </div>
  `;
  document.body.appendChild(dialog);

  dialog.querySelectorAll('[data-close-badge]').forEach(b => {
    b.addEventListener('click', () => dialog.close());
  });
  dialog.querySelector('#badge-print-btn')?.addEventListener('click', () => window.print());
  dialog.querySelector('#badge-next-btn')?.addEventListener('click', () => {
    dialog.close();
    /** @type {HTMLInputElement|null} */ (document.getElementById('wi-name'))?.focus();
  });
  return dialog;
}

/**
 * Show the badge for a fresh registration.
 * @param {any} record
 * @param {string} [gateName]
 * @param {string} [time]
 */
function showBadge(record, gateName, time) {
  const dialog = ensureBadgeDialog();
  const body = dialog.querySelector('#badge-body');
  if (!body) return;

  const dayLabels = (record.days || []).map(d => prettyDate(d)).join(' · ');

  body.innerHTML = `
    <div class="badge-qr">${qrSvg(record.ticket_id)}</div>
    <div class="badge-code">${esc(record.ticket_id)}</div>
    <div class="badge-name">${esc(record.name)}</div>
    ${record.organisation ? `<div class="badge-org">${esc(record.organisation)}</div>` : ''}
    <div class="badge-days">${esc(dayLabels)}</div>
    <div class="badge-days" style="font-weight:600;">
      ${record.paid ? `Paid ${record.amount != null ? 'R' + Number(record.amount).toFixed(2) : ''}` : 'UNPAID — collect before entry'}
    </div>
    ${gateName ? `<div class="badge-days">Admitted · ${esc(gateName)}${time ? ' · ' + esc(time) : ''}</div>` : ''}
  `;

  // showModal (not the `open` attribute) so the badge is an overlay and the
  // print stylesheet can isolate it from the app shell.
  if (!dialog.open) dialog.showModal();
}

/**
 * Initialise the walk-in panel.
 * @param {{ onAdmitted?: (record: any) => Promise<{gateName?: string, time?: string}> | void }} [hooks]
 */
export function initWalkInPanel(hooks = {}) {
  const form = /** @type {HTMLFormElement|null} */ (document.getElementById('walkin-form'));
  if (!form) return;

  const dayGrid = document.getElementById('wi-days');
  const alertBox = document.getElementById('walkin-form-alert');
  const noEmailCheck = /** @type {HTMLInputElement|null} */ (document.getElementById('wi-no-email'));
  const emailInput = /** @type {HTMLInputElement|null} */ (document.getElementById('wi-email'));
  const paidCheck = /** @type {HTMLInputElement|null} */ (document.getElementById('wi-paid'));
  const amountInput = /** @type {HTMLInputElement|null} */ (document.getElementById('wi-amount'));
  const dayBadge = document.getElementById('walkin-day-badge');

  const today = todayInSast();
  const days = conferenceDays();

  // --- Day selector -------------------------------------------------------
  if (dayGrid) {
    dayGrid.innerHTML = days.map(d => `
      <label class="day-toggle">
        <input type="checkbox" name="days" value="${esc(d.date)}" ${d.date === today ? 'checked' : ''}>
        <span class="day-label">${esc(d.name.replace(/^AAD 2026 · /, ''))}</span>
        <span class="day-date">${esc(prettyDate(d.date))}</span>
      </label>
    `).join('');
  }
  if (dayBadge) {
    const match = days.find(d => d.date === today);
    dayBadge.textContent = match ? match.name.replace(/^AAD 2026 · /, '') : 'No session today';
  }

  // --- Small UI helpers ---------------------------------------------------
  /** @param {string} field @param {string} message */
  function setFieldError(field, message) {
    const el = document.getElementById(`wi-${field}-error`);
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById(`wi-${field}`));
    if (el) {
      el.textContent = message;
      el.hidden = !message;
    }
    if (input) input.classList.toggle('invalid', Boolean(message));
  }

  function clearErrors() {
    ['name', 'email', 'days'].forEach(f => setFieldError(f, ''));
  }

  /** @param {string} message @param {'error'|'success'|'warn'} [kind] */
  function showAlert(message, kind = 'error') {
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.className = `walkin-alert ${kind}`;
    alertBox.hidden = false;
  }

  function hideAlert() {
    if (alertBox) alertBox.hidden = true;
  }

  // "No email" disables the email field so the desk can move fast
  noEmailCheck?.addEventListener('change', () => {
    if (!emailInput) return;
    const noEmail = noEmailCheck.checked;
    emailInput.disabled = noEmail;
    emailInput.required = !noEmail;
    if (noEmail) {
      emailInput.value = '';
      setFieldError('email', '');
    }
  });

  paidCheck?.addEventListener('change', () => {
    if (!amountInput) return;
    amountInput.disabled = !paidCheck.checked;
  });

  // --- Submit -------------------------------------------------------------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    hideAlert();

    const submitBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('wi-submit'));
    if (submitBtn?.disabled) return; // guard against double-submit on a slow tablet

    const checkedDays = Array.from(
      /** @type {NodeListOf<HTMLInputElement>} */ (form.querySelectorAll('input[name="days"]:checked'))
    ).map(i => i.value);

    const payload = {
      name: /** @type {HTMLInputElement} */ (document.getElementById('wi-name'))?.value || '',
      email: emailInput?.value || '',
      noEmail: Boolean(noEmailCheck?.checked),
      organisation: /** @type {HTMLInputElement} */ (document.getElementById('wi-org'))?.value || '',
      days: checkedDays,
      ticketType: /** @type {HTMLSelectElement} */ (document.getElementById('wi-type'))?.value || 'Walk-in Day Pass',
      paid: Boolean(paidCheck?.checked),
      amount: amountInput && amountInput.value !== '' ? Number(amountInput.value) : null,
      notes: /** @type {HTMLInputElement} */ (document.getElementById('wi-notes'))?.value || ''
    };

    if (submitBtn) submitBtn.disabled = true;

    try {
      const state = getState();
      const result = await createWalkIn(payload, {
        operator: state.operatorName,
        gateId: state.activeGateId
      });

      if (!result.ok) {
        const errors = result.errors || {};
        Object.entries(errors).forEach(([field, message]) => setFieldError(field, message));
        showAlert(
          result.duplicate
            ? `${payload.name} already registered today as ${result.duplicate.ticket_id}. If this is a different person, change the email.`
            : 'Please fix the highlighted fields.',
          'error'
        );
        return;
      }

      const record = result.record;

      // Record the admission through the normal log/counter path
      let gateName = '';
      let time = '';
      if (hooks.onAdmitted) {
        const info = await hooks.onAdmitted(record);
        if (info) {
          gateName = info.gateName || '';
          time = info.time || '';
        }
      }

      showToast(`${record.name} registered — ${record.ticket_id}`, 'success');

      // Reset for the next delegate but keep the selected day
      form.reset();
      if (noEmailCheck) noEmailCheck.checked = false;
      if (emailInput) { emailInput.disabled = false; }
      if (paidCheck) paidCheck.checked = true;
      if (amountInput) amountInput.disabled = false;
      const todayBox = /** @type {HTMLInputElement|null} */ (form.querySelector(`input[name="days"][value="${today}"]`));
      if (todayBox) todayBox.checked = true;
      clearErrors();

      await refresh();

      // Keep a copy of the code visible for the delegate to see
      showAlert(`${record.name} admitted as ${record.ticket_id}.`, 'success');

      showBadge(record, gateName, time);
    } catch (err) {
      console.error('Walk-in registration failed:', err);
      // The record may still have been written — be honest rather than pretend.
      showAlert(
        `Could not complete registration: ${err.message}. Check the Recent walk-ins list before re-entering.`,
        'error'
      );
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      /** @type {HTMLInputElement|null} */ (document.getElementById('wi-name'))?.focus();
    }
  });

  form.addEventListener('reset', () => {
    clearErrors();
    hideAlert();
  });

  // --- Export -------------------------------------------------------------
  document.getElementById('wi-export-btn')?.addEventListener('click', async () => {
    try {
      const { csv, rowCount, filename } = await exportWalkInsCsv();
      if (rowCount === 0) {
        showToast('No walk-ins registered yet.', 'warn');
        return;
      }
      downloadFile(csv, filename);
      showToast(`Exported ${rowCount} rows to ${filename}`, 'success');
    } catch (err) {
      showToast('Export failed: ' + err.message, 'error');
    }
  });

  // --- Render stats + recent list ----------------------------------------
  async function renderStatsAndList() {
    const stats = await walkInStats();
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };
    set('wi-stat-total', stats.total);
    set('wi-stat-today', stats.today);
    set('wi-stat-paid', stats.paid);
    set('wi-stat-unpaid', stats.unpaid);
    set('wi-stat-revenue', 'R' + stats.revenue.toFixed(2));

    const listEl = document.getElementById('wi-list');
    const countEl = document.getElementById('wi-list-count');
    if (countEl) countEl.textContent = String(stats.total);

    if (!listEl) return;

    const records = await listWalkIns();
    const recent = records
      .slice()
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 40);

    if (recent.length === 0) {
      listEl.innerHTML = '<p class="wi-empty">No walk-ins yet today.</p>';
      return;
    }

    listEl.innerHTML = recent.map(r => `
      <div class="wi-row" data-ticket="${esc(r.ticket_id)}">
        <div class="wi-row-main">
          <div class="wi-row-name">${esc(r.name)}</div>
          <div class="wi-row-meta">
            ${r.organisation ? esc(r.organisation) + ' · ' : ''}
            ${r.email === NO_EMAIL_PLACEHOLDER ? 'no email' : esc(r.email)}
            ${r.paid ? '' : ' · <strong>unpaid</strong>'}
          </div>
        </div>
        <span class="wi-row-code">${esc(r.ticket_id)}</span>
        <button type="button" data-delete="${esc(r.ticket_id)}" title="Delete this registration" aria-label="Delete ${esc(r.name)}">
          <svg class="icon"><use href="assets/icons.svg#icon-trash"></use></svg>
        </button>
      </div>
    `).join('');

    listEl.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-delete');
        if (!id) return;
        const row = records.find(r => r.ticket_id === id);
        if (!window.confirm(`Delete walk-in ${id}${row ? ' (' + row.name + ')' : ''}? This cannot be undone.`)) return;
        await removeWalkIn(id);
        showToast(`${id} removed`, 'warn');
        await refresh();
      });
    });
  }

  async function refresh() {
    await renderStatsAndList();
  }
  refreshStats = refresh;

  // Re-render when the panel is opened (registrations from other tabs show up)
  document.querySelectorAll('.nav-item, .mobile-tab-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('data-target') === 'walkin') refresh();
    });
  });

  refresh();
}

/**
 * Called by app.js after a manifest import so walk-in stats stay in sync.
 */
export async function refreshWalkInPanel() {
  if (refreshStats) await refreshStats();
}

// @ts-check
import { $, esc, iconSvg, copyToClipboard } from './dom.js';
import { getState } from '../core/state.js';
import { verifyPin } from '../core/security.js';
import { showToast } from './toast.js';

/**
 * @typedef {import('../core/state.js').ScanResult} ScanResult
 */

let denialTakeoverTimer = null;

/**
 * Render scan result panel (with optional Supervisor PIN protection on overrides)
 * @param {ScanResult|null} result 
 * @param {{ loadedCount: number, eventName: string, gateName: string }} context
 * @param {{ onOverrideHandler?: (result: any, reason: string) => void }} [ctx]
 */
export function renderResult(result, context, ctx = {}) {
  const panel = $('#result-panel');
  const liveAnnouncer = $('#aria-live-announcer');
  if (!panel) return;

  if (!result) {
    panel.removeAttribute('data-status');
    panel.style.borderLeftColor = 'var(--neutral-muted)';
    panel.style.backgroundColor = 'var(--surface-panel)';
    panel.innerHTML = `
      <div class="result-header-row">
        <div class="result-title-group">
          <div class="result-status-icon" style="color: var(--neutral-muted)">
            ${iconSvg('icon-scan', 'icon')}
          </div>
          <div>
            <div class="result-status-phrase" style="color: var(--neutral-muted); font-size: 1.75rem;">Waiting for scan…</div>
            <div style="font-size: 14px; color: var(--neutral-dark); margin-top: 4px;">
              ${Number(context.loadedCount) || 0} passes loaded · ${esc(context.eventName)} · ${esc(context.gateName)}
            </div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  panel.setAttribute('data-status', result.status);
  panel.classList.remove('animate-in');
  void panel.offsetWidth;
  panel.classList.add('animate-in');

  const vipBadge = result.isVip ? `<span class="chip chip-gold">VIP / SPEAKER</span>` : '';
  const cadenceBadge = result.cadence === 'weekly'
    ? `<span class="chip chip-valid">WEEKLY PASS</span>`
    : result.cadence === 'daily'
      ? `<span class="chip chip-neutral">DAILY PASS${Array.isArray(result.validDates) && result.validDates.length === 1 ? ' · ' + esc(result.validDates[0]) : ''}</span>`
      : '';
  const sourceBadge = result.source
    ? `<span class="chip chip-neutral" style="text-transform:uppercase;">${esc(result.source.replace('_', '-'))}</span>`
    : '';
  const softWarningBadge = result.softWarning ? `<span class="chip chip-prechecked">${esc(result.softWarning)}</span>` : '';
  const pinProtected = Boolean(getState().settings.supervisorPinHash);

  panel.innerHTML = `
    <div class="result-header-row">
      <div class="result-title-group">
        <div class="result-status-icon">
          ${iconSvg(result.icon, 'icon')}
        </div>
        <div>
          <div class="result-status-phrase">${esc(result.phrase)}</div>
          <div class="result-holder-name">
            <span>${esc(result.holderName)}</span>
            ${vipBadge}
            ${cadenceBadge}
            ${sourceBadge}
            ${softWarningBadge}
          </div>
        </div>
      </div>
    </div>

    ${result.actionLine ? `<div class="result-action-line">${esc(result.actionLine)}</div>` : ''}

    ${result.overriddenFrom ? `<div class="result-action-line" style="color: var(--status-valid); font-weight:700;">
        Manual override of a <code>${esc(result.overriddenFrom)}</code> result — recorded against ${esc(result.overrideOperator || 'staff')}.
      </div>` : ''}

    ${result.matchedVia && result.matchedVia !== 'exact' && result.matchedVia !== 'none'
      ? `<div class="result-action-line" style="font-size:12px; opacity:0.85;">
          Matched by ${esc(result.matchedVia)} lookup: scanned “${esc(result.ticketId)}”, matched ticket ${esc(result.resolvedTicketId || '')}.
        </div>` : ''}

    ${!result.valid && !result.overriddenFrom && ctx.onOverrideHandler ? `
      <div class="override-row no-print" data-override-row>
        <button type="button" class="btn btn-outline" data-override-open>
          ${iconSvg(pinProtected ? 'icon-lock' : 'icon-alert-triangle', 'icon')}
          <span>Admit anyway (supervisor${pinProtected ? ' PIN' : ''})</span>
        </button>
        <div class="override-menu" data-override-menu hidden>
          ${pinProtected ? `
            <div class="pin-inline-box">
              ${iconSvg('icon-lock', 'icon')}
              <label for="override-pin-input" style="font-size:12px; font-weight:700;">Supervisor PIN:</label>
              <input type="password" id="override-pin-input" class="pin-inline-input" inputmode="numeric" autocomplete="off" placeholder="Enter PIN" maxlength="12">
            </div>
          ` : ''}
          <span class="override-menu-label">Reason — this is logged against your name:</span>
          <div class="override-reasons">
            <button type="button" class="filter-chip" data-reason="Paid cash at the desk">Paid cash at desk</button>
            <button type="button" class="filter-chip" data-reason="Ticket transferred between delegates">Ticket transferred</button>
            <button type="button" class="filter-chip" data-reason="Name misspelt at purchase">Name misspelt</button>
            <button type="button" class="filter-chip" data-reason="Approved by organiser / VIP">Organiser approved</button>
            <button type="button" class="filter-chip" data-reason="Duplicate purchase, refund in progress">Duplicate purchase</button>
            <button type="button" class="filter-chip" data-reason="Scanned on the wrong device earlier">Wrong device</button>
          </div>
        </div>
      </div>` : ''}

    <div class="result-meta-grid">
      <div class="result-meta-item">
        <span class="result-meta-label">Package / Pass Tier</span>
        <span class="result-meta-value" title="${esc(result.ticketType)}">${esc(result.passTierLabel || result.ticketType)}</span>
      </div>
      <div class="result-meta-item">
        <span class="result-meta-label">Order</span>
        <span class="result-meta-value">${esc(result.orderId)}</span>
      </div>
      <div class="result-meta-item">
        <span class="result-meta-label">Ticket ID</span>
        <span class="result-meta-value mono">
          <span>${esc(result.ticketId)}</span>
          <button type="button" class="copy-mini-btn" data-copy="${esc(result.ticketId)}" title="Copy ticket ID" aria-label="Copy ticket ID">
            ${iconSvg('icon-copy', 'icon')}
          </button>
        </span>
      </div>
      <div class="result-meta-item">
        <span class="result-meta-label">Gate / Time</span>
        <span class="result-meta-value">${esc(result.gateName)} · ${esc(result.scanTime)}</span>
      </div>
    </div>
  `;

  if (liveAnnouncer) {
    liveAnnouncer.textContent = `${result.phrase}. ${result.holderName}. ${result.ticketType}. ${result.actionLine}`;
  }

  const overrideOpen = panel.querySelector('[data-override-open]');
  const overrideMenu = /** @type {HTMLElement|null} */ (panel.querySelector('[data-override-menu]'));
  if (overrideOpen && overrideMenu) {
    overrideOpen.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      overrideMenu.hidden = !overrideMenu.hidden;
      if (!overrideMenu.hidden) {
        const pinField = /** @type {HTMLInputElement|null} */ (panel.querySelector('#override-pin-input'));
        if (pinField) pinField.focus();
      }
    });

    panel.querySelectorAll('[data-reason]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const expectedHash = getState().settings.supervisorPinHash;
        if (expectedHash) {
          const pinField = /** @type {HTMLInputElement|null} */ (panel.querySelector('#override-pin-input'));
          const entered = pinField ? pinField.value : '';
          const validPin = await verifyPin(entered, expectedHash);
          if (!validPin) {
            showToast('Incorrect Supervisor PIN — override denied.', 'error');
            if (pinField) {
              pinField.value = '';
              pinField.focus();
            }
            return;
          }
        }
        const reason = btn.getAttribute('data-reason') || '';
        if (typeof ctx.onOverrideHandler === 'function') {
          ctx.onOverrideHandler(result, reason);
        }
      });
    });
  }

  const copyBtn = panel.querySelector('[data-copy]');
  if (copyBtn) {
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const val = copyBtn.getAttribute('data-copy');
      if (val) {
        await copyToClipboard(val);
        showToast('Ticket ID copied to clipboard', 'info');
      }
    });
  }

  if (!result.valid && window.innerWidth < 768) {
    triggerMobileDenialTakeover(result);
  }
}

/**
 * Fullscreen takeover dialog for denials on small screens
 * @param {ScanResult} result 
 */
function triggerMobileDenialTakeover(result) {
  if (denialTakeoverTimer) {
    clearTimeout(denialTakeoverTimer);
  }

  const existing = document.getElementById('mobile-denial-takeover');
  if (existing) existing.remove();

  const takeover = document.createElement('div');
  takeover.id = 'mobile-denial-takeover';
  takeover.className = 'fullscreen-result-takeover';
  takeover.innerHTML = `
    <div style="color: var(--status-duplicate); font-size: 56px;">
      ${iconSvg(result.icon, 'icon')}
    </div>
    <div style="font-family: var(--font-heading); font-size: 2.5rem; font-weight: 900; color: var(--status-duplicate); line-height: 1;">
      ${esc(result.phrase)}
    </div>
    <div style="font-size: 1.25rem; font-weight: 700; color: var(--neutral-darkest);">
      ${esc(result.holderName)}
    </div>
    <div style="font-size: 1rem; color: var(--neutral-dark);">
      ${esc(result.actionLine)}
    </div>
    <button type="button" class="btn btn-secondary btn-lg" style="margin-top: 16px;">
      Tap to Continue
    </button>
  `;

  document.body.appendChild(takeover);

  const closeTakeover = () => {
    if (takeover.parentNode) takeover.parentNode.removeChild(takeover);
    if (denialTakeoverTimer) clearTimeout(denialTakeoverTimer);
  };

  takeover.addEventListener('click', closeTakeover);
  denialTakeoverTimer = setTimeout(closeTakeover, 2500);
}

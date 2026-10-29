// @ts-check
import { $, $$, esc, iconSvg, copyToClipboard } from './dom.js';
import { getState } from '../core/state.js';
import { showToast } from './toast.js';

/**
 * @typedef {import('../core/state.js').LogEntry} LogEntry
 */

let activeFilter = 'all';
let searchQuery = '';

/**
 * Initialize activity controls (search and filter chips)
 */
export function initActivity() {
  const searchInput = /** @type {HTMLInputElement} */ ($('#activity-search-input'));
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      renderActivityList();
    });
  }

  $$('.activity-filter-strip .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('.activity-filter-strip .filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.getAttribute('data-filter') || 'all';
      renderActivityList();
    });
  });
}

/**
 * Filter and render activity log entries
 */
export function renderActivityList() {
  const listEl = $('#activity-list-container');
  const countEl = $('#activity-count-badge');
  if (!listEl) return;

  const log = getState().log || [];
  if (countEl) countEl.textContent = `${log.length} total`;

  if (log.length === 0) {
    listEl.innerHTML = `
      <div class="activity-empty">
        <div style="font-size: 36px; color: var(--neutral-muted);">
          ${iconSvg('icon-scan', 'icon')}
        </div>
        <div class="activity-empty-title">No scans yet</div>
        <div>Point a Zebra scanner at a ticket code to begin validating.</div>
      </div>
    `;
    return;
  }

  // Filter items
  const filtered = log.filter(entry => {
    // Filter chip logic
    if (activeFilter === 'admitted') {
      if (entry.status !== 'valid' && entry.status !== 'prechecked') return false;
    } else if (activeFilter === 'duplicate') {
      if (entry.status !== 'duplicate') return false;
    } else if (activeFilter === 'denial') {
      if (entry.status === 'valid' || entry.status === 'prechecked') return false;
    }

    // Text search logic
    if (searchQuery) {
      const match = (
        (entry.ticketId || '').toLowerCase().includes(searchQuery) ||
        (entry.holderName || '').toLowerCase().includes(searchQuery) ||
        (entry.orderId || '').toLowerCase().includes(searchQuery) ||
        (entry.gateName || '').toLowerCase().includes(searchQuery) ||
        (entry.status || '').toLowerCase().includes(searchQuery)
      );
      if (!match) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="activity-empty">
        <div class="activity-empty-title">No matching entries</div>
        <div>Try adjusting your search query or filter chips.</div>
      </div>
    `;
    return;
  }

  // Cap DOM at 200 rows (newest first)
  const MAX_DOM_ROWS = 200;
  const displayRows = filtered.slice(0, MAX_DOM_ROWS);
  const remainingCount = filtered.length - displayRows.length;

  let rowsHtml = '';
  displayRows.forEach(entry => {
    const timeFormatted = new Date(entry.scannedAt).toLocaleTimeString('en-ZA', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const statusChipClass = `chip-${entry.status.replace(/_/g, '')}`;

    rowsHtml += `
      <div class="activity-row" data-status="${esc(entry.status)}" data-id="${esc(entry.id)}">
        <div><span class="chip ${statusChipClass}">${esc(entry.status.toUpperCase())}</span></div>
        <div class="tabular-nums" style="font-size: 13px; color: var(--neutral-dark);">${esc(timeFormatted)}</div>
        <div class="col-ticket mono" style="font-size: 13px; font-weight: 600;">${esc(entry.ticketId)}</div>
        <div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(entry.holderName || 'Attendee')}</div>
        <div class="col-package" style="color: var(--neutral-dark); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(entry.ticketType || 'Pass')}</div>
        <div class="col-gate" style="color: var(--neutral-muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(entry.gateName)}</div>
        <div style="color: var(--neutral-muted); text-align: right;">${iconSvg('icon-chevron-right', 'icon')}</div>
      </div>
    `;
  });

  if (remainingCount > 0) {
    rowsHtml += `
      <div class="activity-capped-footer">
        +${remainingCount} older entries — export the log to see all entries
      </div>
    `;
  }

  listEl.innerHTML = rowsHtml;

  // Add click listener for row detail dialog
  listEl.querySelectorAll('.activity-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.getAttribute('data-id');
      const entry = log.find(e => e.id === id);
      if (entry) openDetailDialog(entry);
    });
  });
}

/**
 * Open detail dialog for a specific activity row
 * @param {LogEntry} entry 
 */
function openDetailDialog(entry) {
  const dialog = /** @type {HTMLDialogElement} */ ($('#detail-dialog'));
  const body = $('#detail-dialog-body');
  if (!dialog || !body) return;

  const timeFormatted = new Date(entry.scannedAt).toLocaleString('en-ZA');

  body.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span class="chip chip-${esc(entry.status)}">${esc(entry.status.toUpperCase())}</span>
      <span class="tabular-nums" style="font-size: 13px; color: var(--neutral-muted);">${esc(timeFormatted)}</span>
    </div>

    <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
      <div>
        <div class="result-meta-label">Ticket ID</div>
        <div class="mono" style="font-size: 16px; font-weight: 700;">${esc(entry.ticketId)}</div>
      </div>

      <div>
        <div class="result-meta-label">Holder Name</div>
        <div style="font-size: 16px; font-weight: 700;">${esc(entry.holderName || '—')}</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div>
          <div class="result-meta-label">Package / Type</div>
          <div>${esc(entry.ticketType || '—')}</div>
        </div>
        <div>
          <div class="result-meta-label">Order ID</div>
          <div>${esc(entry.orderId || '—')}</div>
        </div>
        <div>
          <div class="result-meta-label">Gate</div>
          <div>${esc(entry.gateName || '—')}</div>
        </div>
        <div>
          <div class="result-meta-label">Operator</div>
          <div>${esc(entry.operator || '—')}</div>
        </div>
      </div>

      <div>
        <div class="result-meta-label">Raw Scanned Payload</div>
        <pre class="mono" style="background: var(--surface-panel); padding: 8px; border-radius: var(--radius-sm); font-size: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-all;">${esc(entry.rawPayload || '—')}</pre>
      </div>
    </div>
  `;

  // Wire buttons in dialog footer
  const copyIdBtn = $('#detail-copy-id-btn');
  if (copyIdBtn) {
    copyIdBtn.onclick = async () => {
      await copyToClipboard(entry.ticketId);
      showToast('Ticket ID copied', 'info');
    };
  }

  const copyJsonBtn = $('#detail-copy-json-btn');
  if (copyJsonBtn) {
    copyJsonBtn.onclick = async () => {
      await copyToClipboard(JSON.stringify(entry, null, 2));
      showToast('Record JSON copied', 'info');
    };
  }

  const closeBtn = $('#detail-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => dialog.close();
  }

  dialog.showModal();
}

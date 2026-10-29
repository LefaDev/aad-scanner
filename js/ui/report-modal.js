// @ts-check
import { $, esc, iconSvg } from './dom.js';
import { getState } from '../core/state.js';
import { generateReportData, renderArrivalChartSvg } from '../core/report.js';
import { exportReportCsv } from '../core/export.js';
import { getAadEvent } from '../config/events.js';
import { getGate } from '../config/gates.js';

/**
 * Open the summary report modal and generate real-time metrics
 */
export function openReportModal() {
  const dialog = /** @type {HTMLDialogElement} */ ($('#report-dialog'));
  const body = $('#report-dialog-body');
  const headerMeta = $('#report-header-meta');
  if (!dialog || !body) return;

  const state = getState();
  const event = getAadEvent(state.activeEventId);
  const gate = getGate(state.activeGateId);
  const eventName = event ? event.name : 'AAD 2026';
  const gateName = gate ? gate.name : 'All Gates';

  const reportData = generateReportData(
    state.counters,
    state.log,
    state.manifest ? state.manifest.tickets : {},
    state.operatorName,
    state.deviceId
  );

  if (headerMeta) {
    headerMeta.textContent = `${eventName} · ${gateName} · Generated ${reportData.generatedAt}`;
  }

  // 1. Headline figures
  const headlineHtml = `
    <div class="report-headline-grid">
      <div class="report-headline-card">
        <div class="stat-label">Total Loaded</div>
        <div class="report-headline-num">${reportData.headline.loaded.toLocaleString()}</div>
        <div class="stat-caption">in active manifest</div>
      </div>
      <div class="report-headline-card" style="border-top: 3px solid var(--status-valid);">
        <div class="stat-label">Checked In</div>
        <div class="report-headline-num" style="color: var(--status-valid);">${reportData.headline.admitted.toLocaleString()}</div>
        <div class="stat-caption">admitted at gate</div>
      </div>
      <div class="report-headline-card">
        <div class="stat-label">No-Shows</div>
        <div class="report-headline-num">${reportData.headline.noShows.toLocaleString()}</div>
        <div class="stat-caption">expected − admitted</div>
      </div>
      <div class="report-headline-card" style="border-top: 3px solid var(--status-duplicate);">
        <div class="stat-label">Denial Rate</div>
        <div class="report-headline-num" style="color: var(--status-duplicate);">${esc(reportData.headline.denialRate)}</div>
        <div class="stat-caption">${reportData.headline.denials} total denials</div>
      </div>
    </div>
  `;

  // 2. Breakdown by package
  let packageRowsHtml = '';
  const packageEntries = Object.entries(reportData.packages);
  packageEntries.forEach(([pkg, stat], index) => {
    // @ts-ignore
    const pct = stat.total > 0 ? (stat.admitted / stat.total) * 100 : 0;
    const isTop = index === 0;
    const barColor = isTop ? 'var(--color-highlight)' : 'var(--color-primary)';

    packageRowsHtml += `
      <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 600;">
          <span>${esc(pkg)}</span>
          <span class="tabular-nums">${stat.admitted} / ${stat.total} (${pct.toFixed(1)}%)</span>
        </div>
        <div style="height: 10px; background: var(--surface-panel); border-radius: var(--radius-pill); overflow: hidden;">
          <div style="width: ${pct}%; height: 100%; background: ${barColor}; border-radius: var(--radius-pill);"></div>
        </div>
      </div>
    `;
  });

  // 3. Breakdown by gate table
  let gateRowsHtml = '';
  for (const [gateTitle, stat] of Object.entries(reportData.gates)) {
    gateRowsHtml += `
      <tr>
        <td style="font-weight: 600;">${esc(gateTitle)}</td>
        <td class="tabular-nums">${stat.total}</td>
        <td class="tabular-nums" style="color: var(--status-valid); font-weight: 700;">${stat.admitted}</td>
        <td class="tabular-nums" style="color: var(--status-duplicate);">${stat.denied}</td>
      </tr>
    `;
  }

  // 4. Arrivals Chart SVG
  const chartSvg = renderArrivalChartSvg(reportData.arrivalBuckets);

  // 5. Exceptions Table
  let exceptionRowsHtml = '';
  reportData.exceptions.slice(0, 50).forEach(e => {
    const timeFormatted = new Date(e.scannedAt).toLocaleTimeString('en-ZA');
    exceptionRowsHtml += `
      <tr>
        <td class="tabular-nums">${esc(timeFormatted)}</td>
        <td class="mono">${esc(e.ticketId)}</td>
        <td>${esc(e.holderName || '—')}</td>
        <td>${esc(e.gateName)}</td>
        <td><span class="chip chip-${esc(e.status)}">${esc(e.status.toUpperCase())}</span></td>
      </tr>
    `;
  });

  body.innerHTML = `
    <!-- Print Only Header -->
    <div class="print-header no-screen" style="display: none;">
      <div class="print-logo-badge">
        <img src="brand/aad-logo.png" alt="AAD 2026 Logo">
      </div>
      <div class="print-header-meta">
        <h1>AAD 2026 Gate Control Report</h1>
        <p>${esc(eventName)} · ${esc(gateName)} · Generated ${esc(reportData.generatedAt)}</p>
      </div>
    </div>

    <!-- 1. Headline Figures -->
    <section>
      <h3 style="margin-bottom: 12px;">Headline Attendance</h3>
      ${headlineHtml}
    </section>

    <!-- 2. Breakdown by Package -->
    <section class="card" style="margin-top: 16px;">
      <h3 style="margin-bottom: 12px;">Package Attendance & Uptake</h3>
      ${packageRowsHtml || '<div style="color: var(--neutral-muted); font-size: 13px;">No package statistics available.</div>'}
    </section>

    <!-- 3. Breakdown by Gate -->
    <section class="card" style="margin-top: 16px;">
      <h3 style="margin-bottom: 12px;">Gate Throughput</h3>
      <table class="report-table">
        <thead>
          <tr>
            <th>Gate Name</th>
            <th>Total Scans</th>
            <th>Admitted</th>
            <th>Denied</th>
          </tr>
        </thead>
        <tbody>
          ${gateRowsHtml || '<tr><td colspan="4" style="text-align: center; color: var(--neutral-muted);">No scans recorded yet.</td></tr>'}
        </tbody>
      </table>
    </section>

    <!-- 4. Arrivals by 15-Minute Window -->
    <section class="card" style="margin-top: 16px;">
      <h3 style="margin-bottom: 12px;">Arrivals by 15-Minute Window</h3>
      <div class="chart-container">
        ${chartSvg}
      </div>
    </section>

    <!-- 5. Exceptions Log -->
    <section class="card" style="margin-top: 16px;">
      <h3 style="margin-bottom: 12px;">Security & Validation Exceptions</h3>
      <table class="report-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Ticket ID</th>
            <th>Holder</th>
            <th>Gate</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${exceptionRowsHtml || '<tr><td colspan="5" style="text-align: center; color: var(--status-valid); font-weight: 600;">No exceptions recorded. All scans valid.</td></tr>'}
        </tbody>
      </table>
    </section>

    <!-- 6. Print Footer Note -->
    <div class="print-footer-note" style="display: none;">
      Generated by AAD Gate Validator · ${esc(reportData.deviceId)} · ${esc(reportData.operator)}
    </div>
  `;

  // Wire buttons
  const printBtn = $('#report-print-btn');
  if (printBtn) {
    printBtn.onclick = () => window.print();
  }

  const exportBtn = $('#report-export-csv-btn');
  if (exportBtn) {
    exportBtn.onclick = () => exportReportCsv(reportData, state.activeEventId);
  }

  const closeBtn = $('#report-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => dialog.close();
  }

  dialog.showModal();
}

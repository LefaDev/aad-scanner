// @ts-check
/**
 * @typedef {import('./state.js').Counters} Counters
 * @typedef {import('./state.js').LogEntry} LogEntry
 * @typedef {import('./state.js').Ticket} Ticket
 */

/**
 * Generate aggregate summary data for reporting
 * @param {Counters} counters 
 * @param {LogEntry[]} log 
 * @param {Record<string, Ticket>} [manifestTickets={}] 
 * @param {string} [operator='Staff'] 
 * @param {string} [deviceId='Device'] 
 */
export function generateReportData(counters, log, manifestTickets = {}, operator = 'Staff', deviceId = 'Device') {
  const loaded = counters.loaded || 0;
  const admitted = counters.checkedIn || 0;
  const noShows = Math.max(0, loaded - admitted);
  const denials = (counters.duplicates || 0) + (counters.invalid || 0) + (counters.cancelled || 0);
  const totalScans = log.length;
  const denialRate = totalScans > 0 ? ((denials / totalScans) * 100).toFixed(1) + '%' : '0.0%';

  // 1. Package breakdown
  /** @type {Record<string, { total: number, admitted: number }>} */
  const packageStats = {};
  for (const t of Object.values(manifestTickets)) {
    const pkg = t.ticket_type || t.ticket_label || 'Standard Pass';
    if (!packageStats[pkg]) packageStats[pkg] = { total: 0, admitted: 0 };
    packageStats[pkg].total++;
  }
  for (const entry of log) {
    if (entry.status === 'valid' || entry.status === 'prechecked') {
      const pkg = entry.ticketType || 'Standard Pass';
      if (!packageStats[pkg]) packageStats[pkg] = { total: 0, admitted: 0 };
      packageStats[pkg].admitted++;
    }
  }

  // 2. Gate breakdown
  /** @type {Record<string, { total: number, admitted: number, denied: number }>} */
  const gateStats = {};
  for (const entry of log) {
    const gate = entry.gateName || 'Unknown Gate';
    if (!gateStats[gate]) gateStats[gate] = { total: 0, admitted: 0, denied: 0 };
    gateStats[gate].total++;
    if (entry.status === 'valid' || entry.status === 'prechecked') {
      gateStats[gate].admitted++;
    } else {
      gateStats[gate].denied++;
    }
  }

  // 3. Arrivals by 15-minute intervals
  /** @type {Record<string, number>} */
  const arrivalBuckets = {};
  for (const entry of log) {
    if (entry.status === 'valid' || entry.status === 'prechecked') {
      const date = new Date(entry.scannedAt);
      const hours = date.getHours().toString().padStart(2, '0');
      const mins = Math.floor(date.getMinutes() / 15) * 15;
      const minsStr = mins.toString().padStart(2, '0');
      const key = `${hours}:${minsStr}`;
      arrivalBuckets[key] = (arrivalBuckets[key] || 0) + 1;
    }
  }

  // 4. Exceptions
  const exceptions = log.filter(e => e.status !== 'valid' && e.status !== 'prechecked');

  return {
    headline: {
      loaded,
      admitted,
      noShows,
      denialRate,
      denials,
      totalScans
    },
    packages: packageStats,
    gates: gateStats,
    arrivalBuckets,
    exceptions,
    operator,
    deviceId,
    generatedAt: new Date().toLocaleString('en-ZA')
  };
}

/**
 * Generate a hand-crafted SVG arrival bar chart
 * @param {Record<string, number>} buckets 
 * @returns {string} SVG markup
 */
export function renderArrivalChartSvg(buckets) {
  const keys = Object.keys(buckets).sort();
  if (keys.length === 0) {
    return `<div style="padding: 30px; text-align: center; color: var(--neutral-muted); font-size: 13px;">No admitted arrivals recorded yet.</div>`;
  }

  const values = keys.map(k => buckets[k]);
  const maxVal = Math.max(...values, 5);

  const width = Math.max(600, keys.length * 48);
  const height = 180;
  const paddingLeft = 45;
  const paddingBottom = 30;
  const paddingTop = 20;
  const paddingRight = 20;

  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;
  const barWidth = Math.max(16, Math.min(32, (chartW / keys.length) * 0.7));
  const step = chartW / keys.length;

  let barsSvg = '';
  keys.forEach((key, i) => {
    const val = buckets[key];
    const isPeak = val === maxVal && val > 0;
    const barH = (val / maxVal) * chartH;
    const x = paddingLeft + i * step + (step - barWidth) / 2;
    const y = paddingTop + (chartH - barH);
    const color = isPeak ? '#fac80f' : '#154a58';

    barsSvg += `
      <g class="chart-bar-group">
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="2" />
        <text x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="${isPeak ? '700' : '500'}" fill="#2b2c26">${val}</text>
        <text x="${(x + barWidth / 2).toFixed(1)}" y="${(height - 10).toFixed(1)}" text-anchor="middle" font-size="9" fill="#81817f" font-family="monospace">${key}</text>
      </g>
    `;
  });

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="overflow: visible;" xmlns="http://www.w3.org/2000/svg">
      <!-- Grid line -->
      <line x1="${paddingLeft}" y1="${paddingTop + chartH}" x2="${width - paddingRight}" y2="${paddingTop + chartH}" stroke="#acacaa" stroke-width="1" />
      ${barsSvg}
    </svg>
  `;
}

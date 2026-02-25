// charts.js — Chart.js equity curve, daily P&L, hourly, day-of-week, and distribution charts
// Depends on: stats.js (fmtDate, dateKey), Chart.js global

let equityChart  = null;
let dailyChart   = null;
let sessionChart = null;
let dowChart     = null;
let distChart    = null;

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: {
    legend: { display: false },
    tooltip: { mode: 'index', intersect: false },
  },
};

const SCALE_DEFAULTS = {
  x: {
    ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 8 },
    grid:  { color: '#2a3347' },
  },
  y: {
    ticks: {
      color: '#64748b', font: { size: 10 },
      callback: v => `$${v.toLocaleString()}`,
    },
    grid: { color: '#2a3347' },
  },
};

function barColor(v) {
  return v >= 0 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)';
}
function barBorder(v) {
  return v >= 0 ? '#10b981' : '#ef4444';
}

function renderCharts(trades, stats) {
  // ── Equity curve ─────────────────────────────
  let cum = 0;
  const equityPoints = trades.map(t => {
    cum += t.netPnl;
    return { x: fmtDate(t.date), y: Math.round(cum * 100) / 100 };
  });

  // ── Daily P&L ────────────────────────────────
  const dailyMap = {};
  for (const t of trades) {
    const key = dateKey(t.date);
    dailyMap[key] = (dailyMap[key] || 0) + t.netPnl;
  }
  const dailyLabels = Object.keys(dailyMap).sort();
  const dailyValues = dailyLabels.map(k => Math.round(dailyMap[k] * 100) / 100);

  if (equityChart)  equityChart.destroy();
  if (dailyChart)   dailyChart.destroy();
  if (sessionChart) sessionChart.destroy();
  if (dowChart)     dowChart.destroy();
  if (distChart)    distChart.destroy();

  const eCtx = document.getElementById('equity-chart').getContext('2d');
  equityChart = new Chart(eCtx, {
    type: 'line',
    data: {
      labels: equityPoints.map(p => p.x),
      datasets: [{
        data: equityPoints.map(p => p.y),
        borderColor: cum >= 0 ? '#10b981' : '#ef4444',
        backgroundColor: cum >= 0 ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
        borderWidth: 2,
        pointRadius: equityPoints.length > 50 ? 0 : 3,
        pointBackgroundColor: '#10b981',
        fill: true,
        tension: 0.3,
      }],
    },
    options: { ...CHART_DEFAULTS, scales: SCALE_DEFAULTS },
  });

  const dCtx = document.getElementById('daily-chart').getContext('2d');
  dailyChart = new Chart(dCtx, {
    type: 'bar',
    data: {
      labels: dailyLabels.map(d => {
        const [, m, day] = d.split('-');
        return `${m}/${day}`;
      }),
      datasets: [{
        data: dailyValues,
        backgroundColor: dailyValues.map(barColor),
        borderColor:     dailyValues.map(barBorder),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: '#2a3347' } },
        y: SCALE_DEFAULTS.y,
      },
    },
  });


  // ── Day-of-week P&L (avg per session) ───────
  // Group trades by calendar date first, sum P&L per date,
  // then average those daily totals by day-of-week.
  // This prevents days with more sessions from looking artificially better/worse.
  const DOW_ORDER = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dowSessionMap = {}; // dow -> { total, sessions: Set of dateKeys }
  for (const t of trades) {
    const d   = DAYS[t.date.getUTCDay()];
    const dk  = t.date.toISOString().slice(0, 10);
    if (!dowSessionMap[d]) dowSessionMap[d] = { total: 0, sessions: new Set() };
    dowSessionMap[d].total += t.netPnl;
    dowSessionMap[d].sessions.add(dk);
  }
  const dowLabels   = DOW_ORDER.filter(d => dowSessionMap[d]);
  const dowCounts   = dowLabels.map(d => dowSessionMap[d].sessions.size);
  const dowTotals   = dowLabels.map(d => dowSessionMap[d].total);
  const dowAvgValues= dowLabels.map((d, i) => Math.round((dowTotals[i] / dowCounts[i]) * 100) / 100);

  const wCtx = document.getElementById('dow-chart').getContext('2d');
  dowChart = new Chart(wCtx, {
    type: 'bar',
    data: {
      labels: dowLabels,
      datasets: [{
        data: dowAvgValues,
        backgroundColor: dowAvgValues.map(barColor),
        borderColor:     dowAvgValues.map(barBorder),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: {
            label: (ctx) => {
              const i = ctx.dataIndex;
              const avg = dowAvgValues[i];
              const n   = dowCounts[i];
              const tot = Math.round(dowTotals[i] * 100) / 100;
              const sign = avg >= 0 ? '+' : '';
              return [`Avg: ${sign}$${avg.toLocaleString()}`, `Total: ${sign}$${tot.toLocaleString()} (${n} session${n!==1?'s':''})`];
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: '#2a3347' } },
        y: SCALE_DEFAULTS.y,
      },
    },
  });

  // ── P&L Distribution Histogram ───────────────
  if (stats && document.getElementById('dist-chart')) {
    const edges   = stats.histEdges;
    const counts  = stats.histCounts;
    const thr     = stats.sizeThreshold;

    // Build labels: skip ±Infinity edges, show ranges
    const distLabels = counts.map((_, i) => {
      const lo = edges[i], hi = edges[i + 1];
      if (lo === -Infinity) return `<${hi < 0 ? '-' : ''}$${Math.abs(hi)}`;
      if (hi ===  Infinity) return `>$${lo < 0 ? '-' : ''}${Math.abs(lo)}`;
      if (lo < 0 && hi <= 0) return `-$${Math.abs(lo)}`;
      if (lo >= 0)           return `+$${lo}`;
      return `$${lo}`;
    });

    // Midpoint of each bucket to decide color: use threshold to split
    const distMids   = counts.map((_, i) => (
      edges[i] === -Infinity ? edges[i+1] - 1 : edges[i+1] === Infinity ? edges[i] + 1 : (edges[i] + edges[i+1]) / 2
    ));
    const distColors = distMids.map(mid => {
      if (Math.abs(mid) >= thr) return mid >= 0 ? 'rgba(16,185,129,0.85)' : 'rgba(239,68,68,0.85)';
      return mid >= 0 ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)';
    });
    const distBorders = distMids.map(mid => Math.abs(mid) >= thr
      ? (mid >= 0 ? '#10b981' : '#ef4444')
      : (mid >= 0 ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)')
    );

    const dCtx = document.getElementById('dist-chart').getContext('2d');
    distChart = new Chart(dCtx, {
      type: 'bar',
      data: {
        labels: distLabels,
        datasets: [{
          data: counts,
          backgroundColor: distColors,
          borderColor:     distBorders,
          borderWidth: 1,
          borderRadius: 3,
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const i = ctx.dataIndex;
                const lo = edges[i], hi = edges[i+1];
                const range = lo === -Infinity ? `< $${hi}` : hi === Infinity ? `≥ $${lo}` : `$${lo} to $${hi}`;
                return `${ctx.raw} trade${ctx.raw !== 1 ? 's' : ''} (${range})`;
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: '#64748b', font: { size: 9 }, maxRotation: 45 }, grid: { color: '#2a3347' } },
          y: { ticks: { color: '#64748b', font: { size: 10 }, stepSize: 1 }, grid: { color: '#2a3347' } },
        },
      },
    });
  }
}

// ui.js — rendering, filter/sort state, file loading, event wiring
// Depends on: trading.js, stats.js, charts.js

let allTrades     = [];
let currentFilter = 'win';
let sortCol       = 'net';
let sortAsc       = false;

const SETTINGS_KEY = 'tj_settings';
let settings = { balance: 100000, pointValue: null, sizeThreshold: 500 };

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (typeof s.balance       === 'number') settings.balance       = s.balance;
    if (typeof s.pointValue    === 'number') settings.pointValue    = s.pointValue;
    if (typeof s.sizeThreshold === 'number') settings.sizeThreshold = s.sizeThreshold;
  } catch (_) {}
  _pointValueOverride = settings.pointValue;
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  _pointValueOverride = settings.pointValue;
}

// ─── Card helpers ─────────────────────────────

const fmt$ = v => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const sign  = v => v >= 0 ? 'green' : 'red';
const fmtR  = v => isFinite(v) ? v.toFixed(2) : '∞';

function card(label, valueHtml, sub, accentColor) {
  const style = accentColor ? ` style="border-top:2px solid var(--${accentColor})"` : '';
  return `<div class="stat-card"${style}>
    <div class="stat-label">${label}</div>
    ${valueHtml}
    <div class="stat-sub">${sub}</div>
  </div>`;
}

function val(v, cls, size) {
  return `<div class="stat-value ${cls || ''}"${size ? ` style="font-size:${size}"` : ''}>${v}</div>`;
}

// ─── ROW 1: Returns ───────────────────────────

function renderBarReturns(stats) {
  const growthSub = `avg ${fmt$(stats.avgDailyPnl)}/day · ${stats.tradingDays} trading days`;
  const pfStr = isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞';
  const pfCls  = stats.profitFactor >= 1.5 ? 'green' : stats.profitFactor >= 1 ? 'yellow' : 'red';
  const wrCls  = stats.winRate >= 55 ? 'green' : stats.winRate >= 45 ? 'yellow' : 'red';
  const skewCls = stats.winLossSkew >= 1.5 ? 'green' : stats.winLossSkew >= 1.0 ? 'yellow' : 'red';

  document.getElementById('bar-returns').innerHTML = [
    card('Net P&L',
      val(fmtPnl(stats.totalNet), sign(stats.totalNet)),
      growthSub),
    card('Profit Factor',
      val(pfStr, pfCls),
      `${fmtPnl(stats.totalGross)} gross · ${stats.tradeCount} trades`),
    card('Win Rate',
      val(`${stats.winRate.toFixed(1)}%`, wrCls),
      `${stats.winCount}W / ${stats.lossCount}L · avg win ${fmt$(stats.avgWin)} / avg loss ${fmt$(stats.avgLoss)}`),
    card('Avg Win / Avg Loss',
      val(`${isFinite(stats.winLossSkew) ? stats.winLossSkew.toFixed(2) : '∞'}×`, skewCls),
      `Avg P&L ${fmt$(stats.expectancy)} per trade · edge ratio ${stats.rMultiple.toFixed(2)}×`),
    card('Commission',
      val(`$${Math.abs(stats.totalComm).toFixed(0)}`, '', '17px'),
      `${stats.commPctOfGrossWins.toFixed(1)}% of gross wins · worst loss ${fmt$(stats.maxLoss)}`,
      'muted'),
  ].join('');
}

// ─── ROW 2: Intraday Behavior ─────────────────

function renderBarIntraday(stats) {
  const recCls   = stats.recoveryRate >= 60 ? 'green' : stats.recoveryRate >= 40 ? 'yellow' : 'red';
  const g2pCls   = stats.gainToPain >= 2 ? 'green' : stats.gainToPain >= 1 ? 'yellow' : 'red';
  const dayWrCls = (stats.profitableDays / stats.tradingDays) * 100 >= 60 ? 'green'
                 : (stats.profitableDays / stats.tradingDays) * 100 >= 50 ? 'yellow' : 'red';
  const sortinoCls = stats.sortino >= 1 ? 'green' : stats.sortino >= 0.5 ? 'yellow' : 'red';

  document.getElementById('bar-intraday').innerHTML = [
    card('Day Win Rate',
      val(`${((stats.profitableDays / stats.tradingDays) * 100).toFixed(0)}%`, dayWrCls),
      `${stats.profitableDays} green / ${stats.tradingDays} days · avg ${fmt$(stats.avgDailyPnl)}/day`),
    card('Gain-to-Pain',
      val(fmtR(stats.gainToPain), g2pCls),
      `Net P&amp;L ÷ sum of losing days · &gt;1 = edge`),
    card('Sortino Ratio',
      val(isFinite(stats.sortino) ? stats.sortino.toFixed(2) : '∞', sortinoCls),
      `Avg daily P&L ÷ downside deviation · losing days only`),
    card('Avg Intraday DD',
      val(fmt$(-stats.avgIntradayDD), 'red', '17px'),
      `Max single session: ${fmt$(-stats.maxIntradayDD)}`),
    card('Recovery Rate',
      val(`${stats.recoveryRate.toFixed(0)}%`, recCls),
      `${stats.recoveredDays}/${stats.wentNegDays} neg. sessions recovered · 1st trade WR ${stats.firstTradeWR.toFixed(0)}%`),
  ].join('');
}

// ─── ROW 3: Capital Management — removed, merged into Intraday Behavior ──────

// ─── ROW 4: Directional ──────────────────────

function renderBarDirection(stats) {
  const longWrCls  = stats.longWinRate  >= 50 ? 'green' : 'red';
  const shortWrCls = stats.shortWinRate >= 50 ? 'green' : 'red';
  const biasCls    = stats.longNet >= stats.shortNet ? 'accent' : '';
  const biasLabel  = stats.longNet >= stats.shortNet ? 'Long' : 'Short';

  document.getElementById('bar-direction').innerHTML = [
    card('Long Net P&L',
      val(fmtPnl(stats.longNet), sign(stats.longNet)),
      `${stats.longCount} trades · WR ${stats.longWinRate.toFixed(0)}%`),
    card('Long Win Rate',
      val(`${stats.longWinRate.toFixed(1)}%`, longWrCls),
      `${Math.round(stats.longCount * stats.longWinRate / 100)} wins of ${stats.longCount}`),
    card('Short Net P&L',
      val(fmtPnl(stats.shortNet), sign(stats.shortNet)),
      `${stats.shortCount} trades · WR ${stats.shortWinRate.toFixed(0)}%`),
    card('Short Win Rate',
      val(`${stats.shortWinRate.toFixed(1)}%`, shortWrCls),
      `${Math.round(stats.shortCount * stats.shortWinRate / 100)} wins of ${stats.shortCount}`),
    card('Net Bias',
      val(biasLabel, biasCls, '17px'),
      `Long ${fmt$(stats.longNet)} vs Short ${fmt$(stats.shortNet)}`),
  ].join('');
}

// ─── Daily Cards ──────────────────────────────

function renderDailyCards(trades) {
  const dailyMap = {};
  for (const t of trades) {
    const key = dateKey(t.date);
    if (!dailyMap[key]) dailyMap[key] = { pnl: 0, wins: 0, losses: 0, count: 0, comm: 0 };
    dailyMap[key].pnl  += t.netPnl;
    dailyMap[key].comm += t.commission;
    dailyMap[key].count++;
    if (t.netPnl >= 0) dailyMap[key].wins++;
    else               dailyMap[key].losses++;
  }

  document.getElementById('daily-cards').innerHTML = Object.keys(dailyMap).sort().map(date => {
    const d   = dailyMap[date];
    const wr  = d.count ? ((d.wins / d.count) * 100).toFixed(0) : 0;
    const cls = d.pnl >= 0 ? 'positive' : 'negative';
    const pnlHtml = `<span class="${d.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${fmtPnl(d.pnl)}</span>`;
    const [y, m, day] = date.split('-');
    const label = new Date(Date.UTC(+y, +m - 1, +day)).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
    return `
      <div class="day-card ${cls}">
        <div class="day-date">${label}</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:6px">${pnlHtml}</div>
        <div class="day-stats">
          <div class="day-stat"><span class="ds-label">Trades: </span>${d.count}</div>
          <div class="day-stat"><span class="ds-label">WR: </span>${wr}%</div>
          <div class="day-stat"><span class="ds-label">Comm: </span>$${d.comm.toFixed(0)}</div>
        </div>
      </div>`;
  }).join('');
}

// ─── Trade Table ──────────────────────────────

function getFilteredSortedTrades() {
  let trades = [...allTrades];

  if      (currentFilter === 'win')   trades = trades.filter(t => t.result    === 'Win');
  else if (currentFilter === 'loss')  trades = trades.filter(t => t.result    === 'Loss');
  else if (currentFilter === 'long')  trades = trades.filter(t => t.direction === 'Buy');
  else if (currentFilter === 'short') trades = trades.filter(t => t.direction === 'Sell');

  const keyMap = {
    date:       t => t.date,
    direction:  t => t.direction,
    qty:        t => t.qty,
    entry:      t => t.entryPrice,
    exit:       t => t.exitPrice,
    points:     t => t.points,
    gross:      t => t.grossPnl,
    commission: t => t.commission,
    net:        t => t.netPnl,
    duration:   t => t.durationMs,
    result:     t => t.result,
  };
  const key = keyMap[sortCol] || (t => t.date);
  trades.sort((a, b) => {
    const va = key(a), vb = key(b);
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ?  1 : -1;
    return 0;
  });
  return trades;
}

function renderTable() {
  const trades = getFilteredSortedTrades();
  document.getElementById('trade-count').textContent = `${trades.length} trades`;

  const tbody = document.getElementById('trade-tbody');
  if (!trades.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--muted)">No trades match this filter</td></tr>';
    return;
  }

  const thr = settings.sizeThreshold;
  tbody.innerHTML = trades.map(t => {
    const isSmall     = Math.abs(t.netPnl) < thr;
    const rowStyle    = isSmall ? ' style="opacity:0.45"' : '';
    const dirBadge    = t.direction === 'Buy'
      ? '<span class="badge badge-long">LONG</span>'
      : '<span class="badge badge-short">SHORT</span>';
    const resultBadge = t.result === 'Win'
      ? '<span class="badge badge-win">WIN</span>'
      : '<span class="badge badge-loss">LOSS</span>';
    return `<tr${rowStyle}>
      <td>${fmtDate(t.date)}</td>
      <td>${dirBadge}</td>
      <td>${t.qty}</td>
      <td>${fmtPrice(t.entryPrice)}</td>
      <td>${fmtPrice(t.exitPrice)}</td>
      <td class="${t.points >= 0 ? 'pnl-pos' : 'pnl-neg'}">${t.points >= 0 ? '+' : ''}${t.points.toFixed(2)}</td>
      <td class="${t.grossPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${fmtPnl(t.grossPnl)}</td>
      <td style="color:var(--muted)">$${t.commission.toFixed(2)}</td>
      <td class="${t.netPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${fmtPnl(t.netPnl)}</td>
      <td style="color:var(--muted)">${fmtDuration(t.durationMs)}</td>
      <td>${resultBadge}</td>
    </tr>`;
  }).join('');

  document.querySelectorAll('th[data-col]').forEach(th => {
    const icon = th.querySelector('.sort-icon');
    th.classList.remove('sorted');
    if (th.dataset.col === sortCol) {
      th.classList.add('sorted');
      icon.textContent = sortAsc ? '↑' : '↓';
    } else {
      icon.textContent = '↕';
    }
  });
}

// ─── Orchestration ────────────────────────────

function renderAll(trades) {
  const stats = computeStats(trades, settings.sizeThreshold);
  if (!stats) return;

  renderBarReturns(stats);
  renderBarIntraday(stats);
  renderBarDirection(stats);
  renderCharts(trades, stats);
  renderDailyCards(trades);
  renderTable();

  if (trades.length) {
    const first = trades[0].date;
    const last  = trades[trades.length - 1].date;
    const fmt   = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    document.getElementById('date-range-display').textContent = `${fmt(first)} – ${fmt(last)}`;

    const sym  = trades[0].symbol;
    const inst = sym ? detectInstrument(sym) : null;
    const pvLabel = settings.pointValue !== null
      ? `$${settings.pointValue}/point (manual)`
      : inst ? `${inst.name} · $${inst.pointValue}/point` : `$${POINT_VALUE_DEFAULT}/point`;
    document.getElementById('footer-instrument').textContent = pvLabel;

    const notice = document.getElementById('instrument-detected');
    if (inst && settings.pointValue === null) {
      notice.textContent = `Auto-detected: ${inst.name} — $${inst.pointValue}/point`;
      notice.classList.add('visible');
      document.querySelectorAll('#instrument-tbody tr').forEach(tr => {
        tr.classList.toggle('selected', tr.dataset.pv === String(inst.pointValue) && tr.dataset.name === inst.name);
      });
    } else {
      notice.classList.remove('visible');
    }
  }
}

// ─── File Loading ─────────────────────────────

function loadCSV(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      allTrades = buildTrades(parseCSV(e.target.result));
      document.getElementById('upload-zone').style.display = 'none';
      document.getElementById('app').style.display         = 'block';
      document.getElementById('footer').style.display      = 'block';
      renderAll(allTrades);
    } catch (err) {
      alert('Error parsing CSV: ' + err.message);
      console.error(err);
    }
  };
  reader.readAsText(file);
}

// ─── Event Wiring ─────────────────────────────

document.getElementById('load-sample-btn').addEventListener('click', () => {
  fetch('paper-trading-balance-history.csv')
    .then(r => r.text())
    .then(text => {
      allTrades = buildTrades(parseCSV(text));
      document.getElementById('upload-zone').style.display = 'none';
      document.getElementById('app').style.display         = 'block';
      document.getElementById('footer').style.display      = 'block';
      renderAll(allTrades);
    })
    .catch(err => alert('Could not load sample: ' + err.message));
});

['file-input-main', 'file-input-header'].forEach(id => {
  document.getElementById(id).addEventListener('change', e => {
    if (e.target.files[0]) loadCSV(e.target.files[0]);
  });
});

const zone = document.getElementById('upload-zone');
zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
zone.addEventListener('drop', e => {
  e.preventDefault();
  zone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadCSV(file);
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderTable();
  });
});

document.querySelectorAll('th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    if (sortCol === th.dataset.col) sortAsc = !sortAsc;
    else { sortCol = th.dataset.col; sortAsc = true; }
    renderTable();
  });
});

// ─── Settings Panel ───────────────────────────

function openSettings() {
  document.getElementById('settings-panel').classList.add('open');
  document.getElementById('settings-overlay').classList.add('open');
  document.getElementById('setting-balance').value        = settings.balance || '';
  document.getElementById('setting-point-value').value    = settings.pointValue !== null ? settings.pointValue : '';
  document.getElementById('setting-size-threshold').value = settings.sizeThreshold ?? 500;
}
function closeSettings() {
  document.getElementById('settings-panel').classList.remove('open');
  document.getElementById('settings-overlay').classList.remove('open');
}

document.getElementById('settings-toggle').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
document.getElementById('settings-overlay').addEventListener('click', closeSettings);

document.getElementById('settings-apply').addEventListener('click', () => {
  const bal = parseFloat(document.getElementById('setting-balance').value);
  const pv  = parseFloat(document.getElementById('setting-point-value').value);
  const thr = parseFloat(document.getElementById('setting-size-threshold').value);
  settings.balance       = isFinite(bal) && bal >= 0 ? bal : 0;
  settings.pointValue    = isFinite(pv)  && pv  > 0  ? pv  : null;
  settings.sizeThreshold = isFinite(thr) && thr >= 0 ? thr : 500;
  saveSettings();
  closeSettings();
  if (allTrades.length) renderAll(allTrades);
});

// ─── Instrument Table ─────────────────────────

(function buildInstrumentTable() {
  const tbody = document.getElementById('instrument-tbody');
  tbody.innerHTML = FUTURES_INSTRUMENTS.map(inst => `
    <tr data-pv="${inst.pointValue}" data-name="${inst.name}">
      <td>${inst.name}</td>
      <td>${inst.tickSize}</td>
      <td>$${inst.tickValue}</td>
      <td>$${inst.pointValue}</td>
    </tr>
  `).join('');
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      document.getElementById('setting-point-value').value = tr.dataset.pv;
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
      tr.classList.add('selected');
    });
  });
})();

loadSettings();
document.getElementById('setting-balance').value        = settings.balance || '';
document.getElementById('setting-point-value').value    = settings.pointValue !== null ? settings.pointValue : '';
document.getElementById('setting-size-threshold').value = settings.sizeThreshold ?? 500;

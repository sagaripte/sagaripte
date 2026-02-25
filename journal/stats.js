// stats.js — P&L statistics and formatting helpers

function computeStats(trades, sizeThreshold) {
  if (!trades.length) return null;
  if (sizeThreshold === undefined) sizeThreshold = 500;

  const wins   = trades.filter(t => t.netPnl >= 0);
  const losses = trades.filter(t => t.netPnl < 0);

  const totalNet   = trades.reduce((s, t) => s + t.netPnl, 0);
  const totalGross = trades.reduce((s, t) => s + t.grossPnl, 0);
  const totalComm  = trades.reduce((s, t) => s + t.commission, 0);

  const avgWin  = wins.length   ? wins.reduce((s, t)   => s + t.netPnl, 0) / wins.length   : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.netPnl, 0) / losses.length : 0;
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;

  const grossWins   = wins.reduce((s, t)   => s + t.grossPnl, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.grossPnl, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : (grossWins > 0 ? Infinity : 0);

  const maxLoss = losses.length ? Math.min(...losses.map(t => t.netPnl)) : 0;

  // Expectancy and R-multiple
  const expectancy = totalNet / trades.length;
  const rMultiple  = avgLoss !== 0 ? expectancy / Math.abs(avgLoss) : 0;

  // Win/loss skew: avg win / avg loss magnitude
  const winLossSkew = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : Infinity;

  // Commission as % of gross wins
  const commPctOfGrossWins = grossWins > 0 ? (Math.abs(totalComm) / grossWins) * 100 : 0;

  // Long vs short breakdown
  const longs  = trades.filter(t => t.direction === 'Buy');
  const shorts = trades.filter(t => t.direction === 'Sell');
  const longWinRate  = longs.length  ? longs.filter(t  => t.netPnl >= 0).length / longs.length  * 100 : 0;
  const shortWinRate = shorts.length ? shorts.filter(t => t.netPnl >= 0).length / shorts.length * 100 : 0;
  const longNet  = longs.reduce((s, t)  => s + t.netPnl, 0);
  const shortNet = shorts.reduce((s, t) => s + t.netPnl, 0);

  // Day-of-week P&L (for chart)
  const byDow = {};
  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for (const t of trades) {
    const d = DOW[t.date.getUTCDay()];
    if (!byDow[d]) byDow[d] = { pnl: 0, count: 0 };
    byDow[d].pnl += t.netPnl; byDow[d].count++;
  }

  // P&L distribution histogram
  const HIST_EDGES = [-Infinity, -2000, -1500, -1000, -750, -500, -250, 0, 250, 500, 750, 1000, 1500, 2000, Infinity];
  const histCounts = Array(HIST_EDGES.length - 1).fill(0);
  for (const t of trades) {
    for (let i = 0; i < HIST_EDGES.length - 1; i++) {
      if (t.netPnl >= HIST_EDGES[i] && t.netPnl < HIST_EDGES[i + 1]) { histCounts[i]++; break; }
    }
  }

  // ── Daily P&L ────────────────────────────────────────────────────────────
  // Group trades by date, preserving chronological order within each day
  const dailyTradeMap = {}; // dateKey -> trades[]
  for (const t of trades) {
    const k = dateKey(t.date);
    if (!dailyTradeMap[k]) dailyTradeMap[k] = [];
    dailyTradeMap[k].push(t);
  }
  const dailyKeys    = Object.keys(dailyTradeMap).sort();
  const dailyPnls    = dailyKeys.map(k => dailyTradeMap[k].reduce((s, t) => s + t.netPnl, 0));
  const tradingDays  = dailyKeys.length;
  const profitableDays = dailyPnls.filter(v => v > 0).length;
  const bestDay      = dailyPnls.length ? Math.max(...dailyPnls) : 0;
  const worstDay     = dailyPnls.length ? Math.min(...dailyPnls) : 0;
  const avgDailyPnl  = tradingDays > 0 ? totalNet / tradingDays : 0;

  // Gain-to-pain: net P&L / |sum of losing days|
  const totalDailyLoss = Math.abs(dailyPnls.filter(v => v < 0).reduce((s, v) => s + v, 0));
  const gainToPain = totalDailyLoss > 0
    ? totalNet / totalDailyLoss : (totalNet > 0 ? Infinity : 0);

  // Worst day / best day asymmetry ratio
  const dayAsymmetry = bestDay > 0 ? Math.abs(worstDay) / bestDay : 0;

  // ── Intraday behavior metrics ─────────────────────────────────────────────
  // For each session: compute running P&L, find intraday max drawdown,
  // first trade result, and whether the day recovered from a drawdown.
  const sessionDDs = [];       // per-day intraday max drawdown
  let firstTradeWins = 0;      // sessions where first trade was a win
  let recoveredDays  = 0;      // days that went negative then ended green
  let wentNegDays    = 0;      // days that hit negative at some point

  for (const dk of dailyKeys) {
    const dayTrades = dailyTradeMap[dk]; // already in date order (trades sorted globally)

    // First trade win rate
    if (dayTrades[0] && dayTrades[0].netPnl >= 0) firstTradeWins++;

    // Intraday drawdown + recovery
    let runPnl = 0, sessionPeak = 0, sessionDD = 0, wentNeg = false;
    for (const t of dayTrades) {
      runPnl += t.netPnl;
      if (runPnl > sessionPeak) sessionPeak = runPnl;
      const dd = sessionPeak - runPnl;
      if (dd > sessionDD) sessionDD = dd;
      if (runPnl < 0) wentNeg = true;
    }
    sessionDDs.push(sessionDD);
    if (wentNeg) {
      wentNegDays++;
      if (runPnl > 0) recoveredDays++;
    }
  }

  const avgIntradayDD  = sessionDDs.length ? sessionDDs.reduce((s, v) => s + v, 0) / sessionDDs.length : 0;
  const maxIntradayDD  = sessionDDs.length ? Math.max(...sessionDDs) : 0;
  const firstTradeWR   = tradingDays > 0 ? (firstTradeWins / tradingDays) * 100 : 0;
  const recoveryRate   = wentNegDays > 0 ? (recoveredDays / wentNegDays) * 100 : 100;

  // Sharpe on daily P&L series (mean / std dev, not annualised — relative indicator only)
  let sharpe = 0;
  if (tradingDays > 1) {
    const mean = avgDailyPnl;
    const variance = dailyPnls.reduce((s, v) => s + (v - mean) ** 2, 0) / tradingDays;
    const stdDev = Math.sqrt(variance);
    sharpe = stdDev > 0 ? mean / stdDev : (mean > 0 ? Infinity : 0);
  }

  return {
    // Core
    totalNet, totalGross, totalComm,
    winRate, avgWin, avgLoss, maxLoss,
    winCount: wins.length, lossCount: losses.length, tradeCount: trades.length,
    profitFactor, commPctOfGrossWins,
    // Edge
    expectancy, rMultiple, winLossSkew,
    // Direction
    longCount: longs.length, shortCount: shorts.length,
    longWinRate, shortWinRate, longNet, shortNet,
    // Time
    byDow,
    // Histogram
    histCounts, histEdges: HIST_EDGES,
    // Daily
    tradingDays, profitableDays, bestDay, worstDay, avgDailyPnl,
    dailyKeys, dailyPnls,
    gainToPain, dayAsymmetry,
    // Intraday behavior
    avgIntradayDD, maxIntradayDD,
    firstTradeWR,
    recoveryRate, recoveredDays, wentNegDays,
    sharpe,
  };
}

// ─── Formatters ──────────────────────────────

function fmtPnl(v) {
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPrice(v) {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDuration(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC',
  });
}

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

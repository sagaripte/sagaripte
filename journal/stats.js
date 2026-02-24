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

  const maxWin  = wins.length   ? Math.max(...wins.map(t   => t.netPnl)) : 0;
  const maxLoss = losses.length ? Math.min(...losses.map(t => t.netPnl)) : 0;

  // Max drawdown on cumulative net P&L
  let peak = 0, cumulative = 0, maxDD = 0;
  for (const t of trades) {
    cumulative += t.netPnl;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDD) maxDD = dd;
  }

  // Sortino ratio — penalises only downside deviation, not upside outliers
  const pnls = trades.map(t => t.netPnl);
  const mean  = totalNet / trades.length;
  const downsideVariance = pnls.reduce((s, v) => s + (Math.min(v, 0) ** 2), 0) / pnls.length;
  const sortino = downsideVariance > 0 ? mean / Math.sqrt(downsideVariance) : (mean > 0 ? Infinity : 0);

  // Long vs short breakdown
  const longs  = trades.filter(t => t.direction === 'Buy');
  const shorts = trades.filter(t => t.direction === 'Sell');
  const longWinRate  = longs.length  ? longs.filter(t  => t.netPnl >= 0).length / longs.length  * 100 : 0;
  const shortWinRate = shorts.length ? shorts.filter(t => t.netPnl >= 0).length / shorts.length * 100 : 0;
  const longNet  = longs.reduce((s, t)  => s + t.netPnl, 0);
  const shortNet = shorts.reduce((s, t) => s + t.netPnl, 0);

  // P&L by UTC hour and day-of-week
  const byHour = {}, byDow = {};
  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for (const t of trades) {
    const h = t.date.getUTCHours();
    const d = DOW[t.date.getUTCDay()];
    if (!byHour[h]) byHour[h] = { pnl: 0, count: 0 };
    if (!byDow[d])  byDow[d]  = { pnl: 0, count: 0 };
    byHour[h].pnl += t.netPnl; byHour[h].count++;
    byDow[d].pnl  += t.netPnl; byDow[d].count++;
  }

  // Trade size buckets (noise vs. conviction)
  const smallTrades = trades.filter(t => Math.abs(t.netPnl) <  sizeThreshold);
  const largeTrades = trades.filter(t => Math.abs(t.netPnl) >= sizeThreshold);
  function bucketStats(bucket) {
    if (!bucket.length) return { count: 0, winCount: 0, winRate: 0, total: 0, avg: 0 };
    const w     = bucket.filter(t => t.netPnl >= 0);
    const total = bucket.reduce((s, t) => s + t.netPnl, 0);
    return {
      count:    bucket.length,
      winCount: w.length,
      winRate:  (w.length / bucket.length) * 100,
      total:    Math.round(total * 100) / 100,
      avg:      Math.round((total / bucket.length) * 100) / 100,
    };
  }
  const smallStats = bucketStats(smallTrades);
  const largeStats = bucketStats(largeTrades);

  // P&L distribution histogram
  const HIST_EDGES = [-Infinity, -2000, -1500, -1000, -750, -500, -250, 0, 250, 500, 750, 1000, 1500, 2000, Infinity];
  const histCounts = Array(HIST_EDGES.length - 1).fill(0);
  for (const t of trades) {
    for (let i = 0; i < HIST_EDGES.length - 1; i++) {
      if (t.netPnl >= HIST_EDGES[i] && t.netPnl < HIST_EDGES[i + 1]) { histCounts[i]++; break; }
    }
  }

  // ── Drawdown recovery ────────────────────────────────────────────────────
  let ddMaxAbs = 0, ddStart = -1;
  let ddTroughDate = null, ddWorstTrades = 0, ddWorstDays = 0;
  {
    let curPeak = 0, curCum = 0, peakIdx = 0;
    for (let i = 0; i < trades.length; i++) {
      curCum += trades[i].netPnl;
      if (curCum > curPeak) {
        curPeak = curCum;
        peakIdx = i;
      } else {
        const d = curPeak - curCum;
        if (d > ddMaxAbs) {
          ddMaxAbs     = d;
          ddStart      = peakIdx;
          ddTroughDate = trades[i].date;
        }
      }
    }
    if (ddStart >= 0) {
      let recCum = 0;
      for (let i = 0; i <= ddStart; i++) recCum += trades[i].netPnl;
      const peakVal = recCum;
      let runCum = peakVal, recovered = false;
      for (let i = ddStart + 1; i < trades.length; i++) {
        runCum += trades[i].netPnl;
        if (runCum >= peakVal) {
          ddWorstTrades = i - ddStart;
          if (ddTroughDate) ddWorstDays = Math.round((trades[i].date - ddTroughDate) / 86400000);
          recovered = true;
          break;
        }
      }
      if (!recovered) { ddWorstTrades = -1; ddWorstDays = -1; }
    }
  }

  // ── Daily P&L ────────────────────────────────────────────────────────────
  const dailyPnlMap = {};
  for (const t of trades) {
    const k = dateKey(t.date);
    dailyPnlMap[k] = (dailyPnlMap[k] || 0) + t.netPnl;
  }
  const dailyPnls     = Object.values(dailyPnlMap);
  const tradingDays   = dailyPnls.length;
  const profitableDays = dailyPnls.filter(v => v > 0).length;
  const bestDay       = dailyPnls.length ? Math.max(...dailyPnls) : 0;
  const worstDay      = dailyPnls.length ? Math.min(...dailyPnls) : 0;

  // ── Capital trust metrics ─────────────────────────────────────────────────
  // Calmar = annualised return / max DD (proxy-annualised via 252 trading days)
  const avgDailyReturn   = tradingDays > 0 ? totalNet / tradingDays : 0;
  const calmar = ddMaxAbs > 0
    ? (avgDailyReturn * 252) / ddMaxAbs : (totalNet > 0 ? Infinity : 0);

  // Return / Max-DD: how many × of the worst hole was earned back
  const returnOnDD = ddMaxAbs > 0
    ? totalNet / ddMaxAbs : (totalNet > 0 ? Infinity : 0);

  // Gain-to-pain: net P&L / |sum of losing days|
  const totalDailyLoss = Math.abs(dailyPnls.filter(v => v < 0).reduce((s, v) => s + v, 0));
  const gainToPain = totalDailyLoss > 0
    ? totalNet / totalDailyLoss : (totalNet > 0 ? Infinity : 0);

  // Worst day / best day ratio (want < 1 — bad days smaller than good days)
  const dayAsymmetry = bestDay > 0 ? Math.abs(worstDay) / bestDay : 0;

  // ── Noise-style edge metrics ──────────────────────────────────────────────
  // Expectancy and R-multiple
  const expectancy = totalNet / trades.length;
  const rMultiple  = avgLoss !== 0 ? expectancy / Math.abs(avgLoss) : 0;

  // Win/loss skew: avg win / avg loss magnitude
  const winLossSkew = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : Infinity;

  // Slugging %: share of gross wins that came from big wins (≥ threshold)
  const bigWins      = wins.filter(t => t.netPnl >= sizeThreshold);
  const bigWinTotal  = bigWins.reduce((s, t) => s + t.netPnl, 0);
  const sluggingPct  = grossWins > 0 ? (bigWinTotal / grossWins) * 100 : 0;

  // Base P&L without any big wins
  const baseNet = totalNet - bigWinTotal;

  // Noise cost: total of all losing trades
  const noiseCost = losses.reduce((s, t) => s + t.netPnl, 0);

  // Commission as % of gross wins
  const commPctOfGrossWins = grossWins > 0 ? (Math.abs(totalComm) / grossWins) * 100 : 0;

  // Dependency on top 3 winners
  const sortedByPnl    = [...trades].sort((a, b) => b.netPnl - a.netPnl);
  const top3Net        = sortedByPnl.slice(0, 3).reduce((s, t) => s + t.netPnl, 0);
  const top3NetWithout = totalNet - top3Net;
  const top3PctOfTotal = totalNet !== 0 ? (top3Net / totalNet) * 100 : 0;

  return {
    // Core
    totalNet, totalGross, totalComm,
    winRate, avgWin, avgLoss, maxWin, maxLoss,
    winCount: wins.length, lossCount: losses.length, tradeCount: trades.length,
    profitFactor, maxDD, sortino,
    // Direction
    longCount: longs.length, shortCount: shorts.length,
    longWinRate, shortWinRate, longNet, shortNet,
    // Time
    byHour, byDow,
    // Buckets
    sizeThreshold, smallStats, largeStats,
    // Histogram
    histCounts, histEdges: HIST_EDGES,
    // Capital trust
    ddWorstTrades, ddWorstDays,
    tradingDays, profitableDays, bestDay, worstDay,
    calmar, returnOnDD, gainToPain, dayAsymmetry,
    // Noise-style edge
    expectancy, rMultiple,
    winLossSkew,
    sluggingPct, bigWinTotal, bigWinCount: bigWins.length, baseNet,
    noiseCost, commPctOfGrossWins,
    top3Net, top3NetWithout, top3PctOfTotal,
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

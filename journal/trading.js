// trading.js — CSV parsing and trade reconstruction
//
// Supported formats (auto-detected):
//   • TradingView Balance History  — most accurate, uses TV's own avg-price P&L
//   • TradingView Account History  — pre-calculated P&L columns
//   • TradingView Order History    — reconstructed via avg-price position pairing
//   • AMP / Rithmic Order History  — same pairing, different column names
//   • Sierra Chart / Rithmic Order Report

const POINT_VALUE_DEFAULT = 20;

// ─── Instrument Registry ─────────────────────

const FUTURES_INSTRUMENTS = [
  // Equity index
  { pattern: /\bENQ[A-Z0-9]*\b|F\.US\.ENQ|CME_MINI:NQ|\bNQ1!/i,    name: 'NQ (E-mini NASDAQ-100)',   tickSize: 0.25,      tickValue: 5,      pointValue: 20       },
  { pattern: /\bMNQ[A-Z0-9]*\b|F\.US\.MNQ|CME_MICRO:MNQ|\bMNQ1!/i, name: 'MNQ (Micro NASDAQ-100)',  tickSize: 0.25,      tickValue: 0.5,    pointValue: 2        },
  { pattern: /\bES[A-Z0-9]*\b|CME_MINI:ES|F\.US\.EP/i,              name: 'ES (E-mini S&P 500)',      tickSize: 0.25,      tickValue: 12.5,   pointValue: 50       },
  { pattern: /\bMES[A-Z0-9]*\b|F\.US\.MES/i,                        name: 'MES (Micro S&P 500)',      tickSize: 0.25,      tickValue: 1.25,   pointValue: 5        },
  { pattern: /\bYM[A-Z0-9]*\b|CBOT_MINI:YM|F\.US\.YM/i,            name: 'YM (E-mini Dow)',          tickSize: 1,         tickValue: 5,      pointValue: 5        },
  { pattern: /\bMYM[A-Z0-9]*\b|F\.US\.MYM/i,                        name: 'MYM (Micro Dow)',          tickSize: 1,         tickValue: 0.5,    pointValue: 0.5      },
  { pattern: /\bRTY[A-Z0-9]*\b|CME_MINI:RTY|F\.US\.RY/i,           name: 'RTY (E-mini Russell 2000)',tickSize: 0.1,       tickValue: 5,      pointValue: 50       },
  { pattern: /\bM2K[A-Z0-9]*\b|F\.US\.M2K/i,                        name: 'M2K (Micro Russell 2000)',tickSize: 0.1,       tickValue: 0.5,    pointValue: 5        },
  // Energy
  { pattern: /\bCL\b|NYMEX:CL|F\.US\.CL/i,                          name: 'CL (Crude Oil)',           tickSize: 0.01,      tickValue: 10,     pointValue: 1000     },
  { pattern: /\bMCL\b|F\.US\.MCL/i,                                  name: 'MCL (Micro Crude Oil)',    tickSize: 0.01,      tickValue: 1,      pointValue: 100      },
  { pattern: /\bNG\b|NYMEX:NG|F\.US\.NG/i,                           name: 'NG (Natural Gas)',         tickSize: 0.001,     tickValue: 10,     pointValue: 10000    },
  // Metals
  { pattern: /\bGC\b|COMEX:GC|F\.US\.GC/i,                           name: 'GC (Gold)',                tickSize: 0.1,       tickValue: 10,     pointValue: 100      },
  { pattern: /\bMGC\b|F\.US\.MGC/i,                                   name: 'MGC (Micro Gold)',         tickSize: 0.1,       tickValue: 1,      pointValue: 10       },
  { pattern: /\bSI\b|COMEX:SI|F\.US\.SI/i,                            name: 'SI (Silver)',              tickSize: 0.005,     tickValue: 25,     pointValue: 5000     },
  // Treasuries
  { pattern: /\bZB\b|CBOT:ZB|F\.US\.ZB/i,                            name: 'ZB (30yr T-Bond)',         tickSize: 0.03125,   tickValue: 31.25,  pointValue: 1000     },
  { pattern: /\bZN\b|CBOT:ZN|F\.US\.ZN/i,                            name: 'ZN (10yr T-Note)',         tickSize: 0.015625,  tickValue: 15.625, pointValue: 1000     },
  // FX
  { pattern: /\b6E\b|CME:6E|F\.US\.6E/i,                             name: '6E (Euro FX)',             tickSize: 0.0001,    tickValue: 12.5,   pointValue: 125000   },
  { pattern: /\b6J\b|CME:6J|F\.US\.6J/i,                             name: '6J (Japanese Yen)',        tickSize: 0.0000005, tickValue: 6.25,   pointValue: 12500000 },
];

function detectInstrument(symbol) {
  if (!symbol) return null;
  return FUTURES_INSTRUMENTS.find(inst => inst.pattern.test(symbol)) || null;
}

let _pointValueOverride = null;

function getPointValue(symbol) {
  if (_pointValueOverride !== null) return _pointValueOverride;
  const inst = detectInstrument(symbol);
  return inst ? inst.pointValue : POINT_VALUE_DEFAULT;
}

// ─── CSV Parsing ─────────────────────────────

function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = (vals[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function cleanPrice(str) {
  if (!str) return null;
  const n = parseFloat(str.replace(/[^0-9.-]/g, ''));
  return isFinite(n) ? n : null;
}

function parseDate(str) {
  if (!str) return null;
  str = str.trim();
  // Sierra Chart / Rithmic: "M/D/YY H:MM:SS AM/PM"
  const sc = str.match(/^(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)\s+(AM|PM)$/i);
  if (sc) {
    let [, mo, day, yr, hr, min, sec, ampm] = sc;
    yr = parseInt(yr); if (yr < 100) yr += 2000;
    hr = parseInt(hr);
    if (ampm.toUpperCase() === 'PM' && hr !== 12) hr += 12;
    if (ampm.toUpperCase() === 'AM' && hr === 12) hr = 0;
    return new Date(Date.UTC(yr, parseInt(mo) - 1, parseInt(day), hr, parseInt(min), parseInt(sec)));
  }
  // ISO-like: "YYYY-MM-DD HH:MM:SS"
  return new Date(str.replace(' ', 'T') + 'Z');
}

// ─── Avg-Price Position Pairing (shared logic) ───────────────────────────────
// Mirrors TradingView's position tracking: legs in the same direction accumulate
// using a running average price; an opposite-side leg closes (part of) the position.
// A round-trip trade is emitted when net position reaches zero.

function makePosMap() {
  const map = {};
  return sym => {
    if (!map[sym]) map[sym] = { qty: 0, avgPrice: 0, legs: [] };
    return map[sym];
  };
}

function emitTradeFromPos(pos, sym, closeQty, exitPrice, exitTs) {
  const closingLong = pos.qty > 0;
  const priceDelta  = closingLong ? exitPrice - pos.avgPrice : pos.avgPrice - exitPrice;
  const grossPnl    = priceDelta * closeQty * getPointValue(sym);
  const totalComm   = pos.legs.reduce((s, l) => s + l.comm, 0);
  const netPnl      = grossPnl - totalComm;
  return {
    date:       pos.legs[0].ts,
    exitDate:   exitTs,
    symbol:     sym,
    direction:  closingLong ? 'Buy' : 'Sell',
    qty:        closeQty,
    entryPrice: pos.avgPrice,
    exitPrice,
    points:     Math.round(priceDelta * 100) / 100,
    grossPnl:   Math.round(grossPnl * 100) / 100,
    commission: Math.round(totalComm * 100) / 100,
    netPnl:     Math.round(netPnl * 100) / 100,
    durationMs: Math.max(0, exitTs - pos.legs[0].ts),
    result:     netPnl >= 0 ? 'Win' : 'Loss',
  };
}

function pairOrders(orders, posMapFn) {
  // orders: [{ symbol, side ('buy'|'sell'|'b'), qty, price, comm, ts }]
  const getPos = posMapFn || makePosMap();
  const trades = [];

  for (const { symbol: sym, side, qty, price, comm, ts } of orders) {
    const pos = getPos(sym);
    const isBuy = /^(buy|long|b)$/i.test(side);
    const signed = isBuy ? qty : -qty;

    if (pos.qty === 0 || Math.sign(signed) === Math.sign(pos.qty)) {
      const prevAbs = Math.abs(pos.qty);
      const newAbs  = prevAbs + qty;
      pos.avgPrice  = prevAbs === 0 ? price : (pos.avgPrice * prevAbs + price * qty) / newAbs;
      pos.qty      += signed;
      pos.legs.push({ ts, comm });
    } else {
      const closing  = Math.min(qty, Math.abs(pos.qty));
      const overflow = qty - closing;
      const commProp = qty > 0 ? comm * closing / qty : 0;
      pos.legs.push({ ts, comm: commProp });
      trades.push(emitTradeFromPos(pos, sym, closing, price, ts));
      if (overflow > 0) {
        getPos(sym); // initialise
        Object.assign(getPos(sym), {
          qty:      -Math.sign(pos.qty) * overflow,
          avgPrice: price,
          legs:     [{ ts, comm: comm * overflow / qty }],
        });
      } else {
        Object.assign(pos, { qty: 0, avgPrice: 0, legs: [] });
      }
    }
  }

  return trades.sort((a, b) => a.date - b.date);
}

// ─── Format Parsers ───────────────────────────

function buildTradesFromBalanceHistory(rows) {
  const sorted = [...rows].sort((a, b) => parseDate(a['Time']) - parseDate(b['Time']));

  const enterComms = [];
  for (const r of sorted) {
    const action = r['Action'] || '';
    if (!action.startsWith('Commission for: Enter')) continue;
    const m = action.match(/Enter position for symbol ([\w:!.]+) at price ([\d.]+) for (\d+)/);
    if (m) enterComms.push({
      time: parseDate(r['Time']),
      sym:  m[1],
      price: parseFloat(m[2]),
      qty:  parseInt(m[3]),
      comm: Math.abs(parseFloat(r['Realized P&L (value)'])),
    });
  }

  const trades = [];
  for (const r of sorted) {
    const action = r['Action'] || '';
    if (action.startsWith('Commission for:') || !action.startsWith('Close')) continue;

    const m = action.match(/Close (long|short) position for symbol ([\w:!.]+) at price ([\d.]+) for (\d+) units.*?AVG Price was ([\d.]+)/);
    if (!m) continue;

    const direction  = m[1] === 'long' ? 'Buy' : 'Sell';
    const symbol     = m[2];
    const closePrice = parseFloat(m[3]);
    const qty        = parseInt(m[4]);
    const avgPrice   = parseFloat(m[5]);
    const exitDate   = parseDate(r['Time']);
    const grossPnl   = parseFloat(r['Realized P&L (value)']);

    const exitCommRow = sorted.find(x =>
      x['Time'] === r['Time'] && (x['Action'] || '').startsWith('Commission for: Close')
    );
    const exitComm = exitCommRow ? Math.abs(parseFloat(exitCommRow['Realized P&L (value)'])) : 0;

    let entryComm = exitComm, entryDate = null;
    // First try exact qty match (single-leg close)
    let matchIdx = enterComms.findIndex(e => e.sym === symbol && e.qty === qty && e.time < exitDate);
    if (matchIdx !== -1) {
      entryComm = enterComms[matchIdx].comm;
      entryDate = enterComms[matchIdx].time;
      enterComms.splice(matchIdx, 1);
    } else {
      // Multi-leg: collect all enter commissions for this symbol before exitDate,
      // use the earliest timestamp as entryDate and sum their commissions.
      const legIndices = [];
      enterComms.forEach((e, i) => { if (e.sym === symbol && e.time < exitDate) legIndices.push(i); });
      if (legIndices.length) {
        entryComm = legIndices.reduce((s, i) => s + enterComms[i].comm, 0);
        entryDate = legIndices.reduce((earliest, i) =>
          enterComms[i].time < earliest ? enterComms[i].time : earliest,
          enterComms[legIndices[0]].time
        );
        // Remove matched legs in reverse order to preserve indices
        for (let i = legIndices.length - 1; i >= 0; i--) enterComms.splice(legIndices[i], 1);
      }
    }

    const totalComm  = exitComm + entryComm;
    const netPnl     = grossPnl - totalComm;
    const priceDelta = direction === 'Buy' ? closePrice - avgPrice : avgPrice - closePrice;

    trades.push({
      date:       entryDate || exitDate,
      exitDate,
      symbol,
      direction,
      qty,
      entryPrice: avgPrice,
      exitPrice:  closePrice,
      points:     Math.round(priceDelta * 100) / 100,
      grossPnl:   Math.round(grossPnl * 100) / 100,
      commission: Math.round(totalComm * 100) / 100,
      netPnl:     Math.round(netPnl * 100) / 100,
      durationMs: entryDate ? Math.max(0, exitDate - entryDate) : 0,
      result:     netPnl >= 0 ? 'Win' : 'Loss',
    });
  }

  return trades.sort((a, b) => a.date - b.date);
}

function buildTradesFromAccountHistory(rows) {
  const trades = [];
  for (const r of rows) {
    const keys = Object.keys(r);
    const get = (...candidates) => {
      for (const c of candidates) {
        const k = keys.find(k => k.toLowerCase().replace(/[\s/&]/g, '') === c.toLowerCase().replace(/[\s/&]/g, ''));
        if (k && r[k] && r[k].trim()) return r[k].trim();
      }
      return null;
    };

    const symbol     = get('Symbol', 'Ticker', 'Instrument');
    const sideRaw    = get('Side', 'Direction', 'Type');
    const qty        = parseFloat(get('Qty', 'Quantity', 'Size', 'Contracts') || '0');
    const entryPrice = cleanPrice(get('Entry', 'Entry Price', 'Open', 'Open Price', 'Avg Entry'));
    const exitPrice  = cleanPrice(get('Exit', 'Exit Price', 'Close', 'Close Price', 'Avg Exit'));
    const pnl        = cleanPrice(get('Profit', 'P&L', 'PL', 'PnL', 'Realized P&L', 'Net Profit', 'Net P&L'));
    const commission = cleanPrice(get('Commission', 'Fee', 'Fees')) || 0;
    const openTime   = parseDate(get('Open Time', 'Entry Time', 'Open Date', 'Date Open', 'Placing Time'));
    const closeTime  = parseDate(get('Close Time', 'Exit Time', 'Close Date', 'Date Close', 'Closing Time'));

    if (!symbol || !qty || pnl === null) continue;

    const direction = /^(buy|long)$/i.test(sideRaw || '') ? 'Buy' : 'Sell';
    const netPnl    = Math.round(pnl * 100) / 100;
    const grossPnl  = Math.round((pnl + commission) * 100) / 100;
    const points    = (entryPrice !== null && exitPrice !== null)
      ? Math.round((direction === 'Buy' ? exitPrice - entryPrice : entryPrice - exitPrice) * 100) / 100
      : null;
    const date = openTime || closeTime || new Date(0);

    trades.push({
      date,
      exitDate:   closeTime || date,
      symbol,
      direction,
      qty,
      entryPrice,
      exitPrice,
      points,
      grossPnl,
      commission: Math.round(commission * 100) / 100,
      netPnl,
      durationMs: (openTime && closeTime) ? Math.max(0, closeTime - openTime) : 0,
      result:     netPnl >= 0 ? 'Win' : 'Loss',
    });
  }
  return trades.sort((a, b) => a.date - b.date);
}

function buildTradesFromOrderHistory(rows) {
  const orders = rows
    .filter(r => r['Status'] === 'Filled' && r['Fill Price'])
    .map(r => ({
      symbol: r['Symbol'],
      side:   (r['Side'] || '').toLowerCase(),
      qty:    parseFloat(r['Qty']) || 0,
      price:  cleanPrice(r['Fill Price']),
      comm:   cleanPrice(r['Commission']) || 0,
      ts:     parseDate(r['Closing Time']),
    }))
    .filter(r => r.price !== null && r.qty > 0)
    .sort((a, b) => a.ts - b.ts);
  return pairOrders(orders);
}

function buildTradesFromAmpOrderHistory(rows) {
  const orders = rows
    .filter(r => r['Status'] === 'Filled' && r['Avg Fill Price'])
    .map(r => ({
      symbol: r['Symbol'],
      side:   (r['Side'] || '').toLowerCase(),
      qty:    parseFloat(r['Fill Qty'] || r['Qty']) || 0,
      price:  cleanPrice(r['Avg Fill Price']),
      comm:   cleanPrice(r['Commission']) || 0,
      ts:     parseDate(r['Status Time'] || r['Placing Time']),
    }))
    .filter(r => r.price !== null && r.qty > 0 && r.ts !== null)
    .sort((a, b) => a.ts - b.ts);
  return pairOrders(orders);
}

function buildTradesFromSierraOrderReport(rows) {
  const orders = rows
    .filter(r => r['Status'] === 'Filled' && r['Avg Fill P'])
    .map(r => ({
      symbol: r['Symbol'],
      side:   (r['B/S'] || '').toLowerCase(),
      qty:    parseFloat(r['Fld (380)'] || r['Qty']) || 0,
      price:  cleanPrice(r['Avg Fill P']),
      comm:   0,
      ts:     parseDate(r['Fill T']),
    }))
    .filter(r => r.price !== null && r.qty > 0 && r.ts !== null)
    .sort((a, b) => a.ts - b.ts);
  return pairOrders(orders);
}

// ─── Format Detection & Entry Point ──────────

function detectFormat(rows) {
  if (!rows.length) return 'order-history';
  const keys = Object.keys(rows[0]).map(k => k.toLowerCase().trim());
  if (keys.some(k => k === 'balance before' || k.includes('balance before'))) return 'balance-history';
  const hasProfit = keys.some(k => k.includes('profit') || k === 'p&l' || k === 'pl' || k === 'pnl');
  const hasEntry  = keys.some(k => k.includes('entry') || k === 'open price' || k === 'open');
  if (hasProfit || hasEntry) return 'account-history';
  if (keys.some(k => k === 'avg fill price') || keys.some(k => k === 'status time')) return 'amp-order-history';
  if (keys.some(k => k === 'b/s') || keys.some(k => k === 'fill t')) return 'sierra-order-report';
  return 'order-history';
}

function buildTrades(rows) {
  const format = detectFormat(rows);
  if (format === 'balance-history')     return buildTradesFromBalanceHistory(rows);
  if (format === 'account-history')     return buildTradesFromAccountHistory(rows);
  if (format === 'amp-order-history')   return buildTradesFromAmpOrderHistory(rows);
  if (format === 'sierra-order-report') return buildTradesFromSierraOrderReport(rows);
  return buildTradesFromOrderHistory(rows);
}

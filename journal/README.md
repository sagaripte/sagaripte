# Trading Journal

A single-page trading journal that runs entirely in your browser — no server, no sign-up, no data ever leaves your machine. Drop a CSV export from your broker and get a full performance breakdown instantly.

## Features

**Four stat sections, each answering a specific question:**

- **Returns** — Net P&L, Profit Factor, per-trade Expectancy, Sortino Ratio, Commission drag
- **How the Edge Works** — Win/Loss Skew, Slugging %, Noise Cost, dependency on top 3 wins, base profitability without outliers
- **Capital Management** — Calmar Ratio, Return/Max-DD, Gain-to-Pain, Day Win Rate, worst day vs recovery time
- **Directional** — Long vs Short net P&L, win rates, bias

**Charts:** equity curve, daily P&L, P&L distribution histogram, by-hour, by-day-of-week

**Trade log** — full round-trip table with sortable columns, Win/Loss/Long/Short filters, noise trades dimmed at configurable threshold

## Supported CSV Formats

Auto-detected from column headers:

| Format | How to export |
|--------|---------------|
| TradingView Balance History | Paper trading → ⋮ → Export → Balance History |
| TradingView Account History | Paper trading → ⋮ → Export → Account History |
| TradingView Order History   | Paper trading → ⋮ → Export → Order History |
| AMP / Rithmic Order History | AMP Client → Reports → Order History |
| Sierra Chart Order Report   | Sierra Chart → Trade → Trade Order Fill Log |

**Most accurate:** Balance History — uses TradingView's own avg-price P&L, matches the UI exactly.

## Usage

No build step. Open `index.html` directly in a browser (Chrome, Firefox, Safari, Edge).

```
open index.html          # macOS
start index.html         # Windows
xdg-open index.html      # Linux
```

Then drag-and-drop your CSV or click "Browse File".

## Settings

Click ⚙ in the top-right:

- **Starting Balance** — used to show account growth %
- **Big Win Threshold** — dollar amount that separates noise trades from conviction trades (default $500). Drives the "How the Edge Works" section.
- **Point Value** — auto-detected from the symbol for common futures (NQ, ES, MNQ, MES, CL, GC, …). Override manually if needed.

## Stats Reference

| Stat | What it means |
|------|---------------|
| Profit Factor | Gross wins ÷ gross losses. >1.5 = solid edge |
| Expectancy | Average net P&L per trade |
| Sortino Ratio | Return ÷ downside deviation only. Better than Sharpe for styles with big right-tail wins |
| Win/Loss Skew | Avg win ÷ avg loss magnitude. >1.5× means losses are structurally smaller than wins |
| Slugging % | Share of gross wins from trades above the big-win threshold |
| Noise Cost | Sum of all losing trades — the "hunting cost" for big wins |
| Strip Top 3 Wins | Net P&L with your 3 best trades removed — tests dependency on outliers |
| Base P&L | P&L from all non-big-win trades — what's left when the big wins don't land |
| Calmar Ratio | Annualised return ÷ max drawdown. >1 solid, >2 excellent |
| Return / Max DD | How many times over you earned back your worst drawdown hole |
| Gain-to-Pain | Net P&L ÷ sum of all losing days. >1 = edge worth the pain |
| DD Recovery | Trades and calendar days to fully recover from the worst drawdown |

## Files

```
index.html   — UI shell, CSS, layout
trading.js   — CSV parsing and trade reconstruction (6 format parsers)
stats.js     — All stat computation and formatters
charts.js    — Chart.js wrappers (equity, daily, hourly, DoW, distribution)
ui.js        — DOM rendering, event wiring, settings
```

## License

MIT

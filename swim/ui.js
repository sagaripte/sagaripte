'use strict';

/**
 * UI — form, controls, per-length lap timeline.
 *
 * Timeline layout (one row per pool length):
 *
 *   L1 →  [Dive][UW  ][Swim          ][App][Turn]
 *             ↓ detail chips below each segment ↓
 *             ← turn connector arrow →
 *   L2 ←  [Push][Swim             ][App][Turn]
 *             ← turn connector arrow ←
 *   L3 →  ...
 */
const UI = (() => {

  // Single reused dot element — moved between segments each frame
  let _dot = null;

  // ── Public API ──────────────────────────────────────────────

  function init() {
    _rebuildPoolOptions();
    _rebuildDistanceOptions(25);
    _bindForm();
    _bindControls();
    _buildLegend();
    _rebuildPresetOptions();
    _applyPreset();
  }

  /**
   * Build the per-length split timeline.
   * Groups phases by lengthIndex, renders one row per length.
   */
  // Convert meters to display unit string
  function _distStr(meters, isYards) {
    if (isYards) return (meters * M_TO_YD).toFixed(1) + 'yd';
    return meters.toFixed(1) + 'm';
  }
  function _speedStr(mps, isYards) {
    if (isYards) return (mps * M_TO_YD).toFixed(2) + 'yd/s';
    return mps.toFixed(2) + 'm/s';
  }
  function _dpsStr(m, isYards) {
    if (isYards) return (m * M_TO_YD).toFixed(2) + 'yd';
    return m.toFixed(2) + 'm';
  }

  function renderTimeline(phases, totalTime, poolLength, isYards = false) {
    const lapRows = document.getElementById('lap-rows');
    lapRows.innerHTML = '';

    // Group phases by length
    const byLength = [];
    for (const p of phases) {
      if (!byLength[p.lengthIndex]) byLength[p.lengthIndex] = [];
      byLength[p.lengthIndex].push(p);
    }

    const numLengths = byLength.length;

    for (let li = 0; li < numLengths; li++) {
      const lengthPhases = byLength[li];
      const isRTL = li % 2 === 1;  // even = L→R, odd = R→L

      // Length time budget (sum of all phases in this length)
      const lengthTime = lengthPhases.reduce((s, p) => s + p.durationS, 0);
      const strokeLabel = STROKE_CONSTANTS[lengthPhases[0].stroke]?.label || lengthPhases[0].stroke;

      // ── Row ──────────────────────────────────────────────────
      const row = document.createElement('div');
      row.className = 'lap-row';
      row.dataset.length = li;

      // Bar wrap (label + segments)
      const barWrap = document.createElement('div');
      barWrap.className = 'lap-bar-wrap';

      const label = document.createElement('div');
      label.className = 'lap-label';
      label.innerHTML = `L${li + 1}<br><span style="font-size:8px;color:var(--text-muted)">${strokeLabel}</span>`;
      barWrap.appendChild(label);

      const bar = document.createElement('div');
      bar.className = 'lap-bar' + (isRTL ? ' rtl' : '');
      barWrap.appendChild(bar);

      row.appendChild(barWrap);

      // Tick strip row (between bar and detail text)
      const ticks = document.createElement('div');
      ticks.className = 'lap-ticks';
      ticks.style.flexDirection = isRTL ? 'row-reverse' : 'row';
      row.appendChild(ticks);

      // Detail strip below the ticks
      const details = document.createElement('div');
      details.className = 'lap-details';
      details.style.flexDirection = isRTL ? 'row-reverse' : 'row';
      row.appendChild(details);

      lapRows.appendChild(row);

      // ── Segments + tick strips + detail cards ─────────────────
      for (const phase of lengthPhases) {
        const widthPct = (phase.durationS / lengthTime) * 100;

        // Segment bar
        const seg = document.createElement('div');
        seg.className = 'phase-seg';
        seg.dataset.id = phase.id;
        seg.style.width      = widthPct + '%';
        seg.style.background = phase.color;

        if (widthPct > 6) {
          const lbl = document.createElement('span');
          lbl.className   = 'seg-label';
          lbl.textContent = phase.labelShort;
          seg.appendChild(lbl);
        }
        bar.appendChild(seg);

        // Tick strip — strokes or UW kicks
        const tickWrap = document.createElement('div');
        tickWrap.className  = 'phase-ticks';
        tickWrap.dataset.id = phase.id;
        tickWrap.style.width = widthPct + '%';
        tickWrap.appendChild(_buildTickSvg(phase, isRTL));
        ticks.appendChild(tickWrap);

        // Detail card
        const card = document.createElement('div');
        card.className  = 'phase-detail';
        card.dataset.id = phase.id;
        card.style.width = widthPct + '%';

        const rows = [];
        if (phase.distanceM > 0)            rows.push(['dist', _distStr(phase.distanceM, isYards)]);
        rows.push(['time', phase.durationS.toFixed(2) + 's']);
        if (phase.split15m != null)         rows.push([isYards ? '15yd' : '15m', phase.split15m.toFixed(2) + 's']);
        if (phase.turnTime != null)         rows.push(['wall', phase.turnTime.toFixed(2) + 's']);
        if (phase.speed)                    rows.push(['spd',  _speedStr(phase.speed, isYards)]);
        if (phase.strokeCount !== null)     rows.push(['stk',  phase.strokeCount]);
        if (phase.cycleRate != null)        rows.push(['spm',  phase.cycleRate.toFixed(1)]);
        if (phase.dps != null)              rows.push(['dps',  _dpsStr(phase.dps, isYards)]);
        if (phase.efficiency != null)       rows.push(['SI',   phase.efficiency.toFixed(2)]);
        if (phase.underwaterKicks !== null) rows.push(['uw',   phase.underwaterKicks + (phase.underwaterKicks === 1 ? ' pull' : ' kicks')]);

        if (widthPct > 3) {
          for (const [key, val] of rows) {
            const dr = document.createElement('div');
            dr.className = 'detail-row';
            dr.innerHTML = `<span class="detail-key">${key}</span><span class="detail-val">${val}</span>`;
            card.appendChild(dr);
          }
        }

        details.appendChild(card);
      }

      // ── Mobile accordion ──────────────────────────────────────
      const accordion = document.createElement('div');
      accordion.className = 'mobile-accordion';
      if (li === 0) {
        accordion.classList.add('open');
        row.classList.add('acc-open');
      }

      for (const phase of lengthPhases) {
        const mRow = document.createElement('div');
        mRow.className = 'mobile-phase-row';
        mRow.dataset.id = phase.id;

        const dot = document.createElement('div');
        dot.className = 'mobile-phase-dot';
        dot.style.background = phase.color;

        const name = document.createElement('div');
        name.className = 'mobile-phase-name';
        name.textContent = phase.labelShort;

        const stats = document.createElement('div');
        stats.className = 'mobile-stats';

        const statDefs = [];
        statDefs.push(['TIME', phase.durationS.toFixed(2) + 's']);
        if (phase.distanceM > 0)              statDefs.push(['DIST', _distStr(phase.distanceM, isYards)]);
        if (phase.speed)                      statDefs.push(['SPD',  _speedStr(phase.speed, isYards)]);
        if (phase.cycleRate != null)          statDefs.push(['SPM',  phase.cycleRate.toFixed(1)]);
        if (phase.dps != null)                statDefs.push(['DPS',  _dpsStr(phase.dps, isYards)]);
        if (phase.efficiency != null)         statDefs.push(['SI',   phase.efficiency.toFixed(2)]);
        if (phase.split15m != null)           statDefs.push([isYards ? '15YD' : '15M', phase.split15m.toFixed(2) + 's']);
        if (phase.underwaterKicks != null)    statDefs.push(['UW',   phase.underwaterKicks + (phase.underwaterKicks === 1 ? ' pull' : ' kicks')]);
        if (phase.turnTime != null)           statDefs.push(['WALL', phase.turnTime.toFixed(2) + 's']);

        for (const [k, v] of statDefs) {
          const s = document.createElement('div');
          s.className = 'mobile-stat';
          s.innerHTML = `<span class="mobile-stat-key">${k}</span><span class="mobile-stat-val">${v}</span>`;
          stats.appendChild(s);
        }

        mRow.append(dot, name, stats);
        accordion.appendChild(mRow);
      }

      row.appendChild(accordion);

      // Tapping the bar wrap toggles this accordion (visible only on mobile via CSS)
      barWrap.addEventListener('click', () => {
        const isOpen = accordion.classList.contains('open');
        document.querySelectorAll('.mobile-accordion.open').forEach(a => a.classList.remove('open'));
        document.querySelectorAll('.lap-row.acc-open').forEach(r => r.classList.remove('acc-open'));
        if (!isOpen) {
          accordion.classList.add('open');
          row.classList.add('acc-open');
        }
      });

      // ── Turn connector (between lengths, not after last) ──────
      if (li < numLengths - 1) {
        const conn = document.createElement('div');
        conn.className = 'lap-connector';

        // Arrow curves around the wall
        const arrow = isRTL
          ? '← wall →'   // R→L length, next goes L→R: arrow turns right
          : '← wall →';  // L→R length, next goes R→L: arrow turns left
        const nextDir = isRTL ? 'L→R' : 'R→L';

        conn.innerHTML = `
          <div class="connector-line"></div>
          <span class="connector-arrow">${isRTL ? '↙' : '↘'}</span>
          <span class="connector-label">TURN · ${nextDir}</span>
          <div class="connector-line"></div>
        `;
        lapRows.appendChild(conn);
      }
    }

    // ── Summary stats ─────────────────────────────────────────
    const totalDistM = phases[phases.length - 1].distanceEnd;  // always meters
    const totalStrokes = phases
      .filter(p => p.strokeCount !== null)
      .reduce((s, p) => s + p.strokeCount, 0);
    const avgSpeedMps  = totalDistM / totalTime;
    // Pace per 100 in the display unit
    const paceRef      = isYards ? 100 * YD_TO_M : 100;  // 100yd in meters, or 100m
    const paceLabel    = isYards ? 'Pace / 100yd' : 'Pace / 100m';
    const pacePer100   = (totalTime / totalDistM * paceRef).toFixed(2);

    const summary = document.createElement('div');
    summary.className = 'lap-summary';
    summary.innerHTML = `
      <div class="summary-stat">
        <span class="summary-label">Total Time</span>
        <span class="summary-val">${totalTime.toFixed(2)}s</span>
      </div>
      <div class="summary-stat">
        <span class="summary-label">Distance</span>
        <span class="summary-val">${_distStr(totalDistM, isYards).replace('.0', '')}</span>
      </div>
      <div class="summary-stat">
        <span class="summary-label">Avg Speed</span>
        <span class="summary-val">${_speedStr(avgSpeedMps, isYards)}</span>
      </div>
      <div class="summary-stat">
        <span class="summary-label">${paceLabel}</span>
        <span class="summary-val">${pacePer100}s</span>
      </div>
      <div class="summary-stat">
        <span class="summary-label">Total Strokes</span>
        <span class="summary-val">${totalStrokes}</span>
      </div>
      <div class="summary-stat">
        <span class="summary-label">Lengths</span>
        <span class="summary-val">${numLengths}</span>
      </div>
    `;
    document.getElementById('lap-rows').appendChild(summary);

    // Create the progress dot (one shared element, reparented each frame)
    _dot = document.createElement('div');
    _dot.className = 'progress-dot';
    // Start hidden until animation begins
    _dot.style.display = 'none';
  }

  /**
   * Highlight the currently active phase segment and its detail card.
   */
  function highlightActivePhase(id) {
    document.querySelectorAll('.phase-seg, .phase-detail, .mobile-phase-row').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id);
    });
  }

  /**
   * Move the progress dot to the correct position within the active segment.
   * @param {string} phaseId   - id of the current phase
   * @param {number} progress  - 0..1, how far through this phase we are
   * @param {boolean} isRTL    - whether this length runs right-to-left
   */
  function updateDot(phaseId, progress, isRTL) {
    if (!_dot) return;

    const seg = document.querySelector(`.phase-seg[data-id="${phaseId}"]`);
    if (!seg) { _dot.style.display = 'none'; return; }

    // Reparent dot into the active segment if needed
    if (_dot.parentElement !== seg) {
      seg.appendChild(_dot);
    }

    _dot.style.display = 'block';

    // For RTL rows the segment itself is already flipped via flex-direction:row-reverse,
    // so visually left→right within the segment still means progress 0→1 from the
    // entering edge. We flip the percentage so the dot enters from the correct side.
    const pct = isRTL ? (1 - progress) * 100 : progress * 100;
    _dot.style.left = pct + '%';
  }

  function updateTimeDisplay(t, total) {
    document.getElementById('sim-time-display').textContent =
      `${t.toFixed(2)}s / ${total.toFixed(2)}s`;
  }

  function setPlayPauseState(state) {
    const btn = document.getElementById('play-pause-btn');
    if (state === 'play') {
      btn.textContent = '▶ Play';
      btn.classList.remove('play-active');
    } else {
      btn.textContent = '⏸ Pause';
      btn.classList.add('play-active');
    }
  }

  // ── Private ─────────────────────────────────────────────────

  function _bindForm() {
    document.getElementById('unit').addEventListener('change', () => {
      _rebuildPoolOptions();
      _rebuildDistanceOptions(+document.getElementById('pool-length').value);
      _filterDistancesForStroke(document.getElementById('stroke').value);
      _applyPreset();
    });
    document.getElementById('pool-length').addEventListener('change', e => {
      _rebuildDistanceOptions(+e.target.value);
      _filterDistancesForStroke(document.getElementById('stroke').value);
      _applyPreset();
    });
    document.getElementById('stroke').addEventListener('change', e => {
      _filterDistancesForStroke(e.target.value);
      _applyPreset();
    });
    document.getElementById('lap-distance').addEventListener('change', () => {
      _applyPreset();
    });
    document.getElementById('gender').addEventListener('change', () => {
      _applyPreset();
    });
    document.getElementById('age-group').addEventListener('change', () => {
      _rebuildPresetOptions();
      _applyPreset();
    });
    document.getElementById('time-preset').addEventListener('change', () => {
      _applyPreset();
    });
    // Typing a custom value switches preset to "custom"
    document.getElementById('target-time').addEventListener('input', () => {
      document.getElementById('time-preset').value = 'custom';
    });
    document.getElementById('sim-form').addEventListener('submit', e => {
      e.preventDefault();
      _runSimulation();
    });
  }

  /**
   * Swap the preset dropdown options between Open (Silver/Gold/WR) and
   * Age Group (A / BB / B) depending on the selected age group.
   */
  function _rebuildPresetOptions() {
    const ageGroup = document.getElementById('age-group').value;
    const sel      = document.getElementById('time-preset');
    const current  = sel.value;

    if (ageGroup === 'open') {
      sel.innerHTML = `
        <option value="silver">Silver (~FINA 600)</option>
        <option value="gold">Gold (~FINA 800)</option>
        <option value="wr">World Record</option>
        <option value="custom">Custom</option>
      `;
      // Restore a sensible default if switching back from age group mode
      if (!['silver','gold','wr','custom'].includes(current)) sel.value = 'gold';
      else sel.value = current;
    } else {
      sel.innerHTML = `
        <option value="a">A Cut</option>
        <option value="bb">BB Cut</option>
        <option value="b">B Cut</option>
        <option value="custom">Custom</option>
      `;
      if (!['a','bb','b','custom'].includes(current)) sel.value = 'b';
      else sel.value = current;
    }
  }

  /**
   * Fill target-time from the appropriate reference table based on all selectors.
   * - Open: REFERENCE_TIMES (meters) or REFERENCE_TIMES_YD (yards) → silver/gold/wr
   * - Age group: AGE_GROUP_TIMES_SCY → a/bb/b  (SCY only; for LCM, fall back to open table)
   */
  function _applyPreset() {
    const preset   = document.getElementById('time-preset').value;
    if (preset === 'custom') return;

    const unit     = document.getElementById('unit').value;
    const isYards  = unit === 'yards';
    const stroke   = document.getElementById('stroke').value;
    const dist     = +document.getElementById('lap-distance').value;
    const ageGroup = document.getElementById('age-group').value;
    const gender   = document.getElementById('gender').value;

    let ref;
    if (ageGroup !== 'open') {
      // Age group mode — SCY table only. If in meters mode fall back to open.
      if (isYards) {
        ref = ((AGE_GROUP_TIMES_SCY[gender] || {})[ageGroup] || {})[stroke]?.[dist];
      } else {
        // No LCM age group table — silently skip auto-fill in meters+age group combo
        return;
      }
    } else {
      const table = isYards ? REFERENCE_TIMES_YD : REFERENCE_TIMES;
      ref = (table[stroke] || {})[dist];
    }

    if (!ref || ref[preset] == null) return;
    document.getElementById('target-time').value = ref[preset].toFixed(2);
  }

  function _bindControls() {
    document.getElementById('play-pause-btn').addEventListener('click', () => {
      if (Animator.getPhases().length === 0) return;
      if (Animator.isPlaying) {
        Animator.pause();
        setPlayPauseState('play');
      } else {
        Animator.play();
        setPlayPauseState('pause');
      }
    });
    document.getElementById('reset-btn').addEventListener('click', () => {
      if (Animator.getPhases().length === 0) return;
      Animator.reset();
      setPlayPauseState('play');
    });
    document.getElementById('speed-select').addEventListener('change', e => {
      Animator.setSpeed(+e.target.value);
    });
  }

  function _runSimulation() {
    const unit        = document.getElementById('unit').value;
    const isYards     = unit === 'yards';
    // Values from form are in the selected unit; convert to meters for the model
    const poolLengthU  = +document.getElementById('pool-length').value;
    const lapDistanceU = +document.getElementById('lap-distance').value;
    const poolLength   = isYards ? poolLengthU * YD_TO_M : poolLengthU;
    const lapDistance  = isYards ? lapDistanceU * YD_TO_M : lapDistanceU;
    const stroke       = document.getElementById('stroke').value;
    let   idealTime    = +document.getElementById('target-time').value;

    // Floor check uses the same unit-denominated key
    const floorTable = isYards ? {} : (MIN_TIME_FLOOR[stroke] || {});
    const floor      = floorTable[lapDistanceU];
    const warnEl     = document.getElementById('time-warning');
    if (floor && idealTime < floor) {
      idealTime = floor;
      document.getElementById('target-time').value = idealTime.toFixed(2);
      warnEl.style.display = 'inline';
    } else {
      warnEl.style.display = 'none';
    }

    const result = PhaseModel.compute({ poolLength, lapDistance, stroke, idealTime });
    renderTimeline(result.phases, result.totalTime, poolLength, isYards);
    Animator.load(result);
    Animator.reset();
  }

  function _rebuildPoolOptions() {
    const unit = document.getElementById('unit').value;
    const sel  = document.getElementById('pool-length');
    if (unit === 'yards') {
      sel.innerHTML = '<option value="25">25yd (SCY)</option>';
    } else {
      sel.innerHTML = `
        <option value="25">25m (short course)</option>
        <option value="50">50m (long course)</option>
      `;
    }
  }

  function _rebuildDistanceOptions(pool) {
    const unit  = document.getElementById('unit').value;
    const isYards = unit === 'yards';
    const sel   = document.getElementById('lap-distance');
    const dists = isYards
      ? (VALID_DISTANCES_YD[pool] || VALID_DISTANCES_YD[25])
      : (VALID_DISTANCES[pool] || VALID_DISTANCES[25]);
    const suffix = isYards ? 'yd' : 'm';
    sel.innerHTML = dists.map(d => `<option value="${d}">${d}${suffix}</option>`).join('');
    if (dists.includes(50)) sel.value = '50';
    _filterDistancesForStroke(document.getElementById('stroke')?.value || 'freestyle');
  }

  function _filterDistancesForStroke(stroke) {
    const pool    = +document.getElementById('pool-length').value;
    const sel     = document.getElementById('lap-distance');
    // IM minimum is 4 lengths (100m or 100yd)
    const imMin   = 4 * pool;
    Array.from(sel.options).forEach(opt => {
      const d = +opt.value;
      opt.disabled = stroke === 'im'
        ? (d < imMin || (d / pool) % 4 !== 0)
        : false;
    });
    if (sel.selectedOptions[0]?.disabled) {
      for (const opt of sel.options) {
        if (!opt.disabled) { sel.value = opt.value; break; }
      }
    }
  }

  /**
   * Build an inline SVG showing evenly-spaced stroke ticks or kick diamonds
   * for a phase. Returns an <svg> element (or an empty <svg> if no marks).
   *
   * Strokes (swim/approach): short vertical lines  |
   * UW kicks (underwater/pushoff): small diamonds  ◆
   * Breaststroke pullout (1 kick): single wider diamond
   */
  function _buildTickSvg(phase, isRTL) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('preserveAspectRatio', 'none');
    // viewBox width = 1000 units regardless of rendered px width;
    // marks are placed by fraction so they scale correctly.
    const VW = 1000, VH = 14;
    svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);

    const count = phase.strokeCount ?? phase.underwaterKicks ?? 0;
    if (count <= 0) return svg;

    const isKick   = phase.underwaterKicks !== null;
    const isSingle = isKick && count === 1; // breaststroke pullout
    const color    = 'rgba(255,255,255,0.75)';

    // Place marks evenly between 5% and 95% of the width
    const margin = VW * 0.05;
    const usable = VW - margin * 2;

    // For a single mark, centre it
    const positions = count === 1
      ? [VW / 2]
      : Array.from({ length: count }, (_, i) =>
          margin + (i / (count - 1)) * usable
        );

    // Flip order for RTL so ticks read right→left (first stroke on right)
    if (isRTL) positions.reverse();

    for (const x of positions) {
      if (isKick) {
        // Diamond ◆
        const s = isSingle ? 5 : 3.5; // half-size of diamond
        const d = `M${x},${VH/2 - s} L${x+s},${VH/2} L${x},${VH/2 + s} L${x-s},${VH/2} Z`;
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', color);
        svg.appendChild(path);
      } else {
        // Vertical stroke tick  |
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', x); line.setAttribute('x2', x);
        line.setAttribute('y1', 2); line.setAttribute('y2', VH - 2);
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', '18');
        line.setAttribute('stroke-linecap', 'round');
        svg.appendChild(line);
      }
    }

    return svg;
  }

  function _buildLegend() {
    const legend = document.getElementById('phase-legend');
    for (const [type, color] of Object.entries(PHASE_COLORS)) {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `<div class="legend-dot" style="background:${color}"></div>${PHASE_LABELS[type].long}`;
      legend.appendChild(item);
    }
  }

  return {
    init,
    renderTimeline,
    highlightActivePhase,
    updateDot,
    updateTimeDisplay,
    setPlayPauseState,
  };
})();

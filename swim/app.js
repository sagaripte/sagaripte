'use strict';

const AppV2 = (() => {
  const state = {
    compare: null,
    isYards: true,
    segmentLayout: new Map(),
    playing: false,
    speed: 1,
    elapsed: 0,
    rafId: null,
    lastTick: null,
  };

  const els = {};

  function init() {
    els.form = document.getElementById('sim-form');
    els.unit = document.getElementById('unit');
    els.poolLength = document.getElementById('pool-length');
    els.lapDistance = document.getElementById('lap-distance');
    els.stroke = document.getElementById('stroke');
    els.gender = document.getElementById('gender');
    els.ageGroup = document.getElementById('age-group');
    els.preset = document.getElementById('time-preset');
    els.idealTime = document.getElementById('ideal-time');
    els.actualTime = document.getElementById('actual-time');
    els.playPause = document.getElementById('play-pause');
    els.reset = document.getElementById('reset');
    els.speed = document.getElementById('speed');
    els.timeReadout = document.getElementById('time-readout');
    els.warning = document.getElementById('warning');
    els.summary = document.getElementById('summary');
    els.lanes = document.getElementById('lanes');

    bindEvents();
    rebuildPoolOptions();
    rebuildDistanceOptions();
    rebuildPresetOptions();
    applyPreset();
    setTimeReadout(0, 0, 0);
  }

  function bindEvents() {
    els.unit.addEventListener('change', () => {
      rebuildPoolOptions();
      rebuildDistanceOptions();
      applyPreset();
    });

    els.poolLength.addEventListener('change', () => {
      rebuildDistanceOptions();
      applyPreset();
    });

    els.stroke.addEventListener('change', () => {
      filterDistancesForStroke();
      applyPreset();
    });

    els.gender.addEventListener('change', applyPreset);
    els.ageGroup.addEventListener('change', () => {
      rebuildPresetOptions();
      applyPreset();
    });

    els.lapDistance.addEventListener('change', applyPreset);
    els.preset.addEventListener('change', applyPreset);

    els.idealTime.addEventListener('input', () => {
      els.preset.value = 'custom';
    });

    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      runSimulation();
    });

    els.playPause.addEventListener('click', togglePlayPause);
    els.reset.addEventListener('click', resetPlayback);
    els.speed.addEventListener('change', () => {
      state.speed = Number(els.speed.value);
    });
  }

  function rebuildPoolOptions() {
    if (els.unit.value === 'yards') {
      els.poolLength.innerHTML = '<option value="25">25yd (SCY)</option>';
      return;
    }

    els.poolLength.innerHTML = [
      '<option value="25">25m (SCM)</option>',
      '<option value="50">50m (LCM)</option>',
    ].join('');
  }

  function rebuildDistanceOptions() {
    const isYards = els.unit.value === 'yards';
    const pool = Number(els.poolLength.value);
    const source = isYards ? VALID_DISTANCES_YD : VALID_DISTANCES;
    const dists = source[pool] || source[25];
    const unitLabel = isYards ? 'yd' : 'm';

    els.lapDistance.innerHTML = dists.map((d) => `<option value="${d}">${d}${unitLabel}</option>`).join('');
    if (dists.includes(50)) {
      els.lapDistance.value = '50';
    }

    filterDistancesForStroke();
  }

  function filterDistancesForStroke() {
    const stroke = els.stroke.value;
    const pool = Number(els.poolLength.value);
    const minIM = 4 * pool;

    for (const option of els.lapDistance.options) {
      const d = Number(option.value);
      option.disabled = stroke === 'im' ? d < minIM || ((d / pool) % 4 !== 0) : false;
    }

    if (els.lapDistance.selectedOptions[0]?.disabled) {
      const firstEnabled = [...els.lapDistance.options].find((o) => !o.disabled);
      if (firstEnabled) {
        els.lapDistance.value = firstEnabled.value;
      }
    }
  }

  function applyPreset() {
    if (els.preset.value === 'custom') return;

    const isYards = els.unit.value === 'yards';
    const stroke = els.stroke.value;
    const distance = Number(els.lapDistance.value);
    const gender = els.gender.value;
    const ageGroup = els.ageGroup.value;
    let ref = null;

    if (ageGroup !== 'open') {
      if (!isYards) return;
      ref = AGE_GROUP_TIMES_SCY[gender]?.[ageGroup]?.[stroke]?.[distance];
    } else {
      const table = isYards ? REFERENCE_TIMES_YD : REFERENCE_TIMES;
      ref = table[stroke]?.[distance];
    }

    if (ref?.[els.preset.value] != null) {
      const ideal = ref[els.preset.value];
      els.idealTime.value = ideal.toFixed(2);
      if (!els.actualTime.value || Number(els.actualTime.value) <= 0) {
        els.actualTime.value = (ideal * 1.08).toFixed(2);
      }
    }
  }

  function rebuildPresetOptions() {
    const ageGroup = els.ageGroup.value;
    const current = els.preset.value;

    if (ageGroup === 'open') {
      els.preset.innerHTML = [
        '<option value="silver">Silver</option>',
        '<option value="gold">Gold</option>',
        '<option value="wr">World Record</option>',
        '<option value="custom">Custom</option>',
      ].join('');
      els.preset.value = ['silver', 'gold', 'wr', 'custom'].includes(current) ? current : 'gold';
      return;
    }

    els.preset.innerHTML = [
      '<option value="a">A Cut</option>',
      '<option value="bb">BB Cut</option>',
      '<option value="b">B Cut</option>',
      '<option value="custom">Custom</option>',
    ].join('');
    els.preset.value = ['a', 'bb', 'b', 'custom'].includes(current) ? current : 'b';
  }

  function runSimulation() {
    const isYards = els.unit.value === 'yards';
    const poolLengthU = Number(els.poolLength.value);
    const lapDistanceU = Number(els.lapDistance.value);
    const stroke = els.stroke.value;

    const poolLengthM = isYards ? poolLengthU * YD_TO_M : poolLengthU;
    const lapDistanceM = isYards ? lapDistanceU * YD_TO_M : lapDistanceU;
    const maxUWFromWallM = isYards ? 15 * YD_TO_M : 15;

    let idealTime = Number(els.idealTime.value);
    let actualTime = Number(els.actualTime.value);

    if (!Number.isFinite(actualTime) || actualTime <= 0) {
      actualTime = idealTime * 1.08;
      els.actualTime.value = actualTime.toFixed(2);
    }

    const floor = isYards ? null : MIN_TIME_FLOOR[stroke]?.[lapDistanceU];
    const warnings = [];
    if (floor && idealTime < floor) {
      idealTime = floor;
      els.idealTime.value = idealTime.toFixed(2);
      warnings.push('Ideal');
    }
    if (floor && actualTime < floor) {
      actualTime = floor;
      els.actualTime.value = actualTime.toFixed(2);
      warnings.push('Your');
    }

    if (warnings.length) {
      els.warning.hidden = false;
      els.warning.textContent = `${warnings.join(' and ')} time clamped to minimum reference.`;
    } else {
      els.warning.hidden = true;
    }

    const ideal = PhaseModel.compute({
      poolLength: poolLengthM,
      lapDistance: lapDistanceM,
      stroke,
      idealTime,
      maxUWFromWallM,
    });
    const actual = PhaseModel.compute({
      poolLength: poolLengthM,
      lapDistance: lapDistanceM,
      stroke,
      idealTime: actualTime,
      maxUWFromWallM,
    });

    state.compare = { ideal, actual, poolLengthM, poolLengthU, isYards };
    state.isYards = isYards;
    state.elapsed = 0;
    state.playing = false;
    state.lastTick = null;

    renderSummary(state.compare, isYards);
    renderLanes(state.compare, poolLengthU);
    setPlayButton();
    setTimeReadout(0, actual.totalTime, ideal.totalTime);
    updateActiveView();
  }

  function renderSummary(compare, isYards) {
    const { ideal, actual } = compare;
    const delta = actual.totalTime - ideal.totalTime;
    const deltaSign = delta > 0 ? '+' : '';
    const unit = isYards ? 'yd' : 'm';
    const paceRefM = isYards ? 100 * YD_TO_M : 100;

    const idealPace = (ideal.totalTime / ideal.totalDistance) * paceRefM;
    const actualPace = (actual.totalTime / actual.totalDistance) * paceRefM;

    const cards = [
      ['Ideal Time', `${ideal.totalTime.toFixed(2)}s`],
      ['Your Time', `${actual.totalTime.toFixed(2)}s`],
      ['Delta', `${deltaSign}${delta.toFixed(2)}s`],
      ['Distance', `${toDisplayDistance(actual.totalDistance, isYards).toFixed(0)}${unit}`],
      [`Ideal Pace / 100${unit}`, `${idealPace.toFixed(2)}s`],
      [`Your Pace / 100${unit}`, `${actualPace.toFixed(2)}s`],
    ];

    els.summary.classList.remove('empty');
    els.summary.innerHTML = cards.map(([k, v]) => (
      `<div class="summary-card"><div class="k">${k}</div><div class="v">${v}</div></div>`
    )).join('');
  }

  function renderLanes(compare, poolLengthU) {
    const { ideal, actual, isYards } = compare;
    const idealByLength = groupByLength(ideal.phases);
    const actualByLength = groupByLength(actual.phases);
    state.segmentLayout = new Map();
    const unitLabel = isYards ? 'yd' : 'm';
    const tickStep = poolLengthU > 25 ? 10 : 5;

    els.lanes.innerHTML = idealByLength.map((idealLengthPhases, idx) => {
      const actualLengthPhases = actualByLength[idx] || [];
      const direction = idx % 2 === 0 ? 'Left to Right' : 'Right to Left';
      const isRTL = idx % 2 === 1;
      const strokeKey = idealLengthPhases[0].stroke;
      const markerHtml = buildPoolMarkers(poolLengthU, tickStep, unitLabel, isRTL);
      const fixedMarksHtml = buildFixedMarks(poolLengthU, strokeKey);

      const idealLengthTime = idealLengthPhases.reduce((sum, p) => sum + p.durationS, 0);
      const actualLengthTime = actualLengthPhases.reduce((sum, p) => sum + p.durationS, 0);
      const lengthDelta = actualLengthTime - idealLengthTime;
      const deltaSign = lengthDelta > 0 ? '+' : '';

      const idealSegments = buildTrackSegments(idealLengthPhases, idx, isYards, 'ideal', compare.poolLengthM);
      const actualSegments = buildTrackSegments(actualLengthPhases, idx, isYards, 'actual', compare.poolLengthM);

      return `
        <article class="length-row" data-length="${idx}">
          <div class="length-meta">
            <span>Length ${idx + 1} · ${STROKE_CONSTANTS[strokeKey]?.label || strokeKey}</span>
            <span>${direction} · Δ ${deltaSign}${lengthDelta.toFixed(2)}s</span>
          </div>
          <div class="pool-context">
            <div class="pool-scale">${markerHtml}</div>
            <div class="tracks-compare">
              <div class="track-line-header"><span>Ideal ${idealLengthTime.toFixed(2)}s</span></div>
              <div class="track-wrap">
                <div class="pole left"></div>
                <div class="track ideal-track" data-track="ideal-${idx}">
                  ${fixedMarksHtml}
                  <div class="wall left"></div>
                  ${idealSegments}
                  <div class="wall right"></div>
                  <div class="swimmer" data-swimmer="ideal-${idx}"></div>
                </div>
                <div class="pole right"></div>
              </div>

              <div class="track-line-header"><span>You ${actualLengthTime.toFixed(2)}s</span></div>
              <div class="track-wrap">
                <div class="pole left"></div>
                <div class="track actual-track" data-track="actual-${idx}">
                  ${fixedMarksHtml}
                  <div class="wall left"></div>
                  ${actualSegments}
                  <div class="wall right"></div>
                  <div class="swimmer" data-swimmer="actual-${idx}"></div>
                </div>
                <div class="pole right"></div>
              </div>
            </div>
            <div class="rope rope-top"></div>
            <div class="rope rope-bottom"></div>
          </div>
        </article>
      `;
    }).join('');
  }

  function buildTrackSegments(lengthPhases, lengthIndex, isYards, mode, poolLengthM) {
    const visualPhases = lengthIndex % 2 === 0 ? lengthPhases : [...lengthPhases].reverse();
    const turnCount = lengthPhases.filter((p) => p.distanceM === 0).length;
    const turnWidth = turnCount ? 2 : 0;
    const adjustedDistances = adjustPhaseDistances(lengthPhases, poolLengthM);
    const availableWidth = 100 - turnCount * turnWidth;
    let cursor = 0;

    return visualPhases.map((p) => {
      const dist = adjustedDistances.get(p.id) || 0;
      const width = dist > 0 ? (dist / poolLengthM) * availableWidth : turnWidth;
      const key = `${mode}:${p.id}`;
      state.segmentLayout.set(key, {
        mode,
        lengthIndex,
        startPct: cursor,
        widthPct: width,
        direction: p.direction,
      });
      cursor += width;

      return `
        <div class="phase-seg" data-id="${key}" style="width:${width}%;background:${p.color};">
          <span class="phase-name-inline">${p.labelShort}</span>
          <span class="phase-meta-inline">${segmentMeta(p, isYards)}</span>
        </div>
      `;
    }).join('');
  }

  function adjustPhaseDistances(lengthPhases, poolLengthM) {
    const adjusted = new Map(lengthPhases.map((p) => [p.id, Math.max(0, p.distanceM)]));
    const nonZero = lengthPhases.filter((p) => p.distanceM > 0);
    const sumDist = nonZero.reduce((sum, p) => sum + p.distanceM, 0);
    const diff = poolLengthM - sumDist;
    if (Math.abs(diff) < 0.0001 || nonZero.length === 0) return adjusted;

    const swimPhase = nonZero.find((p) => p.type === 'swim') || nonZero[nonZero.length - 1];
    const current = adjusted.get(swimPhase.id) || 0;
    adjusted.set(swimPhase.id, Math.max(0, current + diff));
    return adjusted;
  }

  function buildPoolMarkers(poolLengthU, tickStep, unitLabel, isRTL) {
    let out = '';
    for (let d = 0; d <= poolLengthU; d += tickStep) {
      const pct = (d / poolLengthU) * 100;
      const labelDist = isRTL ? (poolLengthU - d) : d;
      const cls = d === 0 ? 'start' : d === poolLengthU ? 'end' : '';
      out += `
        <span class="pool-marker ${cls}" style="left:${pct}%">
          <i></i>
          <em>${Math.round(labelDist)}${unitLabel}</em>
        </span>
      `;
    }
    return out;
  }

  function buildFixedMarks(poolLengthU, strokeKey) {
    const fiveFromWall = Math.min(5, poolLengthU / 2);
    const first = (fiveFromWall / poolLengthU) * 100;
    const second = 100 - first;
    const center = 50;
    const flagsClass = strokeKey === 'backstroke' ? 'fixed-mark flags emphasis' : 'fixed-mark flags muted';
    return `
      <span class="${flagsClass}" style="left:${first}%"></span>
      <span class="fixed-mark center" style="left:${center}%"></span>
      <span class="${flagsClass}" style="left:${second}%"></span>
    `;
  }

  function segmentMeta(phase, isYards) {
    const unit = isYards ? 'yd/s' : 'm/s';
    if (phase.strokeCount != null) return `${phase.durationS.toFixed(1)}s · ${phase.strokeCount} strokes`;
    if (phase.underwaterKicks != null) return `${phase.durationS.toFixed(1)}s · ${phase.underwaterKicks} kicks`;
    if (phase.turnTime != null) return `${phase.turnTime.toFixed(2)}s wall`;
    if (phase.speed != null) return `${phase.durationS.toFixed(1)}s · ${toDisplaySpeed(phase.speed, isYards).toFixed(2)} ${unit}`;
    return `${phase.durationS.toFixed(1)}s`;
  }

  function togglePlayPause() {
    if (!state.compare) return;

    state.playing = !state.playing;
    setPlayButton();

    if (state.playing) {
      state.lastTick = performance.now();
      if (state.rafId) cancelAnimationFrame(state.rafId);
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function resetPlayback() {
    if (!state.compare) return;

    state.playing = false;
    state.elapsed = 0;
    state.lastTick = null;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    setPlayButton();
    setTimeReadout(0, state.compare.actual.totalTime, state.compare.ideal.totalTime);
    updateActiveView();
  }

  function tick(now) {
    if (!state.playing || !state.compare) return;

    const deltaS = (now - (state.lastTick || now)) / 1000;
    state.lastTick = now;
    state.elapsed += deltaS * state.speed;

    const maxTime = Math.max(state.compare.ideal.totalTime, state.compare.actual.totalTime);
    if (state.elapsed >= maxTime) {
      state.elapsed = maxTime;
      state.playing = false;
      setPlayButton();
    }

    setTimeReadout(state.elapsed, state.compare.actual.totalTime, state.compare.ideal.totalTime);
    updateActiveView();

    if (state.playing) {
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function updateActiveView() {
    if (!state.compare) return;

    document.querySelectorAll('.phase-seg.active').forEach((el) => {
      el.classList.remove('active');
    });

    const idealPhase = getPhaseAt(state.compare.ideal, state.elapsed);
    const actualPhase = getPhaseAt(state.compare.actual, state.elapsed);

    if (idealPhase) {
      const key = `ideal:${idealPhase.id}`;
      document.querySelector(`.phase-seg[data-id="${key}"]`)?.classList.add('active');
      positionSwimmer('ideal', idealPhase);
    }

    if (actualPhase) {
      const key = `actual:${actualPhase.id}`;
      document.querySelector(`.phase-seg[data-id="${key}"]`)?.classList.add('active');
      positionSwimmer('actual', actualPhase);
    }
  }

  function positionSwimmer(mode, phase) {
    document.querySelectorAll(`.swimmer[data-swimmer^="${mode}-"]`).forEach((d) => {
      d.style.display = 'none';
    });

    if (phase.type === 'turn' && phase.lengthIndex > 0) {
      const prevLane = phase.lengthIndex - 1;
      const dotPrev = document.querySelector(`.swimmer[data-swimmer="${mode}-${prevLane}"]`);
      if (!dotPrev) return;
      const prevDir = prevLane % 2 === 0 ? 1 : -1;
      dotPrev.style.left = prevDir === 1 ? '100%' : '0%';
      dotPrev.style.display = 'block';
      return;
    }

    const key = `${mode}:${phase.id}`;
    const layout = state.segmentLayout.get(key);
    const dot = document.querySelector(`.swimmer[data-swimmer="${mode}-${phase.lengthIndex}"]`);
    if (!layout || !dot) return;

    const phaseElapsed = Math.min(state.elapsed, phase.timeEnd) - phase.timeStart;
    const inPhase = phase.durationS > 0 ? Math.max(0, Math.min(1, phaseElapsed / phase.durationS)) : 0;
    const phaseProgress = layout.direction === -1 ? 1 - inPhase : inPhase;
    const posPct = layout.startPct + layout.widthPct * phaseProgress;

    dot.style.left = `${Math.max(0, Math.min(100, posPct))}%`;
    dot.style.display = 'block';
  }

  function setPlayButton() {
    els.playPause.textContent = state.playing ? 'Pause' : 'Play';
  }

  function setTimeReadout(current, actualTotal, idealTotal) {
    const c = current.toFixed(2);
    const a = actualTotal.toFixed(2);
    const i = idealTotal.toFixed(2);
    els.timeReadout.textContent = `${c}s / ${a}s (Ideal ${i}s)`;
  }

  function getPhaseAt(result, t) {
    const tt = Math.min(t, result.totalTime);
    for (const p of result.phases) {
      if (tt >= p.timeStart && tt <= p.timeEnd) return p;
    }
    return result.phases[result.phases.length - 1] || null;
  }

  function groupByLength(phases) {
    const grouped = [];
    for (const p of phases) {
      if (!grouped[p.lengthIndex]) grouped[p.lengthIndex] = [];
      grouped[p.lengthIndex].push(p);
    }
    return grouped;
  }

  function toDisplayDistance(meters, isYards) {
    return isYards ? meters * M_TO_YD : meters;
  }

  function toDisplaySpeed(mps, isYards) {
    return isYards ? mps * M_TO_YD : mps;
  }

  return { init };
})();

window.addEventListener('DOMContentLoaded', AppV2.init);

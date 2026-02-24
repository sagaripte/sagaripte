'use strict';

/**
 * Renderer — top-down lane view on a <canvas>.
 *
 * Two layers:
 *   1. Static lane cache (offscreen canvas) — pool, ropes, walls, flagpoles, ruler.
 *      Built once on simulate, rebuilt on resize. Never changes during animation.
 *
 *   2. Per-frame dynamic layer — drawn every rAF on top of the static lane:
 *        a. Current phase highlight band (color + label) at swimmer's position
 *        b. Animated swimmer icon
 *        c. Elapsed time counter
 */
const Renderer = (() => {

  // ── Layout constants ────────────────────────────────────────
  const LANE_TOP     = 38;
  const LANE_BOTTOM  = 122;
  const LANE_HEIGHT  = LANE_BOTTOM - LANE_TOP;
  const LANE_MID     = (LANE_TOP + LANE_BOTTOM) / 2;
  const ROPE_TOP     = LANE_TOP;
  const ROPE_BOT     = LANE_BOTTOM;
  const RULER_Y      = 148;      // meter tick label baseline
  const FLAG_ABOVE   = 14;       // px above lane top for flag line
  const FLAG_HEIGHT  = 20;       // total height of flag pole inside lane

  // Phase highlight band: how many px wide around the swimmer
  const BAND_HALF_W  = 28;

  // Easing
  const ease = {
    outCubic:  t => 1 - Math.pow(1 - t, 3),
    inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
    outQuart:  t => 1 - Math.pow(1 - t, 4),
    inQuad:    t => t * t,
    linear:    t => t,
  };

  let canvas, ctx;
  let laneCache = null;   // offscreen canvas — static lane graphics
  let _totalDistance = 0;
  let _poolLength    = 0;
  let _numLengths    = 0;

  // ── Public API ──────────────────────────────────────────────

  function init(canvasEl) {
    canvas = canvasEl;
    ctx    = canvasEl.getContext('2d');
  }

  /**
   * Build the static lane background. Call after simulate and after resize.
   * Does NOT bake phase zones — those are drawn dynamically each frame.
   */
  function buildLaneCache(totalDistance, poolLength) {
    _totalDistance = totalDistance;
    _poolLength    = poolLength;
    _numLengths    = Math.round(totalDistance / poolLength);

    const w = canvas.width;
    const h = canvas.height;

    laneCache        = document.createElement('canvas');
    laneCache.width  = w;
    laneCache.height = h;
    const c = laneCache.getContext('2d');

    // ── Pool water fill ──────────────────────────────────────
    const grad = c.createLinearGradient(0, LANE_TOP, 0, LANE_BOTTOM);
    grad.addColorStop(0,   '#041830');
    grad.addColorStop(0.45,'#072e52');
    grad.addColorStop(1,   '#041830');
    c.fillStyle = grad;
    c.fillRect(0, LANE_TOP, w, LANE_HEIGHT);

    // ── Center black stripe ──────────────────────────────────
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.fillRect(0, LANE_MID - 3, w, 6);

    // ── T-marks at each wall (crossbar at end of center stripe) ─
    for (let wi = 0; wi <= _numLengths; wi++) {
      const wx = m2px(wi * poolLength, w);
      c.fillStyle = 'rgba(0,0,0,0.55)';
      // Horizontal crossbar of the T
      c.fillRect(wx - 6, LANE_MID - 3, 12, 6);
    }

    // ── Lane ropes (top and bottom) ──────────────────────────
    const ropeYs = [ROPE_TOP, ROPE_BOT];
    for (const ry of ropeYs) {
      // Rope line
      c.strokeStyle = '#1d4a6a';
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, ry); c.lineTo(w, ry); c.stroke();

      // Float buoys — alternate cyan / red every 24px
      const floatColors = ['#00bcd4', '#e53935'];
      const FLOAT_R  = 5;
      const FLOAT_GAP = 24;
      for (let fx = FLOAT_GAP / 2; fx < w; fx += FLOAT_GAP) {
        const fi = Math.floor(fx / FLOAT_GAP);
        c.fillStyle = floatColors[fi % 2];
        c.beginPath();
        c.arc(fx, ry, FLOAT_R, 0, Math.PI * 2);
        c.fill();
        // Highlight on float
        c.fillStyle = 'rgba(255,255,255,0.25)';
        c.beginPath();
        c.arc(fx - 1, ry - 1.5, FLOAT_R * 0.45, 0, Math.PI * 2);
        c.fill();
      }
    }

    // ── Solid end walls ──────────────────────────────────────
    for (const wx of [0, w]) {
      const wallW = 5;
      const x = wx === 0 ? 0 : w - wallW;
      c.fillStyle = '#b0bec5';
      c.fillRect(x, LANE_TOP - 2, wallW, LANE_HEIGHT + 4);
      // Tile grout lines on wall
      c.strokeStyle = 'rgba(0,0,0,0.3)';
      c.lineWidth = 1;
      for (let ty = LANE_TOP; ty < LANE_BOTTOM; ty += 8) {
        c.beginPath(); c.moveTo(x, ty); c.lineTo(x + wallW, ty); c.stroke();
      }
    }

    // ── Turn walls at pool-length boundaries ─────────────────
    for (let wi = 1; wi < _numLengths; wi++) {
      const wx = m2px(wi * poolLength, w);
      // Solid wall band
      c.fillStyle = '#78909c';
      c.fillRect(wx - 2, LANE_TOP - 2, 4, LANE_HEIGHT + 4);
      // Grout
      c.strokeStyle = 'rgba(0,0,0,0.25)';
      c.lineWidth = 0.5;
      for (let ty = LANE_TOP; ty < LANE_BOTTOM; ty += 8) {
        c.beginPath(); c.moveTo(wx - 2, ty); c.lineTo(wx + 2, ty); c.stroke();
      }
    }

    // ── Backstroke flag poles (5m before each wall) ──────────
    // A horizontal rope spans the lane width; flag triangles hang from it
    for (let wi = 0; wi <= _numLengths; wi++) {
      const flagM = wi * poolLength - 5;
      if (flagM < 0 || flagM >= totalDistance) continue;
      const fx = m2px(flagM, w);

      // Vertical poles at lane edges (above and below lane)
      c.strokeStyle = '#ffd740';
      c.lineWidth   = 2;
      // Top pole
      c.beginPath();
      c.moveTo(fx, ROPE_TOP - FLAG_ABOVE);
      c.lineTo(fx, ROPE_TOP + FLAG_HEIGHT * 0.4);
      c.stroke();
      // Bottom pole
      c.beginPath();
      c.moveTo(fx, ROPE_BOT - FLAG_HEIGHT * 0.4);
      c.lineTo(fx, ROPE_BOT + FLAG_ABOVE);
      c.stroke();

      // Horizontal rope across the lane (dashed)
      c.strokeStyle = '#ffd740aa';
      c.lineWidth   = 1;
      c.setLineDash([4, 3]);
      c.beginPath();
      c.moveTo(fx, ROPE_TOP + 4);
      c.lineTo(fx, ROPE_BOT - 4);
      c.stroke();
      c.setLineDash([]);

      // Small flag triangles on the rope
      const flagColors = ['#ffd740', '#e53935', '#ffd740', '#e53935'];
      const numFlags = 3;
      for (let fi = 0; fi < numFlags; fi++) {
        const fy = ROPE_TOP + (LANE_HEIGHT / (numFlags + 1)) * (fi + 1);
        c.fillStyle = flagColors[fi % flagColors.length];
        c.beginPath();
        c.moveTo(fx - 6, fy - 5);
        c.lineTo(fx + 6, fy - 5);
        c.lineTo(fx,     fy + 4);
        c.closePath();
        c.fill();
      }

      // "5m" label above top pole
      c.fillStyle = '#ffd740bb';
      c.font = '8px Courier New, monospace';
      c.textAlign = 'center';
      c.fillText('5m', fx, ROPE_TOP - FLAG_ABOVE - 2);
    }

    // ── Meter ruler ticks below the lane ─────────────────────
    c.textAlign = 'center';
    for (let m = 0; m <= totalDistance; m += 5) {
      const rx      = m2px(m, w);
      const isMajor = m % 25 === 0;
      const tickH   = isMajor ? 10 : 5;
      c.strokeStyle = isMajor ? 'rgba(0,172,193,0.7)' : 'rgba(0,172,193,0.35)';
      c.lineWidth   = isMajor ? 1.5 : 0.75;
      c.beginPath();
      c.moveTo(rx, LANE_BOTTOM + 2);
      c.lineTo(rx, LANE_BOTTOM + 2 + tickH);
      c.stroke();
      if (isMajor) {
        c.fillStyle = 'rgba(0,172,193,0.75)';
        c.font      = '9px Courier New, monospace';
        c.fillText(m + 'm', rx, RULER_Y);
      }
    }
  }

  /**
   * Draw one animation frame.
   * @param {number}   simTime       - current simulation time (seconds)
   * @param {Phase[]}  phases        - full phases array from PhaseModel
   * @param {number}   totalDistance - lap distance in meters
   */
  function draw(simTime, phases, totalDistance) {
    if (!ctx || !laneCache) return;
    const w = canvas.width;
    const h = canvas.height;

    // 1. Restore static lane
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(laneCache, 0, 0);

    // 2. Find current phase and swimmer position
    const phase = _getPhaseAt(simTime, phases);
    if (!phase) return;
    const swimX = _computeSwimmerX(simTime, phase, w, totalDistance);

    // 3. Phase highlight band — a glowing column at the swimmer's x
    _drawPhaseBand(swimX, phase, w);

    // 4. Swimmer icon
    _drawSwimmer(swimX, phase, simTime);

    // 5. Phase label pill above swimmer
    _drawPhaseLabel(swimX, phase, w);

    // 6. Elapsed time (top-right)
    ctx.fillStyle = 'rgba(0,229,255,0.9)';
    ctx.font = 'bold 13px Courier New, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(simTime.toFixed(2) + 's', w - 8, 16);
  }

  // ── Internal: phase band ────────────────────────────────────

  function _drawPhaseBand(cx, phase, canvasW) {
    const bandW = BAND_HALF_W * 2;
    const x     = Math.max(0, cx - BAND_HALF_W);
    const clampedW = Math.min(bandW, canvasW - x);

    // Soft radial glow
    const grad = ctx.createLinearGradient(x, 0, x + clampedW, 0);
    grad.addColorStop(0,   phase.color + '00');
    grad.addColorStop(0.3, phase.color + '55');
    grad.addColorStop(0.5, phase.color + 'aa');
    grad.addColorStop(0.7, phase.color + '55');
    grad.addColorStop(1,   phase.color + '00');
    ctx.fillStyle = grad;
    ctx.fillRect(x, LANE_TOP, clampedW, LANE_HEIGHT);

    // Thin bright center line
    ctx.strokeStyle = phase.color + 'cc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, LANE_TOP);
    ctx.lineTo(cx, LANE_BOTTOM);
    ctx.stroke();
  }

  // ── Internal: swimmer position ──────────────────────────────

  function _computeSwimmerX(t, phase, canvasW, totalDistance) {
    const td = totalDistance || _totalDistance;
    if (phase.type === 'turn') {
      return m2px(phase.distanceStart, canvasW, td);
    }
    const pt = phase.durationS > 0
      ? Math.max(0, Math.min(1, (t - phase.timeStart) / phase.durationS))
      : 0;

    let ep;
    switch (phase.type) {
      case 'dive':       ep = ease.outCubic(pt);  break;
      case 'underwater': ep = ease.inOutSine(pt); break;
      case 'pushoff':    ep = ease.outQuart(pt);  break;
      case 'finish':     ep = ease.inQuad(pt);    break;
      default:           ep = ease.linear(pt);    break;
    }
    return m2px(phase.distanceStart + ep * phase.distanceM, canvasW, td);
  }

  // ── Internal: swimmer drawing ───────────────────────────────

  function _drawSwimmer(x, phase, simTime) {
    const dir      = phase.direction;
    const isUW     = phase.type === 'underwater' || phase.type === 'pushoff';
    const isTurn   = phase.type === 'turn';
    const sc       = STROKE_CONSTANTS[phase.stroke] || STROKE_CONSTANTS.freestyle;
    const strokeKey = phase.stroke;

    ctx.save();
    ctx.translate(x, LANE_MID);

    // Rotation during turn (flip 180° over turn duration)
    if (isTurn && phase.durationS > 0) {
      const pt = Math.max(0, Math.min(1, (simTime - phase.timeStart) / phase.durationS));
      ctx.rotate(dir * pt * Math.PI);
    }

    // Mirror for right→left lengths
    if (dir === -1) ctx.scale(-1, 1);

    // Shadow / wake glow
    ctx.shadowColor = phase.color;
    ctx.shadowBlur  = 8;

    // Body — horizontal ellipse
    ctx.fillStyle = '#ffe082';
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Swim cap
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.arc(13, 0, 7, -Math.PI / 2, Math.PI / 2);
    ctx.fill();

    // Goggle glint
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(14, -2, 2, 0, Math.PI * 2);
    ctx.fill();

    // Arms / legs
    ctx.strokeStyle = '#ffe082';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';

    if (isUW) {
      _drawStreamline();
    } else {
      _drawStrokeArms(strokeKey, sc, simTime - phase.timeStart);
    }

    ctx.restore();
  }

  function _drawStreamline() {
    // Arms outstretched forward
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(26, 0); ctx.stroke();
    // Legs streamlined back
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-24, -3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-24,  3); ctx.stroke();
  }

  function _drawStrokeArms(strokeKey, sc, timeInPhase) {
    const freq  = sc.strokeRate / 60;
    const angle = timeInPhase * freq * Math.PI * 2;

    switch (strokeKey) {
      case 'breaststroke': {
        const sweep  = Math.sin(angle) * 0.8 + 0.2;
        const spread = sweep * 18;
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(8 + spread * 0.5, -spread * 0.6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(8 + spread * 0.5,  spread * 0.6); ctx.stroke();
        const kick = Math.abs(Math.sin(angle)) * 6;
        ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-22, -3 - kick); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-22,  3 + kick); ctx.stroke();
        break;
      }
      case 'butterfly': {
        const aa   = Math.sin(angle) * 0.9;
        const armY = aa * 14;
        ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(22,  armY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(22, -armY); ctx.stroke();
        const dk = Math.sin(angle + Math.PI / 2) * 8;
        ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-24, dk); ctx.stroke();
        break;
      }
      case 'backstroke': {
        const a1 = Math.sin(angle) * 20;
        const a2 = Math.sin(angle + Math.PI) * 20;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(18, a1 * 0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(18, a2 * 0.5); ctx.stroke();
        break;
      }
      default: { // freestyle
        const a1 = Math.sin(angle);
        const a2 = Math.sin(angle + Math.PI);
        ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(18 + a1 * 4, a1 * 14); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(18 + a2 * 4, a2 * 14); ctx.stroke();
        const k = Math.sin(angle * 2);
        ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-24,  k * 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-24, -k * 7); ctx.stroke();
        break;
      }
    }
  }

  // ── Internal: phase label ───────────────────────────────────

  function _drawPhaseLabel(x, phase, canvasW) {
    const strokeLabel = STROKE_CONSTANTS[phase.stroke]?.label || phase.stroke;
    const text = (phase.type === 'swim' || phase.type === 'approach')
      ? `${strokeLabel} · ${phase.labelShort}`
      : phase.labelShort;

    const labelY   = LANE_TOP - 10;
    const clampedX = Math.max(36, Math.min(canvasW - 36, x));

    ctx.save();
    ctx.font = 'bold 10px Courier New, monospace';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(text).width + 14;

    // Background pill
    ctx.fillStyle = phase.color + 'dd';
    ctx.beginPath();
    ctx.roundRect(clampedX - tw / 2, labelY - 9, tw, 14, 4);
    ctx.fill();

    ctx.fillStyle = '#000';
    ctx.fillText(text, clampedX, labelY);
    ctx.restore();
  }

  // ── Internal: utilities ─────────────────────────────────────

  function _getPhaseAt(t, phases) {
    for (const p of phases) {
      if (t >= p.timeStart && t <= p.timeEnd) return p;
    }
    return phases[phases.length - 1] || null;
  }

  function m2px(m, canvasW, totalDist) {
    const td = totalDist || _totalDistance;
    return (m / td) * (canvasW || canvas.width);
  }

  // ── Empty pool placeholder ──────────────────────────────────

  function drawEmpty() {
    if (!ctx) return;
    const w = canvas.width;
    ctx.clearRect(0, 0, w, canvas.height);

    const grad = ctx.createLinearGradient(0, LANE_TOP, 0, LANE_BOTTOM);
    grad.addColorStop(0,   '#041830');
    grad.addColorStop(0.5, '#072e52');
    grad.addColorStop(1,   '#041830');
    ctx.fillStyle = grad;
    ctx.fillRect(0, LANE_TOP, w, LANE_HEIGHT);

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, LANE_MID - 3, w, 6);

    // Lane ropes
    for (const ry of [ROPE_TOP, ROPE_BOT]) {
      ctx.strokeStyle = '#1d4a6a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, ry); ctx.lineTo(w, ry); ctx.stroke();
    }

    ctx.fillStyle = 'rgba(0,172,193,0.3)';
    ctx.font = '13px Courier New, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Configure inputs above and click Simulate ▶', w / 2, LANE_MID + 5);
  }

  return { init, buildLaneCache, draw, drawEmpty };
})();

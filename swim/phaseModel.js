'use strict';

/**
 * PhaseModel — FINA / World Aquatics race analysis model.
 *
 * Each 50m is broken into three FINA zones:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  Start/Turn zone (15m)  │  Free swimming  │  Approach zone (5m)  │
 *   │  dive/pushoff + UW      │  open water     │  5m to touch-pad     │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * First length:
 *   dive (reaction + entry + UW inside 15m) → swim → approach → turn|finish
 *
 * Middle / last lengths:
 *   turn → pushoff (UW inside 15m) → swim → approach → turn|finish
 *
 * FINA key metrics stored per phase:
 *   split15m   — official 15m zone time
 *   turnTime   — wall contact time (turnContact constant)
 *   strokeRate — SPM in free-swim zone
 *   strokeLen  — m/stroke (distance per stroke cycle)
 *   DPS        — distance per stroke (same as strokeLen)
 *   efficiency — stroke index = speed × strokeLen
 */
const PhaseModel = (() => {

  function compute(input) {
    const { poolLength, lapDistance, stroke, idealTime } = input;
    const numLengths = Math.round(lapDistance / poolLength);
    const budgets    = _computeLengthBudgets(idealTime, numLengths);
    const phases     = [];

    let absDistCursor = 0;
    let absTimeCursor = 0;

    for (let i = 0; i < numLengths; i++) {
      const isFirst   = i === 0;
      const isLast    = i === numLengths - 1;
      const direction = (i % 2 === 0) ? 1 : -1;
      const strokeKey = stroke === 'im'
        ? IM_ORDER[Math.floor(i / (numLengths / 4))]
        : stroke;
      const c      = STROKE_CONSTANTS[strokeKey];
      const budget = budgets[i];

      const lp = _buildLengthPhases(
        i, isFirst, isLast, direction, c, strokeKey,
        budget, poolLength, absDistCursor, absTimeCursor
      );

      lp.forEach(p => phases.push(p));
      absDistCursor += poolLength;
      absTimeCursor += budget;
    }

    return { phases, totalTime: idealTime, totalDistance: lapDistance, lengths: numLengths };
  }

  // ── Length budget (fatigue curve) ─────────────────────────────────────
  /**
   * Models typical pacing: first length fastest, progressive fade.
   * For sprint events (1–2 lengths) use a mild curve; for distance use steeper.
   * Normalized so sum === totalTime exactly.
   */
  function _computeLengthBudgets(totalTime, numLengths) {
    if (numLengths === 1) return [totalTime];

    // Fatigue exponent — steeper for longer races
    const fade = numLengths <= 2 ? 1.06 : numLengths <= 4 ? 1.12 : 1.18;
    const raw  = [];
    for (let i = 0; i < numLengths; i++) {
      const t = i / (numLengths - 1);          // 0 → 1
      raw.push(1 + t * (fade - 1));             // 1.0 → fade
    }
    const rawSum = raw.reduce((a, b) => a + b, 0);
    return raw.map(b => (b / rawSum) * totalTime);
  }

  // ── Per-length phase builder ───────────────────────────────────────────
  /**
   * FINA zone layout for one pool length:
   *
   *  First length:
   *    [dive/UW — 15m zone] [free swim] [approach — 5m] [turn | finish]
   *
   *  Subsequent lengths:
   *    [turn contact] [pushoff/UW — 15m zone] [free swim] [approach — 5m] [turn | finish]
   *
   * Times are derived from distances where possible (UW zones), then the
   * remaining budget is split between free swim and approach proportionally.
   */
  function _buildLengthPhases(lenIdx, isFirst, isLast, direction, c, strokeKey, budget, poolLength, distOff, timeOff) {
    const phases  = [];
    let curDist   = distOff;
    let curTime   = timeOff;
    let budgetUsed = 0;   // tracks how much of 'budget' we've consumed

    // FINA 15m gate — but must leave room for free swim + approach.
    // Cap: at most 45% of the pool (leaves 55% for swim+approach).
    // For short pools (25yd/25m) this gives ~10–11m which is realistic.
    const startZone    = Math.min(c.startZone,    poolLength * 0.45);
    const approachDist = Math.min(c.approachDist, poolLength * 0.10); // 5m cap

    // ── TURN contact (zero distance, fixed time) — inserted BEFORE pushoff ──
    if (!isFirst) {
      const tContact = c.turnContact;
      phases.push(_makePhase('turn', lenIdx, strokeKey, direction,
        curDist, 0, curTime, tContact,
        null, null, null,
        { turnTime: tContact }));
      curTime    += tContact;
      budgetUsed += tContact;
    }

    // ── Start/Turn zone (0–startZone from wall) ──────────────────────────
    if (isFirst) {
      // Dive: air + entry. Cap at 40% of the start zone (leaves room for UW).
      const diveDist = Math.min(c.diveDist, startZone * 0.40);
      const diveTime = diveDist / (c.uwSpeed * 1.3);
      phases.push(_makePhase('dive', lenIdx, strokeKey, direction,
        curDist, diveDist, curTime, diveTime,
        null, null, null,
        { split15m: null }));
      curDist    += diveDist;
      curTime    += diveTime;
      budgetUsed += diveTime;

      // Underwater inside start zone (after dive).
      // Allow up to the full remaining start zone — not capped to startZone - diveDist
      // because diveDist is already inside the zone.
      const uwDist = Math.min(c.uwDist15, startZone - diveDist);
      const uwTime = uwDist / c.uwSpeed;
      phases.push(_makePhase('underwater', lenIdx, strokeKey, direction,
        curDist, uwDist, curTime, uwTime,
        null, null, c.underwaterKicks,
        {}));
      curDist    += uwDist;
      curTime    += uwTime;
      budgetUsed += uwTime;

      // Annotate split at end of start zone
      phases[phases.length - 1].split15m = curTime - timeOff;

    } else {
      // Pushoff + UW inside start zone
      const uwDist = Math.min(c.pushoffUW15, startZone);
      const uwTime = uwDist / c.uwSpeed;
      phases.push(_makePhase('pushoff', lenIdx, strokeKey, direction,
        curDist, uwDist, curTime, uwTime,
        null, null, c.underwaterKicks,
        { split15m: curTime - timeOff + uwTime }));
      curDist    += uwDist;
      curTime    += uwTime;
      budgetUsed += uwTime;
    }

    // ── Remaining budget for free swim + approach (+ finish if last) ──────
    const remaining = budget - budgetUsed;

    // Approach time = proportional slice of remaining, sized by distance ratio
    const freeDist   = Math.max(0, poolLength - startZone - approachDist);
    const totalOpen  = freeDist + approachDist;
    const approachTime = totalOpen > 0
      ? remaining * (approachDist / totalOpen)
      : 0;
    const swimTime = Math.max(0, remaining - approachTime);

    // ── Free swim ─────────────────────────────────────────────────────────
    if (freeDist > 0.5 && swimTime > 0.1) {
      const strokeCount = Math.max(1, Math.round(swimTime * c.strokeRate / 60));
      const cycleRate   = (strokeCount / swimTime) * 60;
      const swimSpeed   = freeDist / swimTime;
      const strokeLen   = freeDist / strokeCount;   // m per stroke cycle (DPS)
      const efficiency  = swimSpeed * strokeLen;     // stroke index

      phases.push(_makePhase('swim', lenIdx, strokeKey, direction,
        curDist, freeDist, curTime, swimTime,
        strokeCount, cycleRate, null,
        { strokeLen, dps: strokeLen, efficiency, swimSpeed }));
      curDist    += freeDist;
      curTime    += swimTime;
    }

    // ── Approach zone ─────────────────────────────────────────────────────
    if (!isLast && approachDist > 0.5 && approachTime > 0.05) {
      const appStrokes = Math.max(1, Math.round(approachTime * c.strokeRate / 60));
      const appRate    = (appStrokes / approachTime) * 60;
      const appSpeed   = approachDist / approachTime;
      const appLen     = approachDist / appStrokes;

      phases.push(_makePhase('approach', lenIdx, strokeKey, direction,
        curDist, approachDist, curTime, approachTime,
        appStrokes, appRate, null,
        { strokeLen: appLen, dps: appLen }));
      curDist += approachDist;
      curTime += approachTime;
    } else if (isLast) {
      // Last length: approach becomes the finish touch zone
      const finTime = approachTime > 0 ? approachTime : 0.5;
      phases.push(_makePhase('finish', lenIdx, strokeKey, direction,
        curDist, approachDist, curTime, finTime,
        null, null, null, {}));
    }

    return phases;
  }

  // ── Phase factory ────────────────────────────────────────────────────────
  function _makePhase(type, lenIdx, strokeKey, direction,
                      distStart, distM, timeStart, durationS,
                      strokeCount, cycleRate, underwaterKicks,
                      extra) {
    const speed = (distM > 0 && durationS > 0) ? distM / durationS : null;
    return Object.assign({
      id:            `len${lenIdx}_${type}`,
      type,
      lengthIndex:   lenIdx,
      stroke:        strokeKey,
      labelShort:    PHASE_LABELS[type].short,
      labelLong:     PHASE_LABELS[type].long,
      distanceStart: distStart,
      distanceEnd:   distStart + distM,
      distanceM:     distM,
      timeStart,
      timeEnd:       timeStart + durationS,
      durationS,
      speed,
      strokeCount,
      cycleRate,
      underwaterKicks,
      color:         PHASE_COLORS[type],
      direction,
    }, extra || {});
  }

  return { compute };
})();

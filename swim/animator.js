'use strict';

/**
 * Animator — drives the requestAnimationFrame loop.
 *
 * On each tick:
 *   1. Advances elapsedSimTime by (wallClockDelta × speed)
 *   2. Calls UI.highlightActivePhase() / UI.updateTimeDisplay()
 */
const Animator = (() => {

  let isPlaying       = false;
  let speed           = 1.0;
  let elapsedSimTime  = 0;
  let lastRAFTime     = null;
  let rafHandle       = null;
  let phases          = [];
  let totalTime       = 0;
  let totalDistance   = 0;

  // ── Public API ─────────────────────────────────────────────

  function load(result) {
    phases        = result.phases;
    totalTime     = result.totalTime;
    totalDistance = result.totalDistance;
  }

  function reset() {
    elapsedSimTime = 0;
    isPlaying      = false;
    if (rafHandle) cancelAnimationFrame(rafHandle);
    // Single frame at t=0 to position dot at phase start
    rafHandle = requestAnimationFrame(now => _tick(now));
  }

  function play() {
    if (isPlaying) return;
    if (elapsedSimTime >= totalTime) elapsedSimTime = 0;
    isPlaying   = true;
    lastRAFTime = performance.now();
    rafHandle   = requestAnimationFrame(now => _tick(now));
  }

  function pause() {
    isPlaying = false;
  }

  function setSpeed(s) {
    speed = s;
  }

  function getPhases() { return phases; }
  function getTotalTime() { return totalTime; }
  function getTotalDistance() { return totalDistance; }
  function getElapsed() { return elapsedSimTime; }

  // ── Internal ───────────────────────────────────────────────

  function _tick(nowMs, singleFrame) {
    if (isPlaying) {
      const delta = (nowMs - (lastRAFTime ?? nowMs)) / 1000;
      elapsedSimTime = Math.min(totalTime, elapsedSimTime + delta * speed);
    }
    lastRAFTime = nowMs;

    // Sync UI
    UI.updateTimeDisplay(elapsedSimTime, totalTime);
    const curPhase = _getPhaseAt(elapsedSimTime);
    if (curPhase) {
      UI.highlightActivePhase(curPhase.id);
      const progress = curPhase.durationS > 0
        ? Math.max(0, Math.min(1, (elapsedSimTime - curPhase.timeStart) / curPhase.durationS))
        : 0;
      const isRTL = curPhase.direction === -1;
      UI.updateDot(curPhase.id, progress, isRTL);
    }

    if (isPlaying) {
      if (elapsedSimTime >= totalTime) {
        isPlaying = false;
        UI.setPlayPauseState('play');
      } else {
        rafHandle = requestAnimationFrame(now => _tick(now));
      }
    }
  }

  function _getPhaseAt(t) {
    for (const p of phases) {
      if (t >= p.timeStart && t <= p.timeEnd) return p;
    }
    return phases[phases.length - 1] || null;
  }

  return {
    load, reset, play, pause, setSpeed,
    getPhases, getTotalTime, getTotalDistance, getElapsed,
    get isPlaying() { return isPlaying; },
  };
})();

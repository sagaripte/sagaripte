'use strict';

/**
 * FINA / World Aquatics race analysis model constants.
 *
 * FINA measures each 50m in three zones:
 *   • Start/Turn zone : 0–15m from wall (reaction + entry + UW + breakout)
 *   • Free-swimming   : 15m to (50m − 5m)
 *   • Approach zone   : last 5m to wall / touch-pad
 *
 * Within the 15m start zone the sub-phases are:
 *   dive start  → reaction time + air-time + entry + 15m timed
 *   pushoff     → wall contact + streamline + 15m timed
 *   The 15m mark is the official FINA timing gate.
 *
 * turnContact (s) : time swimmer is touching / rotating at the wall
 * uwDist15 (m)    : underwater distance inside the 15m zone (from wall)
 *                   (FINA max is 15m for free/back/fly, 10m pullout for breast)
 * uwSpeed (m/s)   : streamline speed right off the wall
 * freeSpeed ratio : approach zone is slightly slower than free-swim speed
 * strokeRate (SPM): strokes per minute for free swimming section
 * strokeLength(m) : distance per stroke cycle (used for DPS display)
 * approachDist(m) : FINA approach / finish zone distance
 */
const STROKE_CONSTANTS = {
  freestyle: {
    // Start zone (0–15m)
    diveDist:      6.5,    // m from block entry to surfacing
    uwDist15:      7.0,    // m of underwater dolphin kicks inside 15m zone (dive)
    pushoffUW15:   5.5,    // m of UW inside 15m zone (turn pushoff)
    uwSpeed:       2.20,   // m/s streamline speed
    underwaterKicks: 5,    // dolphin kicks taken
    // Turn
    turnContact:   0.30,   // s wall contact (flip turn)
    turnType:      'flip',
    startType:     'dive',
    // Free swimming
    strokeRate:    50,     // SPM at race pace
    strokeLength:  2.00,   // m/stroke cycle
    // Zones
    startZone:     15,     // m — FINA official measurement gate
    approachDist:  5,      // m — approach / finish zone
    label:         'Free',
  },
  backstroke: {
    diveDist:      5.0,
    uwDist15:      6.0,
    pushoffUW15:   5.5,
    uwSpeed:       2.10,
    underwaterKicks: 5,
    turnContact:   0.45,   // flip turn (touch + rotation)
    turnType:      'flip',
    startType:     'in_water',
    strokeRate:    48,
    strokeLength:  1.95,
    startZone:     15,
    approachDist:  5,
    label:         'Back',
  },
  breaststroke: {
    diveDist:      5.5,
    uwDist15:      10.0,   // FINA max 10m pullout; dolphin kick → glide → arm pull → glide
    pushoffUW15:   10.0,   // same after each turn
    uwSpeed:       1.55,   // m/s — pullout is much slower than dolphin kick streamline
                           // (elite ~6–7s UW per length; 10m / 1.55 ≈ 6.5s)
    underwaterKicks: 1,    // 1 pullout sequence (kick + arm pull)
    turnContact:   0.60,   // open turn (two-hand touch + longer setup)
    turnType:      'open',
    startType:     'dive',
    strokeRate:    38,
    strokeLength:  2.10,
    startZone:     15,
    approachDist:  5,
    label:         'Breast',
  },
  butterfly: {
    diveDist:      6.0,
    uwDist15:      7.0,
    pushoffUW15:   5.0,
    uwSpeed:       2.15,
    underwaterKicks: 4,
    turnContact:   0.45,   // open turn (two-hand touch)
    turnType:      'open',
    startType:     'dive',
    strokeRate:    50,
    strokeLength:  1.90,
    startZone:     15,
    approachDist:  5,
    label:         'Fly',
  },
};

const IM_ORDER = ['butterfly', 'backstroke', 'breaststroke', 'freestyle'];

/**
 * Phase types under the FINA model:
 *   dive       — reaction + entry + UW (first length only)
 *   underwater — UW streamline inside 15m zone (after pushoff)
 *   swim       — free-swimming zone (15m to approachDist from wall)
 *   approach   — final approachDist metres into the wall
 *   turn       — wall contact + rotation (zero distance)
 *   pushoff    — wall-leave + UW streamline inside 15m zone
 *   finish     — last touch to pad
 */
const PHASE_COLORS = {
  dive:       '#FFD740',
  underwater: '#1565C0',
  swim:       '#00ACC1',
  approach:   '#FF8F00',
  turn:       '#D32F2F',
  pushoff:    '#7B1FA2',
  finish:     '#388E3C',
};

const PHASE_LABELS = {
  dive:       { short: 'Dive',  long: 'Dive / Start' },
  underwater: { short: 'UW',   long: 'Underwater (15m zone)' },
  swim:       { short: 'Swim', long: 'Free Swimming' },
  approach:   { short: 'App',  long: 'Approach Zone (5m)' },
  turn:       { short: 'Turn', long: 'Turn' },
  pushoff:    { short: 'Push', long: 'Push-off / UW (15m zone)' },
  finish:     { short: 'Fin',  long: 'Finish Touch' },
};

/**
 * Kid-friendly phase card definitions.
 * emoji      — big icon shown on the card
 * name       — plain English phase name
 * keyStats   — which stats to feature prominently (ordered)
 * tip        — one-sentence coaching tip shown on the card
 */
const PHASE_CARDS = {
  dive: {
    emoji: '🚀',
    name: 'Start & Dive',
    keyStats: ['split15m', 'time', 'dist'],
    tip: 'Explode off the block and stay tight in your streamline to go as far as possible underwater.',
  },
  underwater: {
    emoji: '🐬',
    name: 'Dolphin Kicks',
    keyStats: ['underwaterKicks', 'dist', 'time'],
    tip: 'Kick hard and stay narrow — the longer you stay under, the faster you travel.',
  },
  pushoff: {
    emoji: '💪',
    name: 'Push Off the Wall',
    keyStats: ['underwaterKicks', 'dist', 'split15m'],
    tip: 'Hit the wall with both feet, push straight back, and keep your body like an arrow.',
  },
  turn: {
    emoji: '🔄',
    name: 'Flip Turn',
    keyStats: ['turnTime', 'time'],
    tip: 'Flip fast and plant your feet high on the wall — every tenth of a second counts here.',
  },
  swim: {
    emoji: '🏊',
    name: 'Free Swimming',
    keyStats: ['strokeCount', 'cycleRate', 'dps'],
    tip: 'Take long, powerful strokes — fewer strokes per length usually means you\'re moving faster.',
  },
  approach: {
    emoji: '🎯',
    name: 'Coming In to the Wall',
    keyStats: ['time', 'strokeCount', 'speed'],
    tip: 'Don\'t coast! Keep stroking all the way to the wall — never glide in.',
  },
  finish: {
    emoji: '🏁',
    name: 'Touch the Wall',
    keyStats: ['time', 'dist'],
    tip: 'Take a big last stroke and drive your fingertips into the pad — don\'t reach short.',
  },
};

// 1 yard = 0.9144 m  |  1 m = 1.09361 yd
const M_TO_YD = 1.09361;
const YD_TO_M = 0.9144;

// Meters pools
const VALID_DISTANCES = {
  25: [25, 50, 100, 200, 400, 800, 1500],
  50: [50, 100, 200, 400, 800, 1500],
};

// Yards pools — SCY (short course yards, 25yd) standard in USA
// No 50yd long-course yards pool exists in competition; only 25yd SCY is used.
const VALID_DISTANCES_YD = {
  25: [25, 50, 100, 200, 500, 1000, 1650],
};

// World record floor per stroke per distance (seconds)
const MIN_TIME_FLOOR = {
  freestyle:    { 25: 10.5, 50: 20.9, 100: 46.9, 200: 102, 400: 220, 800: 460, 1500: 875 },
  backstroke:   { 25: 12.0, 50: 24.0, 100: 51.9, 200: 112, 400: 235, 800: 490 },
  breaststroke: { 25: 13.5, 50: 25.9, 100: 57.1, 200: 126, 400: 265, 800: 560 },
  butterfly:    { 25: 11.5, 50: 22.3, 100: 49.4, 200: 111, 400: 240, 800: 510 },
  im:           { 100: 51.9, 200: 114, 400: 244, 800: 510 },
};

/**
 * Reference times (seconds) at three FINA points levels — long-course (50m pool), male.
 *
 * FINA 600 pts ≈ National-level / Silver standard
 * FINA 800 pts ≈ International-level / Gold standard
 * FINA 900 pts ≈ Olympic Trials / World-class
 * World Record  ≈ FINA ~1000–1050 pts
 *
 * Values derived from the FINA points scoring tables (2022 base times).
 * These are men's LCM (long-course metres) figures.
 * For SCM (25m pool) or women, times are roughly 2–4% faster / slower respectively.
 */
// ── LCM reference times (meters pools) ───────────────────────────────────
const REFERENCE_TIMES = {
  freestyle: {
    50:   { silver: 26.5,  gold: 23.8,  wr: 20.9  },
    100:  { silver: 57.5,  gold: 51.5,  wr: 46.9  },
    200:  { silver: 126,   gold: 113,   wr: 102    },
    400:  { silver: 264,   gold: 237,   wr: 220    },
    800:  { silver: 546,   gold: 490,   wr: 460    },
    1500: { silver: 1040,  gold: 935,   wr: 875    },
  },
  backstroke: {
    50:   { silver: 31.5,  gold: 28.0,  wr: 24.0  },
    100:  { silver: 67.0,  gold: 59.5,  wr: 51.9  },
    200:  { silver: 145,   gold: 129,   wr: 112    },
  },
  breaststroke: {
    50:   { silver: 34.0,  gold: 30.0,  wr: 25.9  },
    100:  { silver: 73.5,  gold: 65.5,  wr: 57.1  },
    200:  { silver: 162,   gold: 144,   wr: 126    },
  },
  butterfly: {
    50:   { silver: 29.5,  gold: 26.0,  wr: 22.3  },
    100:  { silver: 63.5,  gold: 56.5,  wr: 49.4  },
    200:  { silver: 141,   gold: 125,   wr: 111    },
  },
  im: {
    100:  { silver: 66.0,  gold: 59.0,  wr: 51.9  },
    200:  { silver: 146,   gold: 130,   wr: 114    },
    400:  { silver: 310,   gold: 278,   wr: 244    },
  },
};

// ── SCY reference times (yards pools, USA) ────────────────────────────────
// NCAA Division I "A" cut ≈ silver; US Open / Olympic Trials ≈ gold.
// Distances in yards; times in seconds.
const REFERENCE_TIMES_YD = {
  freestyle: {
    50:   { silver: 22.5,  gold: 20.5,  wr: 18.47 },
    100:  { silver: 49.5,  gold: 44.5,  wr: 40.00 },
    200:  { silver: 110,   gold: 98,    wr: 88.5  },
    500:  { silver: 298,   gold: 268,   wr: 250   },
    1000: { silver: 620,   gold: 555,   wr: 519   },
    1650: { silver: 1040,  gold: 930,   wr: 865   },
  },
  backstroke: {
    50:   { silver: 26.5,  gold: 24.0,  wr: 21.53 },
    100:  { silver: 57.0,  gold: 51.5,  wr: 44.94 },
    200:  { silver: 125,   gold: 112,   wr: 98.8  },
  },
  breaststroke: {
    50:   { silver: 29.0,  gold: 26.5,  wr: 22.96 },
    100:  { silver: 63.0,  gold: 57.0,  wr: 50.25 },
    200:  { silver: 138,   gold: 124,   wr: 110.3 },
  },
  butterfly: {
    50:   { silver: 24.5,  gold: 22.0,  wr: 19.98 },
    100:  { silver: 53.5,  gold: 48.0,  wr: 43.01 },
    200:  { silver: 119,   gold: 107,   wr: 95.9  },
  },
  im: {
    100:  { silver: 56.0,  gold: 50.5,  wr: 44.84 },
    200:  { silver: 125,   gold: 112,   wr: 98.6  },
    400:  { silver: 267,   gold: 239,   wr: 210.5 },
  },
};

/**
 * USA Swimming Age Group time standards (SCY — short course yards).
 * Cuts: A, BB, B  (A = fastest age group standard, B = entry level)
 * Source: USA Swimming 2024 motivational time standards.
 * Structure: AGE_GROUP_TIMES_SCY[gender][ageGroup][stroke][distance] = { a, bb, b }
 * gender: 'male' | 'female'
 * ageGroup: '10u' | '11-12' | '13-14' | '15-16' | '17-18'
 * Times in seconds.
 */
const AGE_GROUP_TIMES_SCY = {
  male: {
    '10u': {
      freestyle:    { 25: { a: 14.49, bb: 15.49, b: 17.09 }, 50: { a: 29.19, bb: 31.39, b: 34.59 }, 100: { a: 1*60+3.59, bb: 1*60+8.39, b: 1*60+15.39 }, 200: { a: 2*60+17.09, bb: 2*60+27.39, b: 2*60+41.89 } },
      backstroke:   { 50: { a: 34.59, bb: 37.29, b: 41.09 }, 100: { a: 1*60+14.39, bb: 1*60+19.89, b: 1*60+27.89 } },
      breaststroke: { 50: { a: 38.49, bb: 41.29, b: 45.49 }, 100: { a: 1*60+23.29, bb: 1*60+29.69, b: 1*60+38.59 } },
      butterfly:    { 50: { a: 32.09, bb: 34.49, b: 37.99 }, 100: { a: 1*60+12.69, bb: 1*60+18.69, b: 1*60+26.69 } },
      im:           { 100: { a: 1*60+11.69, bb: 1*60+16.89, b: 1*60+24.49 }, 200: { a: 2*60+36.29, bb: 2*60+47.69, b: 3*60+3.09 } },
    },
    '11-12': {
      freestyle:    { 50: { a: 25.89, bb: 27.89, b: 30.79 }, 100: { a: 56.49, bb: 1*60+0.89, b: 1*60+7.59 }, 200: { a: 2*60+2.49, bb: 2*60+10.89, b: 2*60+22.99 }, 500: { a: 5*60+24.29, bb: 5*60+48.29, b: 6*60+22.59 }, 1000: { a: 11*60+9.69, bb: 12*60+2.29, b: 13*60+14.49 }, 1650: { a: 18*60+31.79, bb: 19*60+55.79, b: 21*60+55.79 } },
      backstroke:   { 50: { a: 30.89, bb: 33.29, b: 36.59 }, 100: { a: 1*60+5.69, bb: 1*60+10.69, b: 1*60+17.79 }, 200: { a: 2*60+22.09, bb: 2*60+33.69, b: 2*60+48.99 } },
      breaststroke: { 50: { a: 34.29, bb: 36.99, b: 40.69 }, 100: { a: 1*60+13.89, bb: 1*60+19.69, b: 1*60+27.59 }, 200: { a: 2*60+40.09, bb: 2*60+52.09, b: 3*60+7.79 } },
      butterfly:    { 50: { a: 28.49, bb: 30.69, b: 33.79 }, 100: { a: 1*60+3.79, bb: 1*60+8.89, b: 1*60+15.89 }, 200: { a: 2*60+22.09, bb: 2*60+33.69, b: 2*60+49.09 } },
      im:           { 100: { a: 1*60+4.29, bb: 1*60+9.29, b: 1*60+16.29 }, 200: { a: 2*60+17.89, bb: 2*60+28.09, b: 2*60+41.89 }, 400: { a: 4*60+53.39, bb: 5*60+14.69, b: 5*60+46.19 } },
    },
    '13-14': {
      freestyle:    { 50: { a: 23.09, bb: 24.89, b: 27.39 }, 100: { a: 50.29, bb: 54.29, b: 59.79 }, 200: { a: 1*60+49.69, bb: 1*60+57.39, b: 2*60+9.09 }, 500: { a: 4*60+50.09, bb: 5*60+12.09, b: 5*60+43.29 }, 1000: { a: 9*60+58.69, bb: 10*60+44.69, b: 11*60+50.59 }, 1650: { a: 16*60+35.19, bb: 17*60+51.19, b: 19*60+38.19 } },
      backstroke:   { 50: { a: 27.09, bb: 29.19, b: 32.09 }, 100: { a: 57.79, bb: 1*60+2.29, b: 1*60+8.59 }, 200: { a: 2*60+4.89, bb: 2*60+14.99, b: 2*60+28.99 } },
      breaststroke: { 50: { a: 30.09, bb: 32.49, b: 35.79 }, 100: { a: 1*60+4.49, bb: 1*60+9.69, b: 1*60+16.59 }, 200: { a: 2*60+21.29, bb: 2*60+32.09, b: 2*60+47.29 } },
      butterfly:    { 50: { a: 24.89, bb: 26.89, b: 29.59 }, 100: { a: 55.29, bb: 59.69, b: 1*60+5.69 }, 200: { a: 2*60+3.09, bb: 2*60+13.39, b: 2*60+27.79 } },
      im:           { 100: { a: 57.29, bb: 1*60+1.79, b: 1*60+7.99 }, 200: { a: 2*60+3.49, bb: 2*60+12.49, b: 2*60+24.69 }, 400: { a: 4*60+21.49, bb: 4*60+41.49, b: 5*60+9.49 } },
    },
    '15-16': {
      freestyle:    { 50: { a: 21.49, bb: 23.19, b: 25.59 }, 100: { a: 46.69, bb: 50.39, b: 55.49 }, 200: { a: 1*60+42.09, bb: 1*60+50.39, b: 2*60+1.29 }, 500: { a: 4*60+30.59, bb: 4*60+51.59, b: 5*60+21.59 }, 1000: { a: 9*60+21.29, bb: 10*60+4.49, b: 11*60+6.29 }, 1650: { a: 15*60+32.29, bb: 16*60+44.29, b: 18*60+24.29 } },
      backstroke:   { 50: { a: 24.89, bb: 26.89, b: 29.59 }, 100: { a: 53.29, bb: 57.49, b: 1*60+3.29 }, 200: { a: 1*60+55.39, bb: 2*60+5.09, b: 2*60+18.49 } },
      breaststroke: { 50: { a: 27.89, bb: 30.09, b: 33.09 }, 100: { a: 59.49, bb: 1*60+4.49, b: 1*60+11.09 }, 200: { a: 2*60+9.89, bb: 2*60+20.29, b: 2*60+34.69 } },
      butterfly:    { 50: { a: 22.99, bb: 24.79, b: 27.29 }, 100: { a: 50.89, bb: 54.89, b: 1*60+0.49 }, 200: { a: 1*60+53.09, bb: 2*60+2.89, b: 2*60+16.29 } },
      im:           { 100: { a: 53.09, bb: 57.29, b: 1*60+3.09 }, 200: { a: 1*60+53.59, bb: 2*60+2.29, b: 2*60+13.89 }, 400: { a: 4*60+3.79, bb: 4*60+22.39, b: 4*60+49.49 } },
    },
    '17-18': {
      freestyle:    { 50: { a: 20.69, bb: 22.29, b: 24.59 }, 100: { a: 44.99, bb: 48.59, b: 53.49 }, 200: { a: 1*60+38.29, bb: 1*60+46.29, b: 1*60+57.09 }, 500: { a: 4*60+19.79, bb: 4*60+39.79, b: 5*60+9.09 }, 1000: { a: 9*60+0.29, bb: 9*60+42.29, b: 10*60+42.29 }, 1650: { a: 14*60+54.69, bb: 16*60+3.69, b: 17*60+40.69 } },
      backstroke:   { 50: { a: 23.79, bb: 25.69, b: 28.29 }, 100: { a: 51.19, bb: 55.29, b: 1*60+0.89 }, 200: { a: 1*60+51.09, bb: 2*60+0.49, b: 2*60+13.49 } },
      breaststroke: { 50: { a: 26.69, bb: 28.79, b: 31.69 }, 100: { a: 57.19, bb: 1*60+1.89, b: 1*60+8.09 }, 200: { a: 2*60+4.49, bb: 2*60+14.69, b: 2*60+28.59 } },
      butterfly:    { 50: { a: 21.99, bb: 23.79, b: 26.19 }, 100: { a: 48.79, bb: 52.69, b: 58.09 }, 200: { a: 1*60+47.99, bb: 1*60+57.59, b: 2*60+10.49 } },
      im:           { 100: { a: 50.99, bb: 55.09, b: 1*60+0.59 }, 200: { a: 1*60+49.39, bb: 1*60+57.79, b: 2*60+9.09 }, 400: { a: 3*60+53.19, bb: 4*60+11.39, b: 4*60+36.79 } },
    },
  },
  female: {
    '10u': {
      freestyle:    { 25: { a: 15.59, bb: 16.79, b: 18.49 }, 50: { a: 31.09, bb: 33.49, b: 36.89 }, 100: { a: 1*60+7.89, bb: 1*60+13.19, b: 1*60+20.49 }, 200: { a: 2*60+26.29, bb: 2*60+37.59, b: 2*60+52.89 } },
      backstroke:   { 50: { a: 37.09, bb: 39.99, b: 43.99 }, 100: { a: 1*60+19.49, bb: 1*60+25.49, b: 1*60+33.99 } },
      breaststroke: { 50: { a: 41.39, bb: 44.49, b: 48.99 }, 100: { a: 1*60+29.89, bb: 1*60+36.89, b: 1*60+46.59 } },
      butterfly:    { 50: { a: 34.29, bb: 36.99, b: 40.69 }, 100: { a: 1*60+17.19, bb: 1*60+23.69, b: 1*60+32.09 } },
      im:           { 100: { a: 1*60+15.89, bb: 1*60+21.59, b: 1*60+29.69 }, 200: { a: 2*60+44.19, bb: 2*60+56.59, b: 3*60+13.29 } },
    },
    '11-12': {
      freestyle:    { 50: { a: 27.59, bb: 29.69, b: 32.69 }, 100: { a: 59.69, bb: 1*60+4.49, b: 1*60+11.49 }, 200: { a: 2*60+8.89, bb: 2*60+18.09, b: 2*60+31.09 }, 500: { a: 5*60+44.89, bb: 6*60+10.89, b: 6*60+47.89 }, 1000: { a: 11*60+51.19, bb: 12*60+47.19, b: 14*60+3.89 }, 1650: { a: 19*60+41.29, bb: 21*60+11.29, b: 23*60+17.29 } },
      backstroke:   { 50: { a: 32.89, bb: 35.49, b: 39.09 }, 100: { a: 1*60+10.19, bb: 1*60+15.69, b: 1*60+23.29 }, 200: { a: 2*60+30.29, bb: 2*60+42.79, b: 2*60+59.09 } },
      breaststroke: { 50: { a: 36.29, bb: 39.09, b: 43.09 }, 100: { a: 1*60+18.69, bb: 1*60+24.89, b: 1*60+33.49 }, 200: { a: 2*60+50.39, bb: 3*60+3.49, b: 3*60+20.89 } },
      butterfly:    { 50: { a: 30.09, bb: 32.49, b: 35.79 }, 100: { a: 1*60+7.59, bb: 1*60+13.09, b: 1*60+20.69 }, 200: { a: 2*60+30.59, bb: 2*60+42.89, b: 2*60+59.19 } },
      im:           { 100: { a: 1*60+7.89, bb: 1*60+13.19, b: 1*60+20.49 }, 200: { a: 2*60+25.09, bb: 2*60+36.09, b: 2*60+50.69 }, 400: { a: 5*60+10.59, bb: 5*60+33.59, b: 6*60+8.19 } },
    },
    '13-14': {
      freestyle:    { 50: { a: 25.19, bb: 27.19, b: 29.89 }, 100: { a: 54.59, bb: 58.89, b: 1*60+4.89 }, 200: { a: 1*60+57.09, bb: 2*60+6.09, b: 2*60+18.69 }, 500: { a: 5*60+11.89, bb: 5*60+35.89, b: 6*60+9.89 }, 1000: { a: 10*60+44.29, bb: 11*60+34.29, b: 12*60+44.29 }, 1650: { a: 17*60+50.29, bb: 19*60+12.29, b: 21*60+7.29 } },
      backstroke:   { 50: { a: 29.39, bb: 31.69, b: 34.89 }, 100: { a: 1*60+2.99, bb: 1*60+7.99, b: 1*60+14.79 }, 200: { a: 2*60+14.29, bb: 2*60+25.29, b: 2*60+39.79 } },
      breaststroke: { 50: { a: 33.09, bb: 35.69, b: 39.29 }, 100: { a: 1*60+11.49, bb: 1*60+17.29, b: 1*60+24.99 }, 200: { a: 2*60+35.09, bb: 2*60+47.09, b: 3*60+3.39 } },
      butterfly:    { 50: { a: 27.29, bb: 29.49, b: 32.39 }, 100: { a: 1*60+0.29, bb: 1*60+5.29, b: 1*60+11.79 }, 200: { a: 2*60+14.29, bb: 2*60+25.29, b: 2*60+39.79 } },
      im:           { 100: { a: 1*60+2.09, bb: 1*60+7.09, b: 1*60+13.79 }, 200: { a: 2*60+13.09, bb: 2*60+22.99, b: 2*60+35.99 }, 400: { a: 4*60+42.59, bb: 5*60+3.59, b: 5*60+34.09 } },
    },
    '15-16': {
      freestyle:    { 50: { a: 24.09, bb: 26.09, b: 28.69 }, 100: { a: 52.69, bb: 56.89, b: 1*60+2.59 }, 200: { a: 1*60+53.09, bb: 2*60+1.89, b: 2*60+14.09 }, 500: { a: 5*60+0.39, bb: 5*60+23.39, b: 5*60+56.39 }, 1000: { a: 10*60+21.09, bb: 11*60+9.09, b: 12*60+16.09 }, 1650: { a: 17*60+9.79, bb: 18*60+29.79, b: 20*60+21.79 } },
      backstroke:   { 50: { a: 28.09, bb: 30.29, b: 33.29 }, 100: { a: 59.89, bb: 1*60+4.69, b: 1*60+11.19 }, 200: { a: 2*60+8.39, bb: 2*60+19.09, b: 2*60+33.09 } },
      breaststroke: { 50: { a: 31.79, bb: 34.29, b: 37.79 }, 100: { a: 1*60+8.49, bb: 1*60+14.09, b: 1*60+21.49 }, 200: { a: 2*60+28.29, bb: 2*60+40.09, b: 2*60+55.89 } },
      butterfly:    { 50: { a: 26.09, bb: 28.19, b: 31.09 }, 100: { a: 57.39, bb: 1*60+1.99, b: 1*60+8.29 }, 200: { a: 2*60+8.29, bb: 2*60+18.99, b: 2*60+33.29 } },
      im:           { 100: { a: 59.49, bb: 1*60+4.49, b: 1*60+11.09 }, 200: { a: 2*60+8.59, bb: 2*60+18.29, b: 2*60+30.49 }, 400: { a: 4*60+33.19, bb: 4*60+53.19, b: 5*60+22.69 } },
    },
    '17-18': {
      freestyle:    { 50: { a: 23.59, bb: 25.49, b: 28.09 }, 100: { a: 51.49, bb: 55.59, b: 1*60+1.09 }, 200: { a: 1*60+50.99, bb: 1*60+59.69, b: 2*60+11.59 }, 500: { a: 4*60+54.89, bb: 5*60+17.09, b: 5*60+49.09 }, 1000: { a: 10*60+8.29, bb: 10*60+56.29, b: 12*60+1.09 }, 1650: { a: 16*60+47.39, bb: 18*60+5.39, b: 19*60+54.39 } },
      backstroke:   { 50: { a: 27.49, bb: 29.69, b: 32.69 }, 100: { a: 58.69, bb: 1*60+3.39, b: 1*60+9.79 }, 200: { a: 2*60+5.89, bb: 2*60+16.49, b: 2*60+30.19 } },
      breaststroke: { 50: { a: 31.09, bb: 33.59, b: 36.99 }, 100: { a: 1*60+6.89, bb: 1*60+12.29, b: 1*60+19.49 }, 200: { a: 2*60+24.89, bb: 2*60+36.49, b: 2*60+51.79 } },
      butterfly:    { 50: { a: 25.49, bb: 27.59, b: 30.39 }, 100: { a: 55.99, bb: 1*60+0.49, b: 1*60+6.59 }, 200: { a: 2*60+4.99, bb: 2*60+15.59, b: 2*60+29.69 } },
      im:           { 100: { a: 58.09, bb: 1*60+2.89, b: 1*60+9.29 }, 200: { a: 2*60+6.09, bb: 2*60+15.69, b: 2*60+27.59 }, 400: { a: 4*60+28.09, bb: 4*60+48.09, b: 5*60+16.89 } },
    },
  },
};

// Age group labels shown in the UI
const AGE_GROUPS = ['10&Under', '11-12', '13-14', '15-16', '17-18', 'Open'];
const AGE_GROUP_KEYS = ['10u', '11-12', '13-14', '15-16', '17-18'];

// Crude Desk — simulation engine.
// Pure logic, no DOM. The whole "world" (price path, headlines, client requests)
// is pre-generated from a seed, so every player and every benchmark bot faces
// exactly the same market. Player actions only change their own fills.

import { buildPhysical, physicalDesk, botPhysical, analysePhysical } from './physical.js';

export const LOT = 1000; // barrels per lot
export const REQUEST_LIFE = 7; // ticks a client waits for a price
export const MARKOUT = 10; // ticks used to judge whether a fill was "toxic"
export const PENALTY = {
  missed: 1500, // client request left unanswered
  passed: 500, // client request declined
  breachPerTick: 2500, // each tick over the position limit
  forced: 25000, // risk manager had to cut your position
};

// ---------- RNG ----------
export function hashSeed(str) {
  let h = 1779033703 ^ String(str).length;
  for (const ch of String(str)) {
    h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h >>> 0) || 1;
}

export function makeRng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    normal: () => {
      const u = Math.max(next(), 1e-12);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
  };
  return r;
}

export const round2 = (x) => Math.round(x * 100) / 100;

// ---------- Clients ----------
export const CLIENTS = [
  { name: 'SkyJet Airlines', type: 'corporate', desc: 'Airline hedging jet fuel', tol: [0.06, 0.16], size: [10, 50] },
  { name: 'Northsea Refining', type: 'corporate', desc: 'Refiner hedging crude purchases', tol: [0.05, 0.13], size: [20, 60] },
  { name: 'Pampas Petroleum', type: 'corporate', desc: 'Producer hedging output', tol: [0.05, 0.12], size: [20, 80] },
  { name: 'Atlas Shipping', type: 'corporate', desc: 'Shipowner hedging bunker costs', tol: [0.07, 0.18], size: [10, 30] },
  { name: 'Meridian Utilities', type: 'corporate', desc: 'Utility hedging fuel oil exposure', tol: [0.06, 0.15], size: [10, 40] },
  { name: 'Vantage Trading House', type: 'trader', desc: 'Physical trader — sometimes knows something', tol: [0.02, 0.06], size: [20, 70] },
  { name: 'Kestrel Macro Fund', type: 'fund', desc: 'Hedge fund — often informed', tol: [0.01, 0.04], size: [30, 100] },
  { name: 'Blue Harbor Capital', type: 'fund', desc: 'Hedge fund — often informed', tol: [0.01, 0.04], size: [25, 80] },
];

const INFORMED_P = { corporate: 0, trader: 0.45 };

// ---------- News pool (random background headlines) ----------
// impact is $/bbl applied to fair value; [lo, hi] drawn at generation time.
const NEWS_POOL = [
  { text: 'China refinery runs hit record high in latest data', impact: [0.3, 0.8] },
  { text: 'Libya restores output at Sharara field after shutdown', impact: [-0.9, -0.4] },
  { text: 'Dollar index jumps after strong US payrolls', impact: [-0.5, -0.2] },
  { text: 'IEA trims 2026 oil demand growth forecast', impact: [-0.9, -0.4] },
  { text: 'US rig count falls for fifth straight week', impact: [0.1, 0.35] },
  { text: 'Tanker reports harassment near Strait of Hormuz', impact: [0.8, 1.8] },
  { text: 'Nigerian pipeline sabotage cuts Forcados loadings', impact: [0.4, 1.0] },
  { text: 'Norway announces new EV purchase subsidies', impact: [-0.05, 0.05] },
  { text: 'Analyst note: market "well supplied" into Q4', impact: [-0.3, -0.1] },
  { text: 'European gas prices spike on cold-weather forecast', impact: [0.1, 0.4] },
  { text: 'Fed officials signal rates on hold for longer', impact: [-0.35, -0.1] },
  { text: 'Kazakhstan CPC terminal resumes full loadings', impact: [-0.6, -0.25] },
  { text: 'Indian crude imports climb to 11-month high', impact: [0.2, 0.55] },
  { text: 'Chinese stimulus package smaller than expected', impact: [-0.7, -0.3] },
  { text: 'North Sea Forties pipeline outage — repairs "days"', impact: [0.5, 1.2] },
  { text: 'Celebrity CEO tweets that oil is "so over"', impact: [-0.03, 0.03] },
  { text: 'Weekly API data shows surprise crude build', impact: [-0.6, -0.25] },
  { text: 'Weekly API data shows larger-than-expected draw', impact: [0.25, 0.6] },
];

// ---------- Scenarios ----------
export const SCENARIOS = [
  {
    id: 'orientation',
    name: 'Orientation Day',
    tag: 'Calm tape',
    difficulty: 1,
    brief:
      'Quiet Brent market, mostly corporate hedgers. Learn the loop: price every client, earn the spread, hedge before your position gets big.',
    start: 82.4,
    vol: 0.022,
    k: 0.3,
    ticks: 240,
    limit: 150,
    maxLoss: 300000,
    halfSpread: 0.02,
    reqRate: 0.1,
    mix: { corporate: 0.8, trader: 0.12, fund: 0.08 },
    fundInformed: 0.6,
    newsRate: 0.018,
    script: [
      { type: 'data', announceAt: 30, at: 110, name: 'EIA weekly crude inventories', expected: -1.5, spread: 3.5, sens: 0.3 },
    ],
  },
  {
    id: 'opec',
    name: 'OPEC+ Week',
    tag: 'Event risk',
    difficulty: 2,
    brief:
      'OPEC+ ministers meet today. Rumours will fly before the decision. Some are true, some get denied. Size up on confirmation, not on chatter.',
    start: 79.8,
    vol: 0.03,
    k: 0.25,
    ticks: 300,
    limit: 200,
    maxLoss: 400000,
    halfSpread: 0.02,
    reqRate: 0.11,
    mix: { corporate: 0.6, trader: 0.2, fund: 0.2 },
    fundInformed: 0.75,
    newsRate: 0.015,
    script: [
      { type: 'news', at: 12, text: 'OPEC+ ministers gather in Vienna; decision expected this afternoon', impact: 0.1, tag: 'CALENDAR' },
      { type: 'rumour', at: 60, text: 'Delegates say Saudi Arabia pushing for 1M bpd cut', impact: 1.2, resolveAt: 95, truth: false, resolveText: 'Saudi energy ministry denies push for deep cut' },
      { type: 'rumour', at: 130, text: 'Sources: Russia resisting any new output cuts', impact: -0.8, resolveAt: 160, truth: true, resolveText: 'Russian deputy PM confirms opposition to deeper cuts' },
      { type: 'choice', at: 205, options: [
        { p: 0.45, text: 'OPEC+ agrees surprise 750k bpd cut from next month', impact: 2.6 },
        { p: 0.35, text: 'OPEC+ rolls over current quotas — no change', impact: -0.9 },
        { p: 0.2, text: 'OPEC+ talks collapse; members free to raise output', impact: -3.2 },
      ] },
    ],
  },
  {
    id: 'hurricane',
    name: 'Hurricane Season',
    tag: 'Supply shock',
    difficulty: 3,
    brief:
      'A tropical storm is tracking toward the US Gulf Coast. Refineries and offshore platforms sit in its path. Vol rises as the forecast firms up.',
    start: 84.1,
    vol: 0.035,
    k: 0.22,
    ticks: 300,
    limit: 200,
    maxLoss: 400000,
    halfSpread: 0.025,
    reqRate: 0.12,
    mix: { corporate: 0.55, trader: 0.25, fund: 0.2 },
    fundInformed: 0.75,
    newsRate: 0.012,
    script: [
      { type: 'news', at: 20, text: 'NHC: Tropical Storm Iris forms in Caribbean, Gulf track possible', impact: 0.5, tag: 'WEATHER' },
      { type: 'news', at: 75, text: 'Iris upgraded to Category 2 hurricane; producers begin evacuating platforms', impact: 1.3, tag: 'WEATHER' },
      { type: 'data', announceAt: 40, at: 120, name: 'EIA weekly crude inventories', expected: -2.0, spread: 4, sens: 0.3 },
      { type: 'rumour', at: 150, text: 'Unconfirmed: Iris could hit Category 5 before landfall', impact: 1.4, resolveAt: 180, truth: false, resolveText: 'NHC: Iris weakening over cooler water, Cat 3 at landfall' },
      { type: 'choice', at: 225, options: [
        { p: 0.5, text: 'Iris makes landfall east of Houston; three major refineries shut', impact: -1.6 },
        { p: 0.5, text: 'Iris veers west into Mexico; US Gulf output restart begins', impact: -2.2 },
      ] },
    ],
  },
  {
    id: 'macro',
    name: 'Macro Storm',
    tag: 'High vol',
    difficulty: 4,
    brief:
      'Global risk-off. Wide ranges, fake headlines, and hedge funds who know more than you. Tight limits. Survive first, then profit.',
    start: 76.5,
    vol: 0.05,
    k: 0.3,
    ticks: 300,
    limit: 120,
    maxLoss: 300000,
    halfSpread: 0.03,
    reqRate: 0.13,
    mix: { corporate: 0.45, trader: 0.25, fund: 0.3 },
    fundInformed: 0.85,
    newsRate: 0.022,
    script: [
      { type: 'news', at: 15, text: 'Global equities slide 3% on banking-sector contagion fears', impact: -1.2, tag: 'MACRO' },
      { type: 'rumour', at: 70, text: 'Report: Central banks preparing coordinated rate cut', impact: 1.5, resolveAt: 100, truth: false, resolveText: 'ECB spokesperson: "no coordinated action planned"' },
      { type: 'data', announceAt: 60, at: 140, name: 'US CPI (m/m, %)', expected: 0.3, spread: 0.3, sens: -4, unit: '%' },
      { type: 'rumour', at: 190, text: 'Chatter: major commodity fund liquidating long oil book', impact: -1.6, resolveAt: 215, truth: true, resolveText: 'Confirmed: Fund liquidation — sources cite $2bn of crude length' },
      { type: 'news', at: 250, text: 'Treasury secretary: "system is sound", markets stabilise', impact: 1.0, tag: 'MACRO' },
    ],
  },
  {
    id: 'atlantic',
    name: 'Atlantic Arb',
    tag: 'Physical + freight',
    difficulty: 3,
    brief:
      'You run a physical crude book alongside the futures desk. Buy cargoes FOB, charter a tanker, ship them to wherever they are worth most, and sell them delivered. Hedge the flat price with futures. Watch freight: it can close an arb overnight.',
    start: 81.2,
    vol: 0.03,
    k: 0.25,
    ticks: 320,
    ticksPerDay: 4,
    limit: 300,
    maxLoss: 1500000,
    halfSpread: 0.02,
    reqRate: 0.05,
    mix: { corporate: 0.7, trader: 0.15, fund: 0.15 },
    fundInformed: 0.7,
    newsRate: 0.012,
    script: [
      { type: 'data', announceAt: 20, at: 90, name: 'EIA weekly crude inventories', expected: -1.0, spread: 3.5, sens: 0.3 },
    ],
    physical: { origins: ['usgc', 'nsea'], dests: ['rdam', 'ningbo', 'sikka'], offerRate: 0.09, minGap: 6, newsRate: 0.022 },
  },
  {
    id: 'redsea',
    name: 'Red Sea Squeeze',
    tag: 'Freight shock',
    difficulty: 5,
    brief:
      'Attacks on shipping near Bab el-Mandeb. Charter rates are whipsawing, Suez routes are in question, and every arb depends on freight. Trade FFAs on the headlines, pick routes that still work, and hedge every barrel.',
    start: 83.6,
    vol: 0.035,
    k: 0.25,
    ticks: 320,
    ticksPerDay: 4,
    limit: 300,
    maxLoss: 2000000,
    halfSpread: 0.025,
    reqRate: 0.05,
    mix: { corporate: 0.55, trader: 0.2, fund: 0.25 },
    fundInformed: 0.8,
    newsRate: 0.012,
    script: [
      { type: 'news', at: 30, text: 'Tanker struck by missile in Bab el-Mandeb; Brent jumps on supply fears', impact: 1.1, tag: 'BREAKING' },
    ],
    physical: {
      origins: ['usgc', 'nsea', 'meg'],
      dests: ['rdam', 'ningbo', 'sikka'],
      offerRate: 0.1,
      minGap: 5,
      newsRate: 0.012,
      script: [
        { at: 31, tag: 'FREIGHT', text: 'Owners suspend Red Sea transits after missile strike; war-risk premiums soar', rate: { aframax: 6000, suezmax: 9000, vlcc: 5000 }, des: { rdam: 0.3 } },
        { at: 95, tag: 'RUMOUR', text: 'Unconfirmed: naval escort deal to reopen Red Sea lanes within days', rate: { aframax: -2500, suezmax: -4000, vlcc: -2000 } },
        { at: 125, tag: 'DENIAL', text: 'Navies deny escort agreement; insurers raise war-risk cover again', rate: { aframax: 3500, suezmax: 5500, vlcc: 2500 } },
        { at: 210, tag: 'FREIGHT', text: 'Chinese buying spree: 30 VLCCs fixed out of the Gulf this week', rate: { vlcc: 12000 }, des: { ningbo: 0.3 } },
        { at: 270, tag: 'FREIGHT', text: 'Ceasefire holds; first tankers resume Suez transits', rate: { aframax: -5000, suezmax: -8000, vlcc: -4000 }, des: { rdam: -0.25 } },
      ],
    },
  },
];

export function scenarioById(id) {
  return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
}

// ---------- World generation ----------
export function buildWorld(scenarioId, seed) {
  const sc = scenarioById(scenarioId);
  const r = makeRng(`${sc.id}:${seed}`);
  const N = sc.ticks;
  const shocks = new Float64Array(N + 1);
  const headlines = [];
  const calendar = [];

  const addShock = (t, x) => {
    if (t >= 0 && t <= N) shocks[t] += x;
  };

  // scripted events
  for (const ev of sc.script) {
    if (ev.type === 'news') {
      headlines.push({ tick: ev.at, text: ev.text, tag: ev.tag || 'CONFIRMED', impact: ev.impact });
      addShock(ev.at, ev.impact);
    } else if (ev.type === 'rumour') {
      headlines.push({ tick: ev.at, text: ev.text, tag: 'RUMOUR', impact: ev.impact, rumour: true, truth: ev.truth });
      addShock(ev.at, ev.impact * 0.6);
      if (ev.truth) {
        headlines.push({ tick: ev.resolveAt, text: ev.resolveText, tag: 'CONFIRMED', impact: ev.impact * 0.6 });
        addShock(ev.resolveAt, ev.impact * 0.6);
      } else {
        headlines.push({ tick: ev.resolveAt, text: ev.resolveText, tag: 'DENIAL', impact: -ev.impact * 0.6 });
        addShock(ev.resolveAt, -ev.impact * 0.6);
      }
    } else if (ev.type === 'choice') {
      let u = r.next();
      let chosen = ev.options[ev.options.length - 1];
      for (const o of ev.options) {
        if (u < o.p) { chosen = o; break; }
        u -= o.p;
      }
      const impact = chosen.impact * r.range(0.85, 1.15);
      headlines.push({ tick: ev.at, text: chosen.text, tag: 'BREAKING', impact });
      addShock(ev.at, impact);
    } else if (ev.type === 'data') {
      const actual = Math.round((ev.expected + r.range(-ev.spread, ev.spread)) * 10) / 10;
      const unit = ev.unit || 'M bbl';
      const impact = (actual - ev.expected) * (ev.unit ? ev.sens : -ev.sens);
      calendar.push({ tick: ev.at, name: ev.name, expected: ev.expected, unit });
      headlines.push({ tick: ev.announceAt, text: `Scheduled: ${ev.name} due at ${clock(ev.at, N, sc)} — consensus ${fmtSigned(ev.expected)}${unit === '%' ? '%' : ' M bbl'}`, tag: 'CALENDAR', impact: 0 });
      headlines.push({
        tick: ev.at,
        text: `${ev.name}: ${fmtSigned(actual)}${unit === '%' ? '%' : ' M bbl'} vs ${fmtSigned(ev.expected)}${unit === '%' ? '%' : ' M bbl'} expected`,
        tag: 'DATA',
        impact,
        data: { actual, expected: ev.expected },
      });
      addShock(ev.at, impact);
    }
  }

  // background news
  const used = new Set();
  for (let t = 5; t < N - 5; t++) {
    if (!r.chance(sc.newsRate)) continue;
    let item = r.pick(NEWS_POOL);
    if (used.has(item.text)) continue;
    used.add(item.text);
    const impact = r.range(item.impact[0], item.impact[1]);
    headlines.push({ tick: t, text: item.text, tag: 'NEWS', impact });
    addShock(t, impact);
  }
  const physical = sc.physical ? buildPhysical(makeRng(`${sc.id}:${seed}:physical`), sc, N, headlines) : null;
  headlines.sort((a, b) => a.tick - b.tick);
  headlines.forEach((h, i) => (h.id = i));

  // price path: fair value jumps on news, traded mid chases it with lag k plus noise
  const mid = new Float64Array(N + MARKOUT + 2);
  const fair = new Float64Array(N + MARKOUT + 2);
  const hs = new Float64Array(N + MARKOUT + 2);
  let f = sc.start;
  let m = sc.start;
  let stress = 0;
  for (let t = 0; t < mid.length; t++) {
    const sh = t <= N ? shocks[t] : 0;
    f += sh;
    stress = stress * 0.85 + Math.abs(sh);
    m = t === 0 ? m : m + sc.k * (f - m) + sc.vol * (1 + stress * 0.6) * r.normal();
    fair[t] = f;
    mid[t] = round2(m);
    hs[t] = round2(sc.halfSpread * (1 + Math.min(stress, 3)));
  }

  // client requests
  const requests = [];
  const pickType = () => {
    const u = r.next();
    if (u < sc.mix.corporate) return 'corporate';
    if (u < sc.mix.corporate + sc.mix.trader) return 'trader';
    return 'fund';
  };
  let lastReq = -10;
  for (let t = 3; t < N - REQUEST_LIFE; t++) {
    if (t - lastReq < 3 || !r.chance(sc.reqRate)) continue;
    lastReq = t;
    const type = pickType();
    const client = r.pick(CLIENTS.filter((c) => c.type === type));
    const pInformed = type === 'fund' ? sc.fundInformed : INFORMED_P[type];
    const informed = r.chance(pInformed);
    const move = mid[t + MARKOUT] - mid[t];
    const side = informed && Math.abs(move) > 0.03 ? (move > 0 ? 'buy' : 'sell') : r.chance(0.5) ? 'buy' : 'sell';
    const size = Math.round(r.int(client.size[0], client.size[1]) / 5) * 5;
    requests.push({
      id: requests.length,
      tick: t,
      client: client.name,
      type,
      desc: client.desc,
      size,
      side, // hidden from the player: what the client actually wants to do
      informed,
      tol: round2(r.range(client.tol[0], client.tol[1])),
    });
  }

  return { scenario: sc, seed: String(seed), N, mid, fair, hs, headlines, requests, calendar, physical };
}

// ---------- Helpers ----------
export function clock(t, N, sc) {
  if (sc?.ticksPerDay) {
    const day = Math.floor(t / sc.ticksPerDay) + 1;
    const hour = (t % sc.ticksPerDay) * (24 / sc.ticksPerDay);
    return `Day ${day} ${String(hour).padStart(2, '0')}:00`;
  }
  const minutes = 8 * 60 + Math.round((t / N) * 9 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function fmtSigned(x) {
  return (x > 0 ? '+' : '') + x.toFixed(1);
}

// ---------- Game ----------
export function createGame(world) {
  const sc = world.scenario;
  const s = {
    t: 0,
    cash: 0,
    pos: 0, // barrels
    penalties: 0,
    clientEdge: 0,
    hedgeEdge: 0,
    breachTicks: 0,
    forced: 0,
    missed: 0,
    passed: 0,
    quoted: 0,
    filled: 0,
    trades: [],
    rfq: new Map(), // id -> {req, status, ...}
    history: [],
    done: false,
    stoppedOut: false,
    maxDrawdown: 0,
    peak: 0,
    events: [],
  };

  const midAt = (t) => world.mid[Math.min(t, world.mid.length - 1)];
  let physical = null;
  const mtm = () => s.cash + s.pos * midAt(s.t) + (physical ? physical.ffaValue() + physical.cargoMark() : 0);
  const score = () => mtm() - s.penalties;
  const limitBbl = sc.limit * LOT;

  function book(qty, price, kind, extra = {}) {
    const m = midAt(s.t);
    const edge = -qty * (price - m);
    s.cash -= qty * price;
    s.pos += qty;
    if (kind === 'client') s.clientEdge += edge;
    else if (kind === 'physical') s.physEdge += edge;
    else s.hedgeEdge += edge;
    const tr = { t: s.t, qty, price, mid: m, kind, edge, ...extra };
    s.trades.push(tr);
    return tr;
  }

  function openRequests() {
    return world.requests.filter((q) => q.tick <= s.t && s.t < q.tick + REQUEST_LIFE && !s.rfq.has(q.id));
  }

  function quote(id, bid, offer) {
    if (s.done) return { ok: false, reason: 'Session over' };
    const req = world.requests[id];
    if (!req || s.rfq.has(id) || req.tick > s.t || s.t >= req.tick + REQUEST_LIFE) return { ok: false, reason: 'Request expired' };
    bid = round2(bid);
    offer = round2(offer);
    if (!(offer > bid)) return { ok: false, reason: 'Offer must be above bid' };
    s.quoted++;
    const m = midAt(s.t);
    const future = midAt(s.t + MARKOUT);
    let filled = false;
    let price = null;
    if (req.side === 'buy') {
      const limit = req.informed ? Math.max(m + req.tol, future - 0.03) : m + req.tol;
      if (offer <= limit + 1e-9) { filled = true; price = offer; }
    } else {
      const limit = req.informed ? Math.min(m - req.tol, future + 0.03) : m - req.tol;
      if (bid >= limit - 1e-9) { filled = true; price = bid; }
    }
    const res = { req, status: filled ? 'filled' : 'lost', bid, offer, t: s.t, width: round2(offer - bid), skew: round2((offer + bid) / 2 - m) };
    s.rfq.set(id, res);
    if (filled) {
      s.filled++;
      const qty = (req.side === 'buy' ? -1 : 1) * req.size * LOT;
      res.trade = book(qty, price, 'client', { client: req.client, type: req.type, informed: req.informed, reqId: id });
    }
    return { ok: true, ...res };
  }

  function pass(id) {
    const req = world.requests[id];
    if (!req || s.rfq.has(id) || s.done) return { ok: false };
    s.passed++;
    s.penalties += PENALTY.passed;
    s.rfq.set(id, { req, status: 'passed', t: s.t });
    return { ok: true };
  }

  function hedge(lots) {
    if (s.done || !lots) return null;
    const m = midAt(s.t);
    const h = world.hs[Math.min(s.t, world.hs.length - 1)];
    const price = round2(lots > 0 ? m + h : m - h);
    return book(lots * LOT, price, 'hedge');
  }

  function flatten() {
    const lots = -Math.round(s.pos / LOT);
    return lots ? hedge(lots) : null;
  }

  function record() {
    const sc_ = score();
    s.peak = Math.max(s.peak, sc_);
    s.maxDrawdown = Math.max(s.maxDrawdown, s.peak - sc_);
    s.history.push({ t: s.t, mid: midAt(s.t), pos: s.pos, phys: s.phys || 0, pnl: mtm(), score: sc_ });
  }

  // Advance the clock one tick. Returns what happened for the UI.
  function step() {
    if (s.done) return [];
    const ev = [];
    // expire requests that nobody answered
    for (const q of world.requests) {
      if (q.tick + REQUEST_LIFE === s.t + 1 && !s.rfq.has(q.id)) {
        s.missed++;
        s.penalties += PENALTY.missed;
        s.rfq.set(q.id, { req: q, status: 'missed', t: s.t });
        ev.push({ type: 'missed', req: q });
      }
    }
    // limit checks at end of tick
    const absPos = Math.abs(s.pos);
    if (absPos > limitBbl * 1.5) {
      const target = Math.sign(s.pos) * limitBbl * 0.5;
      const lots = Math.round((target - s.pos) / LOT);
      const m = midAt(s.t);
      const price = round2(m + Math.sign(lots) * (world.hs[s.t] + 0.1));
      book(lots * LOT, price, 'hedge', { forced: true });
      s.forced++;
      s.penalties += PENALTY.forced;
      ev.push({ type: 'forced', lots });
    } else if (absPos > limitBbl) {
      s.breachTicks++;
      s.penalties += PENALTY.breachPerTick;
      ev.push({ type: 'breach' });
    }
    record();
    if (score() < -sc.maxLoss) {
      if (physical) physical.close();
      s.done = true;
      s.stoppedOut = true;
      ev.push({ type: 'stopout' });
      return ev;
    }
    s.t++;
    for (const h of world.headlines) if (h.tick === s.t) ev.push({ type: 'headline', h });
    for (const q of world.requests) if (q.tick === s.t) ev.push({ type: 'request', req: q });
    if (physical) physical.onTick(ev);
    if (s.t >= world.N) {
      // futures are marked at mid; cargoes still on the water are sold where they are
      if (physical) physical.close();
      record();
      s.done = true;
      ev.push({ type: 'end' });
    }
    return ev;
  }

  // End the session now: unanswered clients count as missed, the book is marked where it stands.
  function finish() {
    if (s.done) return;
    for (const q of world.requests) {
      if (s.rfq.has(q.id)) continue;
      s.missed++;
      s.penalties += PENALTY.missed;
      s.rfq.set(q.id, { req: q, status: 'missed', t: s.t });
    }
    if (physical) physical.close();
    record();
    s.done = true;
  }

  if (world.physical) physical = physicalDesk({ world, s, book, hedge, midAt });

  return {
    world,
    state: s,
    physical,
    mid: () => midAt(s.t),
    bid: () => round2(midAt(s.t) - world.hs[Math.min(s.t, world.hs.length - 1)]),
    ask: () => round2(midAt(s.t) + world.hs[Math.min(s.t, world.hs.length - 1)]),
    mtm,
    score,
    limitBbl,
    openRequests,
    quote,
    pass,
    hedge,
    flatten,
    step,
    finish,
    visibleHeadlines: () => world.headlines.filter((h) => h.tick <= s.t),
  };
}

// ---------- Benchmark bots ----------
// Each bot plays the exact same world as the player.
const BOTS = [
  {
    id: 'junior',
    name: 'Junior Trader',
    width: { corporate: 0.06, trader: 0.06, fund: 0.06 },
    skewPerLot: 0,
    hedgeAt: 0.15,
    hedgeTo: 0,
    news: null,
    physical: { minMargin: 0.35 },
  },
  {
    id: 'senior',
    name: 'Senior Trader',
    width: { corporate: 0.05, trader: 0.08, fund: 0.14 },
    skewPerLot: 0.0003,
    hedgeAt: 0.2,
    hedgeTo: 0.05,
    news: { lag: 3, minImpact: 0.7, lots: 0.3, hold: 12, trustRumours: false },
    physical: { minMargin: 0.15 },
  },
  {
    id: 'head',
    name: 'Head of Desk',
    width: { corporate: 0.05, trader: 0.1, fund: 0.2 },
    skewPerLot: 0.0005,
    hedgeAt: 0.25,
    hedgeTo: 0.05,
    news: { lag: 1, minImpact: 0.5, lots: 0.5, hold: 10, trustRumours: false },
    physical: { minMargin: 0.05, ffa: { lag: 1, lots: 3, hold: 12, min: 3000 } },
  },
];

export function runBot(world, botId) {
  const bot = BOTS.find((b) => b.id === botId);
  const g = createGame(world);
  const s = g.state;
  const L = world.scenario.limit;
  const exits = [];
  let newsLots = 0; // directional news position, kept apart from client inventory
  // client inventory only: excludes news trades, cargoes and the futures hedging them
  const inventory = () => (s.pos - (s.phys || 0) - (s.cargoHedge || 0)) / LOT - newsLots;
  while (!s.done) {
    const posLots = inventory();
    for (const q of g.openRequests()) {
      if (q.tick + 1 > s.t) continue; // bots take a tick to respond
      const w = bot.width[q.type];
      const skew = -posLots * bot.skewPerLot;
      const m = g.mid();
      g.quote(q.id, m - w + skew, m + w + skew);
    }
    if (bot.news) {
      for (const h of world.headlines) {
        if (h.tick + bot.news.lag !== s.t) continue;
        if (h.tag === 'RUMOUR' && !bot.news.trustRumours) continue;
        if (Math.abs(h.impact) < bot.news.minImpact) continue;
        const lots = Math.sign(h.impact) * Math.round(L * bot.news.lots);
        g.hedge(lots);
        newsLots += lots;
        exits.push({ at: s.t + bot.news.hold, lots: -lots });
      }
      for (const e of exits) if (!e.ffa && e.at === s.t) { g.hedge(e.lots); newsLots += e.lots; }
    }
    if (g.physical) {
      botPhysical(g, bot.physical);
      const ffa = bot.physical.ffa;
      if (ffa) {
        for (const h of world.headlines) {
          if (h.tick + ffa.lag !== s.t || !h.phys?.rate || h.tag === 'RUMOUR') continue;
          for (const [cls, x] of Object.entries(h.phys.rate)) {
            if (Math.abs(x) < ffa.min || !s.ffa[cls]) continue;
            const lots = Math.sign(x) * ffa.lots;
            if (g.physical.tradeFFA(cls, lots).ok) exits.push({ at: s.t + ffa.hold, ffa: cls, lots: -lots });
          }
        }
        for (const e of exits) if (e.ffa && e.at === s.t) g.physical.tradeFFA(e.ffa, e.lots);
      }
    }
    const p = inventory();
    if (Math.abs(p) > L * bot.hedgeAt) g.hedge(Math.round(-p + Math.sign(p) * L * bot.hedgeTo));
    g.step();
  }
  return { id: bot.id, name: bot.name, score: g.score() };
}

export function benchmarks(world) {
  return BOTS.map((b) => runBot(world, b.id));
}

// ---------- Debrief ----------
export function analyse(game) {
  const { world, state: s } = game;
  const N = world.N;
  const midAt = (t) => world.mid[Math.min(t, world.mid.length - 1)];
  const final = game.mtm();
  const phys = world.physical ? analysePhysical(game) : null;
  const physEdge = (s.physEdge || 0) + (game.physical ? game.physical.cargoMark() : 0);
  const freightCost = s.freightCost || 0;
  const ffaPnl = phys ? phys.ffaPnl : 0;
  const market = final - s.clientEdge - s.hedgeEdge - physEdge - freightCost - ffaPnl;

  const byType = {};
  for (const type of ['corporate', 'trader', 'fund']) byType[type] = { type, requests: 0, fills: 0, edge: 0, markout: 0, lots: 0, widthSum: 0, quotes: 0 };
  for (const q of world.requests) if (q.tick < s.t || s.done) byType[q.type].requests++;
  for (const r of s.rfq.values()) {
    if (r.status === 'filled' || r.status === 'lost') { byType[r.req.type].quotes++; byType[r.req.type].widthSum += r.width; }
  }
  for (const tr of s.trades) {
    if (tr.kind !== 'client') continue;
    const b = byType[tr.type];
    b.fills++;
    b.edge += tr.edge;
    b.lots += Math.abs(tr.qty) / LOT;
    b.markout += tr.qty * (midAt(tr.t + MARKOUT) - tr.price);
  }

  // news reactions: did the player trade with a big confirmed headline within 6 ticks?
  const reactions = [];
  for (const h of world.headlines) {
    if (h.tick > s.t || Math.abs(h.impact) < 0.7 || h.tag === 'RUMOUR') continue;
    const window = s.trades.filter((tr) => tr.kind === 'hedge' && !tr.forced && !tr.cargo && tr.t >= h.tick && tr.t <= h.tick + 6);
    const net = window.reduce((a, tr) => a + tr.qty, 0) / LOT;
    const first = window.find((tr) => Math.sign(tr.qty) === Math.sign(h.impact));
    const posBefore = posAt(s, h.tick - 1) / LOT;
    reactions.push({
      h,
      net,
      right: Math.sign(net) === Math.sign(h.impact) || (net === 0 && Math.sign(posBefore) === Math.sign(h.impact)),
      delay: first ? first.t - h.tick : null,
      posBefore,
    });
  }
  const rumourChases = [];
  for (const h of world.headlines) {
    if (h.tag !== 'RUMOUR' || h.tick > s.t) continue;
    const net = s.trades.filter((tr) => tr.kind === 'hedge' && tr.t >= h.tick && tr.t <= h.tick + 6).reduce((a, tr) => a + tr.qty, 0) / LOT;
    if (Math.sign(net) === Math.sign(h.impact) && Math.abs(net) >= 20) rumourChases.push({ h, net, truth: h.truth });
  }

  const heavyTicks = s.history.filter((x) => Math.abs(x.pos) > game.limitBbl * 0.8).length;
  const avgAbsPos = s.history.reduce((a, x) => a + Math.abs(x.pos), 0) / Math.max(1, s.history.length) / LOT;
  const answered = s.quoted;
  const totalReq = world.requests.filter((q) => q.tick <= s.t).length;

  const coach = [];
  const f = byType.fund;
  if (f.fills >= 2 && f.markout < -2000) {
    coach.push({ sev: 'bad', text: `Hedge-fund fills marked out at ${money(f.markout)} after ${MARKOUT} ticks. They trade when they know where price is going. Quote them wider (30–40¢) and skew away from their likely side after news.` });
  }
  const c = byType.corporate;
  if (c.quotes >= 3) {
    const hit = c.fills / c.quotes;
    const avgW = c.widthSum / c.quotes;
    if (hit < 0.4) coach.push({ sev: 'warn', text: `Only ${(hit * 100).toFixed(0)}% of corporate quotes traded (avg width ${(avgW * 100).toFixed(0)}¢). Corporate hedgers are your bread and butter: tighten to ~8–10¢ wide to win the flow.` });
    else if (hit > 0.9 && avgW < 0.08) coach.push({ sev: 'warn', text: `Every corporate quote traded at ${(avgW * 100).toFixed(0)}¢ wide. You are leaving money on the table. Try 2–4¢ wider and watch the hit rate.` });
    else coach.push({ sev: 'good', text: `Corporate flow: ${(hit * 100).toFixed(0)}% hit rate at ${(avgW * 100).toFixed(1)}¢ average width. That's a healthy market-making balance.` });
  }
  if (s.missed > 0) coach.push({ sev: 'bad', text: `${s.missed} client request${s.missed > 1 ? 's' : ''} timed out (−${money(s.missed * PENALTY.missed)}). Always show a price, even a wide one. A wide quote costs nothing, a missed client costs franchise.` });
  if (s.breachTicks > 0 || s.forced > 0) coach.push({ sev: 'bad', text: `Risk limit breached for ${s.breachTicks} tick${s.breachTicks === 1 ? '' : 's'}${s.forced ? ` and the risk manager force-cut you ${s.forced}×` : ''}. Hedge as soon as a big client fill lands. Don't wait for a better price.` });
  if (heavyTicks > N * 0.2) coach.push({ sev: 'warn', text: `You ran over 80% of your limit for ${heavyTicks} ticks. Big positions turn every headline into a coin flip. Keep a buffer so you can absorb the next client trade.` });
  const screenHedges = s.trades.filter((t) => t.kind === 'hedge' && !t.cargo);
  const screenCost = screenHedges.reduce((a, t) => a + t.edge, 0);
  if (screenHedges.length && -screenCost > Math.max(s.clientEdge, 1) * 0.8) coach.push({ sev: 'warn', text: `Hedging costs (${money(screenCost)}) ate most of your client spread (${money(s.clientEdge)}). You're over-trading the screen. Let small positions sit, and use skew to get clients to flatten you for free.` });
  const missedNews = reactions.filter((r) => !r.right);
  if (reactions.length) {
    const good = reactions.length - missedNews.length;
    coach.push({ sev: good >= reactions.length / 2 ? 'good' : 'warn', text: `Big confirmed headlines: you were positioned the right way on ${good} of ${reactions.length}. The price takes a few ticks to fully reprice. Read the headline, decide bullish or bearish, and trade in the first 1–3 ticks.` });
  }
  const badChase = rumourChases.filter((r) => !r.truth);
  if (badChase.length) coach.push({ sev: 'bad', text: `You chased ${badChase.length} rumour${badChase.length > 1 ? 's' : ''} that were later denied. Rumours move price, but only partly. Trade them small, or wait for confirmation.` });
  if (s.stoppedOut) coach.push({ sev: 'bad', text: `Stopped out: you hit the desk's loss limit of ${money(world.scenario.maxLoss)}. Survival first: the best traders size down when they're wrong.` });
  if (phys) coach.push(...phys.coach);
  if (!coach.length) coach.push({ sev: 'good', text: 'Clean session. Now try a harder scenario or Ranked mode.' });

  return {
    final,
    score: game.score(),
    clientEdge: s.clientEdge,
    hedgeEdge: s.hedgeEdge,
    market,
    penalties: s.penalties,
    byType,
    reactions,
    rumourChases,
    heavyTicks,
    avgAbsPos,
    maxDrawdown: s.maxDrawdown,
    answered,
    totalReq,
    coach,
    physEdge,
    freightCost,
    ffaPnl,
    demurrage: s.demurrage || 0,
    phys,
  };
}

function posAt(s, t) {
  let p = 0;
  for (const tr of s.trades) if (tr.t <= t) p += tr.qty;
  return p;
}

export function grade(score, bench) {
  const by = Object.fromEntries(bench.map((b) => [b.id, b.score]));
  if (score >= by.head) return { letter: 'S', label: 'Beat the Head of Desk' };
  if (score >= by.senior) return { letter: 'A', label: 'Senior-trader level' };
  if (score >= by.junior) return { letter: 'B', label: 'Beat the junior' };
  if (score > 0) return { letter: 'C', label: 'Profitable, but the bots did better' };
  return { letter: 'D', label: 'Lost money. Read the debrief' };
}

export function money(x) {
  const sign = x < 0 ? '−' : '';
  const a = Math.abs(Math.round(x));
  return `${sign}$${a.toLocaleString('en-US')}`;
}

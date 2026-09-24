// Crude Desk — physical cargoes and freight.
// A cargo is bought FOB at the load port (Brent + a differential), shipped on a
// chartered tanker, and sold delivered (DES) at the destination (Brent + another
// differential). The arb is: DES diff − FOB diff − freight per barrel.
// The cargo is also a flat-price position in barrels, so it shares the desk's
// position limit with futures and should be hedged with them.

export const VESSELS = {
  aframax: { name: 'Aframax', bbl: 600000, rate: 38000, vol: 300, demurrage: 32000 },
  suezmax: { name: 'Suezmax', bbl: 1000000, rate: 45000, vol: 380, demurrage: 42000 },
  vlcc: { name: 'VLCC', bbl: 2000000, rate: 52000, vol: 450, demurrage: 58000 },
};

export const ORIGINS = {
  usgc: { name: 'Houston', region: 'US Gulf Coast', grade: 'WTI Midland', fob: -0.9, classes: ['aframax', 'vlcc'], sellers: ['Permian Crude Marketing', 'Gulf Coast Energy Trading'] },
  nsea: { name: 'Hound Point', region: 'North Sea', grade: 'Forties', fob: -0.1, classes: ['aframax', 'suezmax'], sellers: ['North Sea Equity Lifter', 'Grangemouth Supply Co.'] },
  meg: { name: 'Basrah', region: 'Mideast Gulf', grade: 'Basrah Medium', fob: -1.6, classes: ['suezmax', 'vlcc'], sellers: ['Basrah Export Co.', 'Gulf Marketing House'] },
};

export const DESTS = {
  rdam: { name: 'Rotterdam', region: 'NW Europe' },
  ningbo: { name: 'Ningbo', region: 'China' },
  sikka: { name: 'Sikka', region: 'India' },
};

// Laden voyage days, origin → destination (round numbers, via the usual canal or cape route).
export const VOYAGE_DAYS = {
  usgc: { rdam: 16, ningbo: 45, sikka: 36 },
  nsea: { rdam: 2, ningbo: 40, sikka: 26 },
  meg: { rdam: 30, ningbo: 20, sikka: 5 },
};

export const PHYS = {
  ballast: 1.6, // charter covers the laden leg plus ~60% for positioning/ballast
  portCost: 200000, // port, canal and agency costs per voyage
  saleDiscount: 0.05, // a receiver's bid sits a little under the assessed DES diff
  afloatDiscount: 0.3, // selling a cargo still at sea when the book closes
  distressDiscount: 0.6, // forced sale after too long waiting at the discharge port
  freeDays: 2, // laytime before demurrage starts
  maxWaitDays: 5, // after this the cargo is sold for you, badly
  offerLife: 8, // ticks a seller holds an offer
  ffaDays: 30, // one FFA lot = 30 days of hire
  ffaHalfSpread: 500, // $/day
  ffaMax: 10, // lots per vessel class
};

export function freightCost(rate, days) {
  return rate * days * PHYS.ballast + PHYS.portCost;
}

const PHYS_NEWS = [
  { text: 'Chinese independent refiners receive fresh crude import quotas', des: { ningbo: [0.25, 0.5] } },
  { text: 'Rotterdam refinery outage takes 200k b/d unit offline for repairs', des: { rdam: [-0.4, -0.2] } },
  { text: 'Indian refiners step up spot crude purchases ahead of peak demand', des: { sikka: [0.2, 0.45] } },
  { text: 'Permian pipeline maintenance trims WTI Midland export volumes', fob: { usgc: [0.25, 0.5] } },
  { text: 'Iraq raises Basrah Medium official selling price for next month', fob: { meg: [0.2, 0.4] } },
  { text: 'Heavy North Sea loading programme leaves Forties cargoes unsold', fob: { nsea: [-0.35, -0.15] } },
  { text: 'Owners avoid Red Sea after attacks; tanker ton-miles jump', rate: { aframax: [4000, 7000], suezmax: [5000, 9000], vlcc: [3000, 6000] } },
  { text: 'VLCC fixtures out of the Mideast Gulf hit six-month high', rate: { vlcc: [6000, 12000] } },
  { text: 'Record newbuild tanker deliveries weigh on charter rates', rate: { aframax: [-4000, -2000], suezmax: [-5000, -2500], vlcc: [-6000, -3000] } },
  { text: 'Turkish Straits delays tie up Aframax tonnage', rate: { aframax: [3000, 6000] } },
  { text: 'Fog closes Houston Ship Channel for two days', rate: { aframax: [1500, 3000] }, fob: { usgc: [-0.2, -0.1] } },
  { text: 'Chinese port congestion eases; VLCC availability improves', rate: { vlcc: [-7000, -3000] } },
  { text: 'European refiners cut runs on weak margins', des: { rdam: [-0.35, -0.15] } },
  { text: 'Suezmax demand firms as West African cargoes head east', rate: { suezmax: [3000, 6000] } },
];

const r2 = (x) => Math.round(x * 100) / 100;

// Build diffs, freight rates, cargo offers and physical headlines for a world.
export function buildPhysical(r, sc, N, headlines) {
  const cfg = sc.physical;
  const tpd = sc.ticksPerDay;
  const len = N + 2;
  const origins = cfg.origins;
  const dests = cfg.dests;
  const classes = [...new Set(origins.flatMap((o) => ORIGINS[o].classes))];
  const zero = () => new Float64Array(len);
  const fobShock = Object.fromEntries(origins.map((o) => [o, zero()]));
  const desShock = Object.fromEntries(dests.map((d) => [d, zero()]));
  const rateShock = Object.fromEntries(classes.map((c) => [c, zero()]));

  const apply = (t, ev) => {
    for (const [o, x] of Object.entries(ev.fob || {})) if (fobShock[o]) fobShock[o][t] += x;
    for (const [d, x] of Object.entries(ev.des || {})) if (desShock[d]) desShock[d][t] += x;
    for (const [c, x] of Object.entries(ev.rate || {})) if (rateShock[c]) rateShock[c][t] += x;
  };
  const relevant = (ev) =>
    Object.keys(ev.fob || {}).some((o) => fobShock[o]) ||
    Object.keys(ev.des || {}).some((d) => desShock[d]) ||
    Object.keys(ev.rate || {}).some((c) => rateShock[c]);

  for (const ev of cfg.script || []) {
    headlines.push({ tick: ev.at, text: ev.text, tag: ev.tag || 'FREIGHT', impact: 0, phys: { fob: ev.fob, des: ev.des, rate: ev.rate } });
    apply(ev.at, ev);
  }
  const used = new Set();
  for (let t = 6; t < N - 6; t++) {
    if (!r.chance(cfg.newsRate)) continue;
    const item = r.pick(PHYS_NEWS);
    if (used.has(item.text) || !relevant(item)) continue;
    used.add(item.text);
    const draw = (m) => (m ? Object.fromEntries(Object.entries(m).map(([k, [lo, hi]]) => [k, r.range(lo, hi)])) : undefined);
    const ev = { fob: draw(item.fob), des: draw(item.des), rate: draw(item.rate) };
    headlines.push({ tick: t, text: item.text, tag: item.rate ? 'FREIGHT' : 'PHYSICAL', impact: 0, phys: ev });
    apply(t, ev);
  }

  // A series chases a "fair" level that jumps on news and slowly reverts to base.
  const series = (base, shocks, k, revert, vol, round) => {
    const out = zero();
    let f = base;
    let v = base;
    for (let t = 0; t < len; t++) {
      f += shocks[t] + revert * (base - f);
      v = t === 0 ? v : v + k * (f - v) + vol * r.normal();
      out[t] = round(v);
    }
    return out;
  };

  const rate = {};
  for (const c of classes) {
    const base = Math.round((VESSELS[c].rate * r.range(0.9, 1.1)) / 50) * 50;
    rate[c] = series(base, rateShock[c], 0.2, 0.004, VESSELS[c].vol, (x) => Math.max(8000, Math.round(x / 50) * 50));
  }
  const fob = {};
  for (const o of origins) fob[o] = series(ORIGINS[o].fob + r.range(-0.12, 0.12), fobShock[o], 0.35, 0.01, 0.012, r2);
  const des = {};
  for (const o of origins) {
    des[o] = {};
    for (const d of dests) {
      const typical = Math.min(...ORIGINS[o].classes.map((c) => freightCost(VESSELS[c].rate, VOYAGE_DAYS[o][d]) / VESSELS[c].bbl));
      const base = ORIGINS[o].fob + typical + PHYS.saleDiscount + r.range(-0.3, 0.3);
      des[o][d] = series(base, desShock[d], 0.35, 0.01, 0.012, r2);
    }
  }

  const offers = [];
  let last = -99;
  for (let t = 2; t < N - 10; t++) {
    if (t - last < cfg.minGap || !r.chance(cfg.offerRate)) continue;
    const o = r.pick(origins);
    const shortest = Math.min(...dests.map((d) => VOYAGE_DAYS[o][d]));
    if (t + shortest * tpd + 2 >= N) continue;
    last = t;
    const cls = r.pick(ORIGINS[o].classes);
    const distressed = r.chance(0.12);
    offers.push({
      id: offers.length,
      tick: t,
      origin: o,
      grade: ORIGINS[o].grade,
      cls,
      bbl: VESSELS[cls].bbl,
      prem: r2(distressed ? r.range(-0.45, -0.25) : r.range(-0.06, 0.2)),
      distressed,
      seller: r.pick(ORIGINS[o].sellers),
    });
  }

  return { tpd, origins, dests, classes, fob, des, rate, offers };
}

// Physical book attached to a game. Uses the game's own booking so futures and
// cargoes share one position, one cash account and one set of limits.
export function physicalDesk({ world, s, book, hedge, midAt }) {
  const P = world.physical;
  const tpd = P.tpd;
  s.cargoes = [];
  s.offersTaken = new Set();
  s.phys = 0; // barrels on cargoes
  s.cargoHedge = 0; // barrels of futures sold against cargoes
  s.physEdge = 0;
  s.freightCost = 0; // charter + demurrage (negative)
  s.demurrage = 0;
  s.ffa = Object.fromEntries(P.classes.map((c) => [c, { lots: 0, cash: 0 }]));

  const at = (arr) => arr[Math.min(s.t, arr.length - 1)];
  const fob = (o) => at(P.fob[o]);
  const des = (o, d) => at(P.des[o][d]);
  const rate = (c) => at(P.rate[c]);
  const offerAsk = (offer) => r2(fob(offer.origin) + offer.prem);

  const openOffers = () => P.offers.filter((o) => o.tick <= s.t && s.t < o.tick + PHYS.offerLife && !s.offersTaken.has(o.id));

  function quoteVoyage(offer, d, cls) {
    const days = VOYAGE_DAYS[offer.origin][d];
    const ticks = days * tpd;
    const freight = freightCost(rate(cls), days);
    const freightBbl = freight / offer.bbl;
    const fobAsk = offerAsk(offer);
    const desBid = r2(des(offer.origin, d) - PHYS.saleDiscount);
    const margin = desBid - fobAsk - freightBbl;
    return {
      dest: d, cls, days, ticks, arrive: s.t + ticks, freight, freightBbl, fobAsk, desBid, margin,
      total: margin * offer.bbl,
      fits: VESSELS[cls].bbl >= offer.bbl,
      late: s.t + ticks >= world.N,
    };
  }

  function buyCargo(offerId, d, cls, { hedge: doHedge = true } = {}) {
    const offer = P.offers[offerId];
    if (s.done || !offer || !openOffers().includes(offer)) return { ok: false, reason: 'The seller has withdrawn that cargo' };
    if (!P.dests.includes(d)) return { ok: false, reason: 'Pick a destination' };
    if (!VESSELS[cls] || VESSELS[cls].bbl < offer.bbl) return { ok: false, reason: 'That ship is too small for the cargo' };
    const q = quoteVoyage(offer, d, cls);
    s.offersTaken.add(offerId);
    const m = midAt(s.t);
    const origin = ORIGINS[offer.origin];
    const buy = book(offer.bbl, r2(m + q.fobAsk), 'physical', { label: `${offer.grade} FOB ${origin.name}`, diff: q.fobAsk });
    s.cash -= q.freight;
    s.freightCost -= q.freight;
    s.trades.push({ t: s.t, qty: 0, price: rate(cls), kind: 'freight', edge: -q.freight, label: `${VESSELS[cls].name} ${origin.name} → ${DESTS[d].name}, ${q.days}d @ $${rate(cls).toLocaleString('en-US')}/day` });
    const cargo = {
      id: s.cargoes.length, offerId, origin: offer.origin, grade: offer.grade, dest: d, cls, bbl: offer.bbl,
      buyTick: s.t, fobDiff: q.fobAsk, flatBuy: buy.price, freight: q.freight, freightBbl: q.freightBbl,
      arriveTick: s.t + q.ticks, status: 'sailing', hedgeLots: 0, demurrage: 0, planned: q.margin,
    };
    s.cargoes.push(cargo);
    s.phys += offer.bbl;
    if (doHedge) {
      const lots = -Math.round(offer.bbl / 1000);
      const h = hedge(lots);
      if (h) h.cargo = true;
      cargo.hedgeLots = lots;
      s.cargoHedge += lots * 1000;
    }
    return { ok: true, cargo, quote: q };
  }

  function sellCargo(id, { unhedge = true, discount = PHYS.saleDiscount, why = 'sold' } = {}) {
    const c = s.cargoes[id];
    if (!c || c.status === 'sold') return { ok: false, reason: 'Cargo already sold' };
    if (c.status !== 'arrived' && why === 'sold') return { ok: false, reason: 'The ship has not arrived yet' };
    const m = midAt(s.t);
    const diff = r2(des(c.origin, c.dest) - discount);
    const tr = book(-c.bbl, r2(m + diff), 'physical', { label: `${c.grade} DES ${DESTS[c.dest].name}`, diff });
    c.status = 'sold';
    c.how = why;
    c.sellTick = s.t;
    c.desDiff = diff;
    c.flatSell = tr.price;
    c.pnl = (diff - c.fobDiff) * c.bbl - c.freight - c.demurrage;
    s.phys -= c.bbl;
    if (unhedge && c.hedgeLots) {
      const h = hedge(-c.hedgeLots);
      if (h) h.cargo = true;
      s.cargoHedge -= c.hedgeLots * 1000;
      c.hedgeLots = 0;
    }
    return { ok: true, cargo: c };
  }

  function tradeFFA(cls, lots) {
    const f = s.ffa[cls];
    if (s.done || !f || !lots) return { ok: false };
    if (Math.abs(f.lots + lots) > PHYS.ffaMax) return { ok: false, reason: `FFA limit is ±${PHYS.ffaMax} lots per vessel class` };
    const price = rate(cls) + Math.sign(lots) * PHYS.ffaHalfSpread;
    f.lots += lots;
    f.cash -= lots * PHYS.ffaDays * price;
    s.trades.push({ t: s.t, qty: 0, lots, cls, price, kind: 'ffa', edge: -Math.abs(lots) * PHYS.ffaDays * PHYS.ffaHalfSpread, label: `${VESSELS[cls].name} FFA` });
    return { ok: true };
  }

  // Unsold cargoes are marked at today's delivered (DES) differential at their
  // destination. Flat price is already in the desk position, so only the diff is marked here.
  const cargoMark = () => s.cargoes.reduce((a, c) => (c.status === 'sold' ? a : a + c.bbl * (des(c.origin, c.dest) - PHYS.saleDiscount)), 0);
  const ffaValue = () => P.classes.reduce((a, c) => a + s.ffa[c].cash + s.ffa[c].lots * PHYS.ffaDays * rate(c), 0);

  // Called after the clock advances.
  function onTick(ev) {
    for (const o of P.offers) if (o.tick === s.t) ev.push({ type: 'offer', offer: o });
    for (const c of s.cargoes) {
      if (c.status === 'sailing' && s.t >= c.arriveTick) {
        c.status = 'arrived';
        ev.push({ type: 'arrived', cargo: c });
      } else if (c.status === 'arrived') {
        const waited = s.t - c.arriveTick;
        if (waited > PHYS.freeDays * tpd) {
          const cost = VESSELS[c.cls].demurrage / tpd;
          s.cash -= cost;
          s.freightCost -= cost;
          s.demurrage += cost;
          c.demurrage += cost;
        }
        if (waited >= PHYS.maxWaitDays * tpd) {
          sellCargo(c.id, { discount: PHYS.distressDiscount, why: 'distressed' });
          ev.push({ type: 'distressed', cargo: c });
        }
      }
    }
  }

  // End of session: whatever is unsold gets sold where it is.
  function close() {
    for (const c of s.cargoes) {
      if (c.status === 'arrived') sellCargo(c.id, { unhedge: false, why: 'end' });
      else if (c.status === 'sailing') sellCargo(c.id, { unhedge: false, discount: PHYS.afloatDiscount, why: 'afloat' });
    }
  }

  return { fob, des, rate, offerAsk, openOffers, quoteVoyage, buyCargo, sellCargo, tradeFFA, ffaValue, cargoMark, onTick, close };
}

// Bot behaviour on the physical desk.
export function botPhysical(g, cfg) {
  const s = g.state;
  const ph = g.physical;
  for (const offer of ph.openOffers()) {
    if (offer.tick + 1 > s.t) continue;
    let best = null;
    for (const d of g.world.physical.dests) {
      const q = ph.quoteVoyage(offer, d, offer.cls);
      if (q.late || q.arrive + 2 >= g.world.N) continue;
      const score = cfg.ignoreFreight ? q.desBid - q.fobAsk : q.margin - 0.04;
      if (!best || score > best.score) best = { ...q, score };
    }
    if (best && best.score > cfg.minMargin) ph.buyCargo(offer.id, best.dest, offer.cls, { hedge: cfg.hedge !== false });
  }
  for (const c of s.cargoes) if (c.status === 'arrived') ph.sellCargo(c.id);
}

export function analysePhysical(game) {
  const { world, state: s } = game;
  const P = world.physical;
  const cargoes = s.cargoes;
  const ffaPnl = game.physical.ffaValue();
  const ffaTrades = s.trades.filter((t) => t.kind === 'ffa').length;
  const losers = cargoes.filter((c) => c.status === 'sold' && c.pnl < 0);
  const oversize = cargoes.filter((c) => VESSELS[c.cls].bbl > c.bbl);
  const late = cargoes.filter((c) => c.how === 'afloat' || c.how === 'distressed');
  const exposed = s.history.filter((x) => x.phys > 0 && Math.abs(x.pos) > x.phys * 0.5).length;

  // cargoes you let go where the arb was clearly open
  let missedArbs = 0;
  for (const offer of P.offers) {
    if (offer.tick > s.t || s.offersTaken.has(offer.id)) continue;
    const t = offer.tick;
    const days = (d) => VOYAGE_DAYS[offer.origin][d];
    const best = Math.max(...P.dests.map((d) => {
      if (t + days(d) * P.tpd >= world.N) return -Infinity;
      const ask = P.fob[offer.origin][t] + offer.prem;
      return P.des[offer.origin][d][t] - PHYS.saleDiscount - ask - freightCost(P.rate[offer.cls][t], days(d)) / offer.bbl;
    }));
    if (best > 0.3) missedArbs++;
  }

  const coach = [];
  if (losers.length) coach.push({ sev: 'bad', text: `${losers.length} cargo${losers.length > 1 ? 'es' : ''} lost money on the differentials after freight. Before you buy, check that DES − FOB − freight per barrel is comfortably positive. The planner shows it for every destination.` });
  if (exposed > 8) coach.push({ sev: 'bad', text: `You carried unhedged cargo for ${exposed} ticks. A 600k bbl cargo moves $600k for every $1 on Brent. Sell futures when you buy the cargo and buy them back when you sell it, so you keep only the arb.` });
  if (s.demurrage > 0) coach.push({ sev: 'warn', text: `You paid ${fmt(s.demurrage)} in demurrage. Ships cost money while they wait. Sell the cargo as soon as it arrives unless the delivered price is clearly rising.` });
  if (oversize.length) coach.push({ sev: 'warn', text: `${oversize.length} cargo${oversize.length > 1 ? 'es' : ''} went on a ship bigger than needed. You pay hire for the whole ship, so the freight per barrel goes up ("dead freight").` });
  if (late.length) coach.push({ sev: 'warn', text: `${late.length} cargo${late.length > 1 ? 'es were' : ' was'} sold at a discount (still at sea at the close, or left too long in port). Match voyage length to the time you have left.` });
  if (missedArbs > 0) coach.push({ sev: 'warn', text: `You let ${missedArbs} cargo offer${missedArbs > 1 ? 's' : ''} expire when the arb was open by 30¢/bbl or more. On a 600k bbl cargo that's over $180k each.` });
  if (ffaTrades) coach.push({ sev: ffaPnl >= 0 ? 'good' : 'warn', text: `Freight derivatives (FFAs) made ${fmt(ffaPnl)}. Freight headlines reprice charter rates over a few ticks, just like Brent. Use FFAs to trade that, or to lock in freight before you fix a ship.` });
  if (!cargoes.length) coach.push({ sev: 'warn', text: 'You didn\'t trade any cargoes. On the physical desk the arb is where most of the money is. Buy, ship and sell at least a couple.' });
  else if (!losers.length) coach.push({ sev: 'good', text: `All ${cargoes.length} cargo${cargoes.length > 1 ? 'es' : ''} made money on the differentials. Good arb discipline.` });

  return { cargoes, ffaPnl, coach, missedArbs };
}

function fmt(x) {
  const a = Math.abs(Math.round(x));
  return `${x < 0 ? '−' : ''}$${a.toLocaleString('en-US')}`;
}

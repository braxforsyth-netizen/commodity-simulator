import {
  SCENARIOS, LOT, REQUEST_LIFE, PENALTY,
  buildWorld, createGame, benchmarks, analyse, grade, money, clock, round2, scenarioById,
} from './engine.js';
import { VESSELS, ORIGINS, DESTS, PHYS } from './physical.js';

const $ = (id) => document.getElementById(id);
const clk = (t) => clock(t, ui.game.world.N, ui.game.world.scenario);
const CHART_KINDS = new Set(['client', 'hedge', 'physical']);
const SIZES = [10, 25, 50, 100];
const BOARD_KEY = 'crudedesk.board.v1';
const PREFS_KEY = 'crudedesk.prefs.v1';

const ui = {
  scenarioId: 'orientation',
  mode: 'practice',
  seed: dailySeed(),
  speed: 1000,
  game: null,
  bench: null,
  timer: null,
  paused: true,
  started: false,
  selected: null,
  width: 10, // cents, bid-to-offer
  skew: 0, // cents
  size: 1, // index into SIZES
  saved: false,
  offerSel: null, // physical desk: selected cargo offer
  destSel: null,
  vesselSel: null,
  hedgeCargo: true,
};

// ---------- storage (best effort) ----------
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

function dailySeed() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- Lobby ----------
function renderLobby() {
  $('scenList').innerHTML = SCENARIOS.map((sc) => `
    <button class="scen" data-id="${sc.id}" aria-pressed="${sc.id === ui.scenarioId}">
      <span class="lvl">L${sc.difficulty}</span>
      <span>
        <h3>${sc.name}</h3>
        <p>${sc.brief}</p>
        <span class="meta"><span>limit ±${sc.limit} lots</span><span>stop-loss ${money(sc.maxLoss)}</span><span>${sc.ticks} ticks</span><span>${sc.physical ? `cargoes from ${sc.physical.origins.map((o) => ORIGINS[o].grade).join(', ')}` : `hedge funds ${Math.round(sc.mix.fund * 100)}% of flow`}</span></span>
      </span>
      <span class="chip">${sc.tag}</span>
    </button>`).join('');
  $('scenList').querySelectorAll('.scen').forEach((b) => b.addEventListener('click', () => {
    ui.scenarioId = b.dataset.id;
    savePrefs();
    renderLobby();
  }));
  $('seedInput').value = ui.seed;
  $('modePractice').setAttribute('aria-pressed', ui.mode === 'practice');
  $('modeRanked').setAttribute('aria-pressed', ui.mode === 'ranked');
  $('modeNote').textContent = ui.mode === 'practice'
    ? 'Coaching hints on, pause allowed. Scores are not saved to the leaderboard.'
    : 'No hints, no pause. Your score goes on the leaderboard.';
  $('speed1').setAttribute('aria-pressed', ui.speed === 1000);
  $('speed2').setAttribute('aria-pressed', ui.speed !== 1000);
  const w = buildWorld(ui.scenarioId, ui.seed);
  $('lobbyPx').textContent = w.mid[0].toFixed(2);
  $('lobbyDate').textContent = `seed ${ui.seed}`;
  renderBoard(benchmarks(w));
}

function renderBoard(bench) {
  const sc = scenarioById(ui.scenarioId);
  $('boardScen').textContent = sc.name;
  const all = (load(BOARD_KEY, {})[sc.id] || []).slice().sort((a, b) => b.score - a.score).slice(0, 8);
  const rows = all.map((r, i) => `<tr${r.fresh ? ' class="you"' : ''}><td class="num">${i + 1}</td><td>${esc(r.initials)}</td><td class="num">${esc(r.seed)}</td><td class="r num">${money(r.score)}</td></tr>`);
  const botRows = bench.slice().reverse().map((b) => `<tr class="bot"><td></td><td>${b.name}</td><td class="num">${esc(ui.seed)}</td><td class="r num">${money(b.score)}</td></tr>`);
  $('boardTable').innerHTML = `<thead><tr><th>#</th><th>Trader</th><th>Seed</th><th class="r">Score</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="4" style="color:var(--faint)">No ranked runs yet. Beat the bots below.</td></tr>'}${botRows.join('')}</tbody>`;
}

function savePrefs() { save(PREFS_KEY, { scenarioId: ui.scenarioId, mode: ui.mode, speed: ui.speed }); }

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

// ---------- Desk ----------
function startGame() {
  ui.seed = ($('seedInput').value || dailySeed()).trim().slice(0, 32);
  const world = buildWorld(ui.scenarioId, ui.seed);
  ui.game = createGame(world);
  ui.bench = null;
  ui.selected = null;
  ui.skew = 0;
  ui.saved = false;
  ui.offerSel = ui.destSel = ui.vesselSel = null;
  ui.paused = true;
  ui.started = false;
  newsIds.clear();
  tradeCount = 0;
  $('feed').innerHTML = '';
  $('blotter').querySelector('tbody').innerHTML = '';
  $('toasts').innerHTML = '';
  show('desk');
  const sc = world.scenario;
  $('deskTitle').innerHTML = `${sc.name}<small>${ui.mode === 'ranked' ? 'RANKED' : 'PRACTICE'} · seed ${esc(ui.seed)}</small>`;
  $('pauseBtn').hidden = ui.mode === 'ranked';
  $('limitLbl').textContent = `limit ±${sc.limit} lots`;
  const phys = !!world.physical;
  $('cargoPane').hidden = $('freightPane').hidden = $('kCargoWrap').hidden = !phys;
  document.querySelector('.desk-grid').classList.toggle('physical', phys);
  $('gL').textContent = `−${sc.limit}`;
  $('gR').textContent = `+${sc.limit}`;
  $('gMin').textContent = `−${Math.round(sc.limit * 1.5)}`;
  $('gMax').textContent = `+${Math.round(sc.limit * 1.5)}`;
  renderSizes();
  renderAll();
  overlay(`
    <div class="label">Morning briefing · ${clk(0)}</div>
    <h2>${sc.name}</h2>
    <p>${sc.brief}</p>
    <p>Position limit <b class="num">±${sc.limit} lots</b> (1 lot = 1,000 bbl, so $0.01 on 100 lots = $1,000). Stop-loss <b class="num">${money(sc.maxLoss)}</b>. Missed client: <b class="num">−${money(PENALTY.missed)}</b>. Pass: <b class="num">−${money(PENALTY.passed)}</b>.</p>
    ${world.physical ? `<p>Physical desk open: 1 tick = 6 hours. Cargoes count toward your limit, so an unhedged 600k bbl cargo is 600 lots of risk. Demurrage starts ${PHYS.freeDays} days after arrival, and after ${PHYS.maxWaitDays} days the cargo is sold for you at a ${Math.round(PHYS.distressDiscount * 100)}¢ discount.</p>` : ''}
    <button class="btn primary" id="goBtn">Start trading <kbd>Enter</kbd></button>`);
  $('goBtn').addEventListener('click', resume);
}

function resume() {
  hideOverlay();
  ui.started = true;
  ui.paused = false;
  $('pauseBtn').textContent = 'Pause';
  clearInterval(ui.timer);
  ui.timer = setInterval(tick, ui.speed);
}

function pause() {
  if (ui.mode === 'ranked' || !ui.started || ui.game.state.done) return;
  ui.paused = true;
  clearInterval(ui.timer);
  overlay(`<div class="label">Paused · ${clk(ui.game.state.t)}</div><h2>Desk on hold</h2><p>The market waits for you in practice mode. In ranked mode it doesn't.</p><button class="btn primary" id="goBtn">Resume <kbd>Enter</kbd></button>`);
  $('goBtn').addEventListener('click', resume);
}

function tick() {
  const g = ui.game;
  if (!g || ui.paused) return;
  const events = g.step();
  for (const e of events) handleEvent(e);
  if (ui.selected != null && !g.openRequests().some((q) => q.id === ui.selected)) ui.selected = null;
  if (ui.selected == null) autoSelect();
  renderAll();
  if (g.state.done) endGame();
}

function handleEvent(e) {
  const g = ui.game;
  if (e.type === 'headline') {
    addHeadline(e.h, true);
    if (ui.mode === 'practice' && Math.abs(e.h.impact) >= 0.6) {
      const dir = e.h.impact > 0 ? 'Bullish' : 'Bearish';
      const extra = e.h.tag === 'RUMOUR' ? ' Unconfirmed: it may get denied, so trade it small.' : ' Price takes a few ticks to catch up.';
      toast(`<b>${dir}</b> headline.${extra}`, e.h.impact > 0 ? 'good' : 'bad');
    }
  } else if (e.type === 'request') {
    toast(`<b>${esc(e.req.client)}</b> asks for a price in <b>${e.req.size} lots</b>`);
  } else if (e.type === 'missed') {
    toast(`${esc(e.req.client)} gave up waiting. −${money(PENALTY.missed)}`, 'bad');
  } else if (e.type === 'breach') {
    if (g.state.breachTicks === 1 || g.state.breachTicks % 5 === 0) toast(`Over your limit. −${money(PENALTY.breachPerTick)} every tick until you hedge.`, 'bad');
  } else if (e.type === 'offer') {
    const o = e.offer;
    toast(`<b>Cargo offer:</b> ${o.grade} ${(o.bbl / 1e6).toFixed(1)}M bbl FOB ${ORIGINS[o.origin].name}${o.distressed ? ' (motivated seller)' : ''}`);
  } else if (e.type === 'arrived') {
    toast(`<b>${e.cargo.grade}</b> has arrived at ${DESTS[e.cargo.dest].name}. Sell before demurrage starts.`, 'good');
  } else if (e.type === 'distressed') {
    toast(`${e.cargo.grade} waited too long at ${DESTS[e.cargo.dest].name} and was sold at a distressed price.`, 'bad');
  } else if (e.type === 'forced') {
    toast(`<b>Risk manager</b> cut ${Math.abs(e.lots)} lots at a penalty price. −${money(PENALTY.forced)}`, 'bad');
  }
}

function endGame() {
  clearInterval(ui.timer);
  ui.paused = true;
  const g = ui.game;
  if (g.state.stoppedOut) {
    overlay(`<div class="label">${clk(g.state.t)}</div><h2>Stopped out</h2><p>The desk hit its ${money(g.world.scenario.maxLoss)} loss limit and risk closed you down for the day.</p><button class="btn primary" id="goBtn">See the debrief <kbd>Enter</kbd></button>`);
    $('goBtn').addEventListener('click', () => { hideOverlay(); showDebrief(); });
  } else {
    showDebrief();
  }
}

// ---------- Ticket ----------
function autoSelect() {
  const open = ui.game.openRequests();
  ui.selected = open.length ? open[0].id : null;
}

function ticketPrices() {
  const m = ui.game.mid();
  const bid = round2(m + ui.skew / 100 - Math.floor(ui.width / 2) / 100);
  return { bid, offer: round2(bid + ui.width / 100) };
}

function sendQuote() {
  const g = ui.game;
  if (ui.selected == null || !ui.started || ui.paused) return;
  const { bid, offer } = ticketPrices();
  const res = g.quote(ui.selected, bid, offer);
  if (!res.ok) { toast(res.reason, 'bad'); return; }
  const q = res.req;
  if (res.status === 'filled') {
    const verb = q.side === 'buy' ? 'BUYS' : 'SELLS';
    toast(`<b>${esc(q.client)} ${verb} ${q.size} lots</b> at ${res.trade.price.toFixed(2)}. Edge ${money(res.trade.edge)}`, 'good');
  } else {
    toast(`${esc(q.client)} traded elsewhere. They wanted to <b>${q.side}</b>; your ${q.side === 'buy' ? 'offer' : 'bid'} wasn't good enough.`);
  }
  ui.skew = 0;
  autoSelect();
  renderAll();
}

function passQuote() {
  if (ui.selected == null || !ui.started || ui.paused) return;
  ui.game.pass(ui.selected);
  toast(`Passed. −${money(PENALTY.passed)} franchise cost`);
  autoSelect();
  renderAll();
}

function hedge(sign) {
  if (!ui.started || ui.paused) return;
  const tr = ui.game.hedge(sign * SIZES[ui.size]);
  if (tr) renderAll();
}

function flatten() {
  if (!ui.started || ui.paused) return;
  ui.game.flatten();
  renderAll();
}

// ---------- Rendering ----------
function renderAll() {
  const g = ui.game;
  const s = g.state;
  const sc = g.world.scenario;
  const N = g.world.N;
  $('kClock').textContent = clk(s.t);
  const lots = Math.round(s.pos / LOT);
  $('kPos').textContent = `${lots > 0 ? '+' : ''}${lots} lots`;
  $('kPos').className = `v ${Math.abs(s.pos) > g.limitBbl ? 'down' : ''}`;
  setMoney($('kPnl'), g.mtm());
  $('kPen').textContent = s.penalties ? `−${money(s.penalties)}` : '$0';
  $('kPen').className = `v ${s.penalties ? 'down' : ''}`;
  setMoney($('kScore'), g.score());
  $('prog').style.width = `${(s.t / N) * 100}%`;

  const bid = g.bid(), ask = g.ask(), mid = g.mid();
  $('pxBid').textContent = bid.toFixed(2);
  $('pxAsk').textContent = ask.toFixed(2);
  $('pxMid').textContent = mid.toFixed(2);
  $('spreadLbl').textContent = `screen spread ${Math.round((ask - bid) * 100)}¢`;
  $('sellPx').textContent = `${bid.toFixed(2)} · ${SIZES[ui.size]}`;
  $('buyPx').textContent = `${ask.toFixed(2)} · ${SIZES[ui.size]}`;

  // gauge: -1.5L .. +1.5L
  const span = sc.limit * 1.5;
  const p = Math.max(-span, Math.min(span, lots));
  const pct = (p / span) * 50;
  const fill = $('gaugeFill');
  fill.style.left = `${pct >= 0 ? 50 : 50 + pct}%`;
  fill.style.width = `${Math.abs(pct)}%`;
  fill.style.background = Math.abs(lots) > sc.limit ? 'var(--bad)' : Math.abs(lots) > sc.limit * 0.7 ? 'var(--warn)' : lots >= 0 ? 'var(--bid)' : 'var(--offer)';

  renderRFQ();
  if (g.physical) {
    $('kCargo').textContent = `${Math.round(s.phys / LOT)} lots`;
    renderPhysical();
  }
  renderBlotter();
  drawLiveChart();
}

function setMoney(el, x) {
  el.textContent = money(x);
  el.className = `v ${x > 0 ? 'up' : x < 0 ? 'down' : ''}`;
}

function renderSizes() {
  $('sizes').innerHTML = SIZES.map((n, i) => `<button data-i="${i}" aria-pressed="${i === ui.size}">${n}<span style="color:var(--faint)"> lots</span> <kbd>${i + 1}</kbd></button>`).join('');
  $('sizes').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { ui.size = +b.dataset.i; renderSizes(); renderAll(); }));
}

function renderRFQ() {
  const g = ui.game;
  const open = g.openRequests();
  $('rfqCount').textContent = `${open.length} open`;
  $('rfqQueue').innerHTML = open.length
    ? open.map((q) => {
      const left = q.tick + REQUEST_LIFE - g.state.t;
      return `<button class="rfq-item${left <= 2 ? ' urgent' : ''}" data-id="${q.id}" aria-pressed="${q.id === ui.selected}">
        <span class="who">${esc(q.client)}</span><span class="num">${q.size} lots</span>
        <span class="label" style="text-transform:none;letter-spacing:0">${esc(q.desc)}</span><span class="num label">${left}s</span>
        <span class="timer"><i style="width:${(left / REQUEST_LIFE) * 100}%"></i></span></button>`;
    }).join('')
    : '<div class="empty">No clients waiting. Watch the tape and manage your risk.</div>';
  $('rfqQueue').querySelectorAll('.rfq-item').forEach((b) => b.addEventListener('click', () => { ui.selected = +b.dataset.id; renderAll(); }));

  const q = open.find((x) => x.id === ui.selected);
  $('ticket').hidden = !q;
  if (!q) return;
  const { bid, offer } = ticketPrices();
  $('ticketAsk').innerHTML = `<b>${esc(q.client)}</b>: “Can I get a two-way in <b>${q.size} lots</b> Brent?”`;
  $('tBid').textContent = bid.toFixed(2);
  $('tOffer').textContent = offer.toFixed(2);
  $('tWidth').textContent = ui.width;
  $('tSkew').textContent = `${ui.skew > 0 ? '+' : ''}${ui.skew}`;
  const hint = ui.mode === 'practice' ? coachHint(q) : '';
  $('tHint').hidden = !hint;
  $('tHint').innerHTML = hint;
}

function coachHint(q) {
  const g = ui.game;
  const sc = g.world.scenario;
  const lots = g.state.pos / LOT;
  const tips = [];
  if (q.type === 'fund') tips.push('Hedge funds are often informed. Quote them 30–40¢ wide, or they will pick you off.');
  else if (q.type === 'trader') tips.push('The trading house sometimes knows something. Go wider than for a corporate (~20¢).');
  else tips.push('Corporate hedger. They aren\'t trading a view. 8–12¢ wide usually wins the trade.');
  if (Math.abs(lots) > sc.limit * 0.3) {
    tips.push(lots > 0
      ? `You're long ${Math.round(lots)} lots: skew <b>down</b> (←) so a buyer takes risk off you.`
      : `You're short ${Math.round(-lots)} lots: skew <b>up</b> (→) so a seller covers you.`);
  }
  if (Math.abs(lots) + q.size > sc.limit) tips.push('A fill here could push you over your limit. Be ready to hedge straight away.');
  const recent = g.world.headlines.filter((h) => h.tick <= g.state.t && h.tick > g.state.t - 8 && Math.abs(h.impact) > 0.5);
  if (recent.length) tips.push(`Fresh news is still repricing the market (${recent[recent.length - 1].impact > 0 ? 'upward' : 'downward'}). Informed clients will trade with it.`);
  return tips.join(' ');
}

const newsIds = new Set();
function addHeadline(h, fresh) {
  if (newsIds.has(h.id)) return;
  newsIds.add(h.id);
  const el = document.createElement('article');
  el.className = `headline${fresh ? ' fresh' : ''}`;
  el.innerHTML = `<div class="top"><time>${clk(h.tick)}</time><span class="chip tag-${h.tag}">${h.tag}</span></div><p>${esc(h.text)}</p>`;
  $('feed').prepend(el);
  $('newsCount').textContent = `${newsIds.size} items`;
}

let tradeCount = 0;
function renderBlotter() {
  const g = ui.game;
  const trades = g.state.trades;
  const tbody = $('blotter').querySelector('tbody');
  for (; tradeCount < trades.length; tradeCount++) {
    const tr = trades[tradeCount];
    const row = document.createElement('tr');
    const lots = tr.kind === 'ffa' ? tr.lots : tr.qty / LOT;
    const type = { client: 'Client', physical: 'Cargo', freight: 'Charter', ffa: 'FFA' }[tr.kind] || (tr.forced ? 'Risk cut' : tr.cargo ? 'Cargo hedge' : 'Hedge');
    const who = tr.client || tr.label || 'ICE screen';
    const px = tr.kind === 'freight' || tr.kind === 'ffa' ? `$${Math.round(tr.price).toLocaleString('en-US')}/d` : tr.price.toFixed(2);
    const lotCell = tr.kind === 'freight' ? '—' : `${lots > 0 ? '+' : ''}${lots}`;
    row.innerHTML = `<td class="num">${clk(tr.t)}</td><td>${type}</td><td>${esc(who)}</td>
      <td class="r num ${lots > 0 ? 'up' : 'down'}">${lotCell}</td><td class="r num">${px}</td><td class="r num ${tr.edge >= 0 ? 'up' : 'down'}">${money(tr.edge)}</td>`;
    tbody.prepend(row);
  }
  $('edgeLbl').textContent = `client spread ${money(g.state.clientEdge)} · hedging ${money(g.state.hedgeEdge)}${g.physical ? ` · freight ${money(g.state.freightCost)}` : ''}`;
}

// ---------- Physical desk ----------
const fmtDiff = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`;
const mbbl = (b) => `${(b / 1e6).toFixed(1)}M bbl`;
const CLASS_COLOR = { aframax: '--bid', suezmax: '--good', vlcc: '--crude' };

function selectOffer(id) {
  const g = ui.game;
  const offer = g.world.physical.offers[id];
  ui.offerSel = id;
  ui.vesselSel = offer.cls;
  const qs = g.world.physical.dests.map((d) => g.physical.quoteVoyage(offer, d, offer.cls)).filter((q) => !q.late);
  qs.sort((a, b) => b.margin - a.margin);
  ui.destSel = qs.length ? qs[0].dest : g.world.physical.dests[0];
}

function renderPhysical() {
  const g = ui.game;
  const ph = g.physical;
  const P = g.world.physical;
  const s = g.state;
  const offers = ph.openOffers();
  if (ui.offerSel != null && !offers.some((o) => o.id === ui.offerSel)) ui.offerSel = null;
  if (ui.offerSel == null && offers.length) selectOffer(offers[0].id);
  const afloat = s.cargoes.filter((c) => c.status !== 'sold').length;
  $('cargoLbl').textContent = `${offers.length} offer${offers.length === 1 ? '' : 's'} · ${afloat} cargo${afloat === 1 ? '' : 'es'} unsold`;

  $('offerList').innerHTML = offers.length
    ? offers.map((o) => {
      const left = o.tick + PHYS.offerLife - s.t;
      return `<button class="offer" data-act="offer" data-id="${o.id}" aria-pressed="${o.id === ui.offerSel}">
        <span><b>${o.grade}</b> · ${mbbl(o.bbl)}</span><span class="num">FOB ${fmtDiff(ph.offerAsk(o))}</span>
        <span class="sub">${ORIGINS[o.origin].name} · ${esc(o.seller)}${o.distressed ? ' · <span style="color:var(--good)">motivated seller</span>' : ''}</span><span class="sub num">${left}t</span>
        <span class="timer"><i style="width:${(left / PHYS.offerLife) * 100}%"></i></span></button>`;
    }).join('')
    : '<div class="empty">No cargoes offered right now. Sellers show up every day or so.</div>';

  renderPlanner(offers.find((o) => o.id === ui.offerSel));

  // arb board: each origin's cheapest ship per route
  const head = `<thead><tr><th>FOB</th>${P.dests.map((d) => `<th class="r">${DESTS[d].name}</th>`).join('')}</tr></thead>`;
  const body = P.origins.map((o) => {
    const cells = P.dests.map((d) => {
      let best = null;
      for (const c of ORIGINS[o].classes) {
        const q = ph.quoteVoyage({ origin: o, bbl: VESSELS[c].bbl, prem: 0 }, d, c);
        if (!best || q.margin > best.margin) best = q;
      }
      const cls = best.margin > 0.1 ? 'open' : best.margin < 0 ? 'shut' : '';
      return `<td class="cell ${cls}" title="DES ${fmtDiff(best.desBid)} − FOB ${fmtDiff(best.fobAsk)} − freight ${best.freightBbl.toFixed(2)}">${fmtDiff(best.margin)}<small>${VESSELS[best.cls].name} · ${best.days}d</small></td>`;
    }).join('');
    return `<tr><td>${ORIGINS[o].grade}<small style="display:block;color:var(--faint);font-size:10.5px">${ORIGINS[o].name} ${fmtDiff(ph.fob(o))}</small></td>${cells}</tr>`;
  }).join('');
  $('arbBoard').innerHTML = head + `<tbody>${body}</tbody>`;

  // voyages: unsold first, then the three most recent sales
  const open = s.cargoes.filter((c) => c.status !== 'sold');
  const sold = s.cargoes.filter((c) => c.status === 'sold').slice(-3).reverse();
  $('voyages').innerHTML = [...open, ...sold].map((c) => {
    const route = `${c.grade} → ${DESTS[c.dest].name}`;
    const meta = `${VESSELS[c.cls].name} · ${mbbl(c.bbl)}`;
    const hedgeChip = c.status === 'sold' ? '' : c.hedgeLots ? '<span class="chip ok">hedged</span>' : '<span class="chip no">unhedged</span>';
    if (c.status === 'sold') {
      return `<div class="voyage sold"><div class="row"><span class="route">${route}</span><span class="num ${c.pnl >= 0 ? 'up' : 'down'}">${money(c.pnl)}</span></div><div class="row sub" style="font-size:12.5px;color:var(--muted)"><span>${meta}</span><span>${c.how === 'distressed' ? 'distressed sale' : c.how === 'sold' ? `sold DES ${fmtDiff(c.desDiff)}` : 'sold at close'}</span></div></div>`;
    }
    const pct = c.status === 'sailing' ? ((s.t - c.buyTick) / (c.arriveTick - c.buyTick)) * 100 : 100;
    const bid = ph.des(c.origin, c.dest) - PHYS.saleDiscount;
    const est = (bid - c.fobDiff) * c.bbl - c.freight - c.demurrage;
    let status;
    let action = '';
    if (c.status === 'sailing') {
      status = `ETA ${clk(c.arriveTick)} · marks ${money(est)}`;
    } else {
      const free = PHYS.freeDays * P.tpd - (s.t - c.arriveTick);
      status = free > 0 ? `Arrived · demurrage in ${free}t` : `<span class="down">Demurrage ${money(c.demurrage)} and counting</span>`;
      action = `<button class="btn primary small" data-act="sell" data-id="${c.id}">Sell DES ${fmtDiff(bid)} · ${money(est)}</button>`;
    }
    return `<div class="voyage ${c.status}"><div class="row"><span class="route">${route}</span>${hedgeChip}</div>
      <div class="bar2"><i style="width:${Math.min(100, pct)}%"></i></div>
      <div class="row" style="font-size:12.5px;color:var(--muted)"><span>${meta}</span><span class="num">${status}</span></div>${action}</div>`;
  }).join('') || '<div class="empty">No cargoes yet. Pick an offer and plan a voyage.</div>';

  renderFreight();
}

function renderPlanner(offer) {
  const el = $('planner');
  el.hidden = !offer;
  if (!offer) return;
  const g = ui.game;
  const ph = g.physical;
  const P = g.world.physical;
  const ships = Object.keys(VESSELS).filter((c) => P.classes.includes(c) && VESSELS[c].bbl >= offer.bbl);
  if (!ships.includes(ui.vesselSel)) ui.vesselSel = ships[0];
  const qs = P.dests.map((d) => ph.quoteVoyage(offer, d, ui.vesselSel));
  const sel = qs.find((q) => q.dest === ui.destSel) || qs[0];
  ui.destSel = sel.dest;
  const rows = qs.map((q) => `<tr class="pick${q.late ? ' late' : ''}" data-act="dest" data-d="${q.dest}" aria-selected="${q.dest === sel.dest}">
      <td>${DESTS[q.dest].name}</td><td class="r num">${q.days}d</td><td class="r num">${fmtDiff(q.desBid)}</td><td class="r num">${q.freightBbl.toFixed(2)}</td>
      <td class="r num ${q.margin >= 0 ? 'up' : 'down'}">${fmtDiff(q.margin)}</td><td class="r num ${q.total >= 0 ? 'up' : 'down'}">${money(q.total)}</td></tr>`).join('');
  const lots = Math.round(offer.bbl / LOT);
  let hint = '';
  if (ui.mode === 'practice') {
    const tips = [];
    if (sel.margin < 0) tips.push(`This arb is <b>closed</b>: after freight you lose ${Math.round(-sel.margin * 100)}¢/bbl.`);
    else tips.push(`Arb open by ${Math.round(sel.margin * 100)}¢/bbl ≈ ${money(sel.total)}. Hedging costs about ${Math.round(g.world.hs[g.state.t] * 200)}¢ round trip.`);
    if (VESSELS[ui.vesselSel].bbl > offer.bbl) tips.push(`Dead freight: you pay for a whole ${VESSELS[ui.vesselSel].name} but only fill ${Math.round((offer.bbl / VESSELS[ui.vesselSel].bbl) * 100)}% of it.`);
    if (!ui.hedgeCargo) tips.push(`Unhedged, this cargo is <b>${lots} lots</b> of flat-price risk against a ±${g.world.scenario.limit} lot limit.`);
    if (sel.late) tips.push('It arrives after the close, so it will be sold afloat at a discount.');
    hint = `<div class="hint">${tips.join(' ')}</div>`;
  }
  el.innerHTML = `<h3>Plan voyage · ${offer.grade} ${mbbl(offer.bbl)} FOB ${ORIGINS[offer.origin].name}</h3>
    <div class="ship-seg">${ships.map((c) => `<button data-act="ship" data-c="${c}" aria-pressed="${c === ui.vesselSel}">${VESSELS[c].name} <span class="num" style="color:var(--faint)">$${(ph.rate(c) / 1000).toFixed(1)}k/d</span></button>`).join('')}</div>
    <div class="table-scroll"><table class="dense"><thead><tr><th>Deliver to</th><th class="r">Sail</th><th class="r">DES</th><th class="r">Freight</th><th class="r">Arb/bbl</th><th class="r">Arb total</th></tr></thead><tbody>${rows}</tbody></table></div>
    <label class="check"><input type="checkbox" id="hedgeCargo" ${ui.hedgeCargo ? 'checked' : ''}> Sell ${lots} lots of Brent futures to hedge the flat price</label>
    ${hint}
    <button class="btn primary" data-act="buy">Buy cargo &amp; fix ${VESSELS[ui.vesselSel].name} to ${DESTS[sel.dest].name}</button>`;
}

function renderFreight() {
  const g = ui.game;
  const ph = g.physical;
  const P = g.world.physical;
  const s = g.state;
  const back = Math.max(0, s.t - 5 * P.tpd);
  $('ffaTable').innerHTML = `<thead><tr><th>Ship</th><th class="r">Spot $/day</th><th class="r">5d</th><th class="r">Pos</th><th class="r">FFA P&amp;L</th><th class="r">FFA</th></tr></thead><tbody>${
    P.classes.map((c) => {
      const r = ph.rate(c);
      const chg = r - P.rate[c][back];
      const f = s.ffa[c];
      const pnl = f.cash + f.lots * PHYS.ffaDays * r;
      return `<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(${CLASS_COLOR[c]});margin-right:6px"></span>${VESSELS[c].name}</td>
        <td class="r num">${r.toLocaleString('en-US')}</td><td class="r num ${chg >= 0 ? 'up' : 'down'}">${chg >= 0 ? '+' : '−'}${Math.abs(chg).toLocaleString('en-US')}</td>
        <td class="r num">${f.lots > 0 ? '+' : ''}${f.lots}</td><td class="r num ${pnl >= 0 ? 'up' : 'down'}">${f.lots || f.cash ? money(pnl) : '—'}</td>
        <td><div class="ffa-btns"><button class="btn sell" data-act="ffa" data-c="${c}" data-lots="-1" title="Sell 1 lot at ${(r - PHYS.ffaHalfSpread).toLocaleString('en-US')}">Sell</button><button class="btn buy" data-act="ffa" data-c="${c}" data-lots="1" title="Buy 1 lot at ${(r + PHYS.ffaHalfSpread).toLocaleString('en-US')}">Buy</button></div></td></tr>`;
    }).join('')
  }</tbody>`;
  drawFreightChart();
}

function drawFreightChart() {
  const g = ui.game;
  const P = g.world.physical;
  const { ctx, w, h } = setupCanvas($('freightChart'));
  const t = g.state.t;
  const N = g.world.N;
  const vals = P.classes.flatMap((c) => Array.from(P.rate[c].slice(0, t + 1)));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad0 = Math.max(2000, (hi - lo) * 0.1);
  lo -= pad0; hi += pad0;
  const pad = { l: 4, r: 44, t: 6, b: 6 };
  const x = (i) => pad.l + (i / N) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
  ctx.font = `11px ${css('--mono')}`;
  ctx.strokeStyle = css('--line');
  ctx.fillStyle = css('--faint');
  const step = niceStep((hi - lo) / 3);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const yy = Math.round(y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
    ctx.fillText(`${Math.round(v / 1000)}k`, w - pad.r + 6, yy + 4);
  }
  for (const c of P.classes) {
    ctx.beginPath();
    for (let i = 0; i <= t; i++) (i ? ctx.lineTo(x(i), y(P.rate[c][i])) : ctx.moveTo(x(i), y(P.rate[c][i])));
    ctx.strokeStyle = css(CLASS_COLOR[c]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function onPhysAction(e) {
  const el = e.target.closest('[data-act]');
  if (!el || !ui.game?.physical || !ui.started || ui.paused) return;
  const g = ui.game;
  const act = el.dataset.act;
  if (act === 'offer') selectOffer(+el.dataset.id);
  else if (act === 'dest') ui.destSel = el.dataset.d;
  else if (act === 'ship') ui.vesselSel = el.dataset.c;
  else if (act === 'buy') {
    const res = g.physical.buyCargo(ui.offerSel, ui.destSel, ui.vesselSel, { hedge: ui.hedgeCargo });
    if (!res.ok) toast(res.reason, 'bad');
    else {
      toast(`Bought <b>${res.cargo.grade}</b> ${mbbl(res.cargo.bbl)}, fixed a ${VESSELS[res.cargo.cls].name} to ${DESTS[res.cargo.dest].name}. Freight ${money(res.quote.freight)}${res.cargo.hedgeLots ? `, hedged ${-res.cargo.hedgeLots} lots` : ''}.`, 'good');
      ui.offerSel = null;
    }
  } else if (act === 'sell') {
    const res = g.physical.sellCargo(+el.dataset.id);
    if (!res.ok) toast(res.reason, 'bad');
    else toast(`Sold <b>${res.cargo.grade}</b> DES ${DESTS[res.cargo.dest].name} at ${fmtDiff(res.cargo.desDiff)}: ${money(res.cargo.pnl)} on the arb.`, res.cargo.pnl >= 0 ? 'good' : 'bad');
  } else if (act === 'ffa') {
    const res = g.physical.tradeFFA(el.dataset.c, +el.dataset.lots);
    if (!res.ok && res.reason) toast(res.reason, 'bad');
  } else return;
  renderAll();
}

// ---------- Charts ----------
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function setupCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function priceFrame(ctx, w, h, lo, hi, pad) {
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
  ctx.font = `11px ${css('--mono')}`;
  ctx.fillStyle = css('--faint');
  ctx.strokeStyle = css('--line');
  ctx.lineWidth = 1;
  const step = niceStep((hi - lo) / 4);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const yy = Math.round(y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
    ctx.fillText(v.toFixed(2), w - pad.r + 6, yy + 4);
  }
  return y;
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

function drawLiveChart() {
  const g = ui.game;
  const cv = $('chart');
  const { ctx, w, h } = setupCanvas(cv);
  const N = g.world.N;
  const t = g.state.t;
  const mids = Array.from(g.world.mid.slice(0, t + 1));
  let lo = Math.min(...mids), hi = Math.max(...mids);
  const padP = Math.max(0.25, (hi - lo) * 0.15);
  lo -= padP; hi += padP;
  const pad = { l: 4, r: 52, t: 8, b: 18 };
  const x = (i) => pad.l + (i / N) * (w - pad.l - pad.r);
  const y = priceFrame(ctx, w, h, lo, hi, pad);

  // headline markers
  for (const hd of g.world.headlines) {
    if (hd.tick > t) break;
    ctx.fillStyle = hd.tag === 'RUMOUR' ? css('--warn') : css('--crude');
    ctx.fillRect(x(hd.tick) - 1, h - pad.b + 4, 2, 8);
  }
  // price area + line
  const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  grad.addColorStop(0, 'rgba(217,154,43,.22)');
  grad.addColorStop(1, 'rgba(217,154,43,0)');
  ctx.beginPath();
  mids.forEach((m, i) => (i ? ctx.lineTo(x(i), y(m)) : ctx.moveTo(x(i), y(m))));
  ctx.lineTo(x(t), h - pad.b); ctx.lineTo(x(0), h - pad.b); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath();
  mids.forEach((m, i) => (i ? ctx.lineTo(x(i), y(m)) : ctx.moveTo(x(i), y(m))));
  ctx.strokeStyle = css('--crude'); ctx.lineWidth = 1.6; ctx.stroke();
  // trades
  for (const tr of g.state.trades) if (CHART_KINDS.has(tr.kind)) drawTradeMark(ctx, x(tr.t), y(tr.kind === 'physical' ? tr.mid : tr.price), tr);
  // endpoint
  ctx.beginPath(); ctx.arc(x(t), y(mids[t]), 3.5, 0, Math.PI * 2); ctx.fillStyle = css('--text'); ctx.fill();
}

function drawTradeMark(ctx, px, py, tr) {
  const up = tr.qty > 0;
  const s = tr.kind === 'client' ? 6 : 4;
  if (tr.kind === 'physical') {
    ctx.fillStyle = up ? css('--bid') : css('--offer');
    ctx.fillRect(px - 5, py - 5, 10, 10);
    return;
  }
  ctx.beginPath();
  if (up) { ctx.moveTo(px, py - s); ctx.lineTo(px - s, py + s * 0.7); ctx.lineTo(px + s, py + s * 0.7); }
  else { ctx.moveTo(px, py + s); ctx.lineTo(px - s, py - s * 0.7); ctx.lineTo(px + s, py - s * 0.7); }
  ctx.closePath();
  ctx.fillStyle = up ? css('--bid') : css('--offer');
  if (tr.kind === 'client') ctx.fill();
  else { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.4; ctx.stroke(); }
}

function drawDebriefChart() {
  const g = ui.game;
  const cv = $('debChart');
  const { ctx, w, h } = setupCanvas(cv);
  const N = g.world.N;
  const t = g.state.t;
  const hist = g.state.history;
  const mids = Array.from(g.world.mid.slice(0, t + 1));
  let lo = Math.min(...mids), hi = Math.max(...mids);
  const padP = Math.max(0.25, (hi - lo) * 0.1);
  lo -= padP; hi += padP;
  const pad = { l: 4, r: 52, t: 8, b: 18 };
  const x = (i) => pad.l + (i / N) * (w - pad.l - pad.r);
  const y = priceFrame(ctx, w, h, lo, hi, pad);
  // position band around the vertical middle
  const L = g.world.scenario.limit * LOT * 1.5;
  const mid = (pad.t + h - pad.b) / 2;
  const half = (h - pad.t - pad.b) / 2;
  for (const pt of hist) {
    const v = (pt.pos / L) * half;
    ctx.fillStyle = pt.pos >= 0 ? 'rgba(69,168,216,.16)' : 'rgba(229,94,78,.16)';
    const bw = Math.max(1, (w - pad.l - pad.r) / N + 0.5);
    ctx.fillRect(x(pt.t), v >= 0 ? mid - v : mid, bw, Math.abs(v));
  }
  ctx.beginPath();
  mids.forEach((m, i) => (i ? ctx.lineTo(x(i), y(m)) : ctx.moveTo(x(i), y(m))));
  ctx.strokeStyle = css('--crude'); ctx.lineWidth = 1.6; ctx.stroke();
  for (const hd of g.world.headlines) {
    if (hd.tick > t) break;
    ctx.fillStyle = hd.tag === 'RUMOUR' ? css('--warn') : css('--crude');
    ctx.fillRect(x(hd.tick) - 1, h - pad.b + 4, 2, 8);
  }
  for (const tr of g.state.trades) if (CHART_KINDS.has(tr.kind)) drawTradeMark(ctx, x(tr.t), y(tr.kind === 'physical' ? tr.mid : tr.price), tr);
}

// ---------- Debrief ----------
function showDebrief() {
  const g = ui.game;
  const sc = g.world.scenario;
  const a = analyse(g);
  ui.bench = benchmarks(g.world);
  const gr = g.state.stoppedOut ? { letter: 'F', label: 'Stopped out by risk' } : grade(a.score, ui.bench);
  show('debrief');
  $('toasts').innerHTML = '';
  $('dGrade').textContent = gr.letter;
  $('dScen').textContent = `${sc.name} · ${ui.mode} · seed ${ui.seed}`;
  $('dLabel').textContent = gr.label;
  $('dScore').textContent = money(a.score);
  $('dScore').className = `score ${a.score >= 0 ? 'up' : 'down'}`;

  const rows = [...ui.bench.map((b) => ({ name: b.name, score: b.score })), { name: 'You', score: a.score, you: true }].sort((p, q) => q.score - p.score);
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.score)));
  $('dBench').innerHTML = rows.map((r) => {
    const wPct = (Math.abs(r.score) / maxAbs) * 50;
    const left = r.score >= 0 ? 50 : 50 - wPct;
    const color = r.you ? 'var(--crude)' : r.score >= 0 ? 'var(--faint)' : 'var(--bad)';
    return `<div class="bench-row${r.you ? ' you' : ''}"><span class="name">${r.name}</span><span class="track"><i style="left:${left}%;width:${wPct}%;background:${color}"></i><i style="left:50%;width:1px;background:var(--line)"></i></span><span class="num r" style="text-align:right">${money(r.score)}</span></div>`;
  }).join('');

  const canSave = ui.mode === 'ranked' && !ui.saved;
  $('saveRow').hidden = !canSave;
  if (canSave) $('initials').value = load(PREFS_KEY, {}).initials || '';

  const attr = [
    ['Client spread', 'What you earned vs mid by pricing clients', a.clientEdge],
    ['Hedging cost', g.physical ? 'Spread you paid crossing the screen, including cargo hedges' : 'Spread you paid crossing the screen', a.hedgeEdge],
    ...(g.physical ? [
      ['Physical margin', 'Sold DES minus bought FOB, in differentials vs Brent', a.physEdge],
      ['Freight & demurrage', `Charters you fixed${a.demurrage ? `, including ${money(-a.demurrage)} demurrage` : ''}`, a.freightCost],
      ['Freight derivatives', 'FFA trading on charter rates', a.ffaPnl],
    ] : []),
    ['Market moves', g.physical ? 'Unhedged flat-price exposure × how Brent moved' : 'Your position × how price moved (news trading, inventory luck)', a.market],
    ['Penalties', `${g.state.missed} missed · ${g.state.passed} passed · ${g.state.breachTicks} ticks over limit · ${g.state.forced} risk cuts`, -a.penalties],
  ];
  $('dAttr').innerHTML = attr.map(([k, d, v]) => `<div class="attr-row"><div>${k}<small>${d}</small></div><span class="num ${v >= 0 ? 'up' : 'down'}">${money(v)}</span></div>`).join('')
    + `<div class="attr-row"><div><b>Score</b><small>Max drawdown ${money(a.maxDrawdown)} · average position ${a.avgAbsPos.toFixed(0)} lots</small></div><span class="num ${a.score >= 0 ? 'up' : 'down'}"><b>${money(a.score)}</b></span></div>`;

  $('dCoach').innerHTML = a.coach.map((c) => `<li class="${c.sev}">${c.text}</li>`).join('');

  const names = { corporate: 'Corporates', trader: 'Trading house', fund: 'Hedge funds' };
  $('dFlow').innerHTML = `<thead><tr><th>Client type</th><th class="r">Asked</th><th class="r">Quoted</th><th class="r">Filled</th><th class="r">Avg width</th><th class="r">Edge</th><th class="r">Markout</th></tr></thead><tbody>${
    Object.values(a.byType).map((b) => `<tr><td>${names[b.type]}</td><td class="r num">${b.requests}</td><td class="r num">${b.quotes}</td><td class="r num">${b.fills}</td><td class="r num">${b.quotes ? Math.round((b.widthSum / b.quotes) * 100) + '¢' : '—'}</td><td class="r num ${b.edge >= 0 ? 'up' : 'down'}">${money(b.edge)}</td><td class="r num ${b.markout >= 0 ? 'up' : 'down'}">${money(b.markout)}</td></tr>`).join('')
  }</tbody>`;
  $('dCargoPane').hidden = !a.phys;
  if (a.phys) {
    const how = { sold: 'Sold on arrival', distressed: 'Distressed sale', end: 'Sold at close', afloat: 'Sold afloat' };
    $('dCargo').innerHTML = `<thead><tr><th>Cargo</th><th>Route</th><th>Ship</th><th>Bought</th><th class="r">FOB</th><th class="r">DES</th><th class="r">Freight</th><th class="r">Demurrage</th><th>Outcome</th><th class="r">P&amp;L</th></tr></thead><tbody>${
      a.phys.cargoes.map((c) => `<tr><td>${c.grade} ${(c.bbl / 1e6).toFixed(1)}M</td><td>${ORIGINS[c.origin].name} → ${DESTS[c.dest].name}</td><td>${VESSELS[c.cls].name}${VESSELS[c.cls].bbl > c.bbl ? ' <span class="chip no">oversized</span>' : ''}</td><td class="num">${clk(c.buyTick)}</td><td class="r num">${fmtDiff(c.fobDiff)}</td><td class="r num">${c.desDiff != null ? fmtDiff(c.desDiff) : '—'}</td><td class="r num">${c.freightBbl.toFixed(2)}</td><td class="r num">${c.demurrage ? money(c.demurrage) : '—'}</td><td>${how[c.how] || '—'}</td><td class="r num ${c.pnl >= 0 ? 'up' : 'down'}">${c.pnl != null ? money(c.pnl) : '—'}</td></tr>`).join('')
      || '<tr><td colspan="10" style="color:var(--faint)">No cargoes traded.</td></tr>'
    }</tbody>`;
  }
  requestAnimationFrame(drawDebriefChart);
}

function saveScore() {
  const g = ui.game;
  const initials = ($('initials').value || 'YOU').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'YOU';
  const board = load(BOARD_KEY, {});
  const list = (board[g.world.scenario.id] || []).map((r) => ({ ...r, fresh: false }));
  list.push({ initials, score: Math.round(g.score()), seed: ui.seed, date: new Date().toISOString(), fresh: true });
  board[g.world.scenario.id] = list.sort((p, q) => q.score - p.score).slice(0, 25);
  save(BOARD_KEY, board);
  save(PREFS_KEY, { ...load(PREFS_KEY, {}), initials });
  ui.saved = true;
  $('saveRow').hidden = true;
  toast('Saved to the leaderboard', 'good');
}

// ---------- Plumbing ----------
function show(which) {
  for (const id of ['lobby', 'desk', 'debrief']) $(id).hidden = id !== which;
  window.scrollTo(0, 0);
}

function overlay(html) {
  $('overlayCard').innerHTML = html;
  $('overlay').hidden = false;
  const b = $('overlayCard').querySelector('button');
  if (b) b.focus();
}
function hideOverlay() { $('overlay').hidden = true; }

function toast(html, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = html;
  $('toasts').prepend(el);
  while ($('toasts').children.length > 4) $('toasts').lastChild.remove();
  setTimeout(() => el.remove(), 4200);
}

function bindLobby() {
  $('modePractice').addEventListener('click', () => { ui.mode = 'practice'; savePrefs(); renderLobby(); });
  $('modeRanked').addEventListener('click', () => { ui.mode = 'ranked'; savePrefs(); renderLobby(); });
  $('speed1').addEventListener('click', () => { ui.speed = 1000; savePrefs(); renderLobby(); });
  $('speed2').addEventListener('click', () => { ui.speed = 600; savePrefs(); renderLobby(); });
  $('seedDaily').addEventListener('click', () => { ui.seed = dailySeed(); renderLobby(); });
  $('seedRandom').addEventListener('click', () => { ui.seed = Math.random().toString(36).slice(2, 8); renderLobby(); });
  $('seedInput').addEventListener('change', () => { ui.seed = $('seedInput').value.trim().slice(0, 32) || dailySeed(); renderLobby(); });
  $('startBtn').addEventListener('click', startGame);
}

function bindDesk() {
  $('cargoPane').addEventListener('click', onPhysAction);
  $('freightPane').addEventListener('click', onPhysAction);
  $('cargoPane').addEventListener('change', (e) => {
    if (e.target.id === 'hedgeCargo') { ui.hedgeCargo = e.target.checked; renderAll(); }
  });
  $('buyBtn').addEventListener('click', () => hedge(1));
  $('sellBtn').addEventListener('click', () => hedge(-1));
  $('flatBtn').addEventListener('click', flatten);
  $('sendBtn').addEventListener('click', sendQuote);
  $('passBtn').addEventListener('click', passQuote);
  $('wUp').addEventListener('click', () => { ui.width = Math.min(60, ui.width + 2); renderAll(); });
  $('wDown').addEventListener('click', () => { ui.width = Math.max(2, ui.width - 2); renderAll(); });
  $('sUp').addEventListener('click', () => { ui.skew = Math.min(30, ui.skew + 1); renderAll(); });
  $('sDown').addEventListener('click', () => { ui.skew = Math.max(-30, ui.skew - 1); renderAll(); });
  $('pauseBtn').addEventListener('click', pause);
  $('quitBtn').addEventListener('click', () => {
    if (!ui.game) return;
    clearInterval(ui.timer);
    ui.paused = true;
    overlay(`<h2>End the day early?</h2><p>Your book is marked at current prices and scored as it stands. Cargoes still at sea are sold afloat at a discount, and remaining clients count as missed.</p><div style="display:flex;gap:8px"><button class="btn primary" id="goBtn">Keep trading</button><button class="btn" id="endBtn">End day</button></div>`);
    $('goBtn').addEventListener('click', () => (ui.started ? resume() : hideOverlay()));
    $('endBtn').addEventListener('click', () => {
      hideOverlay();
      ui.game.finish();
      showDebrief();
    });
  });
  $('retryBtn').addEventListener('click', startGame);
  $('newSeedBtn').addEventListener('click', () => { ui.seed = Math.random().toString(36).slice(2, 8); $('seedInput').value = ui.seed; startGame(); });
  $('lobbyBtn').addEventListener('click', () => { show('lobby'); renderLobby(); });
  $('saveBtn').addEventListener('click', saveScore);
  window.addEventListener('resize', () => {
    if (!$('desk').hidden && ui.game) drawLiveChart();
    if (!$('desk').hidden && ui.game?.physical) drawFreightChart();
    if (!$('debrief').hidden && ui.game) drawDebriefChart();
  });
}

function onKey(e) {
  if (e.target.matches('input, textarea, select')) {
    if (e.key === 'Enter' && e.target.id === 'initials') saveScore();
    return;
  }
  if (!$('overlay').hidden) {
    if (e.key === 'Enter') { e.preventDefault(); $('overlayCard').querySelector('button')?.click(); }
    return;
  }
  if (!$('lobby').hidden) {
    if (e.key === 'Enter' && e.target === document.body) { e.preventDefault(); startGame(); }
    return;
  }
  if ($('desk').hidden) return;
  const k = e.key;
  const map = {
    Enter: sendQuote,
    Escape: passQuote,
    ArrowUp: () => { ui.width = Math.min(60, ui.width + 2); renderAll(); },
    ArrowDown: () => { ui.width = Math.max(2, ui.width - 2); renderAll(); },
    ArrowRight: () => { ui.skew = Math.min(30, ui.skew + 1); renderAll(); },
    ArrowLeft: () => { ui.skew = Math.max(-30, ui.skew - 1); renderAll(); },
    b: () => hedge(1), B: () => hedge(1),
    s: () => hedge(-1), S: () => hedge(-1),
    f: flatten, F: flatten,
    ' ': pause,
    Tab: () => {
      const open = ui.game.openRequests();
      if (!open.length) return;
      const i = open.findIndex((q) => q.id === ui.selected);
      ui.selected = open[(i + 1) % open.length].id;
      renderAll();
    },
  };
  if ('1234'.includes(k) && k.length === 1) { ui.size = +k - 1; renderSizes(); renderAll(); e.preventDefault(); return; }
  if (map[k]) { e.preventDefault(); map[k](); }
}

// ---------- Boot ----------
const prefs = load(PREFS_KEY, {});
if (prefs.scenarioId && SCENARIOS.some((s) => s.id === prefs.scenarioId)) ui.scenarioId = prefs.scenarioId;
if (prefs.mode) ui.mode = prefs.mode;
if (prefs.speed) ui.speed = prefs.speed;
bindLobby();
bindDesk();
document.addEventListener('keydown', onKey);
renderLobby();

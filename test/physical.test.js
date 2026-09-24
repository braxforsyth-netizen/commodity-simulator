import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, createGame, analyse, benchmarks, LOT } from '../src/engine.js';
import { VESSELS, PHYS, freightCost, VOYAGE_DAYS } from '../src/physical.js';

const firstOffer = (g) => {
  while (!g.physical.openOffers().length) g.step();
  return g.physical.openOffers()[0];
};

test('physical worlds are deterministic and only built for physical scenarios', () => {
  const a = buildWorld('atlantic', 'x');
  const b = buildWorld('atlantic', 'x');
  assert.ok(a.physical.offers.length > 5);
  assert.deepEqual(a.physical.offers, b.physical.offers);
  assert.deepEqual(Array.from(a.physical.rate.aframax), Array.from(b.physical.rate.aframax));
  assert.equal(buildWorld('opec', 'x').physical, null);
});

test('buying a cargo books FOB barrels, charges freight up front and can hedge the flat price', () => {
  const g = createGame(buildWorld('atlantic', 'buy'));
  const offer = firstOffer(g);
  const d = g.world.physical.dests[0];
  assert.equal(g.physical.buyCargo(offer.id, d, 'aframax_nope').ok, false);
  const res = g.physical.buyCargo(offer.id, d, offer.cls, { hedge: true });
  assert.ok(res.ok);
  const expected = freightCost(g.physical.rate(offer.cls), VOYAGE_DAYS[offer.origin][d]);
  assert.ok(Math.abs(g.state.freightCost + expected) < 1e-6);
  assert.equal(g.state.phys, offer.bbl);
  assert.equal(g.state.pos, 0, 'fully hedged: futures offset the cargo');
  assert.equal(g.physical.buyCargo(offer.id, d, offer.cls).ok, false, 'cannot buy the same cargo twice');
});

test('a ship that is too small is refused', () => {
  const w = buildWorld('redsea', 'small');
  const g = createGame(w);
  let offer;
  while (!(offer = g.physical.openOffers().find((o) => o.cls !== 'aframax'))) g.step();
  assert.equal(g.physical.buyCargo(offer.id, 'rdam', 'aframax').ok, false);
});

test('arrival, demurrage and the forced distressed sale', () => {
  const g = createGame(buildWorld('atlantic', 'demurrage'));
  const offer = firstOffer(g);
  const d = [...g.world.physical.dests].sort((a, b) => VOYAGE_DAYS[offer.origin][a] - VOYAGE_DAYS[offer.origin][b])[0];
  const { cargo } = g.physical.buyCargo(offer.id, d, offer.cls);
  while (cargo.status === 'sailing') g.step();
  assert.equal(g.state.t, cargo.arriveTick);
  while (cargo.status === 'arrived') g.step();
  assert.equal(cargo.how, 'distressed');
  assert.ok(cargo.demurrage > 0);
  assert.equal(g.state.phys, 0);
  assert.equal(g.state.pos, 0, 'forced sale also lifts the hedge');
});

test('P&L attribution still adds up with cargoes and FFAs', () => {
  const g = createGame(buildWorld('redsea', 'attr'));
  while (!g.state.done) {
    for (const o of g.physical.openOffers()) g.physical.buyCargo(o.id, 'sikka', 'vlcc', { hedge: g.state.t % 2 === 0 });
    for (const c of g.state.cargoes) if (c.status === 'arrived') g.physical.sellCargo(c.id);
    if (g.state.t % 40 === 5) g.physical.tradeFFA('vlcc', 2);
    if (g.state.t % 40 === 25) g.physical.tradeFFA('vlcc', -2);
    if (Math.abs(g.state.pos) > g.limitBbl) g.flatten();
    g.step();
  }
  const a = analyse(g);
  const parts = a.clientEdge + a.hedgeEdge + a.physEdge + a.freightCost + a.ffaPnl + a.market;
  assert.ok(Math.abs(parts - a.final) < 1e-3);
  assert.ok(g.state.cargoes.every((c) => c.status === 'sold'), 'everything is sold by the close');
});

test('FFA position limit is enforced', () => {
  const g = createGame(buildWorld('atlantic', 'ffa'));
  assert.ok(g.physical.tradeFFA('aframax', PHYS.ffaMax).ok);
  assert.equal(g.physical.tradeFFA('aframax', 1).ok, false);
});

test('Head of Desk beats the Junior on physical scenarios', () => {
  for (const id of ['atlantic', 'redsea']) {
    const [j, , h] = benchmarks(buildWorld(id, 'rank'));
    assert.ok(h.score > j.score, id);
  }
});

test('ending the day early closes the book at current prices', () => {
  const g = createGame(buildWorld('atlantic', 'finish'));
  const offer = firstOffer(g);
  g.physical.buyCargo(offer.id, g.world.physical.dests[0], offer.cls);
  const t = g.state.t;
  g.finish();
  assert.equal(g.state.done, true);
  assert.equal(g.state.t, t);
  assert.equal(g.state.cargoes[0].how, 'afloat');
  assert.equal(g.state.cargoes[0].demurrage, 0);
  const a = analyse(g);
  assert.ok(Math.abs(a.clientEdge + a.hedgeEdge + a.physEdge + a.freightCost + a.ffaPnl + a.market - a.final) < 1e-3);
});

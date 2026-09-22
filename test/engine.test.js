import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, buildWorld, createGame, benchmarks, analyse, LOT, REQUEST_LIFE, PENALTY } from '../src/engine.js';

test('same scenario + seed builds an identical world', () => {
  const a = buildWorld('opec', 'abc');
  const b = buildWorld('opec', 'abc');
  assert.deepEqual(Array.from(a.mid), Array.from(b.mid));
  assert.deepEqual(a.requests, b.requests);
  assert.deepEqual(a.headlines.map((h) => h.text), b.headlines.map((h) => h.text));
  assert.notDeepEqual(Array.from(buildWorld('opec', 'xyz').mid), Array.from(a.mid));
});

test('every scenario generates requests and headlines', () => {
  for (const sc of SCENARIOS) {
    const w = buildWorld(sc.id, 1);
    assert.ok(w.requests.length > 5, sc.id);
    assert.ok(w.headlines.length > 1, sc.id);
    assert.equal(w.mid.length > w.N, true);
  }
});

test('P&L attribution adds up: client edge + hedge cost + market = mark-to-market', () => {
  const w = buildWorld('hurricane', 7);
  const g = createGame(w);
  while (!g.state.done) {
    for (const q of g.openRequests()) g.quote(q.id, g.mid() - 0.07, g.mid() + 0.07);
    if (g.state.t % 17 === 0) g.hedge(25);
    if (g.state.t % 29 === 0) g.flatten();
    g.step();
  }
  const a = analyse(g);
  assert.ok(Math.abs(a.clientEdge + a.hedgeEdge + a.market - a.final) < 1e-6);
  assert.ok(Math.abs(a.final - a.penalties - g.score()) < 1e-6);
});

test('tight quotes win corporate flow, absurdly wide quotes never trade', () => {
  const w = buildWorld('orientation', 3);
  const tight = createGame(w);
  const wide = createGame(w);
  for (const g of [tight, wide]) {
    const w_ = g === tight ? 0.01 : 5;
    while (!g.state.done) {
      for (const q of g.openRequests()) g.quote(q.id, g.mid() - w_, g.mid() + w_);
      g.step();
    }
  }
  assert.ok(tight.state.filled > 0);
  assert.equal(wide.state.filled, 0);
});

test('unanswered requests are penalised once they expire', () => {
  const w = buildWorld('orientation', 3);
  const g = createGame(w);
  const first = w.requests[0];
  while (g.state.t < first.tick + REQUEST_LIFE) g.step();
  assert.equal(g.state.missed, 1);
  assert.equal(g.state.penalties, PENALTY.missed);
});

test('breaching the limit costs money; 1.5x triggers the risk manager', () => {
  const w = buildWorld('orientation', 3);
  const g = createGame(w);
  g.hedge(w.scenario.limit + 10);
  g.step();
  assert.equal(g.state.breachTicks, 1);
  g.hedge(w.scenario.limit);
  g.step();
  assert.equal(g.state.forced, 1);
  assert.ok(Math.abs(g.state.pos) <= w.scenario.limit * LOT);
});

test('benchmark bots are deterministic', () => {
  const w = buildWorld('macro', 'bench');
  assert.deepEqual(benchmarks(w), benchmarks(w));
});

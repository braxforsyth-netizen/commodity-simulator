# Crude Desk

An oil trading desk simulator in the style of assessed commodities-trading
sims (e.g. AmplifyME × bp). Price client requests in ICE Brent, trade the
headlines, stay inside your risk limits, and try to beat three benchmark
traders who play the exact same market.

## Run it

No dependencies, no build step. Any static file server works (ES modules don't
load from `file://`):

```sh
npm start            # python3 -m http.server 8000
# then open http://localhost:8000
```

Tests (Node 20+):

```sh
npm test
```

## How to play

1. Pick a scenario (Orientation Day → OPEC+ Week → Hurricane Season → Macro Storm).
2. **Practice** gives you coaching hints and a pause button. **Ranked** gives you neither, and saves your score.
3. The **seed** fixes prices, news and clients. Replay the same seed to measure improvement. **Daily** gives everyone today's market.

| Key | Action |
|---|---|
| `Enter` / `Esc` | Send price / pass on the selected client |
| `↑` `↓` | Widen / tighten your quote |
| `←` `→` | Skew your quote down / up |
| `B` / `S` | Buy at ask / sell at bid on screen |
| `1`–`4` | Hedge size: 10 / 25 / 50 / 100 lots |
| `F` | Flatten position |
| `Tab` | Next client request |
| `Space` | Pause (practice only) |

### Physical cargoes and freight

Two scenarios, **Atlantic Arb** and **Red Sea Squeeze**, open a physical desk
next to the futures desk (1 tick = 6 hours):

- **Cargo offers.** Sellers offer WTI Midland (Houston), Forties (Hound Point) or
  Basrah Medium cargoes FOB, priced as a differential to Brent.
- **Voyage planner.** Pick a tanker (Aframax 600k bbl, Suezmax 1M, VLCC 2M) and a
  destination (Rotterdam, Ningbo, Sikka). The planner shows sailing days, the
  delivered (DES) differential, freight per barrel and the arb:
  **DES − FOB − freight**. A ship bigger than the cargo means dead freight.
- **Hedging.** A cargo is flat-price risk that counts toward your position limit.
  Tick the box to sell futures against it; the hedge is lifted when you sell.
- **Arrival.** Sell delivered as soon as the ship arrives. Demurrage starts after
  2 days, and after 5 days the cargo is sold for you at a distressed price.
- **Freight trading.** Charter rates move on freight headlines (Red Sea attacks,
  VLCC fixture sprees, newbuild deliveries). Trade FFAs (1 lot = 30 days' hire)
  to speculate or to hedge freight.
- **Arb board.** A live matrix of every origin → destination arb after freight.

Scoring: **Score = mark-to-market P&L − penalties** (missed clients, passes,
limit breaches, forced risk cuts). Unsold cargoes are marked at today's
delivered differential. The debrief splits your result into client spread,
hedging cost, physical margin, freight and demurrage, FFAs, market moves and
penalties. Physical scenarios also get a cargo log and coaching on closed arbs,
unhedged cargo, demurrage, dead freight and arbs you let go.

See [PLAN.md](PLAN.md) for the skills each mechanic trains, a staged practice
programme, and the roadmap (forward curve, physical cargoes, options,
multiplayer).

# Crude Desk: plan

A practice ground for commodities trading simulations like the AmplifyME × bp
session: price clients, trade the news, stay inside risk limits, and be scored
on P&L against other traders.

## What these simulations test

Assessed trading sims in this style tend to grade the same few skills, and you
usually only find out which one you're weak at after the session ends:

| Skill | What it looks like in the sim | How you lose points |
|---|---|---|
| **Market making** | A client asks for a two-way price and you don't know their side | Quoting so wide you never trade, or so tight you get run over |
| **Knowing your counterparty** | Some clients hedge real exposure, some are trading a view | Giving an informed fund the same price as an airline |
| **Risk management** | Every fill leaves you with a position | Sitting on inventory, breaching limits, getting force-cut |
| **Reading news** | Headlines move fair value before the price catches up | Reacting late, chasing rumours, trading "noise" headlines |
| **Cost awareness** | Hedging on screen costs the spread | Churning the screen so hedging eats the client edge |
| **Composure** | Several clients at once, the clock running | Missed clients, fat-finger sizes, panic flattening |

## How Crude Desk trains each one

- **Client requests (RFQs).** Eight fictional counterparties across three types:
  corporates (uninformed), a trading house (sometimes informed) and hedge funds
  (usually informed). You set width and skew. Informed clients trade on what
  price will be 10 ticks later, so tight quotes to them lose money the same way
  they would on a real desk.
- **News engine.** Each headline moves fair value; the traded price chases it
  with a lag. Rumours move price by 60% of their full impact, then get confirmed or denied.
  Scheduled data (EIA inventories, CPI) shows the consensus up front, then the
  actual number. You have to read actual vs expected.
- **Limits and stop-loss.** Fines for every tick over the limit. At 1.5× the
  limit the risk manager cuts you at a bad price. Losing past the stop-loss
  ends your day.
- **P&L attribution.** Your score breaks down into client spread, hedging cost,
  market moves and penalties, so you can see where the money went.
- **Benchmarks on the same tape.** Three bots (Junior, Senior, Head of Desk) trade
  the exact same seed. You're graded S/A/B/C/D against them.
- **Coach's notes.** Your debrief flags toxic hedge-fund fills (negative
  markout), low hit rates, missed clients, limit breaches, rumour-chasing and
  slow news reactions.

## Training programme

Keep the seed fixed while you drill a skill, so the only thing that changes is
you. Move to the Daily seed once you can beat the Senior Trader.

| Stage | Scenario / mode | Goal to move on |
|---|---|---|
| 1. Mechanics | Orientation Day, Practice | Zero missed clients, zero limit breaches |
| 2. Spread discipline | Orientation Day, Practice | Corporate hit rate 55–80% with positive hedge-fund markout |
| 3. Event trading | OPEC+ Week, Practice | Right side of ≥ 2/3 big headlines; no losing rumour chases |
| 4. Pressure | Hurricane Season, Ranked | Grade A (beat the Senior Trader) |
| 5. Survival | Macro Storm, Ranked | Positive score with max drawdown < 50% of stop-loss |
| 6. Physical arb | Atlantic Arb, Practice | Every cargo hedged and profitable after freight; zero demurrage |
| 7. Freight | Red Sea Squeeze, Ranked | Grade A, with positive FFA P&L |
| 8. Competition | Any, Ranked, Daily seed | Grade S. Beat the Head of Desk |

**Habits to build (these are what the Head of Desk bot does):**

1. Price every client within 2 ticks. A wide price costs nothing; a missed one costs $1,500.
2. Width by client (bid-to-offer): ~10¢ corporates, ~20¢ trading house, 30–40¢ hedge funds.
3. Skew before you hedge. If you're long, shade both prices down so the next buyer takes your risk and pays you the spread.
4. Hedge on screen only when you're past ~25–30% of your limit. Don't hedge back to exactly flat.
5. On a big confirmed headline, trade in the first 1–3 ticks, about half your limit, and take it off within ~10 ticks.
6. Treat rumours as half-size at most. Wait for the confirmation or denial.
7. Physical: only buy a cargo if DES − FOB − freight clears ~5¢/bbl for the
   best destination, on the ship that fits the cargo. Hedge every barrel, and
   sell the moment it arrives.
8. Freight: trade FFAs in the direction of freight headlines within a tick or
   two, and take the trade off within ~3 days.

## Roadmap

**v1.** Front-month Brent, RFQs, news, limits, bots, debrief,
local leaderboard, seeded replays.

**v1.1 (this repo): physical and freight.** Cargo offers from three load
ports, Aframax/Suezmax/VLCC charters to three destinations, a voyage planner
and arb board, cargo hedging against the shared position limit, demurrage and
distressed sales, charter-rate headlines, and FFA trading.

**v2: the forward curve.** Add M1–M6 contracts, calendar spreads,
contango/backwardation, and a storage tank. Buy prompt, sell deferred, pay
storage, and learn the cash-and-carry trade.

**v3: deeper physical.** Laycans and pricing windows (cargo priced on the
average of Dated Brent around the bill of lading rather than a fixed price),
selling cargoes afloat and rerouting mid-voyage, storage, quality blending,
and receiver tenders you bid into.

**v4: options and Greeks.** Client requests for caps and collars, a vol
surface, delta-hedging, and vega risk into events like OPEC meetings.

**v5: head-to-head.** A shared Daily Challenge leaderboard and live multiplayer
rooms where players compete for the same client flow, since your competitors
set the price a client sees.

## Architecture

- `src/engine.js` holds all market logic, with no DOM. `buildWorld(scenario, seed)`
  pre-generates the price path, headlines and client requests. Player actions
  never change the world, which is what makes replays and bot benchmarks fair.
- `src/physical.js` holds cargoes, freight, the voyage planner maths, FFAs and
  the bots' physical strategy. Its world data (diffs, charter rates, offers) is
  also generated from the seed.
- `src/app.js` is the browser UI (lobby, desk, debrief). Charts are drawn on canvas.
- `index.html` holds the markup and styles. No build step, no dependencies.
- `test/physical.test.js` covers cargo booking, freight, demurrage, FFA limits
  and the attribution identity with physical in the book.
- `test/engine.test.js` covers determinism, the P&L attribution identity, fills,
  penalties, limits and bots (`npm test`).

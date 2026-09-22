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

Scoring: **Score = mark-to-market P&L − penalties** (missed clients, passes,
limit breaches, forced risk cuts). The debrief splits your result into client
spread, hedging cost, market moves and penalties, and adds coaching notes.

See [PLAN.md](PLAN.md) for the skills each mechanic trains, a staged practice
programme, and the roadmap (forward curve, physical cargoes, options,
multiplayer).

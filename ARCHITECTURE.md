# Architecture: repeatable, and easy to change

Two properties were designed in on purpose, because they are the actual job (an AI *systems*
role): the process is **repeatable** (one command, same result anywhere) and the architecture is
**easy to change** (new behaviour is a config or adapter swap, not a rewrite). This is the
"separate the runtime from the configuration; a new type is a config change, not a code change"
principle, applied to a game.

## Repeatable

- **One command:** `npm run ci` runs the whole gate (unit -> asset gate -> build -> build gate ->
  e2e). Same command locally, in Docker, and in CI. There is no "works on my machine" surface.
- **Reproducible environment:** the `Dockerfile` pins the toolchain + browser, so the build and
  tests produce the same result on any host.
- **Deterministic core:** all decision logic (collision, scoring, combos, run-end) is pure and
  unit-tested. Given the same inputs it always produces the same outputs, so a regression is a
  failing test, not a vibe.

## Easy to change: the seams

Each concern is isolated behind a small interface, so you can replace one without touching the
others. The swap points:

| Want to change... | Touch only... | Everything else is unaffected because... |
|---|---|---|
| Difficulty / theme / a new ad variant | `src/game/config.ts` | the engine reads a `GameConfig`; a variant is a data entry |
| Placeholder art -> real AI sprites | `src/game/assets.ts` + `assets/assets.json` | the rest consumes a `Texture` + a manifest, not files |
| Input device (add gamepad, tilt) | `src/input/Input.ts` | the game reads `getAxis()`, and never the device |
| Scoring / combo rules | `src/game/Scoring.ts` | pure functions, unit-tested in isolation |
| Hit detection | `src/game/Collision.ts` | pure functions, unit-tested in isolation |
| Look of the HUD / end card | `src/ui/ui.ts` + `src/styles.css` | game logic emits events, DOM renders them |
| Ad-network plumbing / CTA | `src/mraid.ts` | a single adapter wraps the SDK; the game calls `fireCta()` |

`src/mraid.ts` is the clearest example of the adapter pattern from the brief: the network SDK can
change, and only that one file changes. The game never imports the SDK directly.

## "A new variant is a config change, not code"

`config.ts` already proves it: `classic`, `rush`, and `zen` are three playable variants produced
by data alone (`?variant=rush`). Speed, density, run length, fruit theme, and title are all
config. Adding a fourth variant is a few lines of data and zero engine code, which is exactly how
a playable-ad studio spins up A/B creatives at volume.

## Collaboration and scaling (where a dashboard belongs, and where it does not)

The collaboration surface for this project is deliberately lightweight and already present:

- **`config.ts`** lets a designer/PM propose a new variant without reading the engine.
- **`pipeline/grade.md`** is a shared rubric: anyone can score a generated asset/variant against
  the same criteria, and the log is the shared record.
- **`DECISIONS.md`** is the shared reasoning trail (which tool, why, what was rejected).

A live **dashboard** (variant win-rates, asset quality scores, the agentic loop, tests, cost, and
the closed flywheel) is built (`pipeline/agentic/dashboard.mjs`) and reads only from the logged
artifacts — nothing on it is hand-written. It started as a scaling story and is now the single place
both technical and non-technical readers can see what was made, whether it's good, what it cost, and
what needs attention. The architecture stayed shaped to feed it (everything it charts — variant id, score, outcome, is
already a discrete, logged value), so adding it later is wiring, not a redesign.

## The closed loop (the data flywheel)

Quality grading answers *"does it look good?"*; the north-star is *"which variant performs in
play?"*. The game emits `window.__telemetry` (variant, score, pickups, duration) each run;
`collect-telemetry.mjs` aggregates it per variant into engagement, and the dashboard ranks the
variants and recommends which to generate more of. Locally this runs on Playwright; in production
the identical shape is fed by the ad-network's performance webhook — production play feeds straight
back into what the pipeline generates next. That feedback loop is the system getting smarter each
cycle, not a one-off build.

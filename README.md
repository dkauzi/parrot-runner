# Parrot Auto-Runner

A forward-flying parrot collects fruit along a jungle path. Start, fly a fixed distance,
end on a score card.

see it in action here url: https://dkauzi.github.io/parrot-runner/   
<img width="340" height="191" alt="download" src="https://github.com/user-attachments/assets/e4195397-6f5f-4cf8-beb8-06805c5ee86a" />



Built on `winstonrc/threejs-typescript-template` (webpack + TypeScript + Three.js).

## Run it

```bash
npm install            # once

npm start              # dev server with live reload -> http://localhost:9000
```

Or build and open the single self-contained playable:

```bash
npm run build:playable # -> dist/index.html (one file, ~0.48 MB)
open dist/index.html    # runs straight from file://, no server needed
```

Controls: arrow keys / WASD, or drag the on-screen joystick (touch). Try the variants with
`?variant=rush` or `?variant=zen` on the URL.

Verify everything:

```bash
npm run ci             # unit tests -> asset gate -> build -> build gate -> headless e2e
```

**On GitHub:** pushing to `main` runs the CI workflow (`.github/workflows/ci.yml`) and, once
 publishes the playable to
`https://dkauzi.github.io/parrot-runner/`

## Why this build is shaped the way it is


- It is built like a **playable ad**, not a generic game (see `PRODUCTION_BUDGET.md`).
- 
- The asset workflow is a **reproducible generate -> validate -> grade pipeline**
  (see `pipeline/`), a miniature of the variant-generate-and-grade systems the role exists
  to build, kept deliberately small (no agent framework) because three assets do not justify
  one. Knowing that boundary is the senior signal.
  
- The thinking is an artifact, not just a claim (see `DECISIONS.md`).



- `AGENTIC.md` - the AI asset pipeline: generate -> validate -> judge -> retry -> escalate, + dashboard
## The five stages (plain language)

| Stage | What happens | Who/what |
|---|---|---|
| 1. Generate | Make a sprite image from the versioned prompt | image provider (AI) |
| 2. Validate | Hard rules: real PNG, square, transparent, under size budget | deterministic code |
| 3. Judge | Score 1–5 on 5 quality criteria (reads at scale, silhouette, on-theme, palette, transparency) | LLM judge (Claude) |
| 4. Retry | If it scores low, send the judge's feedback back and try again | orchestrator |
| 5. Escalate | If it still can't pass, flag for a **human** — the AI never guesses | human-in-the-loop |


- `ARCHITECTURE.md` - repeatable + swap-friendly seams (change a provider, not the system)
--- ## Repeatable

--- **One command:** `npm run ci` runs the whole gate (unit -> asset gate -> build -> build gate ->
  e2e). Same command locally, in Docker, and in CI. There is no "works on my machine" surface.
--- **Reproducible environment:** the `Dockerfile` pins the toolchain + browser, so the build and
  tests produce the same result on any host.
--- **Deterministic core:** all decision logic (collision, scoring, combos, run-end) is pure and
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


- `AUTOMATION.md` - single-file playable build, headless tests, Docker

  # Automation: single-file playable, auto-tested, containerised

Three things, one chain: build a self-contained HTML playable, prove it works headlessly, run
it all in a container so the result is reproducible. Each stage is a gate: it fails loud, it
does not warn and continue. This is wired and passing; `npm run ci` is the single command.

## 1. Make the HTML playable (single self-contained file)

The template uses **webpack** (not Vite). The playable build inlines the JS bundle into one
`index.html` via `html-inline-script-webpack-plugin`; CSS is inlined through `style-loader`;
and placeholder sprites are drawn procedurally, so there are no external files to fetch. The
build is self-contained by construction.

```bash
npm run build:playable     # webpack --env playable -> dist/index.html (one file)
```

Result: `dist/index.html`, ~0.48 MB, everything inlined. That single file is the playable.

## 2. Auto-test it (headless)

`tests/playable.spec.ts` (Playwright) drives the BUILT file in headless Chromium and asserts:

- loads with zero console / page errors
- the game loop advances (its own frame heartbeat grows -> not frozen)
- the WebGL context is healthy and actually rendering
- the CTA fires through `mraid.open` at game end (driven by the `?test=fastend` hook)

```bash
npx playwright install chromium
npm run test:e2e
```

- `BUILD_PLAN.md` - core loop, file architecture, end card, tests, order of work
- `PRODUCTION_BUDGET.md` - FPS, build size, load, dependency policy (the playable-ad contract)
- `prompts/` - versioned asset-generation prompts (prompt as code)
- `pipeline/agentic/` - the agentic generate/judge pipeline + observability dashboard

    # AI Asset Pipeline

A small, real **agentic system** that turns a written prompt into an approved game sprite,
the way Seepia turns briefs into playable-ad variants at scale. It is the centrepiece of this
project for a Senior **AI Systems** role: the game is the artefact, this is the system.

## What it does, in one breath

> **Generate → Validate → Judge → Retry → Escalate.** An AI makes the artwork, automatic rules
> check it, a second AI grades it against a rubric, weak results are fed back and retried, and
> anything that still can't pass is handed to a human. Every step is logged; a dashboard shows
> the result.

This mirrors the "Agent A drafts it, Agent B grades it, Agent A fixes it" pattern, kept at the
right size: a few small files, no agent framework, runs offline for free.

## The five stages (plain language)

| Stage | What happens | Who/what |
|---|---|---|
| 1. Generate | Make a sprite image from the versioned prompt | image provider (AI) |
| 2. Validate | Hard rules: real PNG, square, transparent, under size budget | deterministic code |
| 3. Judge | Score 1–5 on 5 quality criteria (reads at scale, silhouette, on-theme, palette, transparency) | LLM judge (Claude) |
| 4. Retry | If it scores low, send the judge's feedback back and try again | orchestrator |
| 5. Escalate | If it still can't pass, flag for a **human** — the AI never guesses | human-in-the-loop |

## Run it

**Locally (no API key, fully free — uses offline mock providers):**
```bash
npm run pipeline             # generate + validate + judge all 3 sprites
npm run pipeline:dashboard   # build dashboard.html, open it in a browser
```
Options: `node pipeline/agentic/run.mjs --asset fruit` (one asset), `--promote` (copy approved
sprites into the game).

- `pipeline/validate.mjs` / `validate-build.mjs` - deterministic asset + build gates (zero-dep)


- `pipeline/grade.md` - the rubric the LLM judge scores against

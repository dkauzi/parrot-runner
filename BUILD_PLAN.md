# Parrot Auto-Runner: Build Plan (v2, playable-ad framing)

Built on `winstonrc/threejs-typescript-template` (Vite + TypeScript + Three.js).
Read `README.md` and `PRODUCTION_BUDGET.md` first: this is built like a **playable ad**.

## Scope guardrails (read first)

Scored on (1) the game works and (2) tool-choice judgment. Visuals are NOT weighted.

- DO NOT build: RAG, agent runtimes/frameworks, prompt-eval harnesses, drift dashboards,
  kill switches, a physics engine. Over-engineering is the fast way to fail the judgment test.
- DO build: a tight, tested, performance-aware core loop + AI-generated sprites run through a
  small generate/validate/grade pipeline + documented tool decisions.

## Deterministic vs judgment split (your own principle, applied honestly)

- DETERMINISTIC (clean tested code, no AI improvisation): movement, camera, world scroll,
  spawning, collision, scoring, timer, state machine, end card.
- JUDGMENT / CREATIVE (where generative AI earns its place): the parrot, fruit, tree sprites.
  That is the ONLY place generative AI is used, and it runs through `pipeline/`.

## Core loop

1. START screen. Tap / click / space to begin. Assets preloaded before start resolves.
2. Parrot auto-flies forward: scroll the world toward the camera on +Z each frame (parrot
   near origin, camera chases). Easier culling and pooling than moving the parrot.
3. Player control: **virtual joystick (primary, touch)** and **keyboard arrows/WASD
   (fallback)** drive the same horizontal (+ vertical) axis. Mobile-first, per the playable
   context. Clamp the parrot inside the flight lane.
4. Collectibles: fruit sprites spawn ahead, scroll toward the player. Distance-check collision
   vs parrot -> +points, despawn, return to pool.
5. Trees: tree sprites scattered along the path as environment. Decorative by default; an
   optional stretch is making some obstacles that end the run.
6. END: fixed distance (e.g. 2000 units) or timer (e.g. 60 s) -> **end card** (see below) ->
   restart.

## End card (playable-ad framing)

Playables always end on a CTA. The game-over screen is styled as a lightweight end card:
final score, a "Play again" button, and a placeholder primary CTA ("Download" / "Get it now").
No real store link needed; the framing shows you know the product shape. Keep it one overlay,
no new dependency.

## Performance is a feature here

Hold the contract in `PRODUCTION_BUDGET.md`: on-screen FPS HUD (kept in the shipped build,
mirroring the reference mocks), 60 target / 30 floor under CPU throttle, object pooling so
nothing allocates per frame, distance-check collision (no raycasts), single texture atlas,
DPR clamped to ~2, total build < 5 MB.

## File architecture (suggested)

```
src/
  main.ts            // bootstrap: renderer, scene, camera, fixed-step loop
  game/
    GameState.ts     // 'menu' | 'playing' | 'gameover'; score; distance/time
    Parrot.ts        // player sprite + input-driven position clamp
    Spawner.ts       // object pool for fruit + trees; spawn-ahead, recycle behind
    Collision.ts     // pure functions: distance checks -> hits   (UNIT TESTED)
    Scoring.ts       // pure functions: score updates             (UNIT TESTED)
  input/
    Keyboard.ts
    Joystick.ts      // touch virtual stick -> same axis output as keyboard
  assets/
    atlas.png        // packed sprite atlas (parrot, fruit, tree)
    manifest.ts      // typed loader for assets.json
    assets.json      // sprite frames, scale, points-per-item
    assets.schema.json
  ui/
    Hud.ts           // score + FPS counter
    Screens.ts       // start screen + end card
pipeline/
  validate.mjs       // deterministic asset gate (zero-dep)
  grade.md           // judgment grading rubric
prompts/             // versioned generation prompts (prompt as code)
```

## Where your AI-systems principles transfer (truthfully)

- Schema validation before downstream: load `assets.json` through `assets.schema.json` at
  boot; missing sprite or non-numeric points -> fail loud at start, not mid-game. Plus
  `pipeline/validate.mjs` gates the raw PNGs before they ever reach the build.
- Prompt as code / versioning / rollback: every asset has a versioned prompt in `prompts/`
  with tool, model version, exact prompt, and a rejected-attempts log.
- Generate -> validate -> grade: the honest, shrunk form of Seepia's variant pipeline.
  One zero-dep validator + one rubric. No agent runtime, by design.
- Track outcomes not inputs: `DECISIONS.md` logs what each tool produced and what you rejected.

## Tests (the honest "golden test" analog for a game)

Pure functions only, no LLM eval harness:

- Collision: overlapping parrot+fruit returns a hit; non-overlap returns none.
- Scoring: collecting a fruit worth N increments score by N; double-collect impossible.
- End condition: distance/time at limit transitions state to 'gameover'.
- Spawner pool: no leaks (count in == recycled + active).
- Asset gate: `node pipeline/validate.mjs src/assets` exits 0 (wire into CI / pre-commit).

## Suggested order of work

Day 1: scaffold template, scrolling world + chase camera, placeholder parrot, keyboard control,
        FPS HUD wired from the start (perf is not a day-5 afterthought).
Day 2: spawner + pool + collision + scoring + HUD, all unit-tested.
Day 3: generate sprites via `prompts/`, run `pipeline/validate.mjs`, grade via `grade.md`,
        pack atlas, load through manifest + schema, swap placeholders.
Day 4: start screen + end card, end condition, restart, virtual joystick, mobile/portrait pass.
Day 5: perf pass against PRODUCTION_BUDGET (throttle test, size report), DECISIONS.md, record
        a 60-90 s walkthrough, zip.

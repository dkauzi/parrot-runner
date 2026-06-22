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

Note on FPS: the suite does NOT assert a hard 30/60 FPS number. Headless software-GL renders far
below device speed, so that would test the CI rasterizer, not the game. The real frame-rate
budget is Layer-3 device QA (see PRODUCTION_BUDGET.md). The loop-advances test is the honest,
non-flaky automated signal.

## 3. Containerise it

`Dockerfile` (Playwright base image, Chromium preinstalled) runs the WHOLE chain reproducibly:

```bash
docker build -t parrot-playable .   # asset gate -> build -> build gate (fails build if any fail)
docker run --rm parrot-playable     # headless tests
```

Same image locally and in CI: green locally means green in CI.

## The one command that ties it together

```bash
npm run ci
# = test:unit  ->  validate:assets  ->  build:playable  ->  validate:build  ->  test:e2e
```

`npm run ci` is the single source of truth for "is this playable shippable?" All five stages
currently pass.

## Scope honesty

The single-file build + Playwright auto-test are high-signal and cheap; they are wired. Docker is
optional polish that buys the "reproducible CI" talking point; a GitHub Actions workflow running
the same `npm run ci` is a lighter alternative if you would rather not ship a Dockerfile. Do NOT
add a cluster, a registry, or orchestration. One image or one workflow is the right altitude for
a one-file playable.

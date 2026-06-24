# Parrot Auto-Runner

A forward-flying parrot collects fruit along a jungle path. Start, fly a fixed distance,
end on a score card.

see it in action here url: https://dkauzi.github.io/parrot-runner/   


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
Pages is enabled (Settings -> Pages -> Source: GitHub Actions), publishes the playable to
`https://dkauzi.github.io/parrot-runner/`. Pages serves publicly, so a private repo needs
GitHub Pro or to be made public for the live URL; otherwise run locally as above.

## Why this build is shaped the way it is


- It is built like a **playable ad**, not a generic game (see `PRODUCTION_BUDGET.md`).
- 
- The asset workflow is a **reproducible generate -> validate -> grade pipeline**
  (see `pipeline/`), a miniature of the variant-generate-and-grade systems the role exists
  to build, kept deliberately small (no agent framework) because three assets do not justify
  one. Knowing that boundary is the senior signal.
  
- The thinking is an artifact, not just a claim (see `DECISIONS.md`).



- `AGENTIC.md` - the AI asset pipeline: generate -> validate -> judge -> retry -> escalate, + dashboard
- `ARCHITECTURE.md` - repeatable + swap-friendly seams (change a provider, not the system)
- `AUTOMATION.md` - single-file playable build, headless tests, Docker
- `BUILD_PLAN.md` - core loop, file architecture, end card, tests, order of work
- `PRODUCTION_BUDGET.md` - FPS, build size, load, dependency policy (the playable-ad contract)
- `prompts/` - versioned asset-generation prompts (prompt as code)
- `pipeline/agentic/` - the agentic generate/judge pipeline + observability dashboard
- `pipeline/validate.mjs` / `validate-build.mjs` - deterministic asset + build gates (zero-dep)
- `pipeline/grade.md` - the rubric the LLM judge scores against
- `DECISIONS.md` - the three interview answers, pre-structured, filled as you go

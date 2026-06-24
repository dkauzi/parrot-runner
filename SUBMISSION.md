# Parrot Runner - Submission

A parrot playable ad built with AI-generated art, plus the agentic AI pipeline that generates,
quality-controls, and measures it. The game is the artefact; the pipeline is the point.

## Links

- **Repo:** https://github.com/dkauzi/parrot-runner
- **Play the game:** https://dkauzi.github.io/parrot-runner/
- **Live dashboard (observability):** https://dkauzi.github.io/parrot-runner/dashboard.html

## Run it locally

```bash
npm install
npm start                 # dev server -> http://localhost:9000
npm run ci                # all gates: unit + assets + provenance + build + e2e + device-size
npm run dashboard:refresh # regenerate every dashboard panel (tests, telemetry, visual QA, gif)
open pipeline/agentic/dashboard.html
```

## Where to look

| You want to see | Open |
|---|---|
| The game loop, camera, motion | `src/game/Game.ts` |
| The agentic pipeline (generate -> validate -> grade -> judge -> retry -> escalate) | `pipeline/agentic/run.mjs` |
| Deterministic grader (the always-on floor) | `pipeline/agentic/grade-deterministic.mjs` |
| AI judge adapter (swappable: Gemini / Claude / mock) | `pipeline/agentic/judge.mjs` |
| Visual QA agent (camera + perspective + pink check) | `pipeline/agentic/visual-eval.mjs` |
| Device-size QA | `pipeline/agentic/device-check.mjs` |
| Closed loop / real-play telemetry | `pipeline/agentic/collect-telemetry.mjs` |
| Versioned agent config (config-as-data) | `pipeline/agentic/agents.config.json` |
| Prompts as code (versioned) | `prompts/*.md` |
| Reasoning trail (decisions, what was hard, v2) | `DECISIONS.md` |
| Architecture + the data flywheel | `ARCHITECTURE.md`, `AGENTIC.md` |

## Testing

Layered so each catches what the layer below cannot: unit (logic) -> e2e (the built game) ->
device-size QA (6 placements) -> visual QA (AI + deterministic) -> golden eval (judge-drift
regression). All run in `npm run ci` and are shown on the dashboard with per-case pass/fail.

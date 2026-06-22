# Parrot Auto-Runner

A forward-flying parrot collects fruit along a jungle path. Start, fly a fixed distance,
end on a score card.

Built on `winstonrc/threejs-typescript-template` (Vite + TypeScript + Three.js).

## Why this build is shaped the way it is

This is a home assignment for a **Senior AI Systems Engineer** role at Seepia, a company that
makes **playable ads**. The brief asks for a parrot game, but the real test is whether the
build reflects their product reality and their actual job, neither of which the brief spells
out. So this repo deliberately imports the unstated requirements:

- It is built like a **playable ad**, not a generic game (see `PRODUCTION_BUDGET.md`).
- The asset workflow is a **reproducible generate -> validate -> grade pipeline**
  (see `pipeline/`), a miniature of the variant-generate-and-grade systems the role exists
  to build, kept deliberately small (no agent framework) because three assets do not justify
  one. Knowing that boundary is the senior signal.
- The thinking is an artifact, not a claim (see `DECISIONS.md`).

## What we were blind to in v1, and how v2 addresses it

| Blind spot | Why it matters to Seepia | Addressed by |
|---|---|---|
| Treated it as a generic game | They ship playable ads, not games | Playable-ad framing throughout |
| Ignored the FPS counter in the reference mocks ("53 FPS", "33 FPS") | A perf readout in a *concept image* is a planted signal that performance is first-class | FPS HUD + frame budget in `PRODUCTION_BUDGET.md` |
| No size / load ceiling | Playables ship under tight KB/MB limits and must load instantly | Build-size + load budget, atlas, near-zero deps |
| Game-over was just a score screen | Playables end on a CTA end card | End-card spec in `BUILD_PLAN.md` |
| Keyboard-only input | Playables are mobile-first, touch | Virtual joystick primary, keyboard fallback |
| Asset gen as a one-off | The role is AI *systems* | `pipeline/validate.mjs` + `pipeline/grade.md` |
| Risk of over-engineering | Over-build fails the judgment test | Restraint stated and enforced (no agent runtime) |

## Repo map

- `BUILD_PLAN.md` - core loop, file architecture, end card, tests, order of work
- `PRODUCTION_BUDGET.md` - FPS, build size, load, dependency policy (the playable-ad contract)
- `prompts/` - versioned asset-generation prompts (prompt as code)
- `pipeline/validate.mjs` - deterministic asset gate (zero-dep)
- `pipeline/grade.md` - judgment-based grading rubric (the Agent-B step, as a rubric)
- `DECISIONS.md` - the three interview answers, pre-structured, filled as you go

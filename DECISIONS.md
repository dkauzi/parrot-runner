# Decision Log

The reasoning trail for this project — which tool, why, what it produced, and what I rejected.
Written as I went. The principle I held to: track outcomes, not just inputs.

## Which AI tools I used, and why

| Task | Tool chosen | Why | What I rejected / alternative |
|------|-------------|-----|-------------------------------|
| Parrot, fruit, tree, background, ground art | Pollinations (free image gen) | creative/high-variability work where taste matters; no key, no cost | paid APIs (unnecessary for the quality bar); hand-drawing (slow) |
| Asset quality grading | Gemini 2.5-flash (vision, structured JSON) | a subjective rubric needs real judgment; free tier | trusting raw generation (no gate); a paid judge |
| Transparency on sprites | deterministic adaptive chroma-key (code) | exact, repeatable; free models can't output alpha | asking the model for transparency (it can't); manual cut-outs |
| Game logic — collision, scoring, loop, physics | deterministic TypeScript | must be exact, fast, identical every run | LLM-generated logic (variance, leaks) — explicitly chose **not** to use AI here |
| Validation + build gates | deterministic code | fail-loud rules; no LLM variance | an AI reviewer as the only gate |

Where I chose **not** to use AI is the point: anything that must be exact or measurable is code.
AI is reserved for the genuinely creative/judgment calls.

## Key challenges (what was actually hard, and what I redid)

- **Transparent backgrounds.** Free image models only output opaque images. First chroma-key
  assumed pure magenta and leaked pink edges; I redid it as an **adaptive, corner-sampled**
  chroma-key that learns the real background colour per image.
- **The AI judge is not trustworthy alone.** It once scored an obviously buggy frame 5/5 — because
  it had screenshotted the *end card*, not gameplay, and because it's lenient. I redid the visual
  agent to capture **real gameplay** and added a **deterministic floor** (pink detector, camera
  check) that is the verdict whenever the AI is unsure or rate-limited. This became a core rule.
- **Motion model.** First pass had the trees scrolling like the fruit, which felt wrong. I rebuilt
  it as a **fixed world with a moving camera** (trees are fixed like freeway lamp posts; the bird
  flies forward like a race car). Took a couple of iterations to get the ground to read as static.
- **Ground seam + colour.** Redone several times: a mirrored wrap created a kaleidoscope (rejected);
  then a green tint + offset tiling; finally an **offset-and-blend seamless** texture pass.
- **The "upside-down bird."** A real bug the green tests sailed past — the moving camera's look-at
  was too close, so it stared steeply down. Fixed by looking far ahead, and I added a
  **camera/playability check** to the visual agent so this class of bug fails loud next time.
- **Rate limits.** Gemini 429s and daily quota kept blocking the judge; handled with backoff, a
  deterministic fallback, and an offline mock so the pipeline never stalls.

## What I'd do differently in v2

- **Real telemetry backend.** Today the closed loop runs on local Playwright runs; v2 feeds the
  ad-network's performance webhook into the same shape so win-rate comes from real users.
- **Scheduled champion/challenger.** Run a new prompt version silently for days/weeks and
  auto-promote only when it beats the champion, instead of a one-shot comparison.
- **Asset consistency.** Per-asset embeddings / a style reference so separately generated sprites
  share a look without manual tuning; a tileable-texture model for ground instead of post-blending.
- **Stronger judge.** Few-shot the judge with the golden set to cut leniency; expand the golden set
  so regression coverage grows with every new failure mode found.
- **More 3D, fewer billboards.** Real meshes for fruit/trees would give true parallax and depth.

## Asset generation versions (rollback record)

| Asset | Prompt file | Version | Final file | Notes |
|-------|-------------|---------|-----------|-------|
| Parrot | prompts/parrot.md | v0.1 | assets/Parrot.glb | rigged model, real wing-flap |
| Fruit  | prompts/fruit.md  | v0.1 | assets/sprites/fruit.png | variety: mango/coconut/banana |
| Tree   | prompts/tree.md   | v0.1 | assets/sprites/tree.png | fixed-orientation billboard |
| Ground | prompts/ground.md | v0.2 | assets/ground.jpg | green prompt + offset-blend seamless; raw kept as ground.raw.jpg |
| Background | (scene) | v0.1 | assets/background.jpg | opaque jungle backdrop |

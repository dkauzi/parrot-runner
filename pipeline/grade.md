# Asset Grading Rubric (the judgment half of generate -> validate -> grade)

`validate.mjs` enforces the hard, deterministic rules (PNG, alpha, square, size). This file is
the soft, judgment layer: the "Agent B grades Agent A" step from the Seepia variant pipeline,
expressed as a rubric instead of an agent because three assets do not justify a runtime grader.
At scale (hundreds of ad variants) this rubric is what an LLM grader would be prompted with.

Score each generated variant 1-5 per criterion. Accept only variants with **no score below 3
and a total >= 18 / 25**. Log every graded variant so a regression is traceable to a version.

| Criterion | What you are judging | 1 | 5 |
|---|---|---|---|
| Reads at scale | Recognisable at in-game sprite size, not just at 1024px | mush | instantly clear |
| Silhouette | Clean outline against a busy jungle background | blends in | pops |
| On-theme | Fits tropical-jungle playable-ad look | off-brand | spot-on |
| Palette consistency | Matches the other assets' saturation/lighting | clashes | cohesive |
| Transparency | Edges clean, no halo or leftover background | fringed | crisp |

## Grading log

| Asset | Prompt version | Variant / seed | Reads | Silhouette | Theme | Palette | Alpha | Total | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| parrot | v0.1 | | | | | | | | |
| fruit  | v0.1 | | | | | | | | |
| tree   | v0.1 | | | | | | | | |

## How this scales (the interview answer)

For three assets: this rubric + `validate.mjs` is the whole pipeline, run by hand.
For 300 ad variants: same two stages, automated. The validator becomes a CI gate; the grader
becomes an LLM scored against this exact rubric, with low-confidence scores routed to a human.
The architecture does not change, only the volume and who pulls the lever. That is the point:
you ship the small version and you can articulate the large one.

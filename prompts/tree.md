# Asset: Tree (environment) - v0.1

Seen from the FRONT/side as a billboard scattered along the path. Full vertical tree so it
reads as scenery framing the flight lane.

- Tool: <e.g. DALL-E 3 / SDXL / Midjourney v6>
- Model/version: <pin it>
- Output: 1024x1024 PNG (or 1024x1536 if your tool allows portrait), transparent background

## Prompt
```
A single stylized tropical tree with one big compact ROUNDED SOLID canopy and a short thick
trunk. Bold clean silhouette that reads instantly at small size. NO hanging vines, no thin
wispy branches, no scattered leaves. Vivid cartoon game-sprite style, thick clean outline,
flat shading. Centered, full tree from base to top.
```

> Rationale: the AI judge repeatedly scored the old "hanging vines / dense detail" tree 2/5 on
> silhouette ("busy, broken silhouette that won't read at small size"). This prompt forces a
> single solid bold shape - the closed-loop judge feedback driving the prompt, prompt-as-code.

## Negative / constraints
```
no background, no sky, no ground plane, no other trees, no animals, no text, no watermark,
no cast shadow on ground, no harsh perspective
```

## Post-processing
- Background removal, auto-trim. Anchor the sprite at the trunk base so it "stands" on the
  scroll plane. Generate 2-3 with the same prompt + different seeds for variety.

## Rejected attempts log
| Version | What changed | Why rejected |
|---------|--------------|--------------|
| | | |

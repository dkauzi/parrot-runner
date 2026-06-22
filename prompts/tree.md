# Asset: Tree (environment) — v0.1

Seen from the FRONT/side as a billboard scattered along the path. Full vertical tree so it
reads as scenery framing the flight lane.

- Tool: <e.g. DALL-E 3 / SDXL / Midjourney v6>
- Model/version: <pin it>
- Output: 1024x1024 PNG (or 1024x1536 if your tool allows portrait), transparent background

## Prompt
```
A lush tropical jungle tree, full body front view, tall slender trunk with a dense rounded
canopy of vivid green leaves, a few hanging vines. Flat clean game-asset style, soft even
lighting, slight depth shading on the canopy. Centered, full tree from base to top. Isolated
on a fully transparent background. Crisp edges, sprite quality.
```

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

# Asset: Parrot (player sprite) - v0.1

The player is viewed FROM BEHIND in the runner (camera sits behind it), so generate a
back/top view with wings spread, matching reference image 1.

- Tool: <e.g. DALL-E 3 / SDXL / Midjourney v6>
- Model/version: <pin it>
- Output: 1024x1024 PNG, transparent background

## Prompt
```
A colorful scarlet macaw parrot seen from directly behind, wings fully spread wide and
symmetric, flying away from the viewer, top-down-behind view. Vivid red, blue, green, and
yellow feathers. Centered, full body, tail trailing downward. Flat clean game-asset style,
soft even lighting, no harsh shadows. Isolated on a fully transparent background. Sprite
sheet quality, crisp edges.
```

## Negative / constraints
```
no background, no scenery, no foliage, no perspective foreshortening, not front-facing,
not side profile, no text, no watermark, no ground shadow, no motion blur
```

## Post-processing
- Background removal if the model bakes one in (e.g. remove.bg or SDXL alpha).
- Auto-trim transparent margins; keep wings within frame.

## Rejected attempts log
| Version | What changed | Why rejected |
|---------|--------------|--------------|
| | | |

# Sprite drop-in

Drop the AI-generated PNGs here to replace the procedural placeholders:

- `parrot.png` - player, seen from behind, wings spread (see ../../prompts/parrot.md)
- `fruit.png` - collectible (see ../../prompts/fruit.md)
- `tree.png` - environment (see ../../prompts/tree.md)

Each must be a transparent, square PNG under 150 KB. Gate them before building:

```bash
node pipeline/validate.mjs assets/sprites
```

`src/game/assets.ts` auto-detects any PNG named here (webpack inlines it as a base64 data URL,
so the single-file build stays self-contained) and uses it; anything missing falls back to the
procedural placeholder, so the game always runs.

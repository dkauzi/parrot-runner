# Raw art drop-in (for the optimizer)

Optional manual path. If you generate sprites in an external tool (Midjourney, DALL-E, etc.),
save them here as `parrot.png`, `fruit.png`, `tree.png`, then run:

```bash
npm run pipeline:optimize
```

That trims, squares, and shrinks them into game-ready sprites in `assets/sprites/` and gates each
one. (The committed sprites are already produced by the free Pollinations generator, so you don't
need this unless you want to supply your own art.)

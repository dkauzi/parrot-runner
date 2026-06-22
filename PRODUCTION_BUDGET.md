# Production Budget (the playable-ad contract)

Seepia ships playable ads. Playables live or die on three numbers: frame rate, build size,
and time-to-first-frame. The reference mocks even render an FPS counter ("53 FPS", "33 FPS")
in a *concept image*, which is a deliberate signal that performance is first-class. This file
is the contract this build holds itself to, and it is measured, not assumed.

## 1. Frame rate

- Target: 60 FPS on a mid device.
- Floor: never below 30 FPS, including on a 6x-throttled CPU (Chrome DevTools Performance).
- Enforcement: an on-screen FPS HUD (kept in the shipped build, mirroring the reference).
- Techniques: object pooling (no per-frame allocation), distance-check collision (no raycast
  per object), capped object count on screen, `powerPreference: 'high-performance'`.

## 2. Build size

- Total build target: < 3 MB. Hard ceiling: < 5 MB. (A 40 MB parrot game proves you do not
  know the product.)
- Per sprite: < 150 KB after compression. Pack all sprites into a single texture atlas to cut
  draw calls and request count.
- Image format: compressed PNG, or WebP where the target allows. Trim transparent margins.
- Enforcement: read `vite build` output size on every build; record it in DECISIONS.md.

## 3. Load / time-to-first-frame

- Instant start: first frame < ~2 s on a throttled connection.
- Near-zero dependency tree: three.js + the Vite toolchain only. No game framework, no
  physics engine, no UI library. Every dependency is load weight and risk.
- Preload the atlas before the start screen resolves; show start only when assets are ready.

## 4. Device matrix

- Primary: mobile, touch input (virtual joystick), portrait-friendly layout.
- Fallback: desktop, keyboard (arrows / WASD).
- Responsive canvas + DPR clamp (cap devicePixelRatio at ~2 to protect FPS on retina phones).

## How each number is verified

| Budget | Tool | Pass condition |
|---|---|---|
| FPS floor | DevTools 6x CPU throttle + on-screen HUD | stays >= 30 |
| Build size | `vite build` size report | total < 5 MB, sprites < 150 KB each |
| Load | DevTools network throttle (Fast 3G) | first frame < ~2 s |
| Device | real phone or device emulation, touch | joystick controls the parrot |

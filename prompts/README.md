# Asset Prompts (Prompt as Code)

Each asset's generation is versioned here so it can be reproduced and rolled back, exactly
like source code. One file per asset. Bump the version on any prompt change and keep the
old block (don't delete history) so v0.1 can be regenerated if v0.2 regresses.

Convention per file:
- Tool + model + version (the asset-gen equivalent of a dependency pin)
- Exact prompt (copy-paste ready)
- Negative prompt / constraints
- Output settings (size, format, transparency)
- Post-processing steps (bg removal, trim)
- Rejected attempts log (what failed and why -> "track outcomes, not inputs")

All sprites: transparent PNG, square canvas (1024x1024), subject centered, margins trimmed
so on-screen scale is consistent across assets.

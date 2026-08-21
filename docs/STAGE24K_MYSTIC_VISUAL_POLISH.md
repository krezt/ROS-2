# Stage 24K — Mystic Visual Polish

Scope: Mystic visual-only polish on top of Stage 24J. No gameplay changes.

## Changes
- Replaced the Stage 24J Mystic source-pose artwork with a higher-detail polished source matching the Warrior/Barbarian/Archer visual quality bar more closely.
- Corrected **north-facing hood orientation**: the N row now shows the back of the hood/fur collar rather than the hood opening/face.
- Rebuilt the runtime atlas deterministically from the polished source poses.
- Preserved the exact 80×96 runtime cell contract and bottom anchoring.
- Kept the existing Stage 24J Mystic ability VFX integration unchanged.
- Rebuilt the four-frame throwing-dagger projectile from the polished source art.
- Regenerated preview, runtime validation, isolated-pose preview, and Barbarian scale comparison.

## Runtime contract
- N / S / E / W
  - idle ×1
  - walk ×4
  - attack ×5
  - cast ×5
- shared
  - hit ×3
  - KO ×5
  - resurrect ×5
- total champion frames: **73**

The polished source provides 13 strong directional poses per direction. Transitional poses are deliberately remapped/reused in code to produce the exact 15-frame directional runtime contract; no assumed equal-grid runtime slicing is used.

## Validation
- runtime atlas: 1360×480
- exact populated champion frame count: 73
- all intended blank cells transparent
- all populated frames remain within safe 80×96 cell margins
- no frame touches its cell border
- throwing dagger: four isolated 80×96 projectile cells
- `src/` byte-for-byte unchanged from Stage 24J
- automated tests: **567 / 567 passing**

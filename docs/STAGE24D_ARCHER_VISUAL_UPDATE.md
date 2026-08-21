# ROS 2.0 Stage 24D — Archer True-Bounds Visual Fix

## Scope

This pass updates **Archer presentation assets only**.
It does **not** alter mechanics, timings, targeting, damage, movement, AI, or any combat logic.
The authoritative `src/` directory remains unchanged.

## Root cause found

The prior clipping bug was **not** primarily caused by the 64×80 or 80×96 runtime frame size.
It was caused earlier in the authoring pipeline.

The approved Archer concept sheet visually resembles a sprite sheet, but it is **not** an exact 18-column runtime grid.
Each direction row contains **17 real source poses** separated by black gaps.
Previous builds incorrectly sliced the source image into equal-width artificial columns, which cut through the Archer's body and bow before the runtime sheet was even assembled.

That is why increasing the runtime frame size alone did not solve the issue.

## Fix applied

The Archer conversion pipeline now treats the concept art as a **source pose sheet**, not a runtime sheet.

It now:

1. uses the **actual pose boundaries** from the approved source sheet
2. extracts each complete pose intact
3. preserves the full body / bow / quiver / cloak silhouette
4. places the extracted poses into ROS's exact runtime contract
5. keeps Archer on the larger **80×96 native** frame size

This avoids the earlier "cut first, enlarge later" problem.

## Preserved runtime contract

Archer still uses:

- **80×96 native frames**
- the same **85-frame** Stage 24D structure
- the same bottom-anchor rendering behavior
- the same timing hooks

### Frame structure

For each of **N / S / E / W**:
- idle ×4
- walk ×4
- attack ×5
- cast ×5

Shared:
- hit ×3
- KO ×5
- resurrect ×5

Total:
- **85 frames**

Timing preserved:
- `attackImpactFrame: 3`
- `castReleaseFrame: 3`

## Archer rendering behavior

Archer remains bottom-anchored to the grid cell and still renders with the larger-art presentation setup introduced in the prior build:

- `frameWidth: 80`
- `frameHeight: 96`
- `renderScale: 5/6`

This keeps gameplay footprint stable while allowing more art room.

## Updated assets

### Champion assets
- `client/assets/champions/archer.png`
- `client/assets/champions/archer-preview.png`

### Archer VFX assets
- `client/assets/vfx/archer-vfx-sheet.png`
- `client/assets/vfx/archer-arrow-shot.png`
- `client/assets/vfx/archer-impact-burst.png`
- `client/assets/vfx/archer-volley-cluster.png`
- `client/assets/vfx/archer-hunters-mark.png`
- `client/assets/vfx/archer-eagle-eye.png`
- `client/assets/vfx/archer-quick-shot.png`
- `client/assets/vfx/archer-wind-crescent.png`
- `client/assets/vfx/archer-volley-rain.png`
- `client/assets/vfx/archer-feather-sigil.png`
- `client/assets/vfx/archer-mark-arrow.png`
- `client/assets/vfx/archer-guarding-wind.png`
- `client/assets/vfx/archer-sky-beacon.png`
- `client/assets/vfx/archer-arrow-projectile.png`

## Authoring update

- `tools/archer_stage24d_hd.py`
  - no longer slices the source by equal-width columns
  - uses the true pose bounds of the approved source sheet
  - maps those extracted full poses into the Stage 24D runtime contract
  - preserves larger 80×96 native Archer frames

## Validation summary

- Archer visual assets updated only
- no mechanics changed
- `src/` remains untouched

# Stage 24D Monk Visual Update (Polish Pass)

## Scope
Visual-only Monk polish update for ROS2 using the Warrior production method. No gameplay or `src/` logic changes.

## Applied polish
- Reduced Monk effective on-screen height to a maximum of **75 px** in runtime cells.
- Rebuilt the Monk runtime atlas deterministically into exact **80×96** bottom-anchored cells.
- Standardized model scale across directional, hit, KO, resurrect, and Palm Hit frames.
- Prevented oversized / pixelated KO presentation by using the same underlying sprite scale policy across the set.
- Cleaned alpha / silhouette issues to reduce incomplete model artifacts, including detached lower-foot fragments and similar small isolation errors.
- Preserved transparent background and runtime ordering.

## Runtime contract
- Directions order: **N / S / E / W / shared**
- Per direction: **idle ×1, walk ×4, attack ×5, cast ×5**
- Shared: **hit ×3, KO ×5, resurrect ×5, Palm Hit ×4**
- Total active frames: **77**
- Timing hooks preserved:
  - `attackImpactFrame: 3`
  - `castReleaseFrame: 3`

## Validation
Validated before integration:
- exact atlas size and cell isolation
- exact frame count and ordering
- bottom anchoring preserved
- no `src/` file changes
- suitable for in-game runtime use

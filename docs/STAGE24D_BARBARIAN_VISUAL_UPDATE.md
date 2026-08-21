# STAGE24D Barbarian Visual Update

## Scope
- Visual-only Barbarian upgrade for ROS2 using the Warrior production method.
- Barbarian is treated as a brand-new class asset and does not reuse or derive from any previous Barbarian implementation.
- No gameplay or simulation mechanics changed.
- Runtime atlas rebuilt deterministically from approved source-pose art.

## Class target
- Primal Barbarian with throwing axes and war cries.
- Rugged fur-and-leather silhouette with savage, battle-hardened identity.
- Readable SNES-era pixel-art presentation matched first to Warrior, second to Archer.

## Runtime contract
- 80×96 native frames.
- Bottom-anchored.
- Runtime row order: N / S / E / W / shared.
- Fixed 17-column runtime layout.
- Directional clip contract: idle ×1, walk ×4, attack ×5, cast ×5.
- Shared clip contract: hit ×3, KO ×5, resurrect ×5, throwing-axe projectile ×4.
- 77 active frames total (with 8 intentionally blank directional spacer cells in the 17-column grid).

## Production notes
1. Generated source art was treated as source-pose material, not as the final runtime sheet.
2. Poses were selected deliberately and remapped in code in `tools/barbarian_stage24d_hd.py`.
3. Crops were isolated, trimmed, normalized, and fitted into exact 80×96 runtime cells with bottom anchoring.
4. Large rage-aura spill and distant debris were filtered so frames stay isolated and neighbor-safe.
5. Four throwing-axe projectile frames were exported both into the shared runtime row and into `client/assets/vfx/barbarian-axe-projectile.png` for attack / counter presentation.
6. Preview output was regenerated from the same runtime atlas for UI consistency.

## Key files
- `client/assets/champions/barbarian.png`
- `client/assets/champions/barbarian-preview.png`
- `client/assets/vfx/barbarian-axe-projectile.png`
- `tools/barbarian_stage24d_hd.py`
- `docs/concepts/stage24d-barbarian-approved-sprite-source.png`
- `docs/concepts/stage24d-barbarian-runtime-validation.png`
- `docs/concepts/stage24d-barbarian-warrior-scale-validation.png`

## Validation summary
- Exact 80×96 runtime atlas dimensions maintained.
- 17-column deterministic layout preserved.
- 77 active-frame contract preserved.
- N / S / E / W / shared row ordering preserved.
- Idle / walk / attack / cast / hit / KO / resurrect / projectile clip counts preserved.
- Attack impact hook remains frame 3.
- Cast release hook remains frame 3.
- Shared mirroring remains available through client presentation logic.
- Barbarian effective on-screen height is fitted to approximately 80 px at runtime.
- Runtime cells were re-fitted to maintain a 2-pixel safety margin, preventing edge clipping.
- Throwing-axe projectile presentation is enabled for Barbarian attacks and counter attacks.
- Preview / portrait consistency is maintained with `client/assets/champions/barbarian-preview.png`.
- `src/` remains unchanged.
- The atlas is suitable for direct in-game runtime use.

## Polish pass
- Barbarian body footprint increased by roughly 15% over the previous update.
- Source poses now use row-specific variable-width extraction windows instead of assuming equal source slices, preventing missed limbs / extra fragments.
- All runtime frames were rebuilt with one shared model scale so the character reads as the same size throughout the atlas.
- Walk mapping was adjusted to read more like grounded stepping and less like floating.
- Throwing-axe projectile frames were normalized into a consistent dedicated projectile sheet.
- Runtime placement keeps a safety margin so no legs, axes, or hair clip against cell edges.

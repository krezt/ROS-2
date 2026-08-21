# STAGE24D Mage Visual Update

## Scope
- Visual-only Mage upgrade for ROS2 using the Warrior production method.
- Mage is treated as a brand-new class asset and does not reuse or derive from the prior Mage implementation.
- No gameplay or simulation mechanics changed.
- Runtime atlas rebuilt deterministically from approved source-pose art.

## Class target
- Red hooded elemental Mage.
- Fire-and-lightning theme.
- Short-range lightning zaps for basic attack presentation.
- Strong fire spell presentation for cast frames.
- Readable SNES-era pixel-art presentation matched first to Warrior, second to Archer.

## Runtime contract
- 80×96 native frames.
- Bottom-anchored.
- Runtime row order: N / S / E / W / shared.
- Directional runtime layout: 15 populated columns.
- Directional clip contract: idle ×1, walk ×4, attack ×5, cast ×5.
- Shared clip contract: hit ×3, KO ×5, resurrect ×5.
- Total active frames: 73.

## Production notes
1. Generated source art was treated as source-pose material, not as the final runtime sheet.
2. Poses were selected deliberately and remapped in code in `tools/mage_stage24d_hd.py`.
3. Crops were isolated, trimmed, normalized to Warrior-comparable footprint, and fitted into exact 80×96 runtime cells.
4. Oversized edge-touching fire/lightning halo fragments were intentionally removed during cleaning so runtime cells stay isolated.
5. Preview output was regenerated from the same runtime atlas for UI consistency.

## Key files
- `client/assets/champions/mage.png`
- `client/assets/champions/mage-preview.png`
- `tools/mage_stage24d_hd.py`
- `docs/concepts/stage24d-mage-approved-sprite-source.png`
- `docs/concepts/stage24d-mage-runtime-validation.png`
- `docs/concepts/stage24d-mage-archer-scale-validation.png`

## Validation summary
- Exact 80×96 runtime atlas dimensions maintained.
- Exact 73-frame contract preserved.
- N / S / E / W / shared row ordering preserved.
- Idle / walk / attack / cast / hit / KO / resurrect clip counts preserved.
- Attack impact hook remains frame 3.
- Cast release hook remains frame 3.
- Shared mirroring remains available through client presentation logic, including W-facing shared states and attacker-aware hit mirroring for Mage.
- Preview / portrait consistency is maintained with `client/assets/champions/mage-preview.png`.
- `src/` remains unchanged.
- The atlas is suitable for direct in-game runtime use.

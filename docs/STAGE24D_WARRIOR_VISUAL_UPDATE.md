# Stage 24D Warrior Visual Update — Archer Production Method

The Warrior has been rebuilt as a visual-only 80×96 champion using the same production discipline established for Archer.

## Class identity
- steel-armored Warrior
- helmeted
- one sword + one shield
- blue / steel / gold palette
- tough frontline silhouette

## Runtime contract
- 80×96 native cells
- 18 columns × 5 rows
- runtime row order: N / S / E / W / shared
- idle ×4, walk ×4, attack ×5, cast ×5 per direction
- hit ×3, KO ×5, resurrect ×5 shared
- 85 populated frames total
- idle is intentionally frozen in every direction
- KO ends fully prone; resurrect starts from the grounded corpse pose

## Archer production method
1. Generated artwork is stored as source-pose material at `docs/concepts/stage24d-warrior-approved-sprite-source.png`.
2. `tools/warrior_stage24d_hd.py` identifies the actual character components in each source row and maps them deliberately. It does **not** treat the generated art as a pre-cut runtime grid.
3. The script assembles the final 80×96 runtime atlas deterministically.
4. Runtime validation checks the exact 85-frame contract, blank shared tail cells, frozen idle, cell isolation, and safety gutters before assets are written.

## Presentation
- `client/assets/champions/warrior.png` is the validated runtime atlas.
- `client/assets/champions/warrior-preview.png` is regenerated from the same atlas for UI consistency.
- Warrior uses a fitted 1× render scale so its visible battlefield body footprint remains comparable to Archer while sword/shield poses stay inside their 80×96 cells.
- Existing Warrior VFX remain in place; no VFX is baked across runtime cell boundaries.

## Scope guarantee
- visual-only update
- no gameplay mechanics changed
- authoritative `src/` remains byte-for-byte unchanged
- `attackImpactFrame: 3` preserved
- `castReleaseFrame: 3` preserved

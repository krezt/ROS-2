# Stage 24D Paladin Visual Update

This package adds the Stage 24D Paladin presentation pass using the Archer production method.

## Scope
- visual-only update
- no mechanics changed
- `src/` remains byte-for-byte unchanged
- timing hooks preserved:
  - `attackImpactFrame: 3`
  - `castReleaseFrame: 3`

## Deliverables
- `tools/paladin_stage24d_hd.py`
- `client/assets/champions/paladin.png`
- `client/assets/champions/paladin-preview.png`
- `client/assets/vfx/paladin-vfx-sheet.png`
- Paladin signature FX tiles for Shield Bash, Divine Shield, Cleanse, Sanctify, and Judgment
- `docs/concepts/stage24d-paladin-approved-sprite-source.png`
- `docs/concepts/stage24d-paladin-approved-vfx-source.png`

## Production method
1. Generate clean Paladin source-pose art.
2. Deliberately map source poses to the ROS runtime contract.
3. Assemble the 80×96 bottom-anchored runtime atlas deterministically.
4. Validate the final 85-frame sheet before integration.

## Final runtime cleanup
- The generated source sheet remains untouched as source-pose material.
- Source poses that visibly contain duplicate mace heads are deliberately excluded from the runtime attack mappings.
- Clean single-mace poses are reused where necessary instead of editing or equally slicing the generated source sheet.
- `tools/validate_paladin_stage24d.py` validates all 85 populated runtime frames, the five required blank cells, exact 80×96 cells, transparent safety gutters, bottom anchoring, and preview dimensions.
- `docs/concepts/stage24d-paladin-runtime-validation.png` is the assembled runtime inspection sheet used to confirm N / S / E / W / shared ordering before integration.

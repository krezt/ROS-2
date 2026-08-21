# Stage 24D Electromancer Visual Update

This update applies the Archer production method to the Electromancer as a visual-only asset refresh.

## Summary

- Runtime atlas upgraded to **80×96 native** and assembled deterministically from approved source-pose art.
- Runtime order preserved as **N / S / E / W / shared** with the full **85-frame** contract.
- Timing hooks preserved:
  - `attackImpactFrame: 3`
  - `castReleaseFrame: 3`
- `src/` remains unchanged.
- Preview / portrait consistency maintained.

## Source materials

- `docs/concepts/stage24d-electromancer-approved-sprite-source.png`
- `docs/concepts/stage24d-electromancer-approved-vfx-source.png`

## Generated outputs

- `client/assets/champions/electromancer.png`
- `client/assets/champions/electromancer-preview.png`
- `client/assets/vfx/electromancer-vfx-sheet.png`
- split VFX tiles under `client/assets/vfx/`
- validation contact sheets `electro_runtime_*.png`

## Production method

1. generate strong source-pose art
2. select / map poses deliberately
3. assemble runtime atlas deterministically in code
4. validate the final runtime sheet before integration

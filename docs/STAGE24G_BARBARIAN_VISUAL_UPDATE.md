# Stage 24G — Barbarian Visual Update (Warrior Production Method)

Scope: visual-only Barbarian class update integrated directly into the Stage 24F build.

## Summary

This pass replaces the Barbarian champion art with a brand-new SNES-era pixel-art asset set built using the Warrior production method:

1. generate source-pose art
2. select/map poses deliberately
3. assemble the runtime atlas deterministically
4. validate before integration

## Class look

- Barbarian
- axe-thrower
- savage / muscular silhouette
- viking helmet
- Warrior-quality readability with Archer as a secondary style benchmark

## Deliverables updated

- `docs/concepts/stage24d-barbarian-approved-sprite-source.png`
- `client/assets/champions/barbarian.png`
- `client/assets/champions/barbarian-preview.png`
- `client/assets/vfx/barbarian-axe-projectile.png`
- `docs/concepts/stage24d-barbarian-runtime-validation.png`
- `docs/concepts/stage24d-barbarian-warrior-scale-validation.png`
- `tools/barbarian_stage24d_hd.py`

## Runtime contract delivered

- 80×96 native cells
- bottom-anchored runtime atlas
- row order: N / S / E / W / shared
- directional rows: idle ×1, walk ×4, attack ×5, cast ×5
- shared: hit ×3, KO ×5, resurrect ×5
- optional extra shared cells used for axe projectile travel art

## Validation notes

- deterministic runtime atlas assembled by code
- no `src/` gameplay logic changes
- validation render regenerated
- warrior-scale comparison regenerated
- automated suite: `npm test` → **567 / 567 passing**

## Timing hooks preserved

- `attackImpactFrame: 3`
- `castReleaseFrame: 3`

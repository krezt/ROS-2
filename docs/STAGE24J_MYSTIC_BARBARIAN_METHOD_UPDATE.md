# Stage 24J — Mystic Visual Update (Barbarian Production Method)

## Scope
Visual-only Mystic update integrated onto the Stage 24I Barbarian build. No gameplay mechanics were changed and `src/` remains byte-for-byte unchanged.

## Production method
1. Generated brand-new Mystic source-pose art using the current Barbarian quality/method as the production reference.
2. Deliberately mapped the generated NORTH / SOUTH / EAST / WEST / shared poses; no previous Mystic or Rogue visual implementation was used as a source.
3. Built the runtime atlas deterministically by code into exact 80×96 cells.
4. Validated frame count, cell occupancy, alpha isolation, safe margins, direction ordering, shared frames, projectile art, timing hooks, and automated game tests before integration.

## Runtime contract
- native cell: 80×96
- bottom anchored
- sheet order: N / S / E / W / shared
- each direction: idle ×1, walk ×4, attack ×5, cast ×5
- shared: hit ×3, KO ×5, resurrect ×5
- exact champion runtime frames: 73
- extra champion-atlas cells remain transparent/blank

## Projectile / ability VFX
- New four-frame animated throwing-dagger projectile sheet.
- New target-readable presentation VFX for Berserk, Stun, Suppression, and Spellbreak/Mental Breakdown.
- These are presentation-only and do not modify simulation state or mechanics.

## Timing hooks preserved
- `attackImpactFrame: 3`
- `castReleaseFrame: 3`

## Validation
- deterministic atlas builder asserts exactly 73 populated champion frames
- directional blank cells verified empty
- all populated runtime cells remain inside safe cell borders
- projectile sheet is four isolated 80×96 cells
- Barbarian/Mystic scale comparison regenerated
- `src/` SHA-256 snapshot before/after: identical
- `npm test`: 567 / 567 passing

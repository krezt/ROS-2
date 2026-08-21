# Stage 24C — Resolution-Timed Spell VFX + Sprite Polish

## Purpose
Stage 24C keeps the deterministic Stage 23.22 combat rules intact and advances only the replay/presentation layer.

## Spell timing contract
- `CAST_START`: a restrained charging tell only. No full cast animation and no projectile/impact.
- `CAST_COMPLETE`: for ordinary spells, the champion performs the full cast/release animation, followed by the projectile/area VFX.
- `SPELL_RESOLUTION`: Arcane Echo resolutions each perform their own release animation; the release command precedes the echoed projectile.
- Interrupt/fizzle clears the charging effect immediately.
- Presentation remains non-authoritative and consumes no gameplay RNG.

## Sprite presentation
- Native frame contract remains 32×40 pixels.
- Render scale increases from 1.28× to **1.50×**.
- Feet remain anchored to the logical grid square; head/weapon overhang is intentional.
- Class silhouettes received a second pass, especially weapons:
  - Barbarian: broad oversized two-handed axe.
  - Rogue/Shinobi: bright, separated short blades rather than belt-like pixels.
  - Mage: oversized two-handed greatsword to communicate Range 3.
  - Necromancer: extended skull staff to communicate Range 3.

## First VFX layer
Universal:
- physical slash impact
- magical hit particles
- healing particles
- Poison and Bleed impact particles
- cast charge and release halo
- teleport departure/arrival
- resurrection beam/burst

Signature:
- Fireball projectile + expanding blast
- Meteor descending impact
- Chain Lightning jagged arc
- Piercing Light radiant burst
- Shift teleport flash
- Resurrection light

These are deliberately procedural Phaser effects for the first pass. They establish timing, scale and readability before final authored VFX art.

## Asset pipeline
`tools/generate-roster-sprites.py` remains the reproducible source for the current prototype sheets. The art is intentionally still polishable; Stage 24C's goal is a stronger classic-JRPG silhouette and weapon read, not final production art.

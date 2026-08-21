# Stage 24B — Full Roster Animation Pass

## Goal
Take the Stage 24A Warrior vertical slice and prove the same rendering contract works for the entire roster before bespoke VFX and champion-specific polish.

## Scope
Animated archetypes in this stage:
- Warrior
- Barbarian
- Rogue
- Cleric
- Mage
- Paladin
- Archer
- Monk
- Necromancer
- Mystic
- Shinobi
- Electromancer

## Shared asset contract
Every archetype ships with the same native sprite-sheet structure:
- **32×40 px frame size**
- **18 columns × 5 rows** (576×200 total)
- Rows 0–3: N / S / E / W directional clips
- Columns per directional row:
  - 0–3: Idle
  - 4–7: Walk
  - 8–12: Attack
  - 13–17: Cast
- Row 4:
  - 0–2: Hit
  - 3–7: KO
  - 8–12: Resurrection / Stand

## Presentation changes from 24A
- Roster-wide preload and animation registration.
- Slightly larger sprite scale (~1.28×).
- Softer selected-champion ring for readability.
- Battlefield unit IDs hidden to reduce visual clutter.

## Non-goals
- No gameplay / balance changes.
- No champion-specific particle/VFX libraries yet.
- No sound system yet.
- No second-pass polished sprite art yet.

## Next logical steps
1. Tune any individual sprite silhouettes that read poorly in motion.
2. Add universal effect layers (slash, cast spark, heal pulse, control flash).
3. Pilot one or two signature VFX-heavy archetypes (Mage, Electromancer, Rogue).
4. Re-evaluate Chromebook scaling after the roster art is in motion together.

# ROS2 Stage 24 — Pixel-Art & Animation Pipeline Plan

## Goal
Replace Stage-23 placeholder rectangles with scalable JRPG-style pixel champions and readable combat VFX **without moving any gameplay authority into Phaser**.

Simulation remains authoritative. Presentation consumes events/commands and may never decide damage, targeting, RNG, movement legality, timing, or status results.

## Native asset scale
Current desktop board uses 50×46 presentation cells on a 16×11 logical grid.

Recommended champion source frame: **32×40 px** (transparent PNG), bottom-center/feet anchored to the champion's logical cell.

Why 32×40:
- reads clearly inside a 50×46 cell;
- leaves room for HP/control/status markers;
- can visually extend upward from a cell like classic JRPG sprites;
- small enough for Chromebook GPU/memory budgets;
- scales cleanly with Phaser `pixelArt`, nearest-neighbor sampling and whole-canvas FIT scaling.

Do not author separate Chromebook art. Keep one native asset set and scale the Phaser canvas/client layout responsively.

## Four directions
Each archetype needs:
- North
- South
- East
- West

Facing is presentation-only. Simulation remains orthogonal and does not gain facing bonuses unless explicitly designed later.

## Minimum shared animation set
Per archetype, per direction where applicable:

1. **Idle** — 2–4 frames, ~450–700 ms loop
2. **Walk/Run** — 4–6 frames, ~80–120 ms/frame
3. **Basic Attack** — 4–6 frames, one explicit impact frame
4. **Cast** — 4–6 frames, one explicit release frame
5. **Hit** — 2–3 frames
6. **KO** — 4–6 frames or a controlled fall/pose
7. **Resurrection / Stand** — may reuse KO reversed initially, later bespoke

Optional shared phase-two animations:
- Defend/Block
- Item Use
- Counter
- Victory

## Archetype-specific animations
Do not create every bespoke animation up front. Start with shared skeleton animations, then add special clips only where they improve readability.

Examples:
- Rogue: Backstab / Shadowstep
- Paladin: Shield Bash
- Monk: Palm Hits / Flurry
- Archer: Snipe / Volley
- Electromancer: Shift / Chain Lightning
- Cleric: Resurrection / Guardian Angel
- Mage: Arcane Surge / Echo cast
- Necromancer: Plague / Detonation
- Shinobi: Invisibility / potion
- Mystic: Throwing Dagger / control cast

## Animation contract
Create a data manifest rather than hardcoding animation names in event handlers.

Suggested logical keys:
- `idle_n`, `idle_s`, `idle_e`, `idle_w`
- `walk_n`, `walk_s`, `walk_e`, `walk_w`
- `attack_n`, ...
- `cast_n`, ...
- `hit`
- `ko`
- `resurrect`
- optional `special_<abilityId>`

Each clip stores:
- texture/sheet key
- frame list/range
- fps
- repeat
- impact/release frame index if relevant

## Event-to-animation bridge
Examples:
- `MOVE` / `COUNTER_MOVE` → face destination, play Walk, tween cell-to-cell
- `ATTACK` → face target, play Basic Attack; impact frame aligns with already-authoritative hit event
- `COUNTER` → Basic Attack initially; bespoke Counter later
- `CAST_START` → Cast loop/anticipation
- `SPELL_RESOLUTION` → release/projectile/impact VFX
- `DAMAGE` → floating number + Hit response unless blocked/KO
- `BLOCK` → Block response/VFX
- `KO` → KO animation
- `RESURRECT` → Resurrection/Stand
- `TELEPORT` → vanish/reappear VFX; no travel tween

The replay may wait for presentation animation promises, but simulation state is already resolved.

## VFX layer
Use small sprite sheets/particle effects independent of champion sheets.

First useful VFX set:
- Physical slash/impact
- Critical impact (gold)
- Magical impact (light blue)
- Heal pulse (green)
- Poison tick (dark green)
- Bleed tick (red)
- Stun/control indicator (purple)
- Fireball projectile + 4×4 explosion
- Volley arrows / area rain
- Chain Lightning beam segments (sequential)
- Electrical Storm shared simultaneous impact
- Shift vanish/reappear
- Invisibility fade
- Resurrection pillar/pulse

## Ability impact timing
Presentation commands should expose an `impactBeat` / grouping concept:
- Fireball/Volley/Storm victims show one shared impact beat.
- Chain Lightning remains sequential bounce-by-bounce.
- Arcane Echo produces two explicit projectile/impact sequences; second remains visually separate and mechanically 150% damage.

## Screen scaling / Chromebook strategy
1. Author one native art set.
2. Use Phaser FIT scaling for the game canvas.
3. Enable pixel-art / nearest-neighbor rendering and rounded camera pixels.
4. Keep 16×11 logical board invariant.
5. Desktop: full battlefield scale and log beneath.
6. Chromebook: shrink the battlefield container (e.g. ~0.75–0.85 visual scale if needed), preserve command text legibility separately in CSS rather than shrinking the whole DOM UI equally.
7. Test at common 1366×768 before locking final sprite dimensions.

## Recommended Stage-24 vertical slice
Do **not** draw twelve complete classes first.

Start with the current showcase trio:
- Warrior
- Rogue
- Mage

and one enemy trio:
- Barbarian
- Electromancer
- Cleric

For each, produce only:
- four-direction Idle
- four-direction Walk
- four-direction Basic Attack
- four-direction Cast
- Hit
- KO

Then implement VFX for:
- Power Strike / Shield Bash-style physical impact
- Backstab
- Fireball
- Shift
- Guardian Angel / Resurrection

Once that complete battle looks readable and scales properly, lock the asset convention and expand the other six archetypes.

## Art-production principle
Consistency matters more than detail. Six readable 32×40 champions with coherent silhouettes, facing, weapons and impact timing are more valuable than one beautifully animated class and five placeholders.

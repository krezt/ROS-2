# Stage 24A — Warrior Pixel-Animation Vertical Slice

## Purpose
Stage 24A proves the presentation pipeline with one archetype before multiplying art work across the roster.

The **Warrior** is the only champion using sprite animation in this stage. Every other archetype intentionally retains the Stage-23 rectangle placeholder.

Combat simulation remains completely authoritative. The sprite layer reads presentation commands only and cannot alter HP, movement legality, targeting, RNG, statuses, initiative, damage, or outcomes.

## Native asset
- Source frame: **32×40 px** transparent RGBA PNG.
- Sheet: `client/assets/champions/warrior.png`.
- Grid: 18 columns × 5 rows = 576×200 px.
- Phaser: nearest-neighbor / `pixelArt:true`; sprite displayed at 1.15× native size on the current desktop board.
- Anchor: bottom-center / feet. The logical grid cell remains the positional authority.

## Sheet layout
Rows 0–3 are directions: North, South, East, West.

Per directional row:
- frames 0–3: Idle
- frames 4–7: Walk
- frames 8–12: Basic Attack
- frames 13–17: Cast

Row 4:
- frames 0–2: Hit
- frames 3–7: KO
- frames 8–12: Resurrection / Stand

The manifest is `client/champion-animation.js`; event code never hardcodes numeric sheet frames.

## Presentation behavior
- MOVE / COUNTER_MOVE: turn toward destination, loop Walk during the positional tween, return to directional Idle.
- ATTACK / COUNTER: turn toward target and play directional Attack.
- The attack handler resolves at the visual impact beat (~62% through the clip), allowing the already-authoritative DAMAGE / MISS / DODGE feedback to appear while the recovery frames finish.
- CAST_START: directional Cast clip. This is presentation anticipation only; spell timing is still simulation-owned.
- DAMAGE: Hit clip and floating damage number in parallel.
- KO: dedicated KO sequence instead of rotating the whole unit container.
- RESURRECT: dedicated stand sequence and return to Idle.
- Invisibility alpha applies to the sprite as well as the legacy placeholder body.

## Facing
Facing is presentation-only and derived deterministically from geometry:
- dominant horizontal delta → East/West;
- dominant vertical delta → North/South;
- ties prefer horizontal.

No combat rule consults facing.

## Scaling / Chromebook implication
The art stays at one native resolution. The Phaser game remains a fixed logical canvas using FIT scaling and nearest-neighbor rendering.

Before expanding to the whole roster, test this Warrior at:
1. current desktop layout;
2. 1366×768 browser window;
3. a reduced battlefield container (~0.75–0.85 visual scale if necessary).

If the 32×40 source remains readable in all three, the same asset contract can be locked for the other eleven archetypes.

## What Stage 24A intentionally does NOT do
- No gameplay changes from Stage 23.22.
- No sprite art for the other eleven archetypes.
- No bespoke Shieldwall / Warhorn / Insult / Dig In VFX yet.
- No universal slash / magical / heal / control particle library yet.
- No audio pipeline yet.

Those should follow only after the one-archetype scale and animation timing feel correct in real play.

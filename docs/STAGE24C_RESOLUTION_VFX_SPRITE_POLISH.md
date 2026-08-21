# ROS 2.0 — Stage 24C: Resolution-Timed VFX + Sprite Polish

## Purpose
Stage 24C turns the Stage 24B animation contract into a real combat-presentation layer while preserving the simulation as the only gameplay authority.

## Spell timing contract
Delayed spells now have two distinct presentation moments:

1. **CAST_START / declaration:** subtle charge indicator only. No full spellcast animation, projectile, impact, damage, or healing VFX.
2. **CAST_COMPLETE / SPELL_RESOLUTION:** the champion performs the cast clip and the spell's resolution VFX is released. Damage/heal/status events then replay from the authoritative event stream.

Normal one-resolution spells receive a presentation-only resolution cue projected from `CAST_COMPLETE`. Arcane Echo continues to use its two explicit `SPELL_RESOLUTION` events, so both copies receive their own resolution animation and VFX.

Interrupts/fizzles immediately clear the charging indicator.

## Universal VFX layer
Stage 24C adds presentation-only Phaser VFX for:
- physical impact
- magical impact
- critical hit burst
- heal burst
- Poison/Bleed impact colors
- hard-control burst
- shield/block flare
- teleport/Shift departure and arrival
- generic spell projectiles and radial spell bursts

Signature mappings currently include Fireball, Meteor, Chain Lightning, Electrical Storm, Piercing Light, Enid's Blessing/Guardian Angel, Arcane Ward, Power Surge, Resurrection, and Shift. The system is intentionally data-light: VFX selection never affects combat state or gameplay RNG.

## Sprite scale and polish
- Runtime champion scale: **1.50×** (from 1.28× in Stage 24B).
- Feet remain anchored to the logical grid coordinate; upper bodies and weapons may extend beyond the tile.
- Native sheet contract remains **32×40** per frame with nearest-neighbor rendering.
- Name labels moved upward to clear the taller on-screen sprite.

First silhouette polish targets:
- **Barbarian:** larger broad-headed axe with a visibly brutal profile.
- **Rogue/Shinobi:** dagger blade separated visually from belt/torso pixels with a clear grip/guard.
- **Necromancer:** taller, heavier skull staff.
- **Mage:** corrected from generic staff to a large **two-handed sword**, matching the intended Range-3 weapon identity.

The remaining classes retain the same shared animation contract and can receive additional art polish without changing replay code.

## Chromebook / scaling direction
The game remains authored at one native pixel-art resolution. Phaser uses `pixelArt:true`, `antialias:false`, and `Scale.FIT`, so smaller displays should scale the battlefield as a whole rather than requiring alternate sprite assets. Stage 24D can tune responsive battlefield scale / DOM layout after the 1.5× roster has been playtested on common desktop and 1366×768-class screens.

## Non-authoritative guarantee
The presentation layer does not consume gameplay RNG and does not mutate HP, statuses, targeting, movement resources, attacks, or spell timing. It only consumes authoritative events. Animation duration and replay speed therefore cannot alter combat outcomes.

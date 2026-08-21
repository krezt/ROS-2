# ROS 2.0 — Stage 24D: Mystic Visual Update

## Scope
Stage 24D is a presentation-only update. Combat mechanics, balance values, scheduler behavior, targeting, status logic, AI, RNG, and authoritative simulation remain unchanged from Stage 24C.

## Mystic anchor-model upgrade
The Mystic is the first champion moved to the higher-detail Stage 24D art pipeline.

- Approved visual identity: mysterious blue-violet occult seer.
- Weapon identity: ritual throwing daggers.
- Magical focus: floating violet/gold orb with rune motes.
- Native frame size: **64×80** for the Mystic, preserving the existing 18-column / 5-row / 85-frame animation contract.
- Full animation coverage remains unchanged:
  - N/S/E/W idle ×4
  - N/S/E/W walk ×4
  - N/S/E/W attack ×5
  - N/S/E/W cast ×5
  - hit ×3
  - KO ×5
  - resurrect ×5
- West-facing art is an intentional mirror of the East-facing authored set.

The Stage 24C champions remain on 32×40 native sheets until their individual visual passes. To test the larger presentation target, legacy champions render at 2× while the 64×80 Mystic renders 1:1. This gives the roster approximately the same 64×80 on-screen footprint while allowing the Mystic to carry substantially more native pixel detail.

## Throwing-dagger presentation
Mystic basic-attack presentation now uses the new throwing animation and a dedicated pixel-art dagger projectile. The projectile is presentation-only and follows the authoritative attack event; it does not alter hit chance, range, damage, timing rules, counters, or RNG.

## Battlefield presentation adjustments
To support the larger visual footprint:

- champion nameplates move upward;
- selection/target rings are positioned closer to the feet;
- champion pointer hitboxes extend upward with the larger models;
- combat floating text is raised to clear the taller sprites.

These are visual/interaction changes only.

## Reproducible asset pipeline
- `tools/mystic_stage24d_hd.py` — authored Mystic Stage 24D sheet generator.
- `tools/generate-roster-sprites.py` — now preserves the Stage 24D Mystic when rebuilding the roster assets.
- `client/assets/champions/mystic.png` — 1152×400 sheet, 64×80 frames.
- `client/assets/champions/mystic-preview.png` — contact/inspection preview at native Stage 24D resolution.
- `client/assets/vfx/mystic-dagger.png` — throwing-dagger projectile.

## Non-authoritative guarantee
No Stage 24D Mystic art or VFX code mutates game state or consumes gameplay RNG. The simulation remains the sole authority for combat outcomes.

## Final counter-replay sequencing fix
During live playtesting, the new Mystic projectile made an older presentation ambiguity obvious. The authoritative simulation was still correctly moving the Mystic up to her configured **2 counter-movement squares** before resolving the counterattack, but the Phaser replay mapped the earlier `COUNTER` marker to the same attack animation used by `ATTACK_START`. That made the Mystic appear to throw before retreating.

Stage 24D final changes only the presentation mapping:

- `COUNTER` / `COUNTER_CUE` now produces a short reaction pulse only.
- Authoritative `COUNTER_MOVE` events animate next, one square at a time.
- The later counter `ATTACK_START` owns the actual throwing-dagger animation and projectile.
- In the regression scenario, Mystic moves from distance **2 → 3 → 4** before throwing.
- No counter rules, movement values, weapon ranges, attack costs, scheduler behavior, or gameplay RNG were changed.

## Final verification
- **523 / 523 tests passing.**
- Dedicated Stage 24D regression coverage verifies the real roster Mystic's two-square counter retreat and the cue → movement → attack presentation ordering.
- The authoritative `src/` directory remains unchanged from Stage 24C.

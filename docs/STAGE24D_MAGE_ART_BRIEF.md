# ROS 2.0 Stage 24D — Mage Art Brief

## 1. Purpose
This brief defines the visual target for the **Mage** during the Stage 24D champion presentation pass. It is a **presentation-only** update: do not alter range, damage, spell timing, movement, counters, targeting, AI, RNG, or any other gameplay mechanic.

The Mage should meet the visual bar established by the Stage 24D Mystic and Warrior while remaining practical, readable pixel art for ROS 2.0.

## 2. Core Fantasy
The Mage is a **hooded elemental battlemage of fire** who fights through destructive spellcraft and a long-reaching **two-handed elemental sword**.

He should feel:
- intense;
- controlled;
- dangerous;
- arcane rather than knightly;
- physically capable enough to wield the weapon, but still unmistakably a spellcaster.

The visual hook is **fire mage + ice-edged greatsword**: crimson robes and fire runes surrounding a huge icy-blue blade carrying molten orange energy through its hilt and fuller.

## 3. Quality Bar / Visual Direction
Target:
- crisp sprite-first pixel art;
- strong late-NES / SNES JRPG readability;
- authored silhouette rather than procedural block art;
- intentional light/shadow clusters;
- clear face, hood, hands, robe layers, and weapon at native scale;
- enough animation personality to sell a dangerous Range-3 melee caster.

Avoid:
- painterly anti-aliasing;
- a small one-handed sword or dagger;
- staff-wizard clichés;
- heavy plate armor that makes him read as Warrior or Paladin;
- excessive particle noise that obscures the champion.

## 4. Class Identity Summary
The Mage should read immediately as:
- a **fire-elemental spellcaster**;
- a **two-handed greatsword wielder**;
- a long-reach battlemage rather than a back-line staff wizard;
- a champion whose sword is itself an elemental focus.

Key mood words: **fiery, hooded, elemental, disciplined, destructive, arcane, imposing**.

## 5. Silhouette Goals
At a glance:
1. A deep pointed hood.
2. Layered crimson battle robes with split lower panels for movement.
3. A large two-handed sword that is impossible to mistake for a dagger.
4. Both hands visibly committed to the weapon during idle and basic attacks.
5. Long blade poses that sell his unusual **3-square melee reach**.

The Mage should be slimmer and more robe-driven than Warrior, but more physically grounded than Mystic.

## 6. Character Design
### Presence
Male, composed, severe, and battle-ready. The hood keeps part of the face in shadow.

### Face
At sprite scale:
- stern neutral expression;
- one warm/fire eye highlight and one cold/ice highlight are acceptable as a restrained elemental motif;
- face remains secondary to hood + sword silhouette.

### Hood
The hood is mandatory. It should be deep crimson / dark maroon, pointed and angular enough to distinguish the Mage from other hooded roster members.

## 7. Costume Direction
Recommended elements:
- crimson and blood-red outer robe;
- near-black/maroon inner layers;
- split battle-skirt panels for leg readability;
- leather belt and practical boots;
- restrained gold/orange rune trim;
- small elemental gem or clasp combining fire-orange and ice-cyan.

Avoid:
- purple generic-wizard identity;
- bright holy white/gold dominance;
- bulky shoulder plate;
- dangling ornaments that interfere with the sword read.

## 8. Weapon / Equipment Identity
### Primary weapon
A **large two-handed elemental sword** is mandatory.

The sword should read as:
- roughly greatsword proportions for the 64×80 champion frame;
- held with two hands;
- icy-blue/cyan blade body;
- bright frost-white cutting edge;
- fire-orange/red energy concentrated in the guard, hilt, runes, and central blade channel;
- visibly long enough in attack poses to support the class's Range-3 fantasy.

### Explicit prohibitions
- no dagger;
- no short sword;
- no one-handed idle grip;
- no staff replacing the sword;
- no generic metal-gray blade as the primary read.

## 9. Color Palette
Primary:
- deep crimson;
- blood red;
- dark maroon.

Fire accents:
- ember red;
- orange;
- gold-yellow.

Sword / ice accents:
- deep cyan-blue;
- bright ice blue;
- near-white frost edge.

The class should read **red/fire first**, with ice concentrated on the weapon.

## 10. Animation Personality
### Idle
- both hands control the sword;
- subtle breathing / robe motion;
- weapon remains clearly visible;
- no exaggerated bouncing.

### Walk
- measured, heavy-enough movement to respect the weapon;
- robe panels separate to expose leg movement;
- sword tracks convincingly with both hands.

### Attack
Five-frame structure remains compatible with the existing runtime:
1. ready;
2. committed wind-up;
3. acceleration;
4. **impact / longest reach pose**;
5. recovery.

Impact frame must remain `attackImpactFrame: 3` zero-based. The fourth frame should carry the clearest long-range sword extension, icy reach arc, and restrained fire embers.

### Cast
The sword becomes the casting focus rather than disappearing. The Mage raises or centers it with both hands as fire motes gather and frost energy intensifies along the blade. Spell release remains `castReleaseFrame: 3` zero-based.

### Hit / KO / resurrect
- readable recoil;
- authored collapse rather than rotating the standing sprite;
- sword settles with the body;
- resurrection visually reconnects the final KO pose to standing.

## 11. VFX Identity Notes
Mage VFX language:
- flame motes and ember sparks;
- compact orange-red rune cues;
- icy-blue sword-edge flashes;
- frostblade arc on weapon impact;
- strong contrast between warm caster energy and cold blade energy.

Avoid turning every frame into constant fireworks. Elemental effects should peak on attack/cast release.

## 12. Distinction From Other Classes
### Versus Warrior
- robes, hood, no shield, elemental blade, caster gestures.

### Versus Paladin
- no holy-white identity, no divine radiance, no heavy armor.

### Versus Mystic
- aggressive fire-red palette, physically dominant two-handed sword, less subtle/occult.

### Versus Electromancer
- no lightning language; energy is flame + frostblade.

## 13. Required Asset Scope
The Stage 24D Mage uses the upgraded champion contract:

- native frame: **64×80**;
- sheet: **1152×400**;
- 18 columns × 5 rows;
- exact existing animation ordering;
- N/S/E/W idle ×4;
- N/S/E/W walk ×4;
- N/S/E/W attack ×5;
- N/S/E/W cast ×5;
- hit ×3;
- KO ×5;
- resurrect ×5;
- **85 total authored frame positions**.

No gameplay frame indices or simulation timings change.

## 14. Production Priorities
1. Hooded red/fire silhouette.
2. Clearly two-handed greatsword identity.
3. Icy-blue blade + fiery hilt/fuller contrast.
4. Range-3 attack reach readability.
5. Strong four-direction weapon handling.
6. Sword-driven casting animation.
7. Clean KO/resurrection states.
8. Runtime readability at actual battlefield scale.

## 15. Do / Don't Summary
### Do
- make him a red/fire elemental Mage;
- give him a deep hood;
- make the sword large and unmistakably two-handed;
- use ice-blue blade language with fire energy;
- let attack impact frames use the maximum readable weapon extension;
- keep the entire change presentation-only.

### Don't
- give him a dagger;
- shrink the sword into a normal one-handed weapon;
- turn him into an armored Warrior;
- replace the sword with a staff;
- change his existing Range-3 mechanics to justify the art;
- alter combat timing, damage, AI, counters, or RNG.

## 16. Final Target Statement
The final Mage should feel like **a hooded crimson fire-elemental battlemage wielding an enormous two-handed ice-edged sword — a dangerous Range-3 caster-warrior whose warm spell energy and cold blade effects are readable instantly at ROS 2.0 battle scale.**

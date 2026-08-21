# ROS2 Stage 24E — Systems, Balance, and Battlefield Readability Polish

Base build: **Stage 24D Monk polish pass**.

## Battlefield presentation
- Champion display depth is now deterministic from battlefield row rather than creation/arrival order.
- Larger row numbers render in front of smaller row numbers, so champions lower on the battlefield visually overlap champions above them.
- Depth is updated continuously during movement/displacement and re-synchronized after teleports/resurrection.
- Board graphics remain behind champion models; spell/combat VFX remain above them.

## Global survivability
- All champion max-HP baselines increased by 20% from the Monk-polish build (rounded to nearest whole HP).
- Baseline ARM (`DEF`) increased from 25 to 35 for all champions.
- Baseline RES increased from 25 to 35 for all champions.

## Movement
- Barbarian: 14 → 15.
- Warrior: 12 → 14.
- Paladin: 11 → 13.

## Warrior / Barbarian
- Power Strike now uses **SW -2** rather than half-SW. With the Warrior's normal 7 SW it executes 5 strikes; Warhorn's 8 SW becomes 6.
- Rend now uses exactly **4 swings**.
- End-of-round attack dumps re-check Stun/interruption after every attack/counter reaction. A Barbarian stunned during Rend immediately stops attacking.

## Necromancer
- Life Drain: **150–200** base magical damage.
- Life Drain healing fixed: heals the Necromancer for the actual damage dealt (subject to missing HP).
- Poison Bolt: **120–190** base magical damage.
- Plague: **100–160** base Poison and **6-cycle** cast time.

## Archer
- Ranger's Focus heal: **50–100**.
- Hunter's Mark: **4-cycle** cast time.
- Volley: **132–240** base physical damage (+20% from 110–200).

## Cleric
- Defensive Aura: **2-cycle** cast time.
- Enid's Blessing: **7-cycle** cast time.
- Piercing Light: **3-cycle** cast time and **4×4** footprint.

## Mage / Mystic
- Fireball footprint: **5×5**.
- Mental Breakdown: **2-cycle** cast time.
- Spellbreak + Arcane Echo interaction fixed: Spellbreak suppresses only the first echoed spell resolution; the second Arcane Echo resolution still resolves at its normal echo multiplier.

## UI descriptions
Authoritative ability detail models and roster notes were checked/updated so the new timing, damage/heal ranges, swing counts, and AoE footprints are reflected by in-game detailed descriptions/tooltips.

## Validation
- Full deterministic Node test suite: **567 / 567 passing**.
- Added regression coverage for:
  - Life Drain healing exactly actual damage dealt.
  - Power Strike executing SW -2 / five normal strikes.
  - Stun terminating remaining Rend dump swings immediately.
  - Spellbreak suppressing only Arcane Echo resolution 1.
  - Updated stats, timings, damage bands, footprints, tooltips, and row-based render-depth hooks.

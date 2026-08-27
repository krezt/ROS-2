# Realm of Shinobi 2.0 — Stage 25AB

Stage 25AB preserves the Stage 25Z tactical 1P AI, mobile Combat Log collapse, and Stage 25AA Counterstance/pathfinding safeguards while applying the current proc and ability tuning. Multiplayer rules/network flow are unchanged.

- 1P uses **TACTICAL** AI with threat recognition, focus fire, combo sequencing/interruption, sustain denial, reactive defense, meaningful Dispel/Cleanse decisions, and tightly gated Mystic Premonition.
- Counterstance uses path-aware pursuit eligibility and a strict post-pursuit range guard so blocked counters cancel cleanly instead of hanging a round.
- Archer Snipe remains **Range 7** and **202.5% base damage** per shot.
- Marked remains **+65% incoming damage**.
- Rogue remains at **17 Movement** with a **2.5× Shadowstep crit multiplier**; Poison Imbue now adds Poison equal to **75% of successful-hit damage**.
- Barbarian weapon damage remains **77–108**; Smashing Blows now has **15% Stun per successful hit**, and Rend stacks a **25% multiplicative DEF reduction per successful hit** for 3 rounds.
- Basic passive proc chances are now explicit per successful hit: Cleric **15%**, Necromancer **15%**, Mystic **15%**, Electromancer **30%**, Monk **20%**, Paladin **25%**, Mage **6%**; the existing **3 procs/round cap** remains.
- Paladin Shield Bash remains one **300% proactive bash** with two attack resources reserved for normal counters; its tooltip now reports this correctly instead of displaying three proactive swings.

Stage 25V preserves the Stage 25U durable Ranked/Supabase persistence system and Stage 25T portrait draft polish, while adding startup/lifecycle and Monk quality-of-life changes.

- No match auto-starts when the client loads; players explicitly choose a mode from the top bar.
- Match state/timers/action UI/combat log are cleaned before every new match or rematch.
- 2P chat can be collapsed/expanded without removing the chat tab or unread indicator.
- Monk Counterstance uses the free-counter + 2-square pursuit hybrid profile and grants +5 Movement for its 3-round duration.
- Second Wind explicitly reports its 10% max-HP Regen and current Monk per-round amount in the ability details.
- Ranked persistence behavior remains Stage 25U.


Stage 25U preserves all Stage 25T gameplay/visual content and fixes the hosted Ranked persistence path: modern Supabase secret-key authentication, verified read-after-write persistence, fail-closed Ranked on hosted ephemeral storage, and an in-game Ranked storage health indicator. See `server/README.md` for deployment details.

This build extends the Stage 25P 2P Ranked ladder with **independent ratings and ranks for every team size** plus persistent **champion win-rate analytics by format**. Ranked rooms continue to use the same synchronized draft, deterministic round confirmation, replay synchronization, chat, disconnect handling, and verified match-result agreement.

## Stage 25Q additions

- Independent **Elo rating and ladder rank** for 1v1, 2v2, 3v3, 4v4, and 5v5.
- Rating pools do not bleed across formats: a 3v3 result changes only 3v3 ratings.
- Elo settings are exposed in the ladder snapshot: **1500 initial rating, K=32**.
- **VIEW RANKINGS** now has battle-format tabs and two views:
  - **PLAYER LADDER** — format rank, rating, W/L, games, and win percentage.
  - **CHAMPION WIN RATES** — format rank, W/L, games, and win percentage for every drafted champion.
- Every verified Ranked result records the exact drafted teams and updates champion W/L for the selected format.
- Champion totals are also retained across all formats for future balance analysis/API use.
- Existing Stage 25P ladder files migrate to schema v2 automatically. Historical player W/L is preserved and format ratings are reconstructed from stored match history.
- Historical Stage 25P matches cannot retroactively populate champion stats because those older records did not store draft compositions; champion tracking begins with matches recorded by Stage 25Q or later.
- Public coordinator endpoint remains `/rankings`, now returning `players`, `champions`, per-format ranks/ratings, and rating-system metadata.

## Run locally

Client:

```bash
npm run client
```

Coordinator:

```bash
npm run server
```

The default local ladder file is `server/data/ranked-ladder.json`.

## Hosted persistence

For a public deployment, point `ROS2_LADDER_FILE` at persistent storage, for example:

```text
ROS2_LADDER_FILE=/var/data/ros2-ranked-ladder.json
```

On Render, mount a Persistent Disk at `/var/data` on the coordinator Web Service. Without persistent storage, ratings and champion analytics can reset when the coordinator instance is replaced or redeployed.

## Validation

```bash
npm test
```

Current result: **628 / 628 tests passing**, including live two-WebSocket Ranked result verification, separate format ratings, champion analytics, schema migration, and the existing deterministic multiplayer regression suite.
## Stage 25W — Monk ability VFX + Second Wind
- Added approved Monk 4x4 source VFX sheet and deterministic isolated runtime cuts:
  - A1 Palm Hits -> Monk
  - C1 Flurry Style -> Monk
  - D1 Chi Wave -> all living allies simultaneously
  - B2 Counterstance -> Monk
  - D2 Second Wind -> Monk
- Runtime crops are alpha-cleaned, individually trimmed, and padded with transparent borders to prevent clipping/neighbor bleed.
- Second Wind Regen increased from 10% to 15% max HP per round for 3 rounds (242 HP/round at base Monk max HP).


## Stage 25X — Warrior ability VFX + Monk basic proc
- Added the approved Warrior 4x4 VFX source sheet and deterministic isolated runtime cuts:
  - A1 Power Strikes: Warrior's first actual non-counter attack priority for the action.
  - A2 Insult: over Warrior on cast; mirrors when facing West while the existing projectile-to-target remains.
  - B1 Shieldwall redirect: over the intended ally whenever a melee strike is intercepted and redirected to Warrior.
  - B2 Warhorn: over Warrior on cast, followed by B4 over every living affected ally.
  - B3 Shieldwall: over Warrior on cast; mirrors when facing West.
  - B4 Warhorn ally rally: over all living allies after the B2 cast beat.
  - D2 Dig In: over Warrior on cast.
- Added Monk B1 as the successful `MONK_ATTACK` Opening-proc VFX.
- Warrior directional VFX use image mirroring rather than separate duplicated art.
- Runtime VFX are cut from inspected transparent gutters, alpha-cleaned, tightly trimmed, and padded by 10 transparent pixels so no neighboring effect can bleed into a runtime asset and no true effect edge is clipped.
- No combat mechanics or balance values changed.

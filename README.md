# Realm of Shinobi 2.0 — Stage 25AG

Stage 25AG preserves Stage 25AF spectator/replay timing and the Stage 25AE balance overhaul while fixing Shieldwall interception for ranged physical weapon hits and adding the requested Snipe/Shift/War Cry refinements.

- **Shieldwall:** its five redirects now intercept physical weapon hits regardless of melee/ranged weapon mode, so Mystic throwing daggers are correctly intercepted. The 10% team Physical Shield remains unchanged.
- **Shift reactions:** Shift now reacts to ordinary melee hits, Mystic throwing-dagger hits, and Archer Snipe hits. Other ranged attacks do not automatically trigger it.
- **Snipe:** Range **8→10**; base multiplier **225%→210%** so max-range scaling remains exactly equivalent (315% weapon scalar at the old/new maximum); before the first shot Archer attempts to retreat up to **3 squares** while staying within Range 10.
- **Arcane Surge:** Mage now receives Shift for a deterministic **1–2 rounds, 50/50**, in addition to DEF Up and SDM Up.
- **War Cry:** Barbarian additionally heals itself for a random **10–15% max HP** while retaining 75–100 magical team pressure and DEF Down.
- **Spectator discovery:** ongoing spectatable Casual and Ranked matches are exposed with **SPECTATE** buttons from either 2P lobby; the Stage 25AF late-join reconstruction and spectator chat/read-only rules remain intact.
- Full automated suite: **690/690 passing**.

# Realm of Shinobi 2.0 — Stage 25AF

Stage 25AF preserves the complete Stage 25AE balance overhaul and Stage 25AD Rogue VFX while fixing RES Down presentation, separating movement/melee replay timing from slower cast/VFX timing, and adding read-only live spectator mode with room chat.

- **RES Down UI fix:** `res_down` is classified and displayed as a negative/red debuff in champion inspection instead of a positive/green status.
- **Replay timing split:** default replay is now **0.50× for movement/melee/basic-attack presentation**, while **casts and ability VFX use an effective 0.33×** when 0.50× is selected. Selecting 0.25× or 0.33× slows both categories naturally. Combat simulation timing remains unchanged.
- **Spectator mode:** ongoing rooms expose **SPECTATE**; spectators can join mid-match, reconstruct confirmed rounds deterministically, receive subsequent round packages/confirmations live, inspect the battlefield/log, and participate in room chat. Spectators cannot submit actions, timeouts, draw/rematch commands, draft actions, or any other gameplay authority.
- Spectator disconnects do not affect the two-player match; player disconnect behavior remains authoritative and unchanged.
- Full automated suite: **684/684 passing**.

Stage 25AE preserves the Stage 25AD Rogue VFX update, Stage 25Z Tactical AI, Stage 25AA counter safeguards, and the existing multiplayer/ranked architecture while applying the latest roster-wide balance pass.

- New base HP: Warrior **2450**, Barbarian **2250**, Rogue **1850**, Cleric **1900**, Mage **1750**, Paladin **1900**, Archer **1800**, Monk **1800**, Necromancer **1800**, Mystic **1700**, Shinobi **1750**, Electromancer **1750**.
- Physical dodge now rounds **up to the nearest whole percentage point**. Blind physical whiff chance is **40%** globally.
- Warrior: Shieldwall physical shield **10%**; Dig In physical shield **15% for 2 rounds**, stackable to two layers, while retaining its 20% max-HP heal/DEF Up.
- Barbarian: weapon **80–110**; Bloodlust suppresses counters so SW stays committed to the chosen target; Smashing Blows = **5 swings at 125%**, **10% Stun/hit**; Rend = **4 swings at 125%** with 25% multiplicative DEF shred/hit; War Cry **75–100**; Rampage self DEF Down lasts **4 rounds**.
- Rogue: total basic crit **15%**; Shadowstep lasts **4 rounds**; Smoke Bomb heals **15–25% max HP** and blinds enemies at the global 40% whiff rate.
- Cleric: Prayer Mend **85–215** at 15%/successful hit; Defensive Aura heals **35–55% max HP** and grants DEF Up + RES Up for **3 rounds**; Guardian Angel Divine Shield **50%**.
- Mage: Arcane Ward Magic Shield **30%**; Fireball **200–400** magical in its 5×5 true-friendly-fire area.
- Paladin: Resolve lasts **3 rounds**; Shield Bash is one **400% proactive bash** with a **10% physical shield** and two counter resources; Divine Shield **50%**. Judgment remains **350% total damage against afflicted targets** from Stage 25AD.
- Archer: **6 SW**, weapon **80–150**, normal Attack = **100% weapon damage**; Ranger's Focus takes **2 cycles** and initially heals **10% max HP**; Cover Fire = **4 shots**; Volley = **150–350** at **4 cycles**; Snipe = **225% base weapon damage**, Range 8, +5% damage per square.
- Monk: Second Wind restores **20% max HP per round for 3 rounds** and grants DEF Up for 3 rounds in addition to its cleanse/hard-control bypass.
- Necromancer: Poison Bolt gets **+25% ability crit** and adds Poison equal to **100% of actual damage dealt**; Plague applies **100–180 Poison** per enemy.
- Mystic: Guard Falter is **15% per successful basic hit** and now applies both DEF Down and RES Down for **3 rounds**; Premonition additionally grants the whole team **+5 percentage points physical dodge for 3 rounds**.
- Electromancer: weapon **20–40**; Lightning Bolt proc retains 30% proc chance and now has **25% RES penetration** with **15% total crit**; Chain Lightning is **200–300**, and a champion may be hit up to **twice per chain** but never on two consecutive links.
- Basic passive proc rolls remain **uncapped per round**.
- Stage 25AD Rogue ability VFX remain integrated and cleanly cut; all earlier presentation/network functionality is preserved.

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

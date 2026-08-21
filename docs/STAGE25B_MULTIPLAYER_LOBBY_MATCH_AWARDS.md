# Stage 25B — Multiplayer Lobby + Match Awards

## Scope

Stage 25B builds on the Stage 25A variable-team-size core without changing combat balance or presentation assets.

Protected systems left unchanged:
- champion stats and balance
- abilities
- combat formulas
- movement rules
- counters
- friendly fire
- cadence
- visual assets / Stage 24M VFX
- battlefield dimensions
- two-minute planning timer
- deterministic gameplay RNG architecture

## Multiplayer lobby

The 2P Battle panel now supports:
- create room
- join room by ID
- advertised room browser
- host-selected 1v1 / 2v2 / 3v3 / 4v4 / 5v5 format
- optional **1 draft ban per player** flag
- host edits while waiting alone
- server-enforced configuration lock as soon as Player 2 joins
- advertised format, ban setting, player count and lock state

Stage 25B intentionally stops at the locked-lobby boundary. The locked room carries the authoritative team-size / ban configuration into the Stage 25C network draft. No default roster is silently started when Player 2 joins.

## Match-end screen

When an authoritative match completes, the client now records confirmed event statistics and displays a Victory / Defeat screen with:
- Highest Damage
- Most Kills
- Most Healing
- Most Damage in 1 Round
- per-champion damage / kills / healing / best-round damage table
- total completed rounds

Statistics are presentation/reporting only. They consume confirmed event data and do not feed back into simulation state or RNG.

## Validation

- full automated suite passes
- client and server JavaScript syntax checks pass
- all `src/` files remain byte-for-byte identical to Stage 25A
- all `client/assets/` files remain byte-for-byte identical to Stage 25A

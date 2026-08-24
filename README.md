# Realm of Shinobi 2.0 — Stage 25U Ranked Persistence Hardening

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

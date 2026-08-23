# ROS2 Stage 25Q coordinator

Run from the project root with:

```bash
node server/relay-server.cjs
```

The coordinator uses only Node built-ins. It serves:

- `/health` — coordinator health/status
- `/rankings` — public Ranked ladder + champion analytics JSON
- `/ws` — multiplayer WebSocket endpoint

Stage 25Q keeps the verified 2P Ranked result pipeline and adds **separate Elo pools for 1v1 through 5v5** plus **champion W/L and win rate by team size**. A Ranked result is written only after both clients submit matching match-complete reports against the already-confirmed deterministic round hashes. The coordinator snapshots the completed network draft so champion analytics are derived from the server-verified teams rather than client-submitted statistics.

## Rating model

- Initial rating: `1500`
- Elo K-factor: `32`
- Each format is independent.
- Only players with at least one game in a format receive a format ladder rank.

## Ladder persistence

By default the ladder file is:

```text
server/data/ranked-ladder.json
```

For hosted use, set `ROS2_LADDER_FILE` to a persistent disk path. Recommended Render configuration:

```text
Persistent Disk mount: /var/data
ROS2_LADDER_FILE=/var/data/ros2-ranked-ladder.json
```

Existing Stage 25P schema-v1 files are migrated automatically. Historical player ratings are reconstructed from stored match results; historical champion stats cannot be reconstructed because Stage 25P match records did not include drafted teams.

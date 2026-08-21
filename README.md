# Realm of Shinobi 2.0 — Stage 25D Full Multiplayer Validation

This build completes the current ROS2 multiplayer lifecycle: variable 1v1–5v5 rooms, synchronized bans/draft, deterministic two-client round confirmation, replay-readiness synchronization, disconnect handling, match-result verification, and same-room rematches.

## Run locally

Client:

```bash
npm run client
```

Coordinator:

```bash
npm run server
```

Then connect both browser clients to `ws://<host>:3000/ws` (or the deployed secure WebSocket URL).

## Validation

```bash
npm test
```

Current result: **593 / 593 tests passing**, including actual two-WebSocket end-to-end validation for 1v1 through 5v5, disconnect handling, rematch flow, and deliberate hash-desync detection.

See `docs/STAGE25D_FULL_MULTIPLAYER_VALIDATION.md` for the Stage 25D test matrix and protocol lifecycle.

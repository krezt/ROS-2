# Stage 25D — Full Multiplayer Validation

Stage 25D completes the ROS2 two-player lifecycle without changing gameplay rules, balance, combat math, visual assets, Stage 24M VFX, battlefield dimensions, the 120-second planning timer, or deterministic gameplay RNG.

## Multiplayer lifecycle

1. Host creates a configured 1v1–5v5 room.
2. Player 2 joins; configuration locks.
3. Optional ban phase and generalized synchronized snake draft run server-authoritatively.
4. Both clients enter the same match with identical A/B rosters.
5. Each side privately locks declarations.
6. The coordinator releases one canonical round package with a server gameplay seed.
7. Both clients independently simulate the package and submit deterministic digests.
8. The coordinator compares final-state hash, event-stream hash, declaration hash and gameplay RNG information.
9. Only a matching pair produces `round_confirmed`.
10. Each client replays the confirmed round and sends `round_ready` after local replay/advance is complete.
11. The next round opens only after BOTH clients are ready, preventing one client from advancing while the other is still replaying.
12. On a completed battle, both clients submit the same final winner/hash report before the server marks the match complete.

## Disconnect handling

A player leaving or losing the socket during a locked lobby, draft, match, or post-match session closes that room session. The remaining player receives both an explicit `opponent_disconnected` event (including the session phase) and `room_closed`. The client freezes the network battle UI and returns control to the multiplayer lobby instead of allowing stale actions to continue.

## Rematches

After both clients verify the same final result, a `REQUEST REMATCH` control becomes available. Rematch requires both players to opt in. Once both votes are received:

- the room/configuration remains locked,
- the same 1v1–5v5 format and ban setting are preserved,
- match-only round state/timeouts are reset,
- a fresh server-authoritative ban/draft begins,
- a new match ID is created when that draft completes.

## Transport

The Stage 25D coordinator now has a dependency-free WebSocket transport built on Node's HTTP/socket primitives (`server/ws-lite.cjs`). This allowed real local two-WebSocket integration tests without changing the deterministic combat engine.

## Actual two-player integration validation

`test/stage25D-live-multiplayer.test.js` launches the real coordinator on an ephemeral TCP port and connects two independent WebSocket clients.

Validated live for every format:

- 1v1
- 2v2
- 3v3
- 4v4
- 5v5

For each format the test performs room creation/join, configuration lock, full network draft, match launch, private planning submissions, canonical round-package receipt on both clients, independent simulation, identical digest/hash confirmation, two-client replay readiness, and opening of round 2.

Additional live checks:

- the 3v3 run exercises the existing timeout-extension request while preserving 120-second base planning metadata;
- the 5v5 run disconnects Player B during an active match and verifies explicit disconnect/room-close handling;
- a real 1v1 Barbarian vs Necromancer match is played through to a deterministic KO, both final-result reports are verified, both players request rematch, and a fresh same-room draft is started;
- a deliberately corrupted event-stream hash is submitted by one client and the server correctly emits `round_desync` and halts the round.

## Regression result

Full project suite after Stage 25D:

- **593 / 593 tests passing**
- Stage 25D live WebSocket integration: **8 / 8 test cases passing** (including five format subtests)
- client/server JavaScript syntax checks pass
- original `src/`: byte-for-byte unchanged from Stage 25C
- original `client/assets/`: byte-for-byte unchanged from Stage 25C

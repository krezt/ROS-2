# Stage 25C — Network Draft

## Scope

Stage 25C continues directly from Stage 25B. It completes the network handoff from a locked two-player lobby into a synchronized ban/draft and then launches the existing deterministic battle automatically.

Protected gameplay and presentation systems remain unchanged:

- champion stats and balance
- abilities
- combat formulas
- movement rules
- counters
- friendly fire
- cadence
- current visual assets
- Stage 24M VFX
- battlefield dimensions
- two-minute planning timer
- deterministic gameplay RNG architecture

## Server-authoritative draft

When Player 2 joins:

1. The room configuration locks exactly as in Stage 25B.
2. The coordinator creates one canonical draft state.
3. Both clients receive the same `draft_state` snapshot after every accepted action.
4. Only the side identified by `turnSide` can act.
5. A champion removed by a ban or pick cannot be selected again.
6. When both teams reach the configured team size, the server creates the `RoundCoordinator` and broadcasts `match_started` with the canonical Side A and Side B rosters.

No gameplay RNG is consumed by the draft. Match setup uses the existing deterministic battle initialization once the rosters are finalized.

## Optional ban phase

If `draftBansPerPlayer` is enabled, the phase occurs before drafting:

- Side A bans one champion.
- Side B bans one different remaining champion.
- Both banned champions are removed from the shared pool.
- The normal snake draft then begins.

If bans are disabled, the room begins directly in the draft phase.

## Generalized snake order

The same `createSnakeDraftOrder(teamSize)` rule is used by the network draft for all supported sizes:

- 1v1: A → B
- 2v2: A → B → B → A
- 3v3: A → B → B → A → A → B
- 4v4: A → B → B → A → A → B → B → A
- 5v5: A → B → B → A → A → B → B → A → A → B

The server is authoritative; the clients render the order supplied in the canonical draft snapshot rather than advancing their own independent draft counters.

## Browser presentation

The existing draft modal is reused for network drafting and now shows:

- battle format
- current ban/pick turn
- your picks and opponent picks
- your ban and opponent ban when enabled
- filtered shared champion pool
- complete canonical ban/draft order

The draft modal is locked against local cancellation once both players are in the room. A disconnect closes the locked session under the existing Stage 25B room policy.

## Automatic battle launch

After the last valid pick, the server sends:

- final `draft_state`
- `draft_complete`
- `match_started`

`match_started` contains the same canonical `teamA` and `teamB` arrays for both clients. Each client then initializes its local deterministic battle from those exact rosters and its previously assigned Side A/B identity.

## Validation

- Stage 25C network-draft unit tests cover 1v1 through 5v5.
- 5v5 with one ban per player consumes the complete 12-champion shared roster without duplicates.
- out-of-turn, wrong-phase and already-unavailable selections are rejected.
- client protocol sends explicit `draft_ban` and `draft_pick` messages.
- server handoff is wired from `room_locked` → `draft_state` → `draft_complete` → `match_started`.
- full automated suite: **585 / 585 passing**.
- client/server JavaScript syntax checks pass.
- all pre-existing `src/` files remain byte-for-byte unchanged from Stage 25B.
- all pre-existing `client/assets/` files remain byte-for-byte unchanged from Stage 25B.

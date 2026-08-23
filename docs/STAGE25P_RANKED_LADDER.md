# Stage 25P — 2P Ranked Ladder

## Player flow

1. Enter a non-default player name in the top bar.
2. Choose **2P RANKED**.
3. Create or join a ranked room. Ranked rooms are listed separately from casual rooms.
4. Once Player 2 joins, both player names are locked for that ranked match.
5. The match uses the existing deterministic draft and round-confirmation pipeline.
6. After both clients report the same verified final result, the coordinator records one win and one loss for that battle format.
7. **VIEW RANKINGS** displays overall and per-format W/L records.

## Ranking order

The displayed ladder is ordered by:

1. Most total wins.
2. Fewer total losses.
3. Most games played.
4. Username alphabetical order.

No ELO/MMR system was added in this stage.

## Integrity boundaries

- Casual 2P Battle results do not affect the ladder.
- A result is recorded once per unique match ID.
- Both clients must agree on winner and the already-confirmed final-state/event-stream hashes.
- Disconnects are not automatically counted as ranked forfeits in Stage 25P.
- Identity is username-based only; account authentication is not part of this stage.

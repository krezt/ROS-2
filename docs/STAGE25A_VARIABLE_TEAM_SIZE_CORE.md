# Stage 25A — Variable Team Size Core

Stage 25A generalizes ROS2 match setup from a fixed 3v3 assumption to a single team-size configuration supporting **1v1, 2v2, 3v3, 4v4, and 5v5** in local 1P play.

## Scope preserved

This update does **not** change champion stats/balance, abilities, combat formulas, movement rules, counters, friendly fire, cadence, visual assets, Stage 24M VFX, battlefield dimensions, the two-minute planning timer, or gameplay RNG architecture.

## 1P entry points

- **1P SANDBOX** — immediate no-draft default playtest entry.
- **1P ROSTER** — immediate no-draft roster builder supporting 1v1 through 5v5.
- **1P vs AI** — battle-size setup followed by a local snake draft, then Normal-AI combat.
- **2P BATTLE** — retained as the multiplayer/lobby entry point for the following multiplayer stages.

## Draft sequence

The snake draft is generated from team size instead of hard-coded to six picks:

- 1v1: P1 → CPU
- 2v2: P1 → CPU → CPU → P1
- 3v3: P1 → CPU → CPU → P1 → P1 → CPU
- 4v4: P1 → CPU → CPU → P1 → P1 → CPU → CPU → P1
- 5v5: P1 → CPU → CPU → P1 → P1 → CPU → CPU → P1 → P1 → CPU

The class pool is shared: a champion archetype may be drafted only once in a match.

## Approved starting coordinates

Player-facing coordinates are lettered columns / 1-based rows. Internal coordinates remain zero-based.

| Size | West / Side A | East / Side B |
|---|---|---|
| 1v1 | C6 | N6 |
| 2v2 | C5, B7 | N7, O5 |
| 3v3 | C4, B6, C8 | N4, O6, N8 |
| 4v4 | C4, B6, C8, D2 | N4, O6, N8, M10 |
| 5v5 | C4, B6, C8, D2, D10 | N4, O6, N8, M10, M2 |

## Dynamic systems

- Battle state creation accepts equal teams from one to five champions.
- Stable IDs scale as H0…H4 and G0…G4.
- Action selection derives its required declarations from the currently living champions.
- KO champions automatically reduce the following round's required action count.
- UI assignment counters derive from the selection session rather than a fixed total.
- Victory remains authoritative when no living champion remains on the opposing side.
- The existing 3v3 harness remains available as a backwards-compatible wrapper over the generalized team battle state.

## Validation

Dedicated Stage 25A coverage validates:

- all approved spawn formations;
- 1–5 champion battle-state creation;
- 1–5 snake draft schedules;
- dynamic roster validation;
- dynamic action selection after KO;
- one complete local 1P round at every supported team size;
- 5v5 final-KO victory;
- the four requested top-level mode buttons and variable-size quick roster UI.

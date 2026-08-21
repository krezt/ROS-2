# Stage 24F — Necromancer VFX Update

Scope: visual-only Necromancer ability-effect pass. No champion sprite changes and no gameplay/balance logic changes.

## What was updated

The Necromancer now uses cut assets from `docs/concepts/stage24d-necromancer-approved-vfx-source.png` during live combat presentation for the following abilities:

- **Poison Bolt**
  - toxic orb projectile
  - target reticle at the victim
  - poison-cloud impact

- **Plague**
  - plague sigil under each living enemy
  - poison-cloud pulse over each living enemy

- **Plague Detonation**
  - toxic bloom burst on each living enemy
  - necrotic impact burst layered on detonation

- **Death Touch**
  - skull projectile
  - target reticle
  - death-rune circle on the victim

- **Life Drain**
  - target reticle on the victim
  - soul-flame drain travel from victim back to the Necromancer
  - grave-mist pulse at the Necromancer on receipt

## Files changed

- `client/ros2-scene.js`
- added/used Necromancer VFX assets already present in `client/assets/vfx/`

## Validation

- `node --check client/ros2-scene.js`
- `npm test` → **567 / 567 passing**

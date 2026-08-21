# ROS 2.0 Stage 24D — Cleric Visual Update

## Scope

This pass updates **Cleric presentation assets only**.
It does **not** alter mechanics, damage, timings, movement, AI, targeting, or any combat logic.
The authoritative `src/` directory remains unchanged.

## Cleric visual target

The Cleric is presented as a classic holy support champion:

- white / ivory / pale blue / gold palette
- clear priestly silhouette
- visible **mace** weapon identity
- readable healing / protection / resurrection casting language
- stronger Stage 24D sprite quality in the same successful source-pose workflow used for the Archer true-bounds fix

## Runtime contract preserved

Cleric keeps the exact ROS Stage 24D animation contract:

For each of **N / S / E / W**:
- idle ×4
- walk ×4
- attack ×5
- cast ×5

Shared:
- hit ×3
- KO ×5
- resurrect ×5

Total:
- **85 frames**

Timing preserved:
- `attackImpactFrame: 3`
- `castReleaseFrame: 3`

## Native frame size

Cleric now uses a larger native frame for presentation safety:

- `frameWidth: 80`
- `frameHeight: 96`
- `renderScale: 5/6`

Like Archer, this preserves gameplay footprint while giving enough room for the mace, robes, sleeves, and holy casting silhouettes.

## Authoring approach

The approved Cleric concept sheet is treated as a **source-pose sheet**, not a runtime sheet.
The conversion pipeline extracts the true pose bounds from the concept art and then maps those intact poses into the ROS runtime contract.

This prevents the kind of clipping / crop loss that happened before the Archer true-bounds fix.

## Updated assets

### Champion assets
- `client/assets/champions/cleric.png`
- `client/assets/champions/cleric-preview.png`

### Cleric VFX assets
- `client/assets/vfx/cleric-vfx-sheet.png`
- `client/assets/vfx/cleric-mace-sweep.png`
- `client/assets/vfx/cleric-prayer-mend.png`
- `client/assets/vfx/cleric-defensive-aura.png`
- `client/assets/vfx/cleric-guardian-angel.png`
- `client/assets/vfx/cleric-piercing-light.png`
- `client/assets/vfx/cleric-enids-blessing.png`
- `client/assets/vfx/cleric-holy-wave.png`
- `client/assets/vfx/cleric-resurrection.png`
- `client/assets/vfx/cleric-radiant-burst.png`
- `client/assets/vfx/cleric-sanctuary-circle.png`
- `client/assets/vfx/cleric-holy-sigil.png`
- `client/assets/vfx/cleric-holy-impact.png`

## Presentation hooks added

Client-side presentation now adds Cleric-specific signature VFX for major spells:

- `DEFENSIVE_AURA`
- `GUARDIAN_ANGEL`
- `ENIDS_BLESSING`
- `RESURRECTION`
- `PIERCING_LIGHT`

These are visual-only presentation hooks and do not modify any gameplay result.

## Authoring files

- `tools/cleric_stage24d_hd.py`
- `docs/concepts/stage24d-cleric-approved-sprite-source.png`
- `docs/concepts/stage24d-cleric-approved-vfx-source.png`

## Validation summary

- visual assets updated only
- no combat logic changed
- `src/` remains untouched


## Follow-up cleanup

A follow-up polish pass removed a few Cleric source poses that gave a bow-like silhouette or made the mace read as if it were slung across the back. The runtime sheet now uses cleaner mace-readable attack poses while preserving the same 85-frame contract and keeping all Cleric VFX integrated into the client.

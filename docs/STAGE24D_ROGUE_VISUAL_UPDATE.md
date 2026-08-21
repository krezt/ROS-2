# ROS 2.0 Stage 24D — Rogue Clean-Slate Visual Update

## Scope

This pass replaces Rogue presentation assets only. Rogue was rebuilt as a **brand-new class asset** from the newly selected brown-cloak / dagger / poison source sheet. No previous Rogue source sheet, crop map, runtime atlas, or validation output is used by the new pipeline.

- no game mechanics changed
- authoritative `src/` remains byte-for-byte unchanged
- `attackImpactFrame: 3` preserved
- `castReleaseFrame: 3` preserved

## Visual target

- hooded Rogue / assassin
- brown cloak and leather equipment
- clearly readable dagger
- restrained poison-green sub-theme
- Archer is the primary in-game scale / production reference
- Warrior remains a secondary silhouette reference
- true transparent page background

## Archer production method

The selected generated sheet is treated only as **source-pose material**. It is not copied into runtime as a guessed equal grid.

`tools/rogue_stage24d_hd.py` now:

1. reads deliberately selected source-pose row bands and pose windows
2. identifies the local Rogue model and nearby equipment rather than inheriting adjacent generated fragments
3. removes remote poison plumes that would cause cross-frame reads or hard VFX cutoffs
4. locks one scale per direction so attack/cast frames never shrink relative to idle/walk
5. bottom-anchors every populated frame into exact 80×96 runtime cells
6. assembles frames in the exact Rogue runtime order
7. generates the UI preview from the same validated runtime atlas

## Runtime contract

Rogue now uses its requested **73 logical frames**:

For each of N / S / E / W:
- idle ×1
- walk ×4
- attack ×5
- cast ×5

Shared:
- hit ×3
- KO ×5
- resurrect ×5

Total populated frames: **73**.

The atlas is **15 columns × 5 rows** at **1200×480**. The first four rows fill all 15 cells. Shared occupies frames 60–72; the two unavoidable trailing rectangular-sheet cells are fully transparent and unused.

## Scale matching to Archer

Rogue remains 80×96 native, but the source art is normalized to a compact native standing silhouette and rendered at `ROGUE_RENDER_SCALE = 1.048`. The measured on-screen standing height is matched to Archer's 94-pixel native standing silhouette rendered at `5/6`.

Validation confirms Rogue's four idle facings land within approximately 2 pixels of Archer's effective battlefield height. Attack and cast poses use the same per-direction source scale as idle/walk; there is no attack-frame model shrink.

## Direction and shared mirroring

Directional N / S / E / W art is authored explicitly and is not substituted with incorrect facing rows.

Shared Rogue art keeps the existing presentation-only mirroring behavior:
- shared KO / resurrect mirrors when the Rogue's current facing is W
- shared hit uses attacker-relative horizontal direction when available
- an attacker east of the Rogue uses the east-authored shared hit orientation
- an attacker west of the Rogue mirrors that hit toward W
- vertical-only cases fall back to current facing

This keeps hit reactions from incorrectly flipping away from the established battlefield direction.

## Updated files

- `client/assets/champions/rogue.png`
- `client/assets/champions/rogue-preview.png`
- `client/champion-animation.js` — Rogue presentation manifest only
- `tools/rogue_stage24d_hd.py`
- `tools/validate_rogue_stage24d.py`
- `docs/concepts/stage24d-rogue-approved-sprite-source.png`
- `docs/concepts/stage24d-rogue-runtime-validation.png`
- `docs/concepts/stage24d-rogue-archer-scale-validation.png`
- `test/stage24D-rogue-visual.test.js`
- `test/stage24B.test.js` — allows Rogue's 1-idle/15-column visual contract

Superseded Rogue source/validation images were removed so the clean-slate pipeline cannot accidentally inherit them.

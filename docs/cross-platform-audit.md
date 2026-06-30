# Grimdark Tabletop — Cross-Platform Audit Report

**Date:** 2026-06-30 · **Cells audited:** 180 (18 device profiles × 8 flows on offline single-file HTML build, plus boot + battle-hud on served production build) · **Clean cells:** 120 · **Cells with defects:** 60

---

## 1. Executive Summary

The game is **core-playable on standard portrait phones, standard tablets-portrait at a glance, laptops, and standard desktops**, but it is **not reliably playable across the full device matrix**. Several flows fail outright on specific device classes, and the **most damaging failures occur on landscape phones and on the modal/drawer interactions**.

**Headline blockers:**

1. **Landscape phones are effectively broken.** On `phone-landscape`, the floating STRATAGEMS panel and the bottom command panel overlap the title bar, phase rail, and game board across *every* flow tested (battle-hud, camera, drawers, modals, phase-cycle) on **both HTML and served builds**. The board is reduced to a sliver and the round/title text is clipped (`TTLE ROUND` / `CRON PATROL'S`).
2. **The IMPORT MODEL modal does not open on multiple devices** (`ipad-mini-portrait`, `ipad-mini-landscape`, `desktop-fhd`, `ultrawide`, `android-tablet-ls`). On `ultrawide` the root cause is explicit: `openModelImport()` requires a pre-selected unit and otherwise only fires a toast.
3. **Drawers do not open on large/desktop viewports.** The "at least one drawer opens on-screen" check fails (opened=0) on `pixel-7`, `laptop`, `desktop-hd`, `desktop-fhd`, `desktop-4k`, `ultrawide`, and `ipad-pro-portrait`.
4. **Desktop-4K audit instrumentation is unreliable** — full-page `page.screenshot()` times out at 30s on the animating WebGL canvas, and the swallowed `.catch` means screenshots are silently never written (camera flow also crashes mid-flow). Several 4K cells are unverifiable from the script's own output.

Note: many of these cells report `ok:true` with zero console errors. The mechanical checks pass while the layout is visually broken — there is a **systematic gap in overlap/z-index/clip detection** in the audit harness.

---

## 2. Defects by Severity

### 🔴 Blockers

| # | Defect | Affected (device / flow / version) |
|---|--------|-------------------------------------|
| B1 | STRATAGEMS panel overlaps & clips the center title + phase rail; bottom command panel covers the board | `phone-landscape` / battle-hud, camera, (drawers via overlap), phase-cycle / **html**; `phone-landscape` / battle-hud / **served** |
| B2 | IMPORT MODEL modal fails to open (and therefore can't be dismissed / can't be measured) | `ipad-mini-portrait`, `ipad-mini-landscape`, `desktop-fhd`, `android-tablet-ls` / modals / html |
| B3 | "At least one drawer opens on-screen" fails (opened=0) | `pixel-7`, `laptop`, `desktop-hd`, `desktop-fhd`, `desktop-4k`, `ultrawide`, `ipad-pro-portrait` / drawers / html |
| B4 | Desktop-4K screenshot times out & is silently swallowed (`.catch`); camera flow crashes mid-flow before any shot is saved | `desktop-4k` / battle-hud, camera, modals / html |
| B5 | Modal-detection check FAILS even though the modal *is* visibly rendered (selector/markup contract drift) | `ipad-pro-portrait` / modals / html |
| B6 | Bottom command panel overlaps the phase rail & covers most of the board | `phone-landscape` / battle-hud, drawers, camera, modals, phase-cycle / **html + served** |

### 🟠 Major

| # | Defect | Affected (device / flow / version) |
|---|--------|-------------------------------------|
| M1 | STRATAGEMS panel clipped at left viewport edge (left:0, no margin) — left border, `ANY`/`FIGHT` labels, card text cut off at x=0 | `ipad-pro-portrait` (battle-hud, drawers, select-move, camera, served), `laptop` (drawers), `desktop-4k` (drawers), `ipad-mini-landscape`, `android-tablet-ls` (multiple flows, minor on some) |
| M2 | STRATAGEMS panel overlaps phase rail, hiding the leftmost COMMAND tab (only a `D` visible) | `ipad-mini-landscape`, `ipad-pro-portrait`, `desktop-hd`-adjacent / battle-hud, camera, drawers, phase-cycle / html + served |
| M3 | STRATAGEMS panel overlaps center title — leading `N` cut, reads `ECRON PATROL'S …` | `ipad-mini-landscape`, `ipad-pro-portrait` / battle-hud, select-move, camera, modals / html + served |
| M4 | Centered `BATTLE ROUND` title clipped behind the right ULTRAMARINES topbar panel (`BATTLE RO`) | `ipad-mini-portrait` / battle-hud / html + served |
| M5 | IMPORT MODEL modal renders but mechanical checks (opens / fits / dismisses) FAIL due to selector drift or flaky dropdown trigger | `ipad-pro-portrait`, `ipad-pro-landscape` / modals / html; `desktop-4k` / modals (dismiss) |
| M6 | Drawer/STRATAGEMS panel vertically clipped above y=0 (top border off-screen) | `desktop-hd`, `desktop-4k` / drawers / html |
| M7 | "faction A tap" (PLAYER A NECRONS selector) does not register state change | `desktop-fhd`, `ultrawide` / menu / html |
| M8 | Desktop-4K phase-cycle full-page screenshot times out, swallowed by `.catch`, file never written despite ok:true | `desktop-4k` / phase-cycle / html |

### 🟡 Minor

| # | Defect | Affected (device / flow / version) |
|---|--------|-------------------------------------|
| m1 | Faction-card titles truncated with ellipsis (`NECRO…`, `ULTRAM…` / `ULTRAMARIN…`) | `galaxy-fold` (battle-hud, camera, phase-cycle, served), `galaxy-s20`, `iphone-14-pro-max` / served |
| m2 | Galaxy-fold: bottom (4th) left-rail octagon icon clipped/occluded by bottom command panel | `galaxy-fold` / battle-hud (html+served, major on served), camera (major on html) |
| m3 | Large empty dead-zone / black band between top HUD and board (wasted upper third) | `pixel-7` (drawers html + battle-hud served), `ipad-mini-portrait` / served |
| m4 | Dim/low-contrast orange phase sub-labels (`DURING PHASE` / `WRONG PHASE`) nearly illegible | `desktop-hd` / battle-hud, select-move, phase-cycle / html |
| m5 | Large wasted black margins; HUD/board does not scale to fill viewport | `desktop-4k` (battle-hud, drawers), `ultrawide` (battle-hud, drawers, modals) |
| m6 | Phase subtitle `NECRON PATROL'S COMMAND` overlaps bottom edge of topbar player panels | `ipad-mini-portrait` / battle-hud / html + served |
| m7 | STRATAGEMS panel bottom entry (`DARK PACT` / `ARMOUR OF CONTEMPT`) clipped at panel lower edge | `ultrawide` (drawers), `ipad-mini-landscape` (served) |
| m8 | Desktop-4K board sits left-of-center; right-side empty band | `desktop-4k` / battle-hud |
| m9 | `desktop-fhd` menu: `III.` section header clipped behind fixed DEPLOY bar | `desktop-fhd` / menu / html |

---

## 3. Device-Class Patterns & HTML-vs-Served Differences

**Landscape phones (`phone-landscape`, 844×390) — worst class.** Every flow on both builds is broken by floating-panel overlap: STRATAGEMS panel sits over the title + phase rail (left-edge clipping), and the bottom command panel covers the board. This is the single highest-impact cluster and it is **identical between HTML and served builds**.

**Tablets-landscape & iPad-Pro-portrait (`ipad-mini-landscape`, `ipad-pro-portrait`, `android-tablet-ls`).** Consistent left-edge anchoring problem: the STRATAGEMS panel is pinned to x=0 with no margin and overlaps the phase rail's first (COMMAND) tab and the leading `N` of the title. Severity scales with screen — major on iPad-Pro/iPad-mini-landscape, minor on android-tablet-ls. Same behavior HTML and served.

**iPad-mini-portrait.** Different failure axis: the centered `BATTLE ROUND` title collides with/clips behind the **right** ULTRAMARINES topbar panel (not the left stratagems panel). Present in both builds.

**Very narrow phones (`galaxy-fold`, 280px).** Mostly cosmetic: ellipsis-truncated faction names + the 4th left-rail octagon clipped by the bottom panel. Escalates to **major on the served build** (icon harder to tap). Core layout otherwise fits 280px well.

**Large desktop / 4K / ultrawide.** Two themes: (a) **drawers don't open** (opened=0) across all large viewports; (b) **the layout doesn't scale** — fixed-small chrome, large wasted black margins, board left-of-center. 4K additionally suffers an **audit-tooling failure**: WebGL screenshots time out and are silently swallowed, so several 4K cells are unverifiable and one camera flow crashes.

**Standard portrait phones (`galaxy-s20`, `pixel-7`, `iphone-14-pro-max`) and laptop/desktop-hd.** Cleanest classes — only minor truncation, dead-zone, or low-contrast issues.

**HTML vs. served:** Largely identical defect signatures (landscape overlap, stratagems left-clip, iPad-portrait title clip, fold truncation all reproduce on both). Two divergences: the galaxy-fold rail-icon clip is **more severe on served** (major vs minor); and the modal-open failures and drawer-opened=0 failures were exercised primarily on the HTML matrix (served only ran boot + battle-hud).

**Cross-cutting harness gap:** Many broken-layout cells report `ok:true`, 0 errors. The mechanical checks validate bounding-box-in-viewport but **miss z-index/overlap/clip**, so overlap defects pass silently.

---

## 4. Prioritized Fix List

**P0 — Restore playability on landscape phones (B1, B6)**
- Stop the STRATAGEMS panel and the bottom command panel from floating over the board on short-height landscape. Add a landscape breakpoint (e.g. `@media (orientation: landscape) and (max-height: 480px)`) that docks STRATAGEMS as a collapsible off-canvas drawer (closed by default) and constrains the command panel to a bottom bar that does not overlap `.phaserail` or the board. Verify title `BATTLE ROUND … / NECRON PATROL'S COMMAND` is fully visible.

**P0 — Fix IMPORT MODEL modal (B2, B5, M5)**
- In `openModelImport()`: remove/relax the "requires pre-selected unit" precondition (or auto-select / prompt) so the bottom-bar IMPORT MODEL button always opens the modal instead of firing a toast. This is the explicit root cause on `ultrawide` and explains the no-open failures on the iPad-mini, desktop-fhd, android-tablet-ls cells.
- Reconcile the audit's modal selector with the actual modal DOM — on `ipad-pro-portrait`/`ipad-pro-landscape` the modal renders correctly but the `import-model modal opens` / `modal fits viewport` / `modal dismisses` checks fail on a stale selector. Update the selector contract and the dismiss (Cancel) target.

**P0 — Fix drawer-open across large viewports (B3)**
- Investigate why cluster buttons (target/log/melee/menu) yield opened=0 on pixel-7 + all desktop/4K/ultrawide + ipad-pro-portrait. Likely the drawer opens off-viewport (top/left-clipped per M6) so the "on-screen" check fails — ensure drawers open inset within the viewport bounds, not anchored above y=0 / left of x=0.

**P1 — Stratagems panel left-edge anchoring (M1, M2, M3)**
- Give the STRATAGEMS panel a left margin/inset and a z-order/layout that does not overlap `.topbar` title or `.phaserail`'s first tab. Single CSS fix resolves a large cluster across iPad-Pro, iPad-mini-landscape, android-tablet-ls, laptop, desktop-hd, desktop-4k. Verify the leading `N` of `NECRON` and the `COMMAND` phase tab are fully visible.

**P1 — iPad-mini-portrait title collision (M4, m6)**
- Center title `BATTLE ROUND` is clipped behind the right player panel. Reserve horizontal space between the two topbar panels (or reduce panel widths / shrink title) so the centered title is not occluded.

**P1 — Faction-card title truncation (m1)**
- On galaxy-fold/galaxy-s20/iphone-14-pro-max the army names ellipsis to `NECRO…`/`ULTRAM…`. Allow a second line, abbreviate to a known short form, or shrink font so factions are distinguishable.

**P1 — Galaxy-fold left-rail icon clip (m2)**
- The 4th octagon button overlaps the bottom command panel (major on served). Add bottom padding to the icon rail or reflow so all four buttons stay tappable above the panel at 280px.

**P2 — Audit harness reliability (B4, M8)**
- Replace silent `page.screenshot().catch(()=>{})` with: capture at `dpr=1` on 4K (dpr=2 raster times out), increase timeout, **and surface the error** instead of reporting ok:true with a non-existent screenshot path. Fix the camera-flow crash (mid-flow screenshot before fonts-ready times out).
- Add overlap/z-index/clip assertions to the mechanical checks so visually-broken `ok:true` cells (landscape, stratagems overlap) are caught automatically.

**P2 — Desktop/4K/ultrawide scaling & dead-zones (m3, m5, m8)**
- Add max-width centering with proportional scaling (or scale HUD chrome with viewport) so 4K/ultrawide don't leave large black margins and pixel-7/ipad-mini-portrait don't show a blank upper-third band.

**P2 — Menu faction-A selector (M7)**
- `faction A tap` doesn't register on desktop-fhd/ultrawide menu flow (NECRONS looks selected but no state change detected). Verify the click handler/state toggle on the PLAYER A faction button (or fix the selector if it's only a test-hook mismatch).

**P3 — Low-contrast stratagem sub-labels (m4)** — raise contrast on the dim orange `DURING PHASE`/`WRONG PHASE` text (desktop-hd).
**P3 — Panel bottom clipping (m7)** — `DARK PACT`/`ARMOUR OF CONTEMPT` cut off at stratagems panel lower edge (ultrawide, ipad-mini-landscape); allow scroll or size to content.
**P3 — desktop-fhd menu (m9)** — `III.` section header hidden behind fixed DEPLOY bar; add bottom padding to the scroll region.

---

**Bottom line:** Ship-blocking work is concentrated in three areas — landscape-phone HUD overlap, the IMPORT MODEL modal, and large-viewport drawer opening — plus a 4K audit-tooling fix needed to even trust the results. Fixing the shared STRATAGEMS left-edge/overlap CSS resolves a large fraction of the major findings in one change.
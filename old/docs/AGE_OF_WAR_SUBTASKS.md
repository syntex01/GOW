# Age of War Conversion — Detailed Subtask Breakdown

This document decomposes the high-level plan into granular implementation tickets. Each subtask lists its prerequisites, core deliverables, and validation notes to aid parallelization and tracking.

## 1. Project Foundations

### 1.1 Repository Hygiene
- **Description:** Remove obsolete platformer-specific assets and scripts to reduce clutter before large refactors.
- **Prerequisites:** None.
- **Steps:**
  1. Inventory existing assets and scripts still referenced by build pipeline.
  2. Delete unused tilemaps, player sprites, and joystick UI elements.
  3. Update `webpack` config and preload lists to avoid missing file errors.
- **Definition of Done (DoD):** Build completes with zero missing-asset warnings; git history documents removals.

### 1.2 Physics Configuration Reset
- **Description:** Reconfigure Arcade physics defaults for a horizontal battler.
- **Prerequisites:** 1.1.
- **Steps:**
  1. Update `src/game.ts` physics settings to zero gravity and tuned world bounds.
  2. Remove jump and platform collision logic from existing scenes.
  3. Add debug toggle to visualize hitboxes (configurable via query param or keybind).
- **DoD:** Battle prototype scene runs with lane-oriented movement and visible debug overlays.

## 2. Scene Architecture

### 2.1 Boot & Preload Flow Split
- **Description:** Introduce lightweight boot scene before asset preload.
- **Prerequisites:** 1.1.
- **Steps:**
  1. Create `BootScene` handling device orientation, loading minimal assets, and launching `PreloadScene`.
  2. Refactor existing `PreloadScene` to load new asset manifest JSON.
  3. Wire `game.ts` to start `BootScene` instead of `MainScene`.
- **DoD:** Game launches into `MenuScene` with boot + preload sequence verified by logs.

### 2.2 Menu Scene Implementation
- **Description:** Build navigable main menu with difficulty and instructions modal.
- **Prerequisites:** 2.1.
- **Steps:**
  1. Design responsive layout using Phaser UI containers.
  2. Add settings toggles (audio, speed) and difficulty selector storing choice in shared state.
  3. Implement buttons to start battle, open instructions overlay, and exit.
- **DoD:** Menu interactions update shared config and transition to `BattleScene`.

### 2.3 Battle & HUD Scene Separation
- **Description:** Replace `MainScene` with dedicated gameplay and overlay scenes.
- **Prerequisites:** 2.1, 2.2.
- **Steps:**
  1. Scaffold `BattleScene` to manage world layers, lanes, and entity groups.
  2. Build `HUDScene` overlay subscribing to shared game state events for resources, ages, and base HP.
  3. Implement scene communication via event emitter or shared store.
- **DoD:** HUD displays placeholder resource values synchronized with battle updates.

## 3. Core Gameplay Systems

### 3.1 Lane Manager
- **Description:** Provide utilities to spawn and advance units along discrete lanes.
- **Prerequisites:** 2.3.
- **Steps:**
  1. Define lane data structure (spawn points, path bounds, collision layers).
  2. Create Phaser Groups per faction with sorting for depth.
  3. Implement movement updates respecting engagement ranges and blocking.
- **DoD:** Units traverse lanes and stop when encountering enemies or bases in a test harness.

### 3.2 Base Entity & Win Logic
- **Description:** Implement base health, damage handling, and defeat triggers.
- **Prerequisites:** 3.1.
- **Steps:**
  1. Create `Base` class with HP bar and damage animations.
  2. Register overlap events between enemy units/projectiles and bases.
  3. Trigger victory/defeat events feeding into HUD overlays.
- **DoD:** Destroying a base ends the round and surfaces restart/quit options.

### 3.3 Unit Framework
- **Description:** Build data-driven unit classes supporting multiple archetypes.
- **Prerequisites:** 3.1.
- **Steps:**
  1. Define `UnitConfig` TypeScript interfaces and load JSON per age.
  2. Implement base `Unit` class with finite state machine (advance, attack, die).
  3. Extend subclasses or mixins for melee, ranged, siege, and flying behaviors.
- **DoD:** Sample units from config spawn and execute their states without runtime errors.

### 3.4 Projectile & Combat Resolution
- **Description:** Handle ranged attacks, collisions, and damage application.
- **Prerequisites:** 3.3.
- **Steps:**
  1. Implement projectile pooling to minimize allocations.
  2. Calculate hit detection via Arcade overlaps, applying damage and knockback effects.
  3. Integrate combat feedback (hit flashes, damage numbers placeholder).
- **DoD:** Ranged units fire projectiles that correctly damage targets with pooled objects.

### 3.5 Economy and Resource Loop
- **Description:** Track income, spending, and rewards for player and AI.
- **Prerequisites:** 2.3, 3.3.
- **Steps:**
  1. Implement economy service with passive income timers and bounty hooks.
  2. Add HUD bindings for current resources, income rate, and spend previews.
  3. Enforce cost checks before spawning units or upgrading age.
- **DoD:** Resource values update consistently when units spawn or enemies die.

### 3.6 Age Progression System
- **Description:** Manage tier unlocks and base upgrades.
- **Prerequisites:** 3.5.
- **Steps:**
  1. Define age progression data (cost, unlockable units, passive modifiers).
  2. Implement upgrade action with UI prompt and cooldown handling.
  3. Update base visuals and available unit buttons upon advancement.
- **DoD:** Advancing an age changes roster, income, and visuals in-game.

## 4. AI & Game Flow

### 4.1 AI Controller MVP
- **Description:** Create baseline AI that mirrors player's economic pacing.
- **Prerequisites:** 3.5, 3.6.
- **Steps:**
  1. Implement AI economy budget manager.
  2. Script unit spawn priorities reacting to player's current age and resources.
  3. Schedule upgrades and special ability usage based on timers.
- **DoD:** AI spawns units and advances ages without stalling or overspending.

### 4.2 Difficulty Scaling & Behaviors
- **Description:** Expand AI to support multiple difficulty settings.
- **Prerequisites:** 4.1.
- **Steps:**
  1. Introduce configurable behavior profiles (aggressive, defensive, balanced).
  2. Add catch-up mechanics (burst waves, bonus income) tied to base HP thresholds.
  3. Expose difficulty tuning hooks in config files for designers.
- **DoD:** Switching difficulty alters AI spawn cadence and tactics in test runs.

### 4.3 Game State Manager
- **Description:** Centralize run/paused/result state transitions.
- **Prerequisites:** 2.3, 3.2.
- **Steps:**
  1. Implement state machine handling start, pause, defeat, victory, and restart.
  2. Emit events consumed by HUD and Menu scenes for overlays.
  3. Persist recent match stats for post-game display.
- **DoD:** Pause/resume and win/loss flows behave consistently across scenes.

## 5. User Interface & UX

### 5.1 HUD Command Bar
- **Description:** Build responsive bottom bar with unit buttons, age upgrade, and ability slots.
- **Prerequisites:** 2.3, 3.3, 3.6.
- **Steps:**
  1. Create button components with cooldown and cost overlays.
  2. Bind interactions to spawn queue respecting resource checks.
  3. Implement tooltip system for hover/touch descriptions.
- **DoD:** Command bar reflects unit availability, costs, and cooldowns accurately.

### 5.2 Resource & Status Displays
- **Description:** Present economy, base HP, and age progress indicators.
- **Prerequisites:** 3.5, 3.6, 3.2.
- **Steps:**
  1. Design HUD widgets for base HP bars and age meter.
  2. Subscribe to economy/base events to update values live.
  3. Add feedback for insufficient resources or cooldowns.
- **DoD:** HUD updates instantly when resources change or base takes damage.

### 5.3 Settings & Pause Overlay
- **Description:** Provide accessible settings without leaving battle.
- **Prerequisites:** 4.3.
- **Steps:**
  1. Create overlay UI with audio sliders, game speed toggle, and quit button.
  2. Ensure keyboard and touch navigation are supported.
  3. Sync changes to persistent config where applicable.
- **DoD:** Overlay pauses gameplay and applies settings immediately.

## 6. Content & Balancing

### 6.1 Initial Age & Unit Dataset
- **Description:** Ship MVP with at least two ages and representative units.
- **Prerequisites:** 3.3, 3.6.
- **Steps:**
  1. Author JSON configs for Stone and Medieval ages with 3–4 units each.
  2. Define placeholder sprites/animations per unit and base stage.
  3. Hook configs into preload manifest and spawn logic.
- **DoD:** Players can progress through at least two ages with distinct rosters.

### 6.2 Balancing Pass & Telemetry Hooks
- **Description:** Tune unit stats and gather balancing data.
- **Prerequisites:** 6.1, 4.1.
- **Steps:**
  1. Instrument combat events to log damage, kills, and resource spend.
  2. Iterate on stats to achieve target match length and difficulty curve.
  3. Document tuning guidelines and open balancing issues as needed.
- **DoD:** Telemetry captures key metrics; balance feels fair on Normal difficulty.

## 7. Audio, VFX, and Polish

### 7.1 Audio Integration
- **Description:** Add music and SFX layers.
- **Prerequisites:** 2.1, 5.3.
- **Steps:**
  1. Import placeholder tracks for ambient music and combat cues.
  2. Categorize sounds (music, effects, UI) with volume controls.
  3. Trigger contextual sounds on unit spawn, attack, death, and base damage.
- **DoD:** Audio plays without clipping and obeys settings toggles.

### 7.2 Visual Polish & Performance
- **Description:** Finalize visuals and ensure stable performance.
- **Prerequisites:** 3.4, 5.1, 5.2.
- **Steps:**
  1. Add parallax background layers and screen shake effects.
  2. Implement object pooling for units/projectiles and cap active entity counts.
  3. Profile frame time on desktop and mobile targets, optimize update loops.
- **DoD:** Game maintains target FPS with VFX enabled on representative devices.

## 8. QA & Release

### 8.1 Automated Checks
- **Description:** Establish baseline linting and type checks.
- **Prerequisites:** 1.1.
- **Steps:**
  1. Configure `npm` scripts for ESLint and TypeScript `--noEmit` validation.
  2. Integrate with CI (GitHub Actions) to run on PRs.
  3. Add documentation for running checks locally.
- **DoD:** CI pipeline blocks merges on lint/type errors.

### 8.2 Manual Test Plan
- **Description:** Document exploratory and regression testing flows.
- **Prerequisites:** 5.1, 6.1, 7.1.
- **Steps:**
  1. Outline scenarios covering menu navigation, battle flow, age progression, AI behaviors, and UI responsiveness.
  2. Define device/browser matrix for verification.
  3. Maintain checklist for release candidates.
- **DoD:** Test plan stored in `docs/` and referenced in release notes.

### 8.3 Launch Readiness Review
- **Description:** Final validation before public release.
- **Prerequisites:** 8.2.
- **Steps:**
  1. Review outstanding bugs and prioritize must-fix items.
  2. Conduct playtest session to validate balance and performance.
  3. Prepare changelog and marketing screenshots.
- **DoD:** Stakeholders sign off on release checklist; launch assets archived.

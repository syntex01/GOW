# Age of War Side-View Autobattler Conversion Plan

## 1. Vision and High-Level Goals
- Reimagine the existing Phaser 3 platformer into an "Age of War" inspired side-view autobattler with opposing bases, automated lane combat, and tech-age progression.
- Support desktop and mobile browsers with responsive UI, short loading times, and touch-friendly controls, leveraging the current resize and pointer support in `game.ts` and `MainScene`.
- Build a modular architecture that enables future content additions (new ages, units, abilities) without large refactors.

## 2. Project Structure Overhaul
- **Scenes**
  - Replace `MainScene` with a dedicated `BattleScene` responsible for gameplay logic (bases, units, combat loop).
  - Keep `PreloadScene` but update asset lists (units, bases, UI, audio) and split into `BootScene` (minimal loader) + `PreloadScene` for smoother flow.
  - Add `MenuScene` for starting a game, toggling difficulty, and viewing instructions.
  - Create `HUDScene` (separate scene overlay) for UI management (unit buttons, economy info, age progress, pause).
- **Components**
  - Deprecate platformer-specific components (`player`, `tiles`, `coins`, `goal`, `background`, `miniMap`, `controls`).
  - Introduce new domains:
    - `entities/` for bases, units, projectiles, defensive structures.
    - `systems/` for economy, aging, wave scheduling, AI, combat resolution.
    - `ui/` for HUD widgets, tooltips, progress meters.
  - Centralize shared types/configs under `src/gameplay/` (e.g., `AgeConfig`, `UnitConfig`).
- **Asset Pipeline**
  - Reorganize `src/assets` to segregate sprites, animations, audio, and data JSON describing ages and units for ease of iteration.

## 3. Gameplay Core Systems
- **Lane & Physics Handling**
  - Switch physics from platformer gravity to mostly horizontal 2D plane (minimal vertical motion). Configure Arcade physics with zero gravity in `game.ts` and use simple overlap/collision detection for melee range.
  - Implement lane manager managing spawn points, pathing, collision layers; consider using Phaser Groups for friend/foe units and set body sizes for hit detection.
- **Bases & Win Conditions**
  - Create `Base` entity with HP, spawn anchor, upgrade slots, and visual state changes.
  - Add base damage handling, death sequence (camera shake, explosion), and game over UI.
- **Unit Lifecycle**
  - Define `Unit` class hierarchy supporting roles (melee, ranged, siege, flying). Each unit needs stats (HP, damage, attack speed, cost, build time, age requirements) loaded from config.
  - Implement finite state machine for idle, advancing, attacking, dying; integrate with animations/spine if available.
  - Build projectile subsystem for ranged units with travel speed, collision, and on-hit effects.
- **Economy & Resources**
  - Introduce resource generation (e.g., passive income + kill bounty) tracked by player and AI.
  - Implement UI timers for ability cooldowns and unit build queues.
- **Age Progression**
  - Configure age tiers (e.g., Stone, Medieval, Modern) in data files; each tier unlocks units, upgrades base HP, increases passive income.
  - Create upgrade logic verifying resource cost, triggering visual updates, and adjusting spawn lists.

## 4. AI and Game Flow
- **Enemy AI Controller**
  - Build AI module that monitors its economy, selects unit compositions based on difficulty, and triggers age upgrades.
  - Support adaptive behavior (counter units, respond to player's age, escalate difficulty over time).
- **Wave & Spawn Scheduling**
  - Use timed events to spawn units for both sides based on queue data structures.
  - Provide catch-up mechanics (e.g., burst waves when base HP low) configurable per difficulty.
- **Game States**
  - Manage paused, running, victory, defeat states; integrate with HUD for overlays and restart options.

## 5. User Interface & UX
- **HUD Layout**
  - Replace touch joystick with a command bar showing unit buttons, age upgrade, special ability triggers.
  - Display resource counters, age progress bar, base health bars, and unit cooldowns.
  - Ensure UI is responsive by leveraging existing resize handler in `game.ts`; update to reposition HUD elements relative to safe zones.
- **Tooltips & Feedback**
  - Implement hover/touch tooltips showing unit stats and costs.
  - Add visual feedback for insufficient resources, ability cooldowns, and age unlock notifications.
- **Options & Accessibility**
  - Provide toggles for audio, game speed, and difficulty inside `MenuScene` or an in-game settings modal.

## 6. Art, Animation, and Audio
- Define placeholder art requirements (bases, units across ages, projectiles, background parallax) and note reuse of parallax background logic if needed.
- Update `PreloadScene` to load new atlases or Spine data per age; remove unused assets referenced in current preload list.
- Plan soundscape: ambient track, unit attack sounds, UI cues; integrate using Phaser's sound manager with categories for volume control.

## 7. Technical Implementation Phases
1. **Foundation Cleanup**
   - Remove platformer-only code paths in `MainScene` and dependent components.
   - Reconfigure physics defaults in `game.ts` to zero gravity, enable debug toggle for balancing.
2. **Scene and State Refactor**
   - Introduce new scene classes (`BootScene`, `MenuScene`, `BattleScene`, `HUDScene`).
   - Establish shared `GameState` service (singleton or event emitter) accessible across scenes.
3. **Core Entities & Systems**
   - Implement `Base`, `Unit`, `Projectile`, and `LaneManager` classes.
   - Build economy and age management services; hook into HUD.
4. **AI & Game Flow**
   - Develop AI controller; integrate with spawn queues.
   - Implement win/loss detection and transitions to results UI.
5. **UI/UX Implementation**
   - Create HUD components (resource bar, command buttons, age button, timers).
   - Hook up interactions, tooltips, and responsive layout adjustments.
6. **Content Pass**
   - Populate config data for initial set of ages and units.
   - Balance unit stats, spawn rates, and economy values.
7. **Polish**
   - Add animations, effects, audio.
   - Optimize for performance (pool projectiles, limit active entities, fine-tune physics steps).
   - QA on desktop and mobile, adjust scaling/responsiveness issues.

## 8. Testing & Tooling
- Set up automated lint/test scripts if not present; at minimum, add TypeScript type checking for new modules.
- Create debug UI toggles to spawn test units, adjust resources, and force age upgrades to aid balancing.
- Document manual test plan: verifying resource flow, unit interactions, game over, responsive UI on different resolutions.

## 9. Risks and Mitigations
- **Complex AI and balancing**: start with simple scripted behaviors before iterative tuning.
- **Asset availability**: use placeholder shapes or silhouettes initially; design system to swap art without code changes via config.
- **Performance**: ensure unit update loops are optimized (group updates, object pooling) and leverage Phaser's built-in pooling.
- **Scope creep**: deliver MVP with two ages and limited unit roster before expanding.

## 10. Deliverables
- Updated Phaser project with new scenes, systems, and data-driven configuration for Age of War gameplay.
- Replacement HUD and responsive UI that works on touch + keyboard/mouse.
- Documentation covering architecture, config formats, and content pipeline for future expansion.

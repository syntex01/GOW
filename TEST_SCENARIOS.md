# Age of War - Comprehensive Test Scenarios

## Overview
This document outlines all interactive test scenarios to verify the Age of War game functionality.

## Automated Test Suite
Access via: **Main Menu → Run Tests**

The automated test suite includes 20+ tests covering:
- Unit creation and lifecycle
- Combat mechanics
- Visual effects
- Game systems

### Running Automated Tests
1. Launch the game at `http://localhost:8080`
2. Click "Run Tests" from the main menu
3. Press SPACE to run each test sequentially
4. Press R to restart tests
5. Press ESC to return to menu

---

## Manual Test Scenarios

### 1. UNIT SPAWNING TESTS

#### Test 1.1: Basic Unit Spawn
**Steps:**
1. Start a battle
2. Click on a unit button (e.g., "Clubman")
3. Click on a lane
**Expected:**
- Unit spawns with portal effect
- Resource cost deducted
- Unit begins moving toward enemy

#### Test 1.2: Insufficient Resources
**Steps:**
1. Start battle
2. Spawn units until resources are depleted
3. Try to spawn another unit
**Expected:**
- Red flash effect
- "Not enough resources!" hint displayed
- No unit spawned

#### Test 1.3: All Lane Spawning
**Steps:**
1. Start battle
2. Select a unit
3. Click on lane 1, then lane 2, then lane 3
**Expected:**
- Unit spawns in each lane
- Each unit moves in its own lane
- No lane overlap

#### Test 1.4: Rapid Spawning
**Steps:**
1. Start battle
2. Rapidly click a lane 10+ times
**Expected:**
- Units spawn quickly without errors
- Resource deduction is accurate
- All units render correctly

---

### 2. COMBAT TESTS

#### Test 2.1: Melee vs Melee
**Steps:**
1. Spawn a Clubman (player)
2. Wait for enemy to spawn a melee unit
3. Observe combat
**Expected:**
- Units stop when in range
- Attack animations play
- Blood splatter on hits
- Damage numbers appear
- Losing unit dies with death effects

#### Test 2.2: Ranged vs Melee
**Steps:**
1. Spawn a Slinger (ranged)
2. Wait for enemy melee unit
**Expected:**
- Slinger fires projectiles
- Muzzle flash on fire
- Projectile travels to target
- Impact effect on hit
- Damage dealt from range

#### Test 2.3: Mass Combat
**Steps:**
1. Spawn 5+ units in multiple lanes
2. Let enemy spawn units
3. Watch large battle
**Expected:**
- All units engage correctly
- No performance issues
- Effects render properly
- Units die and clean up correctly

#### Test 2.4: Unit vs Base
**Steps:**
1. Let an enemy unit reach your base
**Expected:**
- Unit attacks base
- Base HP decreases
- Impact effects on base
- Screen shake on hit

---

### 3. RESOURCE SYSTEM TESTS

#### Test 3.1: Passive Income
**Steps:**
1. Start battle
2. Watch resource counter for 10 seconds
**Expected:**
- Resources increase every second
- Resource gain popup every 5 seconds
- Counter updates smoothly

#### Test 3.2: Age Upgrade Cost
**Steps:**
1. Accumulate enough resources
2. Click age upgrade button
**Expected:**
- Resources deducted
- Age upgrades
- New units available
- Celebration effect plays

---

### 4. AGE PROGRESSION TESTS

#### Test 4.1: Stone Age to Medieval
**Steps:**
1. Gather 500 resources
2. Click age upgrade
**Expected:**
- Player advances to Medieval Age
- New units appear in UI
- Age upgrade effect triggers
- Base HP increases

#### Test 4.2: Full Age Progression
**Steps:**
1. Progress through all ages (Stone → Medieval → Modern → Future)
**Expected:**
- Each age unlocks new units
- Visual styles change per age
- Resource costs increase
- Unit power scales

#### Test 4.3: Insufficient Upgrade Resources
**Steps:**
1. Start battle
2. Try to upgrade age immediately
**Expected:**
- Red flash
- "Not enough resources" message
- Age does not change

---

### 5. VISUAL EFFECTS TESTS

#### Test 5.1: Blood Splatter
**Steps:**
1. Spawn melee units
2. Watch them fight
**Expected:**
- Dark red blood particles on each hit
- Particles scatter realistically
- Particles fade out

#### Test 5.2: Explosions
**Steps:**
1. Spawn siege units (Catapult, Tank, Artillery)
2. Watch their attacks
**Expected:**
- Orange/red explosion particles
- Screen shake on impact
- Splash damage (if applicable)

#### Test 5.3: Energy Effects (Future Age)
**Steps:**
1. Advance to Future Age
2. Spawn Laser Trooper
3. Watch combat
**Expected:**
- Cyan/blue energy effects instead of blood
- Glowing projectiles
- Energy dissipation on death

#### Test 5.4: Damage Numbers
**Steps:**
1. Spawn any unit
2. Watch it take damage
**Expected:**
- Red damage number pops up
- Number floats upward
- Number fades out
- Accurate damage amount

#### Test 5.5: Hit Markers
**Steps:**
1. Observe any combat
**Expected:**
- Damage numbers on every hit
- Numbers don't overlap excessively
- Clear and readable

---

### 6. UI INTERACTION TESTS

#### Test 6.1: Unit Selection
**Steps:**
1. Click different unit buttons
**Expected:**
- Selected unit button highlights blue
- Previous selection deselects
- Unit description appears in hint

#### Test 6.2: Keyboard Shortcuts
**Steps:**
1. Press 1, 2, 3 keys
**Expected:**
- Units spawn in lanes 1, 2, 3 respectively
- Same as clicking lanes

#### Test 6.3: Space to Upgrade
**Steps:**
1. Accumulate resources
2. Press SPACE
**Expected:**
- Age upgrade triggers
- Same as clicking upgrade button

#### Test 6.4: ESC to Menu
**Steps:**
1. During battle, press ESC
**Expected:**
- Returns to main menu
- Battle ends
- No errors

---

### 7. AI BEHAVIOR TESTS

#### Test 7.1: AI Spawning
**Steps:**
1. Start battle on any difficulty
2. Observe for 30 seconds
**Expected:**
- AI spawns units periodically
- Units appropriate for AI resources
- Spawning continues throughout game

#### Test 7.2: Difficulty Scaling
**Steps:**
1. Start 3 battles on Easy, Normal, Hard
**Expected:**
- Easy: AI spawns cheaper units
- Normal: Balanced spawning
- Hard: AI spawns expensive units aggressively

---

### 8. WIN/LOSS CONDITIONS TESTS

#### Test 8.1: Victory
**Steps:**
1. Spam powerful units
2. Destroy enemy base
**Expected:**
- Massive explosion at enemy base
- "VICTORY!" message
- Gold flash effect
- Return to menu after 3 seconds

#### Test 8.2: Defeat
**Steps:**
1. Don't spawn any units
2. Let enemy destroy your base
**Expected:**
- Massive explosion at player base
- "DEFEAT!" message
- Red flash effect
- Return to menu after 3 seconds

---

### 9. UNIT-SPECIFIC TESTS

#### Test 9.1: Heavy Units (Mammoth, Tank, Mech)
**Steps:**
1. Spawn heavy unit
2. Watch it die
**Expected:**
- Extra screen shake on death
- More blood/effects
- Slower movement speed
- Higher HP

#### Test 9.2: Ranged Units (All Ages)
**Steps:**
1. Spawn: Slinger, Archer, Rifleman, Laser Trooper
**Expected:**
- Each fires projectiles
- Projectile visuals match age
- Range advantage over melee

#### Test 9.3: Siege Units
**Steps:**
1. Spawn Catapult, Artillery, Orbital Strike
**Expected:**
- High damage
- Slow attack speed
- Base damage effectiveness

---

### 10. EDGE CASES TESTS

#### Test 10.1: Max Resources
**Steps:**
1. Let game run for 5+ minutes
2. Accumulate 5000+ resources
**Expected:**
- Resources continue to accumulate
- No overflow errors
- Counter displays correctly

#### Test 10.2: Many Units on Field
**Steps:**
1. Spawn 30+ units
**Expected:**
- All units render
- No severe performance drop
- Combat continues normally

#### Test 10.3: Rapid Age Upgrades
**Steps:**
1. Cheat resources (or wait)
2. Upgrade ages rapidly
**Expected:**
- UI updates correctly
- No visual glitches
- Effects don't stack incorrectly

---

### 11. PROJECTILE SYSTEM TESTS

#### Test 11.1: Projectile Travel
**Steps:**
1. Spawn ranged unit
2. Watch projectile
**Expected:**
- Projectile spawns from unit
- Travels toward target
- Hits target or continues to base

#### Test 11.2: Projectile Pooling
**Steps:**
1. Spawn multiple ranged units
2. Watch many projectiles
**Expected:**
- Projectiles reuse from pool
- No memory leaks
- Smooth performance

---

### 12. SETTINGS TESTS

#### Test 12.1: Difficulty Change
**Steps:**
1. From menu, change difficulty
2. Start battle
**Expected:**
- AI behavior matches selected difficulty
- Setting persists

#### Test 12.2: Audio Toggle
**Steps:**
1. Toggle audio on/off
**Expected:**
- Setting changes
- UI updates

#### Test 12.3: Speed Toggle
**Steps:**
1. Toggle game speed
**Expected:**
- Setting changes
- UI updates

---

## Performance Tests

### P1: Frame Rate
**Steps:**
1. Spawn 20+ units
2. Check browser performance tools
**Expected:**
- 60 FPS maintained on modern hardware
- 30+ FPS minimum

### P2: Memory Usage
**Steps:**
1. Play for 5 minutes
2. Check browser memory
**Expected:**
- Memory stays under 500MB
- No memory leaks over time

### P3: Load Time
**Steps:**
1. Refresh page
2. Time to playable
**Expected:**
- Under 5 seconds on good connection
- No loading errors

---

## Regression Tests

After any code change, verify:
- [ ] Unit spawning still works
- [ ] Combat still works
- [ ] UI buttons responsive
- [ ] No console errors
- [ ] Visual effects render
- [ ] Game can be won/lost
- [ ] Menu navigation works

---

## Known Issues / Expected Behavior

1. **TypeScript 3.3 Compatibility**: No optional chaining or nullish coalescing
2. **Phaser 3.16 API**: Older particle system, requires manual tween effects
3. **No Actual Audio**: Audio toggle is placeholder
4. **Procedural Graphics**: Units drawn with code, not sprites

---

## Test Results Template

Date: __________
Tester: __________

| Test ID | Status | Notes |
|---------|--------|-------|
| 1.1     | ☐ Pass ☐ Fail |       |
| 1.2     | ☐ Pass ☐ Fail |       |
| ...     | ...    | ...   |

---

## Automated Coverage

The test suite (`TestScene`) covers:
✓ Unit creation (all types)
✓ Melee combat
✓ Ranged combat
✓ Unit movement
✓ Damage system
✓ Death system
✓ Projectiles
✓ Base attacks
✓ All visual effects
✓ Mass spawning
✓ All ages present

**Total: 20+ automated tests**

---

## How to Report Bugs

When filing a bug report, include:
1. Test scenario number
2. Steps to reproduce
3. Expected vs actual result
4. Browser/OS info
5. Console errors (if any)
6. Screenshot/video (if applicable)

---

*Last Updated: 2026-01-02*

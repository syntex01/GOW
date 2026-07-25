# GOW — Design and Balance Notes

Working notes for anyone tuning the game. The numbers live in `src/data/`; this
document explains the reasoning behind them so changes stay coherent.

## The core loop

A match is a race between two compounding curves: **army value on the field**
and **technology level**. Gold buys the first, experience buys the second, and
both come from the same source — killing things. That coupling is what makes
the loop tense: the player who is winning fights is also the player who is
pulling ahead in tech, so a lead snowballs unless the loser spends differently.

The three levers that break a snowball:

1. **Turrets.** Static defence you can buy without spending population, which
   lets a losing player stabilise a lane they cannot win in the open.
2. **Economy upgrades.** Five compounding levels. Buying one costs tempo now
   for a bigger army later — the classic greed decision.
3. **Special abilities.** Charge is time-based with a kill bonus, so the losing
   player still gets one, and it arrives roughly when they most need it.

## Age pacing

| Age         | XP to advance | Evolve cost | Base HP | Income/s | Pop cap |
|-------------|---------------|-------------|---------|----------|---------|
| Stone       | 700           | 700         | 6,000   | 16       | 12      |
| Medieval    | 1,900         | 1,700       | 11,000  | 30       | 15      |
| Renaissance | 3,600         | 3,400       | 19,000  | 52       | 18      |
| Modern      | 6,400         | 6,500       | 32,000  | 86       | 21      |
| Future      | —             | —           | 52,000  | 130      | 26      |

Each age is roughly **1.9x** the previous one in XP and cost, and about **1.7x**
in base health. Unit power budgets scale slightly faster than costs, which is
deliberate: reaching the next age should feel like a real power spike, not a
sidegrade. The counterweight is that evolving drains the treasury at the exact
moment your old units stop being buildable, so a badly timed evolution is
punishing.

**How these numbers were derived.** The first pass sized XP thresholds against
unit cost, which produced an unwinnable stalemate: the population cap bounds
how many units can die per minute, so experience income is bounded by the *kill
rate*, not by how much gold is being spent. Measured against a scripted player
on Veteran, the front line trades roughly one unit every six seconds once the
armies meet, and a Stone Age kill is worth ~46 XP. A 700 XP threshold therefore
puts the first evolution around the 60-second mark, and each later age lands on
a similar cadence because XP-per-kill roughly doubles as kill counts stay flat.

Fortress health is set so that a Stone Age rush *cannot* end the game: twelve
population of early infantry need roughly twenty seconds of completely
unopposed contact to break a 6,000 HP wall, which never happens against a
defender who is still producing.

Target match length on Veteran is **5–7 minutes**, reaching Age 3–4.

## Unit budgets

Within an age, units are priced on a rough formula:

```
value ≈ hp × 0.35 + dps × 6 + range × 0.4 + speed × 1.2
```

Deviations from that line are intentional and always paired with a drawback:

- **Siege** (catapult, field cannon, mortar, railgun walker) buys huge range and
  splash by being slow, fragile and `structure`-armoured — pierce shreds them.
- **Tanks** (bonecrusher, knight, cuirassier, battle tank, plasma mech, titan)
  buy survivability with `heavy` armour, which pierce-heavy rosters and
  `bonusVs: { heavy }` units punish hard.
- **Support** (shaman → nano medic) has zero damage. Its value is entirely
  multiplicative on whatever it is standing behind, so it is priced against a
  *good* line, not an average one.
- **Air** (gunship, drone swarm) is priced as if the opponent has anti-air. If
  they do not, it is wildly overtuned — which is the point of the counter.

## Time to kill

Damage values are lifted 1.5x above the "obvious" numbers implied by the cost
formula. A same-age mirror melee matchup resolves in **6–7 seconds**, which is
what makes experience flow fast enough for the age ladder to matter. Slower
than that and the game stalls; much faster and there is no time to react to a
composition with a counter.

Support units are priced against this: healing was originally strong enough
that two stacked healers out-healed focused damage outright and froze the front
line permanently. Heal pulses now cover the two most wounded allies (not three)
and restore roughly a quarter of incoming DPS per healer.

As a backstop, `Battlefield.escalation` raises all unit damage by 12% per
minute after the three-minute mark. Two perfectly matched commanders can
otherwise grind at the midline indefinitely; the ramp makes the front line
progressively more brittle until someone breaks through.

## Damage matrix

Defined in `src/sim/types.ts`. Rows are damage types, columns armour classes.

|            | unarmored | light | heavy | structure | air  |
|------------|-----------|-------|-------|-----------|------|
| blunt      | 1.00      | 0.90  | 1.35  | 0.75      | 0.60 |
| pierce     | 1.35      | 1.15  | 0.70  | 0.50      | 1.20 |
| slash      | 1.25      | 1.00  | 0.80  | 0.60      | 0.80 |
| explosive  | 1.10      | 0.80  | 1.15  | 1.60      | 0.90 |
| energy     | 1.00      | 1.10  | 1.10  | 1.00      | 1.25 |

Energy is deliberately flat and slightly positive everywhere — the Future Age
answer to "no more counters, just power". `bonusVs` on individual units layers
on top of this and is where sharp counters live (pikeman ×1.75 vs heavy).

Bases take a separate multiplier set in `Base.takeDamage`: explosive ×1.6,
pierce ×0.5. Rifles cannot siege; artillery must.

## AI profiles

`src/sim/ai.ts`. Difficulty changes five things:

- **reactionMs** — how often it makes a decision (1500 → 460 ms)
- **aggression** — how much gold it holds in reserve before committing
- **counterPlay** — probability it picks the countering unit rather than the
  most expensive one it can afford (0.2 → 0.95)
- **economy/HP/damage multipliers** — flat handicaps
- **abilityTrigger** — how many enemy units on the field before it fires

The AI also carries a `pressure` term (1 − base health fraction) that makes it
play more desperately when losing: it stops saving for economy and starts
dumping gold and abilities.

Endless mode calls `escalate()` per wave, which tightens reaction time and
aggression permanently, on top of the per-wave stat multipliers applied in
`BattleScene.advanceWave`.

## Star ratings

Campaign missions award up to three stars:

1. Win the mission.
2. Finish with at least `healthStar` of your fortress intact (0.75 early,
   0.35 on the final mission).
3. Finish under `parSeconds`.

Par times assume a player who evolves on cooldown and does not over-build
turrets. They are tight but not speedrun-tight.

## Rendering budget

Everything is generated at load into the Phaser texture manager:

- ~250 unit body-part textures (32 units × 6–8 parts)
- 32 unit icons, 10 fortresses, 24 turret pieces
- 15 projectiles, 9 particle sprites
- 5 ages × (1 ground + 3 ridge bands)

Generation is chunked to a **14 ms per frame** budget in `PreloadScene` so the
progress bar keeps animating instead of the tab freezing.

Per-frame cost in a heavy battle is dominated by the O(n²) targeting scan in
`Battlefield.stepSide`. With the population caps above, `n` stays under ~50, so
this stays comfortably cheap. If caps are ever raised significantly, replace it
with a sorted sweep — the unit lists are already sorted by x.

## Frame-rate independence

`Battlefield.update` splits each frame into fixed 20 ms sub-steps (capped at 16
per frame). This is not an optimisation — it is a correctness requirement.
Knockback is applied as an instantaneous velocity change, so integrating it
over a single 300 ms frame shoved units 30+ pixels apart, out of a 36-pixel
melee range, and combat simply stopped resolving on slow devices and at 3x
speed. Sub-stepping makes 20 fps, 144 fps and every speed setting behave
identically.

Related: Phaser reuses a scene instance across `scene.restart()`, so class field
initialisers do not re-run. `BattleScene.resetSceneState` and
`HUDScene.resetWidgets` clear every mutable field by hand; without them a
restarted battle came back still paused, and the HUD kept updating widgets from
the previous match that had already been destroyed.

## Things intentionally left simple

- No pathfinding: one lane, units queue behind each other with a fixed gap.
- No fog of war: both sides see everything, as the genre expects.
- No multiplayer: the AI is the opponent. The simulation is deterministic given
  a seed (`core/rng.ts`), so a replay or lockstep netcode layer is feasible
  later without restructuring.

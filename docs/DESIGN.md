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
| Stone       | 3,600         | 900         | 2,600   | 14       | 12      |
| Medieval    | 9,500         | 2,400       | 5,200   | 26       | 15      |
| Renaissance | 21,000        | 5,200       | 9,000   | 44       | 18      |
| Modern      | 46,000        | 11,000      | 15,500  | 72       | 21      |
| Future      | —             | —           | 26,000  | 112      | 26      |

Each age is roughly **2.2x** the previous one in XP and cost, and about **1.7x**
in base health. Unit power budgets scale slightly faster than costs, which is
deliberate: reaching the next age should feel like a real power spike, not a
sidegrade. The counterweight is that evolving drains the treasury at the exact
moment your old units stop being buildable, so a badly timed evolution is
punishing.

Target match length on Veteran is **4–7 minutes**, reaching Age 3–4.

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

## Things intentionally left simple

- No pathfinding: one lane, units queue behind each other with a fixed gap.
- No fog of war: both sides see everything, as the genre expects.
- No multiplayer: the AI is the opponent. The simulation is deterministic given
  a seed (`core/rng.ts`), so a replay or lockstep netcode layer is feasible
  later without restructuring.

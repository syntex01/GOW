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

## Lockstep multiplayer

Multiplayer is deterministic lockstep over a direct WebRTC data channel. Neither
peer is authoritative, no game state is ever transmitted, and there is no server
of any kind — not for matchmaking, not for relaying. Players exchange two text
codes by whatever channel they already have (chat, email, reading them aloud)
and the browsers connect to each other.

**Why lockstep and not state replication.** The thing being simulated is a few
dozen units with knockback, ragdolls and swept projectile collision. Replicating
that state sixty times a second would need far more bandwidth than a
copy-paste-signalled peer connection deserves, and would need interpolation and
reconciliation on top. Commands are tiny — a build order is a dozen bytes — and
the simulation was already fixed-step and seeded, so lockstep was close to free.

**The tick.** `TICK_SUBSTEPS = 5` sub-steps per network tick, and the sub-step is
20 ms, so a tick is 100 ms. Commands are scheduled `INPUT_DELAY_TICKS = 2` ticks
ahead — 200 ms of latency hiding. That would be intolerable in a shooter and is
invisible here: every action in this game is a build order queued behind a
production timer, so nobody can perceive the delay.

A tick executes only when *both* sides' commands for it have arrived. If the
peer's input is late the local clock simply holds; after 600 ms the HUD says so.
Running ahead is never an option, because there is nothing to reconcile against.

**Ordering.** `LockstepDriver.executeTick` applies local commands first, then
remote, then steps the simulation. Both peers use that same fixed order rather
than, say, arrival order — otherwise two commands landing on the same tick could
resolve differently on the two machines. The order is arbitrary; being identical
is the whole point.

**Seeding the pipeline.** With a two-tick input delay, ticks 0 and 1 can never
carry a command, so the driver commits them empty in its constructor. They must
still be *sent*: the executor waits for the peer's tick 0 regardless of whether
it could possibly contain anything, so skipping the transmission deadlocks both
peers at tick 0 forever. That bug is exactly why the sends live in the
constructor next to the commits.

**Desync detection.** Every `HASH_INTERVAL_TICKS = 12` ticks (1.2 s) each peer
fingerprints its world with FNV-1a over `Battlefield.stateHash` — elapsed time,
both economies, base HP, and every unit's id, position and HP, all quantised —
and piggybacks it on the next tick message. A mismatch stops the match and says
so plainly. Silently drifting into two different games is much worse than an
honest error, and quantisation means a fingerprint mismatch is a real logic
divergence rather than a float rounding artifact.

**What determinism costs.** All gameplay randomness goes through the seeded
mulberry32 generator in `core/rng.ts`; nothing in `sim/` may call `Math.random`
directly. `Battlefield.stepFixed` exists so the netcode advances the world in
whole sub-steps with no wall-clock input at all — the accumulator in `update` is
bypassed entirely during a networked match. Match speed controls are locked, and
pause stops the HUD rather than the simulation, since one peer cannot freeze
time for the other.

**Result orientation.** `Battlefield` decides victory from the *player* side's
point of view because that is what single-player means. In a networked match the
guest controls the enemy side, so `BattleScene.finish` inverts:
`victory === (this.localFaction === 'player')`, and pulls its summary from
`statsFor(localFaction)` rather than the player-side stats. Networked matches do
not touch campaign records or achievements — an opponent who lets you win is not
an accomplishment.

## Things intentionally left simple

- No pathfinding: one lane, units queue behind each other with a fixed gap.
- No fog of war: both sides see everything, as the genre expects.
- No rollback: lockstep holds the clock instead of predicting and rewinding.
  Rollback would buy responsiveness this game has no use for, and would require
  the whole simulation to be snapshot- and replay-safe.
- No reconnect: if a peer drops, the match ends. Resuming would mean shipping a
  full state snapshot, which is precisely the thing lockstep avoids needing.

# The building and tech rework, per creed

`ECONOMY.md` says what the bottlenecks are. `FACTIONS.md` says what each creed
wants to do with them. This is the part you can build from: every building with
its tiers and numbers, and every tech node to add, change or cut, named against
the tree that actually exists today.

Costs are quoted in **first-age gold**. `buildingCost()` already multiplies by
the age's income scale, so a price here means the same thing at every age.

---

## 0. The shared layer

### The four core buildings, so that all four are needed

Today only the Granary matters, because all four hand you gold and gold is the
resource already in surplus. Each one now owns a different bottleneck, and gold
cannot buy past any of them.

**GRANARY — income.** Unchanged in shape.

| tier | cost | hp | effect |
|---|---|---|---|
| 1 | 400 | 5200 | +18% income |
| 2 | 850 | 8000 | +38% income |
| 3 | 1350 | 12000 | +60% income, first 20% of any siege absorbed |

**RELIQUARY — research.** This is the big change. Research is no longer bought
with gold at all; it accrues as **research points** at a rate this building
sets. With no Reliquary you still tick over, slowly, so a player who ignores it
is primitive rather than frozen.

| tier | cost | hp | effect |
|---|---|---|---|
| — | — | — | base rate 1.0 RP/s |
| 1 | 380 | 4000 | 2.2 RP/s |
| 2 | 820 | 6400 | 4.6 RP/s, ability charges 12% faster |
| 3 | 1300 | 9600 | 9.0 RP/s, and you can read the enemy commander's creed |

Node costs convert from their present gold prices at roughly **1 RP per 12
gold**, so a ring-2 node is about 25 seconds of a tier-1 Reliquary and a ring-6
node is several minutes of a tier-3 one. Two Reliquaries stack additively —
this is the knob an Engineering player abuses.

**MUSTER YARD — production.** The population cap is gone, so this building's job
changes: it is now about *rate*, and at the top it produces on its own.

| tier | cost | hp | effect |
|---|---|---|---|
| 1 | 400 | 4600 | −12% build time |
| 2 | 850 | 7200 | −22%, and a **second build slot** — two units at once |
| 3 | 1350 | 10800 | −30%, a **third slot**, and **autospawn**: a free line unit every 8s |

Autospawn is the mechanic that makes hundreds of units real. Three tier-3
Musters is a free line unit every 2.7 seconds, forever, on top of everything you
buy.

**FORGE — defence.** Repairs and turret capacity, as now, plus one addition so
it is not purely passive.

| tier | cost | hp | effect |
|---|---|---|---|
| 1 | 420 | 5400 | fortress mends 0.4%/s while nothing is hitting it |
| 2 | 880 | 8400 | + turret range +12% |
| 3 | 1400 | 12400 | + a fourth turret slot, and turrets repair between assaults |

### Why you cannot have all four

Generation 0 has **two** plots. Generation 4 has six. Across a whole match a
commander who ages all the way up has raised at most six buildings on their
final seat — and every doctrine building competes for the same ground. Nobody
gets all four core buildings at tier 3 *and* their creed's signature.

### Evolution: a seat only carries what a seat that size can carry

Plots were the only thing an age-up bought, which left an obvious degenerate
opening: bank through the first age, raise one maximal Granary in a tent, and
snowball on income nobody else has yet. Height is now gated the same way width
is.

| seat | founded in age | carries to |
|---|---|---|
| Camp | 1 | tier 1 |
| Stone Hold | 2 | tier 2 |
| Keep | 3 | tier 3 |
| Bastion | 4 | tier 3 |
| Citadel | 5 | tier 3 |

Three consequences worth naming:

- **A seat never grows.** The ceiling is set by the generation that founded it,
  so the Camp's Granary stays tier 1 for the whole match. Ageing up gives you
  *new ground with a higher ceiling*, not an upgrade to the old ground. That is
  what makes moving back a rebuild rather than a formality.
- **Capped is not spent.** A camp that cannot go taller can still go wider, and
  since the yard bonuses stack (harmonic for income and production, gentle for
  research), a second tier-1 Granary is a real purchase. Early ages push you
  toward breadth; later seats let you concentrate.
- **The wall is legible.** The BASE panel prints the seat's ceiling in its
  header, marks unreachable tiers `· NEEDS A GREATER SEAT` instead of quoting a
  price, and says so again on hover. A refusal you can't see the reason for is a
  bug even when the rule is right.

---

## 1. CARNAGE

### Buildings

**Charnel Yard** *(new)* — the Tide's engine. Rear/flank.

| tier | cost | hp | effect |
|---|---|---|---|
| 1 | 900 | 7400 | line units build 35% faster |
| 2 | 1900 | 11000 | +50%, and every corpse on your half adds +0.4% damage to your line units, capped at +40% |
| 3 | 3100 | 15000 | +65%, cap raised to +75%, and the bonus applies to the Butcher too |

**Ossuary** *(new)* — the Risen's bank. Rear only.

| tier | cost | hp | effect |
|---|---|---|---|
| 1 | 1100 | 8200 | banks up to 12 corpses from your half; the Vat draws from the bank first |
| 2 | 2200 | 12000 | banks 30, and banked bodies do not decay |
| 3 | 3600 | 16000 | banks 60, and you may **empty it at will**: everything in the bank rises at once |

That last tier is the path's whole payoff — a button that puts sixty soldiers on
the field in one second, once, after two minutes of saving.

**Bone Kiln** *(exists, keep)* — remains pay 0.9/s instead of 0.45; razed, they
pay nothing for 30s.

**Resurrection Vat** *(exists, keep)* — the dead rise every 2.4s at 65% health.

### Tech

| node | ring | change |
|---|---|---|
| `butchery` | 2 | **change** — dismembered bodies count **double** toward the Charnel Yard's corpse bonus. Taking it is choosing to make the field messier on purpose. |
| `corpse_wall` | 5 | **change** — corpse mounds absorb 25% of ranged damage crossing their file. Currently a soft stat; make it terrain. |
| `bone_harvest` | 3 | keep — gates the Kiln. |
| `necropolis` | 6 | keep — gates the Vat. |
| `charnel_rite` | 4 | **new** — gates the Charnel Yard. Requires `bone_harvest`. |
| `ossuary_rite` | 5 | **new** — gates the Ossuary. Requires `necropolis`. Oath-paired with `charnel_rite`: **you may have the Tide or the Risen, not both.** |
| `the_hunger` | 5 | **new** — your soldiers gain up to +45% attack and move speed as your own population falls below half. Requires `bloodlust`. |
| `the_butcher` | 6 | **new** — unlocks the champion. Permanent +2% damage and +1% max health per kill, no cap, with a visibly growing silhouette. Requires `flenser_rite`. |

**Core buildings it wants:** Muster Yard to the top, Granary second. The
Reliquary is nearly a dump stat — but note the oath above is a ring-5 node, so
"nearly" is doing work: Carnage still has to reach ring 5 to get its identity at
all, and that is the tension the creed is built on.

---

## 2. ORDNANCE

### Buildings

**Battery** *(new)* — artillery as architecture. Rear only, and the reason
Ordnance is always short of plots.

| tier | cost | hp | effect |
|---|---|---|---|
| 1 | 1000 | 6600 | shells the field every 6s, 120 splash damage, reaches midfield |
| 2 | 2100 | 9800 | every 4.5s, 190 damage, reaches the enemy muster line |
| 3 | 3400 | 13000 | every 3s, 260 damage, **second barrel**, reaches their gate |

**Powder Magazine** *(exists, keep)* — +18% splash on everything, detonates when
razed. Now also allowed on **front** plots, which is what makes the Forward
Magazine play legal.

**Signal Tower** *(exists, keep)* — plunging fire reaches any file. With
batteries this is what turns a line of guns into board-wide coverage.

### Tech

| node | ring | change |
|---|---|---|
| `ashfall` | 5 | **change** — burning ground also slows by 30% and cuts accuracy. Fire stops being damage-over-time and becomes a debuff you walk through. |
| `shrapnel` | 3 | keep — gates the Magazine. |
| `plunging_volleys` | 4 | keep — gates the Signal Tower. |
| `gun_line` | 3 | **new** — riflemen gain +8% damage for each friendly ranged unit in the **same file**, capped at +64%. Requires `powder_discipline`. This is the Line path and the reason Ordnance stacks a lane. |
| `emplacement` | 4 | **new** — gates the Battery. Requires `shrapnel`. |
| `forward_magazine` | 4 | **new** — the Magazine may stand on front plots, and its detonation radius is doubled. Requires `overpressure`. |
| `counter_battery` | 5 | **new** — your batteries prioritise enemy buildings over units. Requires `emplacement`. The answer to a mirror. |

**Core buildings it wants:** Granary and Forge. Batteries are buildings, so
Ordnance competes with itself for ground — it needs income to afford them and
structure health to keep them.

---

## 3. ENGINEERING

### Buildings

**Research Hall** *(new)* — the Ascendant path, and the best building in the
game.

| tier | cost | hp | effect |
|---|---|---|---|
| 1 | 900 | 6000 | +1.8 RP/s |
| 2 | 1900 | 9000 | +4.0 RP/s |
| 3 | 3200 | 12500 | +8.0 RP/s, and **after ascension** grants a permanent, uncapped +0.5% to unit damage and health every 20s while it stands |

Double output on a **forward** plot. The greedy play is putting your most
precious building in the most exposed place on the board, and both players can
see it.

**Assembly Line** *(exists, keep)* — turret wrecks reprint instantly at full
strength.

### Tech

| node | ring | change |
|---|---|---|
| `autoforge` | 5 | keep — gates the Assembly Line. |
| `aegis` | 5 | **change** — becomes the Lattice: adjacent defensive buildings and turrets share damage across the network, so the line breaks all at once or not at all. |
| `field_lab` | 3 | **new** — gates the Research Hall. Requires `salvage`. |
| `forward_doctrine` | 4 | **new** — Research Halls on front plots produce double instead of +50%. Requires `field_lab`. |
| `perpetual_engine` | 7 | **new, ascension-gated** — requires `ascend_cyborgs`. Turns every Research Hall from a research building into a permanent-buff engine. **This is what makes Engineering rush ascension.** |
| `iron_line` | 4 | keep. |

**Core buildings it wants:** Reliquary above all, then Forge. Engineering is the
only creed that genuinely needs the research bottleneck opened wide, and the
only one whose buildings must *survive* for it to work.

---

## 4. THE OCCULT

### Buildings

**Summoning Circle** *(new)* — the public commitment. Any face; it glows, it
pulses faster as it nears completion, and it is visible across the field.

| tier | cost | hp | effect |
|---|---|---|---|
| 1 | 1200 | 5000 | 45s rite, then consumes itself and summons a lesser demon |
| 2 | 2400 | 7000 | 75s, a greater demon |
| 3 | 4000 | 9000 | 120s, an archdemon — the strongest single unit in the game |

Deliberately low health for its cost. It is not a building you defend with the
building; it is a building you defend with your army.

**Great Rite** *(new, one only)* — the doom clock. 5 minutes. Both players see
it from the first second. On completion you win outright. Costs 9000 and has
14000 health, and raising it is the loudest thing anyone can do.

**Thrall Pit** *(exists, keep)* — turned dead cost no population.

**Black Chapel** *(exists, keep)* — 8% of every death anywhere feeds the ability.

### Tech

| node | ring | change |
|---|---|---|
| `soul_tithe` | 3 | keep — gates the Chapel. |
| `mind_thrall` | 5 | keep — gates the Pit. |
| `binding_circle` | 4 | **new** — gates the Summoning Circle. Requires `sacrament`. |
| `the_ninth_hour` | 7 | **new, ascension-gated** — requires `ascend_circle` and `binding_circle`. Unlocks the Great Rite. |
| `hexer_pact` | 5 | **change** — casters gain area damage scaling with the number of enemies in the blast. The anti-spam answer, stated as a number rather than implied. |
| `black_sun` | 5 | keep — already the deep occult node. |

**Core buildings it wants:** Reliquary and Granary. It leans on the Muster Yard
least of anyone — the Thrall Pit *is* its production, paid for with other
people's soldiers.

---

## 5. BLIGHT

### Buildings

**Spawning Pool** *(new)* — the Amalgam's feedstock. Flank/rear.

| tier | cost | hp | effect |
|---|---|---|---|
| 1 | 850 | 7800 | a free growth every 10s |
| 2 | 1800 | 11500 | every 7s |
| 3 | 3000 | 15500 | every 5s, and growths spawn already paired |

**Spore Bed** *(exists, keep)* — blight spreads with no kills to seed it.

**Heart Root** *(exists, keep)* — blight heals your buildings and mires everything else.

### Tech

| node | ring | change |
|---|---|---|
| `mycelium` | 3 | keep — gates the Spore Bed. |
| `deep_roots` | 6 | keep — gates the Heart Root. |
| `spawning_rite` | 3 | **new** — gates the Spawning Pool. Requires `spore_cloud`. |
| `amalgamation` | 4 | **new** — three of your growths that touch merge into one unit with the sum of their health and 1.4x their combined damage. Merged units may merge again. Requires `sporeling_bloom`. |
| `the_spread` | 5 | **new** — your blight advances toward the enemy fortress on its own, and damages it on arrival. Requires `verdant_tide`. Slow, inevitable, and entirely visible. |
| `titan_seed` | 6 | **change** — becomes the top of the merge ladder: a third merge produces a titan rather than another sum. |
| `rooted` | 4 | keep. |

**Core buildings it wants:** Granary and Muster Yard, but at **low tiers across
many plots** rather than one at maximum. Blight is a wide creed, not a tall one.

---

## 6. What this adds up to

| creed | new buildings | new nodes | changed nodes |
|---|---|---|---|
| Carnage | 2 | 4 | 2 |
| Ordnance | 1 | 4 | 1 |
| Engineering | 1 | 3 | 1 |
| Occult | 2 | 2 | 1 |
| Blight | 1 | 3 | 1 |
| **total** | **7** | **16** | **6** |

Seven new buildings on top of the sixteen that exist, sixteen new nodes on a
tree of sixty-three, and six existing nodes repurposed rather than replaced.

**One oath pair is load-bearing:** `charnel_rite` against `ossuary_rite`. Carnage
must choose the Tide or the Risen. Without that the creed simply takes both and
becomes the strongest thing in the game.

## 7. What shipped, and where it moved

All of it is built. Three things moved between the design above and the
simulation, each because measurement said so:

**"Corpses on your half" had to become a real tally.** The gore system only
spawns physics gibs when a soldier is DISMEMBERED — era-gated, and needing
overkill or Butchery — so counting gibs meant the number read zero through most
of a match and both the Charnel Yard and the Ossuary measured nothing at all.
Deaths are now counted per half and rot at a quarter a second, so a Yard tracks
the fighting rather than the whole match, and a body taken into a bank stops
being a body on the ground.

**The Forge was rewritten before any of this.** Measured at age four it cost
28,688 gold and bought nothing countable — its whole payload was fortress repair
and turrets, and turrets never reach midfield. It now takes 12/22% off every
blow your soldiers take on your own half, which is what the defence bottleneck
was supposed to mean.

**The Great Rite's clock is in the HUD for both sides.** A five-minute silent
countdown to a loss is not a doom clock; being loud is what you pay for the win
condition.

Everything else is as specified: the seven halls with their tier ladders, the
sixteen new nodes, the six repointed ones, and the `charnel_rite` /
`ossuary_rite` oath. Verified by `scratchpad/halls.mjs`, 9/9.

## 8. Order of work

1. **Research as a resource** — the Reliquary table and RP conversion. Nothing
   else in this document matters until research stops being purchasable.
2. **The Muster ladder** — slots and autospawn. This is what fills the field.
3. **Battery and Research Hall.** The two that most change how a match looks, and
   the two most likely to need their numbers moved after measurement.
4. **Charnel Yard, Ossuary and the Carnage oath.** The clearest identity in the
   set, and the one that tests whether corpses-as-a-resource works at all.
5. **Summoning Circle, then the Great Rite.** The Rite is the riskiest thing here
   and should be built last, after the Circle has proven the pattern.
6. **Spawning Pool and merging.** Merging is a new unit lifecycle and needs its
   own harness before anything depends on it.

# The four bottlenecks, the three curves, and what each creed does with them

A design for the mid-and-late game: why it currently sags, what replaces it, and
what each of the five creeds is actually *for*.

---

## 1. What is wrong, measured

Not opinion. These are the current numbers, pulled from the live rosters.

**A coin buys less the longer you play.** Unit power (hp × dps) per gold spent,
median across each age's roster:

| age | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| power per gold | 173 | 195 | 214 | **97** | **158** |

Age 4 is a crater and age 5 never recovers to age 3. Ageing up does not make
your army stronger per coin — it makes it **weaker**. Everything the player felt
in the late game follows from this one line.

**Gold outruns everything it could be spent on.** Income runs 16 → 130 a second
across the ages (×8.1). Progression costs did not keep pace, so a late commander
ages through the remaining tiers almost as fast as the experience arrives, and
then sits on money.

**The army is capped by the wrong thing.** Population runs 6/12/24/52/120 and a
late unit costs 3 population, so the field holds ~40 soldiers at the very most —
while the gold to buy them is piling up unspent. The limit on army size is not
the economy, so a richer economy does not produce a bigger army. That is why the
field looks empty while the bank looks full.

**Only one building matters.** Buildings multiply gold. Gold is already the thing
you have too much of. A building that gives you more of your surplus resource
solves nothing, so the Granary is the only one worth raising and the rest are
flavour.

---

## 2. The four bottlenecks

The fix is not to tune the numbers. It is to stop gold being the only currency,
so that having a lot of it stops being the same thing as being strong.

Four separate rate limits. **Gold cannot buy past any of them** — only buildings
raise them, and every building you raise is a plot you did not spend on the other
three.

| | limits | raised by | if you neglect it |
|---|---|---|---|
| **INCOME** | gold per second | Granary | everything is slow |
| **RESEARCH** | research points per second | Reliquary | your units stay primitive forever |
| **PRODUCTION** | units per minute, and population | Muster Yard | you cannot field what you can afford |
| **DEFENCE** | what your ground can absorb | Forge, Redoubt, tracks | you die to the first real push |

**Research stops being bought with gold.** It is bought with research points,
which only accrue over time at a rate your Reliquaries set. This is the single
most important change in the document: it means a player who dumps everything
into economy is *rich and primitive*, and cannot buy their way out of it. Deep
nodes take minutes of accumulated research, not one lump payment.

**Population moves off the age track and onto the Muster Yard.** Age gives a
small base; Muster tiers give large flat additions. An army of hundreds is
something you *build toward*, not something the calendar hands you.

The bottlenecks are what make specialisation a real decision. Pour everything
into Granaries and you are a rich man with tier-one soldiers and no wall. Pour
it into Musters and you spam chaff that dies to anything researched. Pour it into
Reliquaries and you have superb technology and eleven soldiers.

---

## 3. The three curves

### Line units — flat cost, linear power

Every age has a cheap standard soldier. **The price never changes** — about 200
gold at every age — and the power grows linearly: ×1, ×2, ×3, ×4, ×5.

This is what makes hundreds of soldiers possible. At age one, 16 gold a second
buys one line unit every twelve seconds. At age five, with income grown, it buys
one and a half a *second*. The line unit is never obsolete and never expensive;
what changes is how many of them the ground can hold.

### Elite units — exponential cost, exponential power

The other road. Cost ×2.6 an age, power ×3.6 an age. An age-one elite is 600
gold and worth about four line units. An age-five elite is around 27,000 gold and
worth about a hundred and seventy.

Held against income, an elite stays roughly *one per minute* at every age — but
what one minute buys goes from "a good soldier" to "a thing that kills a
company". This is the unit that can wade into the tide.

The two curves diverge on purpose. Quantity gets cheaper per point of power as
the game runs; quality gets more concentrated. Neither dominates: a hundred line
units beat one elite, and one elite beats twenty.

### Income and progression — both exponential, in tension

Income ×2.2 an age. Age-up cost and research cost ×2.6 an age. Progression
outruns income slightly, so ageing is always a real decision and never something
that simply happens to you. The current problem — arriving at the last age with
nothing to spend on — disappears because the elite curve is a bottomless sink and
the line curve is a bottomless population problem.

---

## 4. The creeds

Everyone lives under the four bottlenecks. What a creed does is **bend exactly
one of them past where anybody else can reach**, and pay for it somewhere else.

---

### CARNAGE — the war feeds on what it kills

*Bends: production. Its soldiers are the cheapest in the game and its dead are a
resource.*

Carnage does not fight over the field, it fights over the **corpses on it**.
Every other creed sees a body as something that happened; Carnage sees stock.

**The Tide.** Line units cost no population at all and build in half the time.
Every corpse lying on your half adds a little damage to every one of your line
units, so the longer a grinder runs the harder your side hits. You do not win the
first engagement. You win the fourth, in the same place, standing on the first
three.
- *Charnel Yard* — line units are population-free, and build twice as fast.
- *Bone Kiln* (exists) — the remains pay double. Burn it and they pay nothing at
  all for thirty seconds.
- Research: **Butchery** already makes every death a dismemberment; extend it so
  dismembered bodies count double toward the corpse bonus.

**The Risen.** Recursion instead of volume. Your dead get back up — not once, but
as long as there are bodies on your ground to spend.
- *Ossuary* — banks corpses. The Resurrection Vat draws from the bank rather than
  from what happens to be lying nearby, so a Carnage player can *save up deaths*
  and cash them in during a push.
- *Resurrection Vat* (exists) — raise timer down, risen at higher health.
- Corpse mounds already deform the terrain; make them **absorb ranged damage** in
  their file. A Carnage line that has been fighting in one place for two minutes
  is standing behind a wall it made out of its own casualties.

**The Butcher.** The answer to being out-massed by your own mirror: one champion,
enormous, with lifesteal, that grows *permanently* with every kill. Expensive,
slow, and vulnerable for the first ninety seconds — a Butcher that dies at ten
kills is a catastrophe, and one that reaches a hundred cannot be stopped by
anything that comes in ones and twos.

*How Carnage loses:* fire and area damage clear the tide and burn the corpses
that fuel it at the same time — the Cinder Host is its natural predator. And an
army of line units with no Butcher has no answer to a single enormous thing.

---

### ORDNANCE — the ground is the weapon

*Bends: defence, outward. It denies ground rather than taking it.*

The Cinder Host's soldiers are not very good and are not meant to be. They are
there to be in the way while the guns work.

**The Barrage.** Artillery stops being units and becomes **buildings**. Batteries
sit on rear plots and shell the field on their own. More batteries, more shells.
Your infantry is a screen whose job is to keep anything from walking up to the
guns.
- *Battery* — a rear-plot building that fires on the field. Tiers add range,
  then rate, then a second barrel.
- *Powder Magazine* (exists) — +18% splash on everything, and it detonates in
  your own yard when razed. Keep it. A creed built on explosives should have one
  building that is also a liability.
- *Signal Tower* (exists) — plunging fire reaches any file. With batteries this
  is what turns a wall of guns into a weapon that covers the whole board.

**The Firestorm.** You do not kill the army, you make the ground unusable and let
them come to you across it.
- Fire zones that persist and spread; every corpse burns where it falls.
- Research: extend **Ashfall** so burning ground slows and blinds — an army that
  crosses a firestorm arrives disorganised, which is what makes cheap infantry
  able to finish it.

**The Line.** Massed cheap riflemen whose damage scales with **how many of them
are in the same file**. Ten in one lane hit far harder than ten spread over five.
This is the one creed for which stacking a single lane is correct, and it makes
Ordnance the spam faction that plays completely unlike Carnage.

*How Ordnance loses:* anything that closes the distance fast. Its infantry cannot
hold a line against elites, and Blight taking the ground its batteries need to see
blinds it entirely.

---

### ENGINEERING — few, enormous, and permanently improving

*Bends: research. It is the only creed whose power keeps growing while it does
nothing.*

**The Ascendant.** The road the player asked for, and the best idea in this
document. Rush ascension; after ascending, every *Research Hall* standing on your
ground grants a small **permanent, unbounded** buff every twenty seconds. Not a
percentage that caps — a counter that keeps going up for as long as the building
stands.

This does three things at once. It makes a turtle that gets genuinely more
dangerous the longer it survives. It gives the opponent an urgent, *specific*
target — those buildings, right there, and the clock is running. And it makes
forward plots meaningful: a Research Hall on a **forward** plot produces double,
so the greedy play is to build your most precious buildings in the most exposed
place on the board.
- *Research Hall* — the permanent-buff building. Double output on a forward plot.
- *Assembly Line* (exists) — turret wrecks reprint instantly. Keep.
- Research: an ascension node that turns Halls from "faster research" into
  "permanent army buffs", so ascension is a genuine change of state rather than a
  bigger number.

**The Foundry.** One colossus at a time, and when it dies the Assembly Line
builds it again for free. You are never fielding more than three units. Every one
of them is worth forty.

**The Redoubt.** Pure defence: walls, murder holes, turret tracks, and a research
economy behind them. You do not attack until you have already won.

*How Engineering loses:* being rushed before it ascends, and being drowned. An
army of six cannot hold five files, so the moment Carnage gets past the wall in
one place the whole thing folds.

---

### THE OCCULT — pay in lives, not gold

*Bends: the cost model itself. Its best units are not bought with money.*

**The Rite.** Summoning circles: a building that must **survive a fixed time**,
then consumes itself and puts something terrible on the field. It glows while it
works. The enemy can see it, knows exactly what it means, and has that long to
come and kill it.

This is the most interesting building in the game because it is a *public*
commitment. You are announcing that in ninety seconds something is coming, and
betting you can hold the ground until then.
- *Summoning Circle* — tiers change what arrives and how long it takes.
- *Thrall Pit* (exists) — turned dead cost no population. This is what gives the
  Occult its screen: chaff you did not pay for, protecting casters you paid a
  fortune for.

**The Coven.** A handful of extremely strong casters behind a wall of thralls.
Area damage that punishes exactly what Carnage and Ordnance do — which is what
makes the Occult the anti-spam creed without needing a single cheap unit of its
own.

**The Tithe.** *Black Chapel* (exists) takes a bigger cut of every death anywhere
on the field. Push it further: an Occult commander who leans all the way in wins
with **abilities**, not armies — the war is a battery and the ability is the
weapon.

*How the Occult loses:* a fast push onto a circle mid-rite, which destroys the
investment and the tempo together. And being out-produced while paying elite
prices for everything.

---

### BLIGHT — take the ground and the army follows

*Bends: income and defence, indirectly. It wins the map before it wins the fight.*

**The Bloom.** Blight spreads on its own from *Spore Beds* (exists) — no kills
needed to seed it. Ground you hold is hostile to everything that is not yours.
Blight is the only creed whose economy and whose defence are the same thing.

**The Amalgam.** The mechanic the player asked for, and it is Blight's alone:
small growths that touch each other **merge** into a bigger one. Three become
one; three of those become one again. Your army gets stronger by *not dying* —
which inverts every other creed's relationship with combat. Blight does not want
trades. It wants time.
- *Spawning Pool* — turns out cheap growths continuously, like a slow autospawn.
- Merging is visible and dramatic and gives Blight the "hundreds of small units"
  and the "one enormous unit" roads simultaneously, depending on whether you let
  them meet.

**The Root.** *Heart Root* (exists) heals your buildings and mires everything
else. A Blight commander who commits here becomes something you cannot push
into — the ground itself fights, buildings repair faster than they can be burned,
and every step onto their half is slower than the last.

*How Blight loses:* fire, which burns blight faster than it grows — again the
Cinder Host. And ranged armies that simply never walk into it and shell the beds
from outside.

---

## 5. The counter-web this produces

- **Ordnance beats Carnage** — fire clears the tide and burns its fuel.
- **Carnage beats Engineering** — six units cannot hold five files.
- **Engineering beats the Occult** — permanent buffs outlast a timed rite.
- **The Occult beats Ordnance** — area casters punish massed cheap infantry.
- **Blight beats anything slow** and loses to anything that burns or never enters.

Nobody is short of an answer, and every answer costs you the thing you were
otherwise buying.

---

## 6. Order of work

1. **Fix the power-per-gold crater** first. It is a bug in all but name and every
   other number is measured against it.
2. **Split research off gold** onto its own accruing resource. This is what makes
   buildings matter at all.
3. **Move population onto the Muster Yard**, and give it the build-speed →
   parallel-slots → autospawn ladder.
4. **Re-lay the three curves** (line flat/linear, elite exponential/exponential,
   income and progression exponential).
5. **Then** the creed buildings, one creed at a time, each verified against a
   harness that proves the mechanism moved and not just the number.

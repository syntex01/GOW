# The Carnage Creed — the vision

This is the document the Carnage work is measured against. It is written from
every instruction given about the faction plus what the code actually does today,
and where those two disagree the disagreement is written down rather than
smoothed over.

---

## 1. What the faction is

**Everyone else spends money to make soldiers. Carnage spends soldiers to make
money.**

That is the whole faction in one line, and every mechanic below is a consequence
of it. A Carnage commander does not out-produce an opponent — they out-*consume*
them. Bodies are not the cost of doing business, they are the business. The board
a Carnage player wants is a slaughterhouse floor: their dead, the enemy's dead,
and a workforce picking through both.

Three consequences that shape everything:

- **It cannot win by attrition maths.** If a Carnage army trades evenly it
  starves, because its income is downstream of corpses and corpses rot. It has to
  force fights, win them messily, and harvest before the clock runs out.
- **It has almost nothing that shoots.** Reach is not its answer to anything. The
  creed closes, and what little range it has is short and horrible — a Shrike's
  tentacle at two files, not a rifle at six.
- **Its units get worse at being individuals and better at being a mass.** The
  line does not upgrade into elite soldiers, it upgrades into *more* soldiers.

## 2. The economy: three spoils

A body leaves what the manner of its death allows. That is the decision the
economy is built on — the player shapes their income out of the same choice they
were already making about which weapon counters which armour.

| Spoil | Pays | Left by |
|---|---|---|
| **Meat** | gold | blades and clubs — slashing and blunt |
| **Skull** | research | spears and beams — piercing and energy |
| **Bone** | skeleton chaff | piercing, energy, and heavy armour |

Three rules keep it honest:

1. **Existing is not harvesting.** Spoils rot on a clock. A fight won on the far
   side of the board pays less than the same fight won at home, because the
   Bonewrights have further to walk.
2. **Overkill spoils the meat.** A body torn to pieces leaves less than a body
   killed cleanly. Twice its own health in overkill leaves nothing at all.
3. **Worth and rot both scale with what died.** An expensive corpse is worth more
   and lasts longer, on a square-root curve — so killing one elite is better
   income than killing its cost in chaff, but not proportionally better.

The workforce is visible and killable: one Bonewright per lane, unarmed, which
searches a corpse, bags a piece, and walks it home. Two hits kill one. They flee
when struck and are slow to come back. **The economy stands on the board and can
be shot.**

## 3. Machines are earned, not given

This is a rule about the whole game, not just this creed.

**The default roster is people.** No commander begins an age already owning a
tank, a rocket launcher, a helicopter, a walker or a Titan. Those slots start
**empty**, and a slot is filled one of two ways: a research node adds the unit, or
ageing up brings the next rung of a line the player already owns.

Two reasons, and the second is the important one:

- A machine that arrives for free is not a decision. A machine you researched is.
- **It gives every creed the same empty slots to fill with its own answer.** The
  Carnage player fills the tank slot with a Monstrum, Engineering fills it with a
  machine, Ordnance with a gun. The board stops being "the standard army, tinted"
  and starts being five genuinely different armies.

**Shipped.** Every siege engine, rocket, tank, walker, aircraft and Titan stands
in a line behind one of five doctrines — the Siege Train, Shaped Charges, the
Armoured Corps, the Rotary Wing and the Titan Program. Nothing is handed out with
an age. A machine slot belongs to no creed, so it also survives the age-4
consolidation that replaces the bar with the dominant path's soldiers: paying for
the Titan Program and then ascending does not take the Titan away.

The old failure this replaced was a Carnage commander at age 3 fielding a "Carrion
Battle Tank" and a "Carrion Gunship" — a flesh cult with a renamed helicopter.

## 4. Lines, not lists

Every roster slot is a **line**, and a line has one rung per age. A line upgrades
in one of two ways, and the difference decides whether it costs research:

- **A tier bump** is the same body, more of it. It arrives **on age-up and costs
  no research**, because ageing up is what paid for it. The Husk is the model: ×2
  at age 1, then ×4, ×6, ×8, gaining bulk and losing nothing.
- **A mutation** is a different body doing a different thing. It always costs a
  research node, and it always *replaces* the rung below rather than sitting
  beside it.

The lines:

| Line | Age 1 | Age 2 | Age 3 | Age 4 | Owed |
|---|---|---|---|---|---|
| Bodies | Husk ×2 | Swollen ×4 | Bloated ×6 | Charnel ×8 | nothing — it escalates |
| Flanker | — | Ripjaw | Ripjaw Alpha | Skinrider | Skinriders |
| Chaff clear | — | Flenser | Butcher of the Yard | Flensing Host | The Butcher, Flensing Hosts |
| Mind / research | — | Brain Stealer | Brood Nurse | Mind Flayer | Brain Thieves, Mind Flayers |
| Executioner | — | — | Shrike | The Headsman | Rite of the Headsman |
| Raiser | — | — | Carrion Choir | Charnel Engine | The Charnel Engine |
| Tank | — | — | Monstrum | The Great Maw | The Hunger Made Flesh, The Maw |
| Air | — | — | Carrion Widow | Widow Queen | The Widow Queen |
| Screen | — | — | — | Flesh Wall | Flesh Architecture |
| Wildcard | — | — | — | Incarnation | Incarnation Rite |

**Shipped**, and asserted age by age in `scratchpad/carnagelines.mjs`. The Ripjaw
Alpha and the Brood Nurse are the two free tier bumps: they arrive with the age
and cost nothing, because ageing up is what paid for them. Everything in the Owed
column is a node, and each one *replaces* the rung below it rather than sitting
beside it.

Bodies on the bar: **1 → 4 → 8 → 10**, eleven once the Incarnation is bought.
Slightly increasing with age, which is the intent.

**A line arriving late is a real weakness, not an oversight.** Carnage has no
standoff option at age 1 at all — no Catapult replacement, nothing. The Husk swarm
and the bone chaff *are* the siege. Being unable to threaten from a distance for a
whole age is the price of an economy that pays for closing.

## 5. Balance: what "fair" means here

Two benchmarks exist and they answer different questions. Both are needed and
neither is sufficient:

- **`unitvalue`** — spend equal gold on this unit and on a mixed reference force
  of its own age, fight, and measure surviving gold. This answers *"is this unit
  worth its price inside its own age?"*
- **`budget`** — spend equal gold on the best of age N and the best of age N−1.
  This answers *"what did ageing up buy?"*

A unit can be excellent by one and poor by the other. The Flenser is the strongest
pick of its age against the age below it, and scores negative against its own
age's mixed force. That is not a contradiction, it is two facts.

Targets:

- **Inside an age**, a Carnage body should sit slightly *above* its cohort median,
  because the creed pays a real tax elsewhere: no reach, an income that rots, and
  a workforce that can be shot. Slightly above, not far above.
- **Across ages**, ageing up should be a clear gain and not a walkover. Three of
  the four current age-ups are won while losing under 7% of the budget. That is
  too much.
- **Quantity against quality** should hold at every age: cheap wins on equal gold,
  an elite beats a small handful of cheap. It currently holds at one age in five.

Two known outliers to fix rather than build around: the **Husk** at +168% power
per gold, and the **Great Maw** at +46% on paper while measuring worst in the game
at −0.94. The second is the more interesting failure — a real advantage that is
not converting, which is a behaviour bug wearing a balance costume.

## 6. Every body is its own body

No Carnage unit reuses another unit's model, movement or effects. That is already
true and must stay true as the nine new bodies land:

- **Models** come out of `gfx/flesh.ts`, a vocabulary parallel to `anatomy.ts` and
  not built on it. Pale hide outside for silhouette, dark meat for torn bands and
  interiors.
- **Movement** is per-body: the Husk drags, the Flenser waddles and cross-cleaves,
  the Monstrum ripples on six legs, the Flesh Wall inches, the Ripjaw bounds.
- **Effects** are one per body and each is a *different motion*, so a busy lane
  still reads: an arc, a straight lash, a forward cone, an inward suck, a
  shockwave, a thread that shortens, a thread that holds, a knit, a rising column.

The pixel budget is the constraint that governs all of it. A body 70 units tall
gets a 22×14 canvas; at that size a rib cage, a spine, three spurs and a loop of
viscera is not detail, it is noise. Shape carries small bodies; texture is for the
big ones.

## 7. Performance is part of the design

A faction whose whole idea is "many bodies and the remains of many bodies" cannot
be the faction that makes the game stutter. The Husk alone reaches eight per
purchase at age 4, the bone economy raises chaff on top of that, and every death
leaves physics bodies that persist and rot.

So: the late-game frame budget with a full field is a design constraint on this
creed specifically, not a cleanup task to do afterwards. Per-unit and per-pair
work has to stay cheap enough that the intended board — hundreds of bodies and a
carpet of spoils — is a board the game can actually draw.

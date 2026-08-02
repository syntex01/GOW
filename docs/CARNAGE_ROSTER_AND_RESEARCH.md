# Carnage roster and research contract

Carnage uses **persistent functional slots**, not additive faction units. A slot
is a battlefield decision such as anti-horde, fast assault or corpse support.
The first researched Carnage body permanently takes that position on the command
bar; later standard successors never return to it.

## Commitment

`Butchery` is the commitment point. It corrupts the early human roster, disables
all conventional machine doctrines for future research, removes queued machines,
and switches roster assembly to the slot table in `src/data/carnage.ts`.
Existing machines already on the field are not despawned.

`Death Throes` is deliberately separate: Butchery first produces a corrupted
Man-at-Arms, then Death Throes replaces that slot with the Husk. The Husk grows
through later ages rather than being replaced by Duelist, Shock Trooper or
Ripper.

## Full progression

| Slot | Age 1 | Age 2 | Age 3 | Age 4 |
| --- | --- | --- | --- | --- |
| Basic swarm | Husk | Husk | stronger Husk | final Husk |
| Biological ranged | corrupted Longbowman | Brain Stealer | Brood Nurse | Mind Flayer |
| Anti-horde | — | Flenser | Butcher | Flensing Host |
| Fast assault | — | Ripjaw | Ripjaw Alpha | Skinrider |
| Corpse support | corrupted Battle Monk | corrupted Field Surgeon | Carrion Choir | Charnel Engine |
| Execution | — | — | Shrike | Headsman |
| Heavy monster | corrupted Knight | — | Monstrum | Great Maw |
| Air hunter | — | — | Carrion Widow | Widow Queen |
| Screen | — | — | — | Flesh Wall |
| Capstone | — | — | — | optional Incarnation of Slaughter |

Machine fallbacks (`Catapult` through `Railgun Walker`, rockets, armour, rotary
wing and Titan) are intentionally empty after commitment until the matching
Carnage research fills the functional slot.

## Inheritance rule

Carnage behaviour and stat research applies to the body currently occupying a
slot, including every later evolution. The line does not lose Bloodlust, Death
Throes, Plague Wind, Honed Edges or the general morph stages merely because its
unit ID changed. Native `nk_` units keep their authored names while temporary
human fallbacks receive the `Corrupted` morph name and palette.

## Research presentation

Carnage owns a widened, collision-free band at the top of the research graph.
Nodes are grouped into five labelled clusters:

1. Swarm & Corruption
2. Predators & Assault
3. Parasites & Ranged
4. Fleshcraft Support
5. Monstrosities & Capstones

`prominence` is explicit data. Keystone research is larger and costlier; minor
support research is quieter and cheaper. Carnage connector veins darken and
thicken with depth. The validation script checks slot collisions, backwards
Carnage links, exact rosters, machine lockout and the Incarnation contract.

## The capstone

The Incarnation of Slaughter is a payment, not a soldier. Buying the card places
nothing on the field; it adds one mark to the sigil burning over your fortress,
which grows with every mark and is readable by both players from across the
board. That is the tell, and it is what the card was missing when it was pulled.

Every thirty seconds the offer takes somebody: the best melee body on the board,
either side, consumed where it stands. In its place rises the demon-lord —
medium, sword, and enormously dangerous for the half minute it lasts.

**One at a time, always.** While a lord is standing the clock does not run, so
investments buy a bigger lord rather than a second one: each mark adds a tenth
to its health, damage and toughness.

The lord does not walk to the fight. It reads the board for the thickest knot of
enemies, steps out of the air beside them, takes one enormous splash swing, and
steps again — roughly every four seconds. The swing is slow on purpose: the
threat is where it appears, not how much of it there is, so the counter is
spreading out rather than fielding something bigger.

It always ends on schedule. An accelerating bleed integrates to its whole health
across the thirty seconds, so it cannot outlive its window.

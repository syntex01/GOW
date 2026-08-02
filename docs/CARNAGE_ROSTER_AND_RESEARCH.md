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
| Capstone | — | — | — | optional Herald of Slaughter |

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
Carnage links, exact rosters, machine lockout and the Herald contract.

## The capstone

The Herald of Slaughter is a payment with a body. Each one bought is one
investment into the Incarnation and one channelling figure standing behind your
line: it does no damage, blocks no file and adds nothing to the press, but the
board-wide audition only runs while at least one is alive.

The audition takes the most expensive melee body that has killed three times its
own price — from either side — doubles it (plus a tenth per investment), grants
it lifesteal, and bleeds it out over about thirty seconds.

Killing every Herald stops the watching. It does not refund it: investments
already made persist, so a replacement resumes at the multiplier already bought.
A possession already taken also persists — only the bleed ends that.

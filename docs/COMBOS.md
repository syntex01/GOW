# The Combo Codex

One hundred named plays across positioning, research, unit placement and macro —
each with what it beats and what beats it. Generated from `src/data/combos.ts`,
which is the source of truth (and what the balance harnesses sample).

## Positioning (22)

**1. The Set Line** — Post a phalanx unit in the file a flanker will arrive in. Intercept fire hits chargers 1.85× harder.
   *Beats:* open_file_raid, backstab_charge, knights_move · *Countered by:* siege_on_density, spill_pressure, grenadier_arc

**2. The Doctrine Wall** — Phalanx Doctrine raises the intercept to 2.4×: a read charge simply dies.
   *Beats:* pack_hop, backstab_charge · *Countered by:* mortar_pin, ability_bank

**3. The Knight's Move** — A blocked flanker waits 1.5s, then takes the nearest open file and rides it.
   *Beats:* single_file_stack, siege_park · *Countered by:* pike_front, lane_coverage

**4. Backstab** — A flanker striking a soldier already fighting someone else hits 1.25× harder.
   *Beats:* engaged_front, swarm_press · *Countered by:* pike_front, screen_pivot

**5. The Open Road** — A flanker in an enemy-free file raids at 1.3× speed straight for the fortress.
   *Beats:* single_file_stack, greedy_macro · *Countered by:* lane_coverage, turret_reception

**6. The Reception** — Leave the raided file empty on purpose — the raider arrives alone into full turret fire.
   *Beats:* open_file_raid · *Countered by:* siege_on_structure, raid_pairs

**7. The Screen** — Screen units taunt hunters: nothing with the hunt conduct may aim past them while they stand.
   *Beats:* hunter_dive, gunship_hunt · *Countered by:* siege_on_density, ignore_by_air

**8. The Turned Shield** — A screen holding a flanked file gives the backstab no idle victim — the shield is already facing everyone.
   *Beats:* backstab_charge · *Countered by:* mob_pull, emp_shutdown

**9. Spill Pressure** — Fight from a file adjacent to the real target: supporting fire spills at half strength next door.
   *Beats:* single_file_stack, pike_front · *Countered by:* spread_files, corpse_rampart

**10. Plunging Battery** — With Plunging Volleys, arcing fire reaches two files over at a third strength — no lane is safe.
   *Beats:* spread_files, siege_park · *Countered by:* corpse_rampart, black_sun_veil

**11. The Thin Board** — Spread one unit per file: siege bombards the densest lane, so an even board starves every shell.
   *Beats:* siege_on_density, cluster_rain · *Countered by:* swarm_press, knights_move

**12. The Column** — Stack one file deep: rear ranks press the front up to +2 attack strength.
   *Beats:* spread_files, thin_line · *Countered by:* siege_on_density, spill_pressure, penetrator_line

**13. Shellfall** — Siege aims at the thickest file on the board, wherever it is.
   *Beats:* single_file_stack, swarm_press, doctrine_wall · *Countered by:* spread_files, hunter_dive, gunship_hunt

**14. The High Ground** — Shooters standing on a mound six pixels high see 12% further. Park the firing line on the dead.
   *Beats:* flat_standoff, siege_park · *Countered by:* crater_the_hill, quarry_eco

**15. Unmaking the Hill** — Heavy shells destroy mound mass and throw the rest aside — the enemy's high ground is a target.
   *Beats:* mound_battery, flesh_altar · *Countered by:* spread_files, air_layer

**16. The Rampart of the Fallen** — With Corpse Wall, settled remains stop flat shots. Fight from behind your own dead.
   *Beats:* flat_fire_line, penetrator_line · *Countered by:* plunging_battery, ignore_by_air, overpressure_throw

**17. Fighting the Furniture** — Trees, wells and carts block flat shots in their file. Hold the line at the cover the map dealt.
   *Beats:* flat_fire_line · *Countered by:* grenadier_arc, burn_the_cover

**18. The Dread Moat** — Push enemies onto your haunted ground: they swing 15% softer and walk slower while they stand in it.
   *Beats:* engaged_front, swarm_press · *Countered by:* ranged_standoff, fight_on_their_half

**19. The Carpet** — Fight on your own spore ground: it heals you, and with Deep Roots it drags them to a crawl.
   *Beats:* melee_push, swarm_press · *Countered by:* burn_the_cover, ranged_standoff, ignore_by_air

**20. Over the Wall** — Air ignores screens, corpse walls, props and every ground rule. The third dimension is a flank.
   *Beats:* corpse_rampart, screen_taunt, spore_carpet, doctrine_wall · *Countered by:* anti_air_line, slinger_flak

**21. The Flak Line** — Pierce and energy shooters with AA coverage stand behind the front and own the sky.
   *Beats:* ignore_by_air, gunship_hunt · *Countered by:* siege_on_density, penetrator_line

**22. The Backpedal** — Charged siege crews give ground rather than crank at a swordsman — bait them into turret range.
   *Beats:* hunter_dive · *Countered by:* pack_hop, raid_pairs


## Research (30)

**23. The Gore Engine** — Butchery turns every crit into a burst body; Bloodlust reads the soaked ground for up to +45% attack speed. The crits feed the ground that feeds the speed that lands more crits.
   *Beats:* attrition_grind, engaged_front · *Countered by:* ranged_standoff, peace_denial, fight_on_their_half

**24. Carrion Economy** — Butchery fills your half with remains; the Bonewrights walk out, sack them and carry them home for gold.
   *Beats:* greedy_macro, attrition_grind · *Countered by:* burn_the_corpses, overpressure_throw

**25. Eating the Field** — Wounded soldiers stoop over the remains they stand on and eat them, once every three seconds. A carpet of gibs is a slow hospital.
   *Beats:* attrition_grind, poke_damage · *Countered by:* burst_damage, burn_the_corpses

**26. The Altar** — Carnage ground rule: mounds rise fast, refuse to heal, and soldiers on them swing +28% and hit +18%.
   *Beats:* engaged_front, attrition_grind · *Countered by:* crater_the_hill, ranged_standoff, quarry_eco

**27. The Storm of Parts** — Every blast throws wounding fragments and every shove becomes a throw. Explosions ripple.
   *Beats:* swarm_press, single_file_stack · *Countered by:* heavy_line, spread_files

**28. Cluster Rain** — Lobbed shells split into three at apogee and reach two files over. Saturation, not accuracy.
   *Beats:* spread_files, thin_line · *Countered by:* black_sun_veil, heavy_line, gunship_hunt

**29. The Firewall** — Explosions leave burning ground that spreads on its own. The lane itself becomes the weapon.
   *Beats:* melee_push, spore_carpet, necropolis_line · *Countered by:* ranged_standoff, ignore_by_air

**30. The Long Needle** — Shots pass through the first body into the next. A stacked column is a shish kebab.
   *Beats:* single_file_stack, corpse_rampart · *Countered by:* spread_files, heavy_line

**31. The Tunnel Bombs** — Stuck melee burrows behind the enemy line and dies there armed. Their rear rank is your blast radius.
   *Beats:* ranged_standoff, siege_park · *Countered by:* burst_damage, screen_pivot

**32. The Machine Choir** — Machines heal continuously and shoulder-to-shoulder soldiers share every blow. The line refuses to break.
   *Beats:* poke_damage, attrition_grind · *Countered by:* emp_shutdown, burst_damage, siege_on_density

**33. The Off Switch** — Energy hits shut machines down for seconds. Tanks are only tanks while they are on.
   *Beats:* machine_choir, tank_wall · *Countered by:* organic_comp, cyborg_ascension

**34. The Rebuilding Wall** — Turrets rebuild themselves and the fortress holds a third more. Time is on your side.
   *Beats:* poke_damage, raid_pairs · *Countered by:* siege_on_structure, deed_pressure

**35. The Pact Rush** — Units finish instantly; the fortress pays in health. Buy tempo with the wall itself.
   *Beats:* greedy_macro, slow_start · *Countered by:* defensive_hold, baseheld_denial

**36. The Soul Cycle** — Every death feeds the ability and the drums bring it back faster. Cast on cooldown, forever.
   *Beats:* swarm_press, attrition_grind · *Countered by:* spread_files, kill_denial

**37. The Hungry Ground** — Occult ground rule: your half consumes its dead — charge from every body, haunt where mounds would be.
   *Beats:* carrion_economy, flesh_altar, necropolis_line · *Countered by:* fight_on_their_half, ranged_standoff

**38. The Evil Geometry** — Deaths stagger everyone watching and the Hexer makes armour a rumour. The line wilts before it breaks.
   *Beats:* heavy_line, tank_wall · *Countered by:* spread_files, burst_damage

**39. The Closing Rite** — Your dead heal the line as they fall, and a fifth of what you kill stands back up on your side.
   *Beats:* attrition_grind, swarm_press · *Countered by:* burst_damage, kill_denial

**40. The Black Sun** — Enemy fire scatters and their artillery stops landing where it was aimed. The sky takes your side.
   *Beats:* siege_on_density, cluster_rain, plunging_battery · *Countered by:* melee_push, swarm_press

**41. The Chain of Bursts** — Your dead burst into spore ground, and anything that dies in it bursts too. Death is contagious.
   *Beats:* swarm_press, melee_push · *Countered by:* firewall, ranged_standoff

**42. The Creeping Bog** — Blighted ground spreads on its own and drags enemies to a crawl. The map slowly becomes yours.
   *Beats:* melee_push, slow_start · *Countered by:* firewall, ignore_by_air

**43. The Rooted Wall** — Soldiers who hold position take 35% less and heal on blighted ground. Standing still is armour.
   *Beats:* poke_damage, attrition_grind · *Countered by:* mortar_pin, overpressure_throw

**44. The Second Death** — Every trade you lose keeps swinging for two more seconds at double speed. A swarm that dies well out-damages one that dies quietly.
   *Beats:* slow_reads, pike_front · *Countered by:* siege_park, grenadier_arc

**45. The Iron Press** — Rear ranks press +0.15 harder and light fire stops staggering the front. The column grinds forward.
   *Beats:* poke_damage, flat_fire_line · *Countered by:* siege_on_density, penetrator_line

**46. The Salvage State** — Wreckage on the field is stripped for gold where it lies. Every fight pays twice.
   *Beats:* attrition_grind · *Countered by:* fight_on_their_half, kill_denial

**47. The Quarry** — Engineering ground rule: mounds on your half are eaten for gold, craters filled, cover rebuilt.
   *Beats:* flesh_altar, mound_battery, attrition_grind · *Countered by:* fight_on_their_half, pact_tempo

**48. No-Man's-Land** — Ordnance ground rule: your craters stay, mire whoever falls in, and your shells hit +25% down there.
   *Beats:* melee_push, flesh_altar, mound_battery · *Countered by:* ignore_by_air, spread_files, decomposition_fill

**49. The Skipping Volley** — Flat shots skip off armour at shallow angles and keep going. Armour is a suggestion at range.
   *Beats:* heavy_line, tank_wall · *Countered by:* corpse_rampart, prop_cover

**50. The Standing Dead** — Your dead are cover until there are enough of them, and then they are reinforcements.
   *Beats:* attrition_grind, poke_damage · *Countered by:* firewall, hungry_ground, overpressure_throw

**51. The Orchard** — The Titan Bloom lobs its own bursting fruit over a bog nothing can cross quickly.
   *Beats:* melee_push, single_file_stack · *Countered by:* railgun_snipe, ignore_by_air

**52. The Finished Edit** — The whole army heals itself and nothing can be shut down. EMP dies as a concept.
   *Beats:* emp_shutdown, attrition_grind · *Countered by:* burst_damage, deed_pressure


## Unit Placement & Composition (27)

**53. Spear and Sling** — The age-0 core: spears hold the file, slingers stagger from behind. Pierce shreds the unarmored answer.
   *Beats:* clubman_flood, raptor_dive · *Countered by:* bonecrusher_wall, shaman_sustain

**54. The Flood** — Cheap swarm bodies at gap 2 with mob bonus vs anything 3× their price. Numbers are a weapon.
   *Beats:* bonecrusher_wall, expensive_single · *Countered by:* spear_sling, shaman_burst, siege_on_density

**55. The Crusher Wall** — Heavy blunt screen: taunts hunters, and blunt beats the heavy answer they might bring.
   *Beats:* raptor_dive, clubman_flood · *Countered by:* spear_sling, pierce_focus

**56. The Raptor Dive** — Fast hunt flanker that eats unarmored backlines 1.25× harder.
   *Beats:* slinger_flak, shaman_sustain · *Countered by:* spear_sling, bonecrusher_wall

**57. Pike and Bow** — The age-1 axis: pikes punish armour and charges, archers shred light from behind them.
   *Beats:* knight_press, raptor_dive · *Countered by:* catapult_park, monk_line

**58. The Knight Press** — A screen knight soaks the taunt while swords mob at his feet. Slash eats the unarmored answer.
   *Beats:* archer_line, clubman_flood · *Countered by:* pike_and_bow, catapult_park

**59. The Park** — Siege parked behind a screen: shells the densest file while the knight forbids hunters the approach.
   *Beats:* single_file_stack, pike_and_bow · *Countered by:* raptor_dive, ignore_by_air, black_sun_veil

**60. The Chant** — Three heals a pulse, strongest in the healer's own file. A pike line that will not die.
   *Beats:* poke_damage, archer_line · *Countered by:* burst_damage, grenadier_arc

**61. The Musket Wall** — Muskets skip off nothing at their range band; the cuirassier screen holds hunters out of it.
   *Beats:* duelist_hop, swarm_press · *Countered by:* field_cannon_line, grenadier_arc

**62. The Duelist's Evening** — A heavy-killing flanker (1.5× vs heavy) that arrives before the screen has re-formed. Screens are food, not obstacles.
   *Beats:* musket_wall, tank_wall · *Countered by:* pike_front, grenadier_arc

**63. The Grenade Arc** — Lobbed explosive over cover and screens into the pile. Splash does not ask who was pressing.
   *Beats:* swarm_press, prop_cover, monk_line · *Countered by:* heavy_line, spread_files

**64. The Field Battery** — Cannon breaks the structure and the wall; muskets take the sortie that comes out.
   *Beats:* autoforge_turtle, prop_cover · *Countered by:* duelist_hop, gunship_hunt

**65. Rifles Behind Steel** — The eternal shape: a heavy screen and pierce behind it. Cheap, honest, hard to open.
   *Beats:* shock_flank, swarm_press · *Countered by:* bazooka_focus, mortar_pin

**66. The Sweep** — Burst pierce that deletes light and unarmored by volume. Swarms walk into a hose.
   *Beats:* clubman_flood, swarm_press, sporeling_tide · *Countered by:* tank_wall, heavy_line

**67. The Can Opener** — Explosive with 1.4× vs heavy, and AA. The answer to steel in both layers.
   *Beats:* tank_wall, gunship_hunt, rifle_screen · *Countered by:* mg_sweep, swarm_press

**68. The Tank Wall** — Heavy explosive platform with a medic behind it. Blunt trauma on tracks.
   *Beats:* mg_sweep, rifle_screen · *Countered by:* bazooka_focus, emp_shutdown, duelist_hop

**69. The Pin** — Lobbed splash on the densest file: rooted lines, formations and screens must move or die.
   *Beats:* rooted_wall, single_file_stack, machine_choir · *Countered by:* gunship_hunt, black_sun_veil, spread_files

**70. The Gunship Hunt** — Air hunt: dives the weakest, ignores every wall, and only flak answers it.
   *Beats:* siege_park, mortar_pin, corpse_rampart · *Countered by:* anti_air_line, bazooka_focus, slinger_flak

**71. The Shock Entry** — A heavy-armoured flanker that arrives behind the line where the backstab pay-off lives.
   *Beats:* rifle_screen, siege_park · *Countered by:* pike_front, mg_sweep

**72. The Light Wall** — Energy ignores armour bands; the shield soaks. Nothing on the ground trades into it evenly.
   *Beats:* tank_wall, heavy_line · *Countered by:* mortar_pin, swarm_press

**73. The Umbrella** — Air hunt over an AA mech: the drones eat the backline while the mech forbids the sky back.
   *Beats:* siege_park, mortar_pin · *Countered by:* laser_wall, railgun_snipe

**74. The Long Rod** — Pierce siege with 1.9× vs heavy at extreme range. Titans and mechs are its reason to exist.
   *Beats:* titan_anchor, plasma_wall, tank_wall · *Countered by:* duelist_hop, swarm_press, shock_flank

**75. The Anchor** — The most expensive thing alive, screened by definition, healed by nanites. A moving fortress.
   *Beats:* mg_sweep, laser_wall · *Countered by:* railgun_snipe, swarm_press, evil_geometry

**76. The Cleanup** — A late flanker with 1.3× vs unarmored, moving fast enough to take a new file before the old one closes. Backlines end here.
   *Beats:* siege_park, anti_air_line · *Countered by:* pike_front, laser_wall

**77. The Tide** — Cheap regrowing swarm that bursts on death. The opponent pays for every kill twice.
   *Beats:* expensive_single, titan_anchor · *Countered by:* mg_sweep, firewall

**78. The Ward** — Support heals three wounded a pulse, full strength in its own file. Place it where the wounds are.
   *Beats:* poke_damage, attrition_grind · *Countered by:* burst_damage, hunter_dive, gunship_hunt

**79. The Weakest First** — Hunt conduct aims at the weakest in reach: wounded veterans and healers die first.
   *Beats:* healer_stack, veteran_bank · *Countered by:* screen_taunt, monk_line


## Macro & Timing (21)

**80. The Age Rush** — Bank XP, evolve early, and hit age-N units into age-(N-1) armies. One era is a real weapon.
   *Beats:* greedy_macro, slow_start · *Countered by:* pact_tempo, deed_pressure, defensive_hold

**81. The Long Game** — Stack income multipliers and float gold. Every minute you are not dead you are further ahead.
   *Beats:* slow_start, defensive_hold · *Countered by:* age_rush, pact_tempo, open_file_raid

**82. The Hold** — Buy the wall, not the army. Let the turrets do the killing while research compounds.
   *Beats:* pact_tempo, age_rush · *Countered by:* siege_on_structure, greedy_macro

**83. The Long Leverage** — Explosive is 1.7× vs structure. Park siege and make the fortress itself the losing clock.
   *Beats:* defensive_hold, autoforge_turtle · *Countered by:* hunter_dive, gunship_hunt, black_sun_veil

**84. The Held Hand** — Hold the charged ability until their whole build order is standing in one file. Then spend it.
   *Beats:* single_file_stack, swarm_press · *Countered by:* spread_files, soul_cycle

**85. The Veteran Bank** — Pull hurt veterans back instead of feeding them. Three promotions make a different soldier.
   *Beats:* attrition_grind, poke_damage · *Countered by:* hunter_dive, burst_damage

**86. Playing for the Deed** — Key techs demand deeds — 90 kills, 60 losses, 65% base held. Shape every fight toward your unlock.
   *Beats:* greedy_macro, defensive_hold · *Countered by:* kill_denial, baseheld_denial

**87. Starving the Ledger** — Refuse cheap kills to a kills-demand opponent: no trades into their turrets, no feeding the tithe.
   *Beats:* deed_pressure, soul_cycle, salvage_state · *Countered by:* siege_on_structure, open_file_raid

**88. Scratching the Paint** — The Dark Circle ascension demands a fortress never below 65%. One good raid ends that story forever.
   *Beats:* deed_pressure, defensive_hold · *Countered by:* turret_reception, lane_coverage

**89. The Willing Dead** — The Nekrotic road demands your own losses. Spend cheap bodies on purpose; every death is progress.
   *Beats:* kill_denial · *Countered by:* mg_sweep, hungry_ground

**90. The Foundry Count** — The Cyborg road counts units built. Build-speed research turns the demand into a timer.
   *Beats:* slow_start · *Countered by:* open_file_raid, siege_on_structure

**91. The Sixteen** — The Bloom road wants 16 alive at once. Hold the army home, swell it, then release the wave.
   *Beats:* attrition_grind · *Countered by:* ability_bank, siege_on_density

**92. The Last Node** — Ascend when the 6000 gold does not cost you the current fight — a faction swap mid-push is a rout.
   *Beats:* greedy_macro · *Countered by:* age_rush, pact_tempo

**93. The Sharpening** — After minute 3 all damage climbs 12%/min. Stalemates are a countdown: be the side built for late.
   *Beats:* defensive_hold, attrition_grind · *Countered by:* age_rush, pact_tempo

**94. No Quiet** — The ground heals only after 16 quiet seconds. Keep one skirmish alive and the scars never close.
   *Beats:* quarry_eco, field_healing · *Countered by:* defensive_hold, kill_denial

**95. The Quiet Minute** — Disengage entirely and the early-age field heals in half a minute — mounds, blood and all.
   *Beats:* gore_engine, flesh_altar, mound_battery · *Countered by:* peace_denial, open_file_raid

**96. The Away Game** — Every creed's ground rule works on its own half. Push the fight across the midline and unplug it.
   *Beats:* flesh_altar, hungry_ground, quarry_eco, spore_carpet · *Countered by:* defensive_hold, turret_reception

**97. Filling the Bowls** — Bodies decompose into height — dying into a crater field slowly fills the no-man's-land back in.
   *Beats:* broken_ground · *Countered by:* hungry_ground, quarry_eco

**98. Raiding in Pairs** — Send flankers two at a time into different files: one meets the reception, one meets the fortress.
   *Beats:* turret_reception, lane_coverage · *Countered by:* pike_front, doctrine_wall

**99. The Full Board** — Keep at least one body in every file. Coverage is not about winning lanes — it is about time.
   *Beats:* open_file_raid, knights_move, raid_pairs · *Countered by:* siege_on_density, single_file_stack

**100. Salting the Field** — Fire on the ground destroys the remains economy standing on it — harvests, walls, necropolis stock.
   *Beats:* carrion_economy, necropolis_line, bonepicker_sustain · *Countered by:* ranged_standoff, quarry_eco


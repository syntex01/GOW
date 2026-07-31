import type { TechId } from './tech'

/**
 * The rules, in numbers, for every behaviour node.
 *
 * The `effect` strings on the nodes carry the voice; these carry the truth.
 * Each entry is derived from the actual implementation in the simulation —
 * the constants here ARE the constants in the code, and when one changes the
 * other must. The research screen shows both: flavour first, then this.
 *
 * Stat and unit nodes need no entry: their numbers derive automatically from
 * `node.stat` and the unit definition.
 */
export const TECH_MECHANICS: Record<TechId, string> = {
  // ── core gates ──
  collapse: 'The root. Opens the whole network.',
  field_stripping: '+10% gold and XP from kills. Opens Butchery, Bonepickers and Salvage.',
  powder_discipline: 'Explosion knockback +15%. Opens the ordnance line.',
  old_rites: 'Commander ability charges 10% faster. Opens the occult line.',

  // ── carnage ──
  butchery: 'Commits the roster to Carnage. +10% crit chance; critical kills dismember completely; Charnel Yards count those corpses twice. Conventional machine research closes and queued machines are cancelled.',
  bonepickers: 'A wounded soldier (below 92% hp) stoops over a nearby corpse piece every 3s and eats it, healing 6% of max hp + 8. Visible: it bends down, and the piece bursts. Consumes the remains.',
  bone_harvest: 'Raises five Bonewrights, one per lane, who walk out, sack up to 3 spoils and carry them home. MEAT pays 12 gold each. 70 hp, no attack, flees when struck, 22s to come back. Meat off a cheap body rots in ~15s and off an elite in ~40s — what you cannot reach, you do not get.',
  clean_kills: 'Pierce and energy kills on your half leave one EXTRA skull, and Bonewrights start carrying skulls home for 9 research apiece. Blunt and explosive kills still leave none. Base skull life 18s off a cheap body, longer off a dear one.',
  bone_levy: 'Bonewrights now also carry BONE, and 4 frames’ worth delivered stand up as a free Boneling. Bone comes off pierce and energy kills and off heavy armour, and keeps longest of the three.',
  bloodlust: 'Blood-soaked ground grants up to +45% attack and move speed. Gore builds where things die messily.',
  the_hunger: 'While outnumbered, every soldier you have left gains attack and move speed: +50% × (1 − yours ÷ theirs), so +33% at three against two and the full +50% at three to one. Counts fighting bodies only — gatherers do not dilute it.',
  flenser_rite: 'Unlocks the Flenser.',
  plague_wind: 'Every enemy you kill leaves a plague cloud: 70px, 26 damage/s, for 6s, in that lane.',
  necropolis: 'Every 4s, 12 corpse pieces on your half assemble into a free soldier of your age at 50% hp.',
  corpse_wall: 'Settled remains and wreckage physically block enemy shots — and tall burial mounds (12+) stop flat fire for everyone. The dead are fortification.',

  // ── ordnance ──
  ricochet: 'Solid (non-explosive) shots that strike heavy or structure armour at a shallow angle deflect and fly on to hit something else (up to 2 skips, full damage).',
  shrapnel: 'Every explosion throws 5–14 real fragments, each dealing 16% of the blast as pierce damage where it lands.',
  incendiary: 'Blasts of 50px or more leave the ground burning: 40px, 12 damage/s, for 2.6s.',
  overpressure: 'Blasts throw bodies: everything within 1.5× the radius is launched airborne. Knockback impulse ×3.4 — and a hard landing hurts, so the throw is a wound, not an escape.',
  cluster: 'Every lobbed shot splits at the top of its arc into 2 shells at 50% damage, 70% splash.',
  penetrator: 'Your shots pass through the first body they hit at full damage and carry on into the next.',
  torchbearer_doctrine: 'Unlocks the Torchbearer.',
  ashfall: 'Kill-fires (with Incendiary) grow to 60px, 40 damage/s for 5.2s, and SPREAD at 16px/s. Fire burns enemy spores off the ground at 3× speed.',
  demolition: 'Your own soldiers detonate on death: blast radius 40 + height×1.4, damage = their damage ×1.3 + 40, knockback 320.',

  // ── engineering ──
  salvage: 'Wreckage and shell fragments that land on your half are stripped for 12–30 gold apiece.',
  sappers: 'A melee soldier stuck against the front line for 4.2s tunnels under it and surfaces 70px behind the enemy front.',
  nanite_field: 'Vehicles, walkers and aircraft repair 1.2% of max hp per second, always.',
  drone_forge: 'Unlocks the Drone Host.',
  emp: 'Your energy hits shut machines down for 2.6 seconds — no moving, no firing.',
  autoforge: 'A turret destroyed on your fortress rebuilds itself 20 seconds later at half strength, free.',
  aegis: 'Soldiers standing together take less damage: −14% per neighbour within arm’s reach, up to −40% at 3. Breaks instantly when the formation does.',

  // ── occult ──
  blood_pact: 'Units finish building INSTANTLY. Each one takes its build time out of your fortress as hull damage (4.5% of the build ms).',
  soul_tithe: 'Every enemy death anywhere feeds your ability +5% charge.',
  evil_eye: 'When you kill something, every enemy within 130px is slowed to 35% speed for 0.7s.',
  sacrament: 'When one of yours falls, every ally within 170px heals 9% of max hp.',
  hexer_pact: 'Unlocks the Hexer. A hexed unit takes +25% and, while marked, its plating, Aegis sharing, roots and barriers ALL stop working.',
  mind_thrall: '22% of everything you kill stands back up on YOUR side at 40% hp. Fails against armies with Butchery — their dead are in too many pieces.',
  black_sun: 'Enemy fire scatters: their projectile spread ×3.2, on units and turrets alike.',
  ninth_seal: 'Unlocks the Ninth Sign.',

  // ── blight ──
  spore_cloud: 'Your own dead burst into a spore field: 72px, 20 damage/s, for 8s, across all lanes.',
  mycelium: 'Your spore fields and blight blooms creep outward on their own: 10px/s (death-spores) and 7px/s (blooms), up to 260px.',
  verdant_tide: 'Your soldiers standing in your own spores heal 2% of max hp per second.',
  contagion: 'ANYTHING that dies inside your blight bursts into fresh spores (54px, 14 damage/s, 5s) — theirs or yours.',
  rooted: 'A soldier that holds its ground takes up to −35% damage after 4 seconds planted. Moving resets it.',
  sporeling_bloom: 'Unlocks the Sporeling.',
  deep_roots: 'Enemies crossing your blight are dragged to 35% move speed while they stand in it.',
  titan_seed: 'Unlocks the Titan Bloom.',

  // ── lane doctrines ──
  phalanx_doctrine: 'Your phalanx-conduct units deal ×2.4 to flankers (up from ×1.85).',
  death_throes: 'Replaces Man-at-Arms with the persistent Husk slot. Carnage bodies killed with less than their own max hp of overkill stay up for 2s at 2x attack speed; obliterating hits skip the state.',
  iron_line: 'Ranks pressing from behind add +65% damage each (up from +50%, max 4 ranks), and light hits no longer stagger your infantry.',
  plunging_volleys: 'Your ranged units can drop fire two lanes over at 32% damage when nothing closer offers itself.',

  // ── ascensions ──
  ascend_nekrotics: 'Roster becomes the Nekrotics (all ages of them). Every soldier you lose rises again once, at 45% hp, where it fell.',
  ascend_cinder: 'Roster becomes the Cinder Host. Everything you kill leaves fire burning where it fell (60px, 40 damage/s, 5.2s).',
  ascend_cyborgs: 'Roster becomes the Cyborgs. Your whole army repairs 1.2%/s and nothing you field can be EMP-disabled.',
  ascend_circle: 'Roster becomes the Dark Circle. Every kill feeds your ability +5%, and enemy fire scatters ×3.2, permanently.',
  ascend_bloom: 'Roster becomes the Hollow Bloom. Every soldier gains Rooted (−35% damage after 4s planted) and heals 2%/s in your spores.'
}

/**
 * Each creed's identity, shown on its branch nodes: the TWO THREATS it
 * builds, and the counters — none of them stat modifiers, all of them
 * things that physically happen on the field. Answers vary in strength:
 * fire annihilates a corpse economy but only trims a spore one; a hex
 * unmakes a fortress line entirely but does nothing to a swarm.
 */
export const LEAN_RULES: Record<string, string> = {
  carnage:
    'CARNAGE replaces roles instead of adding duplicates. Butchery closes conventional machines; Death Throes begins the persistent Husk line. Predators own mobility and anti-horde work, parasites provide the faction’s narrow ranged pressure, and corpsecraft turns losses into healing, terrain and new bodies. Every broad Carnage buff follows a functional slot into its later evolutions. Counter it by burning or denying remains, breaking its corpse economy, and forcing expensive monsters to fight on clean ground.',
  ordnance:
    'ORDNANCE builds two threats. THE BARRAGE: Shrapnel, Cluster and Overpressure turn every shell into an area — and shells crater the flesh walls down. THE FIRESTORM: Incendiary and Ashfall leave the ground burning and spreading. Its answers: fire consumes settled remains, burns spore fields at triple speed, and SCOURS THE HAUNT out of ground it crosses. Broken by: THE FLESH WALL (flat shots stop; only lobbed fire arcs over), work crews smothering fires, grown gardens (110px+) starving the flames, and Black Sun scattering the guns.',
  engineering:
    'ENGINEERING builds two threats. THE IRON LINE: Aegis formations, plated machines, Nanite repair and rooted positions that simply do not die. THE MACHINE ECONOMY: Salvage, the quarry (which eats enemy flesh walls for gold) and Autoforge. Its answers: crews smother hostile fire and growth on their half, and machines feel no terror and no dread. Broken by: THE HEX (plating, sharing, roots and barriers all stop while marked), swarms mobbing anything expensive, THE DEAD BURYING planted lines, and growth denying the quarry its ground.',
  occult:
    'THE OCCULT builds two threats. THE TITHE: every death feeds the ability; Evil Eye, terror and Black Sun break cohesion — and hostile growth creeping over haunted ground is DRUNK, withering the zone and feeding the dark. THE STOLEN DEAD: Mind Thrall raises a fifth of everything killed, and THE BANISHMENT denies the enemy their dead entirely. Broken by: THE GARDEN (own blight sheds hex, mire and terror at triple speed), FEARLESS STEEL (machines cannot be terrified), Butchery (six pieces hold no strings) and fire scouring the haunt off the ground.',
  blight:
    'BLIGHT builds two threats. THE CREEPING MAP: Spore Cloud, Mycelium and Deep Roots make ground itself hostile — and THE GARDEN EATS THE DEAD, digesting corpses to grow (starving the meat engine as it spreads). THE ROOTED GARDEN: Rooted, Verdant Tide and the cleansing ground itself; a grown garden (110px+) even smothers enemy fires. Its answers: growth denies the quarry its ground. Broken by: FIRE at triple speed, carnage kills scalding the garden back, engineering crews trimming it, and the circle drinking any growth that crosses haunted ground.'
}

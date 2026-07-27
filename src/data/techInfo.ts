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
  butchery: 'Every kill dismembers. Bodies always come apart into usable remains.',
  bonepickers: 'A wounded soldier (below 92% hp) eats one nearby corpse piece every 0.5s, healing 6% of max hp + 8. Consumes the remains.',
  bone_harvest: 'Remains lying on your half pay 0.45 gold/s each (up to 24 at once). The bodies are not consumed.',
  bloodlust: 'Blood-soaked ground grants up to +45% attack and move speed. Gore builds where things die messily.',
  flenser_rite: 'Unlocks the Flenser.',
  plague_wind: 'Every enemy you kill leaves a plague cloud: 70px, 26 damage/s, for 6s, in that lane.',
  necropolis: 'Every 4s, 12 corpse pieces on your half assemble into a free soldier of your age at 50% hp.',
  corpse_wall: 'Settled remains and wreckage physically block enemy shots. Enough dead becomes cover.',

  // ── ordnance ──
  ricochet: 'Solid (non-explosive) shots that strike heavy or structure armour at a shallow angle deflect and fly on to hit something else (up to 2 skips, full damage).',
  shrapnel: 'Every explosion throws 5–14 real fragments, each dealing 16% of the blast as pierce damage where it lands.',
  incendiary: 'Blasts of 50px or more leave the ground burning: 40px, 12 damage/s, for 2.6s.',
  overpressure: 'Blasts throw bodies: everything within 1.5× the radius is launched airborne. Knockback impulse ×3.4.',
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
  hexer_pact: 'Unlocks the Hexer.',
  mind_thrall: '22% of everything you kill stands back up on YOUR side at 40% hp.',
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
  pack_tactics: 'Your flankers switch lanes after 0.55s blocked instead of 1.5s.',
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
 * Each creed's identity, shown on its branch nodes: the MAIN THREAT it
 * builds, the threat it COUNTERS, and the creed that counters IT. The five
 * form a pentagon — build your threat, and if the enemy's threat is the one
 * that eats yours, buy two nodes of the creed that eats theirs as an
 * auxiliary. Two nodes in one branch is a lean; every rule below scales 25%
 * per node and caps at five. Held war banners also carry the lean's
 * signature (rally / spotting / salvage / tithe / feeding).
 */
export const LEAN_RULES: Record<string, string> = {
  carnage:
    'CARNAGE — threat: the meat engine (mounds rise fast, Fury on dead ground up to +28% speed/+18% damage, corpses become soldiers). COUNTERS BLIGHT: your troops take up to −35% from hostile ground zones. WEAK TO ORDNANCE: fire burns your corpse fuel. Held banners rally the garrison (+12% attack rate).',
  ordnance:
    'ORDNANCE — threat: the barrage (deeper craters, +25% explosive damage into bowls, crater-mired enemies). COUNTERS CARNAGE: your fire zones consume settled remains up to 3× faster — no fuel, no meat engine. WEAK TO ENGINEERING: braced plate shrugs blasts. Held banners are spotting posts (+10% reach nearby).',
  engineering:
    'ENGINEERING — threat: the unbreakable line (quarry pays 3g per mass point, props rebuilt, self-repair). COUNTERS ORDNANCE: your units take up to −22% explosive damage. WEAK TO OCCULT: hexes seep through steel. Held gold banners pay +50%.',
  occult:
    'THE OCCULT — threat: the tithe (deaths feed your ability, haunted ground saps enemies up to −12% speed/−15% damage). COUNTERS ENGINEERING: your damage vs heavy and structure armour +22%. WEAK TO BLIGHT: rot does not fear the dark. Every held banner also tithes ability charge.',
  blight:
    'BLIGHT — threat: the creeping map (mounds sprout hostile blooms, blighted ground never settles). COUNTERS THE OCCULT: hostile mire, hex and terror on your troops run 45% shorter. WEAK TO CARNAGE: meat wades through your gardens. Garrisons at held banners feed (+1.2% hp/s).'
}

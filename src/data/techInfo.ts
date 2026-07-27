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
 * What a node does for your creed LEAN, shown for branch nodes. Two nodes in
 * one branch is a lean; the ground rules scale 25% per node from there and
 * cap at five. The rules themselves, per creed:
 */
export const LEAN_RULES: Record<string, string> = {
  carnage: 'Carnage lean: corpses on your half rot into mounds faster and bigger; standing on 4px+ of dead ground grants Fury (up to +28% speed and +18% damage at full lean).',
  ordnance: 'Ordnance lean: your blasts crater the ground deeper; enemies caught in craters are slowed, and your explosive hits on cratered ground deal up to +25%.',
  engineering: 'Engineering lean: work crews quarry your half’s rubble mounds into gold (3g per mass point) and rebuild dead props after 30s.',
  occult: 'Occult lean: bodies falling on your half are consumed — less mound, +2–4% ability charge each, and the ground becomes haunted, sapping enemy speed and damage (up to −12%/−15%).',
  blight: 'Blight lean: your half’s burial mounds sprout hostile spore blooms (up to 48px, 7 damage/s) every 2s, and blighted mounds never settle.'
}

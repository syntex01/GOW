export const WARGEAR: Record<string, WargearCatalogue> = {
  "necron_warriors": {
    extraWeapons: [],
    options: [
      {
        id: "necron_warriors_gauss_weapon", label: "Gauss weapon (per model)", defaultChoiceId: "necron_warriors_gauss_flayer",
        choices: [
        { id: "necron_warriors_gauss_flayer", label: "Gauss Flayer", add: [], remove: [] },
        { id: "necron_warriors_gauss_reaper", label: "Gauss Reaper", add: ["gauss_reaper"], remove: ["gauss_flayer"] },
        ],
      },
    ],
  },
  "necron_overlord": {
    extraWeapons: [
    w(["necron_overlord_overlords_blade", "Overlord's blade", "melee", 0, 4, 2, 8, 3, 2, ["devastatingWounds"]]),
    w(["necron_overlord_voidscythe", "Voidscythe", "melee", 0, 3, 3, 12, 3, 3, ["devastatingWounds"]]),
    ],
    options: [
      {
        id: "necron_overlord_main_weapon", label: "Main weapon", defaultChoiceId: "necron_overlord_main_staff",
        choices: [
        { id: "necron_overlord_main_staff", label: "Staff of light", add: [], remove: [] },
        { id: "necron_overlord_main_blade", label: "Overlord's blade", add: ["necron_overlord_overlords_blade"], remove: ["staff_of_light_ranged", "staff_of_light_melee"] },
        { id: "necron_overlord_main_voidscythe", label: "Voidscythe", add: ["necron_overlord_voidscythe"], remove: ["staff_of_light_ranged", "staff_of_light_melee"] },
        ],
      },
    ],
  },
  "necron_immortals": {
    extraWeapons: [
    w(["necron_immortals_tesla_carbine", "Tesla Carbine", "ranged", 24, 3, 3, 5, 0, 1, ["sustainedHits:2"]]),
    ],
    options: [
      {
        id: "necron_immortals_ranged_weapon", label: "Squad ranged weapon", defaultChoiceId: "necron_immortals_gauss",
        choices: [
        { id: "necron_immortals_gauss", label: "Gauss Blasters", add: [], remove: [] },
        { id: "necron_immortals_tesla", label: "Tesla Carbines", add: ["necron_immortals_tesla_carbine"], remove: ["gauss_blaster"] },
        ],
      },
    ],
  },
  "necron_lychguard": {
    extraWeapons: [
    w(["necron_lychguard_hyperphase_sword", "Hyperphase sword", "melee", 0, 4, 3, 5, 1, 1, []]),
    ],
    options: [
      {
        id: "necron_lychguard_loadout", label: "Melee weapon", defaultChoiceId: "necron_lychguard_loadout_warscythe",
        choices: [
        { id: "necron_lychguard_loadout_warscythe", label: "Warscythe", add: [], remove: [] },
        { id: "necron_lychguard_loadout_sword_shield", label: "Hyperphase sword & dispersion shield", add: ["necron_lychguard_hyperphase_sword"], remove: ["warscythe"] },
        ],
      },
    ],
  },
  "necron_skorpekh_destroyers": {
    extraWeapons: [
    w(["necron_skorpekh_destroyers_reap_blade", "Hyperphase reap-blade", "melee", 0, 3, 3, 8, 3, 3, []]),
    ],
    options: [
      {
        id: "necron_skorpekh_destroyers_hyperphase", label: "Hyperphase weapon (per 3 models, 1 may swap)", defaultChoiceId: "necron_skorpekh_destroyers_hyperphase_stock",
        choices: [
        { id: "necron_skorpekh_destroyers_hyperphase_stock", label: "Hyperphase threshers (default)", add: [], remove: [] },
        { id: "necron_skorpekh_destroyers_hyperphase_reap", label: "1 Skorpekh Destroyer with hyperphase reap-blade", add: ["necron_skorpekh_destroyers_reap_blade"], remove: ["skorpekh_hyperphase"] },
        ],
      },
    ],
  },
  "necron_wraiths": {
    extraWeapons: [
    w(["necron_wraiths_transdimensional_beamer", "Transdimensional Beamer", "ranged", 10, 1, 4, 4, 4, "D3", []]),
    ],
    options: [
      {
        id: "necron_wraiths_ranged", label: "Model ranged weapon", defaultChoiceId: "necron_wraiths_ranged_default",
        choices: [
        { id: "necron_wraiths_ranged_default", label: "Particle Caster", add: [], remove: [] },
        { id: "necron_wraiths_ranged_beamer", label: "Transdimensional Beamer", add: ["necron_wraiths_transdimensional_beamer"], remove: ["particle_caster"] },
        ],
      },
    ],
  },
  "ultramarines_intercessors": {
    extraWeapons: [
    w(["ultramarines_intercessors_astartes_chainsword", "Astartes Chainsword", "melee", 0, 5, 3, 4, 1, 1, []]),
    w(["ultramarines_intercessors_power_weapon", "Power Weapon", "melee", 0, 4, 3, 5, 2, 1, []]),
    w(["ultramarines_intercessors_power_fist", "Power Fist", "melee", 0, 3, 3, 8, 2, 2, []]),
    w(["ultramarines_intercessors_thunder_hammer", "Thunder Hammer", "melee", 0, 3, 4, 8, 2, 2, ["devastatingWounds"]]),
    w(["ultramarines_intercessors_hand_flamer", "Hand Flamer", "ranged", 12, "D6", 0, 3, 0, 1, ["pistol", "torrent", "ignoresCover"]]),
    w(["ultramarines_intercessors_plasma_pistol", "Plasma Pistol", "ranged", 12, 1, 3, 7, 2, 1, ["pistol"]]),
    w(["ultramarines_intercessors_grenade_launcher_frag", "Astartes Grenade Launcher (Frag)", "ranged", 24, "D3", 3, 4, 0, 1, ["blast"]]),
    w(["ultramarines_intercessors_grenade_launcher_krak", "Astartes Grenade Launcher (Krak)", "ranged", 24, 1, 3, 9, 2, "D3", []]),
    ],
    options: [
      {
        id: "sgt_bolt_rifle_swap", label: "Sergeant: bolt rifle replacement", defaultChoiceId: "sgt_ranged_stock",
        choices: [
        { id: "sgt_ranged_stock", label: "Bolt Rifle (default)", add: [], remove: [] },
        { id: "sgt_ranged_chainsword", label: "Astartes Chainsword", add: ["ultramarines_intercessors_astartes_chainsword"], remove: ["bolt_rifle"] },
        { id: "sgt_ranged_hand_flamer", label: "Hand Flamer", add: ["ultramarines_intercessors_hand_flamer"], remove: ["bolt_rifle"] },
        { id: "sgt_ranged_plasma_pistol", label: "Plasma Pistol", add: ["ultramarines_intercessors_plasma_pistol"], remove: ["bolt_rifle"] },
        { id: "sgt_ranged_power_weapon", label: "Power Weapon", add: ["ultramarines_intercessors_power_weapon"], remove: ["bolt_rifle"] },
        ],
      },
      {
        id: "sgt_ccw_swap", label: "Sergeant: close combat weapon replacement", defaultChoiceId: "sgt_melee_stock",
        choices: [
        { id: "sgt_melee_stock", label: "Close Combat Weapon (default)", add: [], remove: [] },
        { id: "sgt_melee_chainsword", label: "Astartes Chainsword", add: ["ultramarines_intercessors_astartes_chainsword"], remove: ["intercessor_ccw"] },
        { id: "sgt_melee_power_fist", label: "Power Fist", add: ["ultramarines_intercessors_power_fist"], remove: ["intercessor_ccw"] },
        { id: "sgt_melee_power_weapon", label: "Power Weapon", add: ["ultramarines_intercessors_power_weapon"], remove: ["intercessor_ccw"] },
        { id: "sgt_melee_thunder_hammer", label: "Thunder Hammer", add: ["ultramarines_intercessors_thunder_hammer"], remove: ["intercessor_ccw"] },
        ],
      },
      {
        id: "squad_grenade_launcher", label: "Squad: Astartes grenade launcher (1 per 5 models)", defaultChoiceId: "gl_none",
        choices: [
        { id: "gl_none", label: "No grenade launcher (default)", add: [], remove: [] },
        { id: "gl_equip", label: "1 Astartes Grenade Launcher", add: ["ultramarines_intercessors_grenade_launcher_frag", "ultramarines_intercessors_grenade_launcher_krak"], remove: ["bolt_rifle"] },
        ],
      },
    ],
  },
  "ultramarines_captain": {
    extraWeapons: [
    w(["ultramarines_captain_bolt_pistol", "Bolt Pistol", "ranged", 12, 1, 2, 4, 0, 1, ["pistol"]]),
    w(["ultramarines_captain_power_fist", "Power Fist", "melee", 0, 5, 2, 8, 2, 2, []]),
    ],
    options: [
      {
        id: "ultramarines_captain_pistol", label: "Pistol", defaultChoiceId: "ultramarines_captain_pistol_plasma",
        choices: [
        { id: "ultramarines_captain_pistol_plasma", label: "Plasma pistol", add: [], remove: [] },
        { id: "ultramarines_captain_pistol_bolt", label: "Bolt pistol", add: ["ultramarines_captain_bolt_pistol"], remove: ["captain_plasma_pistol"] },
        ],
      },
      {
        id: "ultramarines_captain_melee", label: "Melee weapon", defaultChoiceId: "ultramarines_captain_melee_power_weapon",
        choices: [
        { id: "ultramarines_captain_melee_power_weapon", label: "Master-crafted power weapon", add: [], remove: [] },
        { id: "ultramarines_captain_melee_power_fist", label: "Power fist", add: ["ultramarines_captain_power_fist"], remove: ["captain_power_weapon"] },
        ],
      },
    ],
  },
  "ultramarines_assault_intercessors": {
    extraWeapons: [
    w(["ultramarines_assault_intercessors_hand_flamer", "Hand Flamer", "ranged", 12, "D6", 0, 3, 0, 1, ["pistol", "torrent", "ignoresCover"]]),
    w(["ultramarines_assault_intercessors_plasma_pistol", "Plasma Pistol", "ranged", 12, 1, 3, 7, 2, 1, ["pistol"]]),
    w(["ultramarines_assault_intercessors_power_fist", "Power Fist", "melee", 0, 3, 3, 8, 2, 2, []]),
    w(["ultramarines_assault_intercessors_power_weapon", "Power Weapon", "melee", 0, 5, 3, 5, 2, 1, []]),
    ],
    options: [
      {
        id: "ultramarines_assault_intercessors_sergeant_pistol", label: "Sergeant pistol", defaultChoiceId: "sgt_pistol_default",
        choices: [
        { id: "sgt_pistol_default", label: "Heavy Bolt Pistol (default)", add: [], remove: [] },
        { id: "sgt_pistol_hand_flamer", label: "Hand Flamer", add: ["ultramarines_assault_intercessors_hand_flamer"], remove: ["heavy_bolt_pistol"] },
        { id: "sgt_pistol_plasma", label: "Plasma Pistol", add: ["ultramarines_assault_intercessors_plasma_pistol"], remove: ["heavy_bolt_pistol"] },
        ],
      },
      {
        id: "ultramarines_assault_intercessors_sergeant_melee", label: "Sergeant melee weapon", defaultChoiceId: "sgt_melee_default",
        choices: [
        { id: "sgt_melee_default", label: "Astartes Chainsword (default)", add: [], remove: [] },
        { id: "sgt_melee_power_fist", label: "Power Fist", add: ["ultramarines_assault_intercessors_power_fist"], remove: ["astartes_chainsword"] },
        { id: "sgt_melee_power_weapon", label: "Power Weapon", add: ["ultramarines_assault_intercessors_power_weapon"], remove: ["astartes_chainsword"] },
        ],
      },
    ],
  },
  "ultramarines_terminators": {
    extraWeapons: [
    w(["ultramarines_terminators_assault_cannon", "Assault Cannon", "ranged", 24, 6, 3, 6, 0, 1, ["devastatingWounds"]]),
    w(["ultramarines_terminators_heavy_flamer", "Heavy Flamer", "ranged", 12, "D6", 0, 5, 1, 1, ["torrent", "ignoresCover"]]),
    w(["ultramarines_terminators_cyclone_frag", "Cyclone Missile Launcher - frag", "ranged", 36, "2D6", 3, 4, 0, 1, ["blast"]]),
    w(["ultramarines_terminators_cyclone_krak", "Cyclone Missile Launcher - krak", "ranged", 36, 2, 3, 9, 2, "D6", []]),
    ],
    options: [
      {
        id: "ultramarines_terminators_special_weapon", label: "Squad special/heavy weapon (1 per 5 models)", defaultChoiceId: "ultramarines_terminators_special_none",
        choices: [
        { id: "ultramarines_terminators_special_none", label: "Storm Bolter (default)", add: [], remove: [] },
        { id: "ultramarines_terminators_special_assault_cannon", label: "Assault Cannon", add: ["ultramarines_terminators_assault_cannon"], remove: ["storm_bolter"] },
        { id: "ultramarines_terminators_special_heavy_flamer", label: "Heavy Flamer", add: ["ultramarines_terminators_heavy_flamer"], remove: ["storm_bolter"] },
        { id: "ultramarines_terminators_special_cyclone", label: "Cyclone Missile Launcher (keeps storm bolter)", add: ["ultramarines_terminators_cyclone_frag", "ultramarines_terminators_cyclone_krak"], remove: [] },
        ],
      },
    ],
  },
  "ultramarines_redemptor": {
    extraWeapons: [],
    options: [
      {
        id: "ultramarines_redemptor_primary_weapon", label: "Primary weapon", defaultChoiceId: "ultramarines_redemptor_primary_mpi",
        choices: [
        { id: "ultramarines_redemptor_primary_mpi", label: "Macro Plasma Incinerator", add: [], remove: ["heavy_onslaught_gatling"] },
        { id: "ultramarines_redemptor_primary_gatling", label: "Heavy Onslaught Gatling Cannon", add: [], remove: ["macro_plasma_incinerator"] },
        ],
      },
    ],
  },
  "ultramarines_bladeguard": {
    extraWeapons: [
    w(["ultramarines_bladeguard_neovolkite_pistol", "Neo-volkite Pistol", "ranged", 10, 2, 3, 5, 0, 2, ["pistol", "devastatingWounds"]]),
    w(["ultramarines_bladeguard_plasma_pistol_standard", "Plasma Pistol - standard", "ranged", 12, 1, 3, 7, 2, 1, ["pistol"]]),
    w(["ultramarines_bladeguard_plasma_pistol_supercharge", "Plasma Pistol - supercharge", "ranged", 12, 1, 3, 8, 3, 2, ["pistol", "hazardous"]]),
    ],
    options: [
      {
        id: "ultramarines_bladeguard_sergeant_pistol", label: "Sergeant's pistol", defaultChoiceId: "ultramarines_bladeguard_sergeant_pistol_default",
        choices: [
        { id: "ultramarines_bladeguard_sergeant_pistol_default", label: "Heavy Bolt Pistol (default)", add: [], remove: [] },
        { id: "ultramarines_bladeguard_sergeant_pistol_neovolkite", label: "Neo-volkite Pistol", add: ["ultramarines_bladeguard_neovolkite_pistol"], remove: ["bladeguard_heavy_bolt_pistol"] },
        { id: "ultramarines_bladeguard_sergeant_pistol_plasma", label: "Plasma Pistol", add: ["ultramarines_bladeguard_plasma_pistol_standard", "ultramarines_bladeguard_plasma_pistol_supercharge"], remove: ["bladeguard_heavy_bolt_pistol"] },
        ],
      },
    ],
  },
  "ultramarines_lieutenant": {
    extraWeapons: [
    w(["ultramarines_lieutenant_bolt_pistol", "Bolt pistol", "ranged", 12, 1, 2, 4, 0, 1, ["pistol"]]),
    w(["ultramarines_lieutenant_plasma_pistol", "Plasma pistol", "ranged", 12, 1, 2, 7, 2, 1, ["pistol"]]),
    w(["ultramarines_lieutenant_ccw", "Close combat weapon", "melee", 0, 5, 2, 4, 0, 1, []]),
    ],
    options: [
      {
        id: "ultramarines_lieutenant_ranged", label: "Ranged weapon", defaultChoiceId: "ultramarines_lieutenant_ranged_default",
        choices: [
        { id: "ultramarines_lieutenant_ranged_default", label: "Master-crafted bolter", add: [], remove: [] },
        { id: "ultramarines_lieutenant_ranged_boltpistol", label: "Bolt pistol", add: ["ultramarines_lieutenant_bolt_pistol"], remove: ["lieutenant_mc_bolter"] },
        { id: "ultramarines_lieutenant_ranged_plasmapistol", label: "Plasma pistol", add: ["ultramarines_lieutenant_plasma_pistol"], remove: ["lieutenant_mc_bolter"] },
        ],
      },
      {
        id: "ultramarines_lieutenant_melee", label: "Melee weapon", defaultChoiceId: "ultramarines_lieutenant_melee_default",
        choices: [
        { id: "ultramarines_lieutenant_melee_default", label: "Master-crafted power weapon", add: [], remove: [] },
        { id: "ultramarines_lieutenant_melee_ccw", label: "Close combat weapon", add: ["ultramarines_lieutenant_ccw"], remove: ["lieutenant_power_weapon"] },
        ],
      },
    ],
  },
  "ultramarines_eradicators": {
    extraWeapons: [
    w(["ultramarines_eradicators_multi_melta", "Multi-melta", "ranged", 18, 2, 4, 9, 4, "D6", ["heavy", "melta:2"]]),
    ],
    options: [
      {
        id: "ultramarines_eradicators_heavy_weapon", label: "Heavy weapon (per 3 models)", defaultChoiceId: "ultramarines_eradicators_hw_default",
        choices: [
        { id: "ultramarines_eradicators_hw_default", label: "Melta rifle (default)", add: [], remove: [] },
        { id: "ultramarines_eradicators_hw_multimelta", label: "Replace melta rifle with multi-melta", add: ["ultramarines_eradicators_multi_melta"], remove: ["melta_rifle"] },
        ],
      },
    ],
  },
  "ultra_aggressors": {
    extraWeapons: [
    w(["ultra_aggressors_flamestorm_gauntlets", "Flamestorm Gauntlets", "ranged", 12, "D6", 0, 4, 0, 1, ["torrent", "twinLinked"]]),
    ],
    options: [
      {
        id: "ultra_aggressors_gauntlets", label: "Gauntlet Armament", defaultChoiceId: "ultra_aggressors_gauntlets_boltstorm",
        choices: [
        { id: "ultra_aggressors_gauntlets_boltstorm", label: "Boltstorm gauntlets", add: [], remove: [] },
        { id: "ultra_aggressors_gauntlets_flamestorm", label: "Flamestorm gauntlets", add: ["ultra_aggressors_flamestorm_gauntlets"], remove: ["boltstorm_gauntlets"] },
        ],
      },
    ],
  },
  "ultra_inceptors": {
    extraWeapons: [
    w(["ultra_inceptors_plasma_exterminator_std", "Plasma Exterminators – Standard", "ranged", 18, 3, 3, 7, 2, 1, []]),
    w(["ultra_inceptors_plasma_exterminator_super", "Plasma Exterminators – Supercharge", "ranged", 18, 3, 3, 8, 3, 2, ["hazardous"]]),
    ],
    options: [
      {
        id: "ultra_inceptors_main_weapon", label: "Inceptor ranged weapons", defaultChoiceId: "ultra_inceptors_assault_bolters",
        choices: [
        { id: "ultra_inceptors_assault_bolters", label: "Assault Bolters (default)", add: [], remove: [] },
        { id: "ultra_inceptors_plasma", label: "Plasma Exterminators", add: ["ultra_inceptors_plasma_exterminator_std", "ultra_inceptors_plasma_exterminator_super"], remove: ["assault_bolters"] },
        ],
      },
    ],
  },
  "ork_boyz": {
    extraWeapons: [
    w(["ork_boyz_big_shoota", "Big Shoota", "ranged", 36, 3, 5, 5, 0, 1, []]),
    w(["ork_boyz_rokkit_launcha", "Rokkit Launcha", "ranged", 24, 1, 5, 9, 2, 3, []]),
    w(["ork_boyz_power_klaw", "Power Klaw", "melee", 0, 3, 3, 9, 2, 2, []]),
    w(["ork_boyz_big_choppa", "Big Choppa", "melee", 0, 3, 3, 7, 1, 2, []]),
    w(["ork_boyz_kombi_weapon", "Kombi-weapon", "ranged", 24, 1, 5, 4, 0, 1, ["rapidFire:1", "anti:INFANTRY:4", "devastatingWounds"]]),
    ],
    options: [
      {
        id: "ork_boyz_special_weapon", label: "Squad special weapon (per 10 models, up to 2 Boyz)", defaultChoiceId: "ork_boyz_special_default",
        choices: [
        { id: "ork_boyz_special_default", label: "Slugga & Choppa (default)", add: [], remove: [] },
        { id: "ork_boyz_special_big_shoota", label: "Big Shoota", add: ["ork_boyz_big_shoota"], remove: ["slugga", "choppa"] },
        { id: "ork_boyz_special_rokkit", label: "Rokkit Launcha", add: ["ork_boyz_rokkit_launcha"], remove: ["slugga", "choppa"] },
        ],
      },
      {
        id: "ork_boyz_boss_nob_melee", label: "Boss Nob melee weapon", defaultChoiceId: "ork_boyz_boss_melee_default",
        choices: [
        { id: "ork_boyz_boss_melee_default", label: "Choppa (default)", add: [], remove: [] },
        { id: "ork_boyz_boss_power_klaw", label: "Power Klaw", add: ["ork_boyz_power_klaw"], remove: ["choppa"] },
        { id: "ork_boyz_boss_big_choppa", label: "Big Choppa", add: ["ork_boyz_big_choppa"], remove: ["choppa"] },
        ],
      },
      {
        id: "ork_boyz_boss_nob_ranged", label: "Boss Nob ranged weapon", defaultChoiceId: "ork_boyz_boss_ranged_default",
        choices: [
        { id: "ork_boyz_boss_ranged_default", label: "Slugga (default)", add: [], remove: [] },
        { id: "ork_boyz_boss_kombi", label: "Kombi-weapon", add: ["ork_boyz_kombi_weapon"], remove: ["slugga"] },
        ],
      },
    ],
  },
  "ork_nobz": {
    extraWeapons: [
    w(["ork_nobz_kombi_weapon", "Kombi-weapon", "ranged", 24, 1, 5, 4, 0, 1, ["rapidFire:1", "anti:INFANTRY:4", "devastatingWounds"]]),
    w(["ork_nobz_power_klaw", "Power Klaw", "melee", 0, 3, 4, 9, 2, 2, []]),
    ],
    options: [
      {
        id: "ork_nobz_ranged", label: "Nob ranged weapon", defaultChoiceId: "ork_nobz_ranged_slugga",
        choices: [
        { id: "ork_nobz_ranged_slugga", label: "Slugga", add: [], remove: [] },
        { id: "ork_nobz_ranged_kombi", label: "Kombi-weapon", add: ["ork_nobz_kombi_weapon"], remove: ["nob_slugga"] },
        ],
      },
      {
        id: "ork_nobz_melee", label: "Nob melee weapon", defaultChoiceId: "ork_nobz_melee_bigchoppa",
        choices: [
        { id: "ork_nobz_melee_bigchoppa", label: "Big Choppa", add: [], remove: [] },
        { id: "ork_nobz_melee_klaw", label: "Power Klaw", add: ["ork_nobz_power_klaw"], remove: ["big_choppa"] },
        ],
      },
    ],
  },
  "ork_trukk": {
    extraWeapons: [
    w(["ork_trukk_wreckin_ball", "Wreckin' Ball", "melee", 0, 6, 4, 9, 1, 2, []]),
    ],
    options: [
      {
        id: "ork_trukk_wreckin_ball_opt", label: "Wreckin' Ball", defaultChoiceId: "ork_trukk_wreckin_ball_none",
        choices: [
        { id: "ork_trukk_wreckin_ball_none", label: "No wreckin' ball (stock)", add: [], remove: [] },
        { id: "ork_trukk_wreckin_ball_add", label: "Add wreckin' ball", add: ["ork_trukk_wreckin_ball"], remove: [] },
        ],
      },
    ],
  },
  "ork_meganobz": {
    extraWeapons: [
    w(["ork_meganobz_killsaw", "Killsaw", "melee", 0, 4, 3, 9, 4, 2, []]),
    ],
    options: [
      {
        id: "ork_meganobz_melee", label: "Meganob melee weapon", defaultChoiceId: "ork_meganobz_melee_klaw",
        choices: [
        { id: "ork_meganobz_melee_klaw", label: "Power klaw", add: [], remove: [] },
        { id: "ork_meganobz_melee_killsaw", label: "2 Killsaws", add: ["ork_meganobz_killsaw"], remove: ["mega_klaw"] },
        ],
      },
    ],
  },
  "ork_killakans": {
    extraWeapons: [
    w(["ork_killakans_grotzooka", "Grotzooka", "ranged", 18, "D6", 5, 6, 0, 1, ["blast"]]),
    w(["ork_killakans_kmb", "Kustom Mega Blasta", "ranged", 24, 2, 5, 8, 3, 2, ["hazardous"]]),
    w(["ork_killakans_rokkit_launcha", "Rokkit Launcha", "ranged", 24, 1, 5, 9, 2, 3, []]),
    w(["ork_killakans_skorcha", "Skorcha", "ranged", 12, "D6", 0, 5, 1, 1, ["torrent", "ignoresCover"]]),
    ],
    options: [
      {
        id: "ork_killakans_ranged_weapon", label: "Ranged weapon", defaultChoiceId: "kk_opt_big_shoota",
        choices: [
        { id: "kk_opt_big_shoota", label: "Big Shoota (default)", add: [], remove: [] },
        { id: "kk_opt_grotzooka", label: "Grotzooka", add: ["ork_killakans_grotzooka"], remove: ["kk_big_shoota"] },
        { id: "kk_opt_kmb", label: "Kustom Mega Blasta", add: ["ork_killakans_kmb"], remove: ["kk_big_shoota"] },
        { id: "kk_opt_rokkit", label: "Rokkit Launcha", add: ["ork_killakans_rokkit_launcha"], remove: ["kk_big_shoota"] },
        { id: "kk_opt_skorcha", label: "Skorcha", add: ["ork_killakans_skorcha"], remove: ["kk_big_shoota"] },
        ],
      },
    ],
  },
  "chaos_legionaries": {
    extraWeapons: [
    w(["chaos_legionaries_plasma_pistol", "Plasma Pistol (Supercharge)", "ranged", 12, 1, 3, 8, 3, 2, ["pistol", "hazardous"]]),
    w(["chaos_legionaries_combi_weapon", "Combi-weapon", "ranged", 24, 1, 3, 4, 0, 1, ["anti:INFANTRY:4", "devastatingWounds", "rapidFire:1"]]),
    w(["chaos_legionaries_accursed_weapon", "Accursed Weapon", "melee", 0, 5, 3, 5, 2, 2, []]),
    w(["chaos_legionaries_power_fist", "Power Fist", "melee", 0, 3, 3, 8, 2, 2, []]),
    w(["chaos_legionaries_flamer", "Flamer", "ranged", 12, "D6", 0, 4, 0, 1, ["torrent"]]),
    w(["chaos_legionaries_meltagun", "Meltagun", "ranged", 12, 1, 3, 9, 4, "D6", ["melta:2"]]),
    w(["chaos_legionaries_plasma_gun", "Plasma Gun (Supercharge)", "ranged", 24, 1, 3, 8, 3, 2, ["rapidFire:1", "hazardous"]]),
    w(["chaos_legionaries_autocannon", "Autocannon", "ranged", 48, 2, 3, 9, 1, 3, []]),
    w(["chaos_legionaries_lascannon", "Lascannon", "ranged", 48, 1, 3, 12, 3, "D6+1", []]),
    w(["chaos_legionaries_missile_launcher", "Missile Launcher (Krak)", "ranged", 48, 1, 3, 9, 2, "D6", []]),
    w(["chaos_legionaries_reaper_chaincannon", "Reaper Chaincannon", "ranged", 24, 6, 3, 5, 1, 1, ["rapidFire:3", "sustainedHits:1"]]),
    ],
    options: [
      {
        id: "chaos_legionaries_opt_champ_melee", label: "Aspiring Champion melee weapon", defaultChoiceId: "chaos_legionaries_champ_melee_chainsword",
        choices: [
        { id: "chaos_legionaries_champ_melee_chainsword", label: "Astartes chainsword (default)", add: [], remove: [] },
        { id: "chaos_legionaries_champ_melee_accursed", label: "Accursed weapon", add: ["chaos_legionaries_accursed_weapon"], remove: ["csm_chainsword"] },
        { id: "chaos_legionaries_champ_melee_fist", label: "Power fist", add: ["chaos_legionaries_power_fist"], remove: ["csm_chainsword"] },
        ],
      },
      {
        id: "chaos_legionaries_opt_champ_ranged", label: "Aspiring Champion ranged weapon", defaultChoiceId: "chaos_legionaries_champ_ranged_boltgun",
        choices: [
        { id: "chaos_legionaries_champ_ranged_boltgun", label: "Boltgun (default)", add: [], remove: [] },
        { id: "chaos_legionaries_champ_ranged_plasma_pistol", label: "Plasma pistol", add: ["chaos_legionaries_plasma_pistol"], remove: ["csm_boltgun"] },
        { id: "chaos_legionaries_champ_ranged_combi", label: "Combi-weapon", add: ["chaos_legionaries_combi_weapon"], remove: ["csm_boltgun"] },
        ],
      },
      {
        id: "chaos_legionaries_opt_squad_weapon", label: "Legionary special/heavy weapon (1 model per 5)", defaultChoiceId: "chaos_legionaries_squad_boltgun",
        choices: [
        { id: "chaos_legionaries_squad_boltgun", label: "Boltgun (default)", add: [], remove: [] },
        { id: "chaos_legionaries_squad_flamer", label: "Flamer", add: ["chaos_legionaries_flamer"], remove: ["csm_boltgun"] },
        { id: "chaos_legionaries_squad_meltagun", label: "Meltagun", add: ["chaos_legionaries_meltagun"], remove: ["csm_boltgun"] },
        { id: "chaos_legionaries_squad_plasma_gun", label: "Plasma gun", add: ["chaos_legionaries_plasma_gun"], remove: ["csm_boltgun"] },
        { id: "chaos_legionaries_squad_autocannon", label: "Autocannon", add: ["chaos_legionaries_autocannon"], remove: ["csm_boltgun"] },
        { id: "chaos_legionaries_squad_lascannon", label: "Lascannon", add: ["chaos_legionaries_lascannon"], remove: ["csm_boltgun"] },
        { id: "chaos_legionaries_squad_missile", label: "Missile launcher", add: ["chaos_legionaries_missile_launcher"], remove: ["csm_boltgun"] },
        { id: "chaos_legionaries_squad_reaper", label: "Reaper chaincannon", add: ["chaos_legionaries_reaper_chaincannon"], remove: ["csm_boltgun"] },
        ],
      },
    ],
  },
  "chaos_chosen": {
    extraWeapons: [
    w(["chaos_chosen_combi_weapon", "Combi-weapon", "ranged", 24, 1, 4, 4, 0, 1, ["rapidFire:1", "anti:INFANTRY:4", "devastatingWounds"]]),
    w(["chaos_chosen_plasma_pistol", "Plasma Pistol", "ranged", 12, 1, 3, 7, 2, 1, ["pistol"]]),
    w(["chaos_chosen_power_fist", "Power Fist", "melee", 0, 4, 3, 8, 2, 2, []]),
    ],
    options: [
      {
        id: "chaos_chosen_ranged_special", label: "Ranged special weapon (up to 2 per 5 models)", defaultChoiceId: "chaos_chosen_ranged_default",
        choices: [
        { id: "chaos_chosen_ranged_default", label: "Boltgun (stock)", add: [], remove: [] },
        { id: "chaos_chosen_ranged_combi", label: "Combi-weapon", add: ["chaos_chosen_combi_weapon"], remove: ["chosen_boltgun"] },
        { id: "chaos_chosen_ranged_plasma", label: "Plasma pistol", add: ["chaos_chosen_plasma_pistol"], remove: [] },
        ],
      },
      {
        id: "chaos_chosen_melee_upgrade", label: "Melee weapon (1 model per 5 may take a power fist)", defaultChoiceId: "chaos_chosen_melee_default",
        choices: [
        { id: "chaos_chosen_melee_default", label: "Paired accursed weapons (stock)", add: [], remove: [] },
        { id: "chaos_chosen_melee_powerfist", label: "Power fist", add: ["chaos_chosen_power_fist"], remove: ["paired_accursed_weapons"] },
        ],
      },
    ],
  },
  "chaos_lord": {
    extraWeapons: [
    w(["chaos_lord_bolt_pistol", "Bolt Pistol", "ranged", 12, 1, 2, 4, 0, 1, ["pistol"]]),
    w(["chaos_lord_accursed_weapon", "Accursed Weapon", "melee", 0, 6, 2, 6, 2, 2, []]),
    ],
    options: [
      {
        id: "chaos_lord_pistol", label: "Pistol", defaultChoiceId: "chaos_lord_pistol_plasma",
        choices: [
        { id: "chaos_lord_pistol_plasma", label: "Plasma pistol", add: [], remove: [] },
        { id: "chaos_lord_pistol_bolt", label: "Bolt pistol", add: ["chaos_lord_bolt_pistol"], remove: ["lord_plasma_pistol"] },
        ],
      },
      {
        id: "chaos_lord_melee", label: "Melee weapon", defaultChoiceId: "chaos_lord_melee_hammer",
        choices: [
        { id: "chaos_lord_melee_hammer", label: "Daemon hammer", add: [], remove: [] },
        { id: "chaos_lord_melee_accursed", label: "Accursed weapon", add: ["chaos_lord_accursed_weapon"], remove: ["lord_daemon_hammer"] },
        ],
      },
    ],
  },
  "chaos_raptors": {
    extraWeapons: [
    w(["chaos_raptors_plasma_pistol", "Plasma Pistol", "ranged", 12, 1, 3, 7, 2, 1, ["pistol"]]),
    w(["chaos_raptors_power_fist", "Power Fist", "melee", 0, 3, 3, 8, 2, 2, []]),
    w(["chaos_raptors_flamer", "Flamer", "ranged", 12, "D6", 0, 4, 0, 1, ["torrent"]]),
    w(["chaos_raptors_meltagun", "Meltagun", "ranged", 12, 1, 3, 9, 4, "D6", ["melta:2"]]),
    w(["chaos_raptors_plasma_gun", "Plasma Gun", "ranged", 24, 1, 3, 7, 2, 1, ["rapidFire:1"]]),
    ],
    options: [
      {
        id: "chaos_raptors_champ_pistol", label: "Raptor Champion pistol", defaultChoiceId: "chaos_raptors_champ_pistol_stock",
        choices: [
        { id: "chaos_raptors_champ_pistol_stock", label: "Bolt Pistol", add: [], remove: [] },
        { id: "chaos_raptors_champ_pistol_plasma", label: "Plasma Pistol", add: ["chaos_raptors_plasma_pistol"], remove: ["raptor_bolt_pistol"] },
        ],
      },
      {
        id: "chaos_raptors_champ_melee", label: "Raptor Champion melee weapon", defaultChoiceId: "chaos_raptors_champ_melee_stock",
        choices: [
        { id: "chaos_raptors_champ_melee_stock", label: "Astartes Chainsword", add: [], remove: [] },
        { id: "chaos_raptors_champ_melee_fist", label: "Power Fist", add: ["chaos_raptors_power_fist"], remove: ["raptor_chainsword"] },
        ],
      },
      {
        id: "chaos_raptors_special", label: "Raptor special weapon (up to 2 per 5 models)", defaultChoiceId: "chaos_raptors_special_stock",
        choices: [
        { id: "chaos_raptors_special_stock", label: "Bolt Pistol (default)", add: [], remove: [] },
        { id: "chaos_raptors_special_flamer", label: "Flamer", add: ["chaos_raptors_flamer"], remove: ["raptor_bolt_pistol"] },
        { id: "chaos_raptors_special_melta", label: "Meltagun", add: ["chaos_raptors_meltagun"], remove: ["raptor_bolt_pistol"] },
        { id: "chaos_raptors_special_plasma", label: "Plasma Gun", add: ["chaos_raptors_plasma_gun"], remove: ["raptor_bolt_pistol"] },
        ],
      },
    ],
  },
  "chaos_helbrute": {
    extraWeapons: [
    w(["chaos_helbrute_plasma_cannon", "Helbrute plasma cannon", "ranged", 36, "D3", 3, 8, 3, 3, ["blast", "hazardous"]]),
    w(["chaos_helbrute_twin_autocannon", "Twin autocannon", "ranged", 48, 2, 3, 9, 1, 3, ["twinLinked"]]),
    w(["chaos_helbrute_twin_heavy_bolter", "Twin heavy bolter", "ranged", 36, 3, 3, 5, 1, 2, ["sustainedHits:1", "twinLinked"]]),
    w(["chaos_helbrute_twin_lascannon", "Twin lascannon", "ranged", 48, 1, 3, 12, 3, "D6+1", ["twinLinked"]]),
    w(["chaos_helbrute_missile_launcher_frag", "Missile launcher - frag", "ranged", 48, "D6", 3, 4, 0, 1, ["blast"]]),
    w(["chaos_helbrute_missile_launcher_krak", "Missile launcher - krak", "ranged", 48, 1, 3, 9, 2, "D6", []]),
    w(["chaos_helbrute_hammer", "Helbrute hammer", "melee", 0, 5, 4, 14, 3, "D6+1", []]),
    w(["chaos_helbrute_power_scourge", "Power scourge", "melee", 0, 8, 3, 7, 1, 2, []]),
    w(["chaos_helbrute_combi_bolter", "Combi-bolter", "ranged", 24, 2, 3, 4, 0, 1, ["rapidFire:2"]]),
    w(["chaos_helbrute_heavy_flamer", "Heavy flamer", "ranged", 12, "D6", 0, 5, 1, 1, ["torrent", "ignoresCover"]]),
    ],
    options: [
      {
        id: "chaos_helbrute_ranged_arm", label: "Ranged arm (replaces multi-melta)", defaultChoiceId: "chaos_helbrute_ranged_multimelta",
        choices: [
        { id: "chaos_helbrute_ranged_multimelta", label: "Multi-melta (default)", add: [], remove: [] },
        { id: "chaos_helbrute_ranged_plasma", label: "Helbrute plasma cannon", add: ["chaos_helbrute_plasma_cannon"], remove: ["helbrute_multimelta"] },
        { id: "chaos_helbrute_ranged_autocannon", label: "Twin autocannon", add: ["chaos_helbrute_twin_autocannon"], remove: ["helbrute_multimelta"] },
        { id: "chaos_helbrute_ranged_heavybolter", label: "Twin heavy bolter", add: ["chaos_helbrute_twin_heavy_bolter"], remove: ["helbrute_multimelta"] },
        { id: "chaos_helbrute_ranged_lascannon", label: "Twin lascannon", add: ["chaos_helbrute_twin_lascannon"], remove: ["helbrute_multimelta"] },
        ],
      },
      {
        id: "chaos_helbrute_second_arm", label: "Second arm (Helbrute fist / missile launcher swap)", defaultChoiceId: "chaos_helbrute_arm_fist",
        choices: [
        { id: "chaos_helbrute_arm_fist", label: "Helbrute fist (default)", add: [], remove: [] },
        { id: "chaos_helbrute_arm_missile", label: "Missile launcher", add: ["chaos_helbrute_missile_launcher_frag", "chaos_helbrute_missile_launcher_krak"], remove: ["helbrute_fist"] },
        { id: "chaos_helbrute_arm_hammer", label: "Helbrute hammer", add: ["chaos_helbrute_hammer"], remove: ["helbrute_fist"] },
        { id: "chaos_helbrute_arm_scourge", label: "Power scourge", add: ["chaos_helbrute_power_scourge"], remove: ["helbrute_fist"] },
        ],
      },
      {
        id: "chaos_helbrute_fist_attachment", label: "Helbrute fist attachment", defaultChoiceId: "chaos_helbrute_attach_none",
        choices: [
        { id: "chaos_helbrute_attach_none", label: "None (default)", add: [], remove: [] },
        { id: "chaos_helbrute_attach_combi", label: "Combi-bolter", add: ["chaos_helbrute_combi_bolter"], remove: [] },
        { id: "chaos_helbrute_attach_flamer", label: "Heavy flamer", add: ["chaos_helbrute_heavy_flamer"], remove: [] },
        ],
      },
    ],
  },
};

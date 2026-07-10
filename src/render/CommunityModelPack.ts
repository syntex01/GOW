import type { TtsModelAsset, TtsModelPart } from './TtsImport';

/**
 * Curated, exact-name figures from the community-maintained Battleforged TTS
 * catalogue. The project stores URLs/metadata only: no third-party mesh or
 * texture bytes are copied into the repository.
 *
 * The catalogue has collective credits but no per-object licence declarations.
 * Keep this pack for the user's private/local review unless the relevant asset
 * creators grant redistribution permission.
 */

export type CommunityFaction = 'Necrons' | 'Ultramarines' | 'Orks' | 'Chaos Space Marines';

export interface CommunityModelDefinition {
  datasheetId: string;
  datasheetName: string;
  faction: CommunityFaction;
  /** Name shown for the object in the original TTS catalogue. */
  objectName: string;
  asset: TtsModelAsset;
  /** `variant` means the unit is exact but its chapter/loadout differs. */
  match: 'exact' | 'variant';
  note?: string;
}

export const COMMUNITY_MODEL_SOURCE = {
  title: 'Battleforged Workshop Mod Compilation',
  url: 'https://github.com/TTSWarhammer40k/Battleforged-Workshop-Mod-Compilation',
  notice: 'Community TTS catalogue; per-object authors and licences are not declared.',
} as const;

const steam = (path: string): string => `https://images.steamusercontent.com/${path}`;

function one(
  name: string,
  mesh: string,
  diffuse?: string,
  yawDegrees = 0,
  normal?: string,
): TtsModelAsset {
  return {
    name,
    meshUrl: steam(mesh),
    ...(diffuse ? { diffuseUrl: steam(diffuse) } : {}),
    ...(normal ? { normalUrl: steam(normal) } : {}),
    ...(yawDegrees ? { yawDegrees } : {}),
  };
}

function part(mesh: string, diffuse: string): TtsModelPart {
  return { meshUrl: steam(mesh), diffuseUrl: steam(diffuse) };
}

function many(name: string, parts: TtsModelPart[], yawDegrees = 0): TtsModelAsset {
  return { name, parts, ...(yawDegrees ? { yawDegrees } : {}) };
}

export const COMMUNITY_MODEL_PACK: CommunityModelDefinition[] = [
  // Necrons -----------------------------------------------------------------
  {
    datasheetId: 'necron_warriors', datasheetName: 'Necron Warriors', faction: 'Necrons',
    objectName: 'Warrior – Gauss Flayer (modern)', match: 'exact',
    asset: one('Necron Warrior',
      'ugc/1670231910713746592/BDE680D0DBC8E56F5FE67EB0E7EBBB26F10DA6D9/',
      'ugc/1670231910713746901/8E90047EF19B27B13F5AE60DA3888EC624FF033A/', 60),
  },
  {
    datasheetId: 'necron_overlord', datasheetName: 'Necron Overlord', faction: 'Necrons',
    objectName: 'Overlord – Tachyon Arrow/Hyperphase Glaive', match: 'exact',
    asset: one('Necron Overlord',
      'ugc/1344838192470227569/F76178E695178BF01E5A459134F5146BFE02143C/',
      'ugc/1344838049812241307/9E6CE1E57959036974C67C15C35D9219498E028C/', 225),
  },
  {
    datasheetId: 'necron_immortals', datasheetName: 'Immortals', faction: 'Necrons',
    objectName: 'Immortals', match: 'exact',
    asset: one('Necron Immortal',
      'ugc/769491390876519750/3720F351B91299F952014375F01EA85E2CA117ED/',
      'ugc/769491390872546877/D0A9C79BA440DEA3DCC7879076A1DCD455DA5774/'),
  },
  {
    datasheetId: 'necron_lychguard', datasheetName: 'Lychguard', faction: 'Necrons',
    objectName: 'Lychguard sword/shield', match: 'exact',
    asset: one('Lychguard with sword and shield',
      'ugc/1484451058815286257/B88D26A3A8463D7EC8A54CA71127226D9BA6FDEF/',
      'ugc/1484451058815286865/71CFFE33D1DD379F961C9CCBA5584767A05F42E6/', 75),
  },
  {
    datasheetId: 'necron_scarabs', datasheetName: 'Canoptek Scarab Swarms', faction: 'Necrons',
    objectName: 'Canoptek Scarab Swarms', match: 'exact',
    asset: one('Canoptek Scarab Swarm',
      'ugc/80340956997851524/C6A5CA66F73AAC21268C2B9A67C051B292E49FE0/',
      'ugc/787504189454352709/49CB8EAD8763D162049FBBD2B25A8E31D27572F7/'),
  },
  {
    datasheetId: 'necron_skorpekh_destroyers', datasheetName: 'Skorpekh Destroyers', faction: 'Necrons',
    objectName: 'Skorpekh Destroyer – Hyperphase Threshers', match: 'exact',
    asset: one('Skorpekh Destroyer',
      'ugc/1344838384512545406/707B9844E0DD05E02F8ECBFED9B61FB116613F5E/',
      'ugc/1344838384512548926/885510EDD08BBA7C65DBD0806B063254FF6D1674/', 270),
  },
  {
    datasheetId: 'necron_wraiths', datasheetName: 'Canoptek Wraiths', faction: 'Necrons',
    objectName: 'Canoptek Wraith (Transdimensional Beamer)', match: 'exact',
    asset: one('Canoptek Wraith',
      'ugc/779604404004149467/D006A6CEF08752BFA91E2959AE4E98FCC310ACB2/',
      'ugc/949584552270193280/B416DE1AC4ABAD966F2904BC0E1B5E1CE14D39B0/'),
  },
  {
    datasheetId: 'necron_doomsday_ark', datasheetName: 'Doomsday Ark', faction: 'Necrons',
    objectName: 'Ghost Ark chassis', match: 'variant',
    asset: one('Necron Ark chassis',
      'ugc/80340956997822484/39AE104E819CE086033423F73C76761A127A0346/',
      'ugc/945092371199155021/0C4BBDD8CCF45618D42A8CC0C56E443514908D56/'),
    note: 'Closest live community asset: exact Ark chassis, but the Doomsday cannon loadout is absent.',
  },
  {
    datasheetId: 'necron_royal_warden', datasheetName: 'Royal Warden', faction: 'Necrons',
    objectName: 'Royal Warden – Relic Gauss Blaster', match: 'exact',
    asset: one('Royal Warden',
      'ugc/1344838192470578852/DF76B8E0D9087536D804EB9D9DAA135580E6D5AE/',
      'ugc/1344838192470526183/37CEAC233B7641307F46337D1912E04DA1E0563E/', 195),
  },
  {
    datasheetId: 'necron_deathmarks', datasheetName: 'Deathmarks', faction: 'Necrons',
    objectName: 'Deathmark', match: 'exact',
    asset: one('Necron Deathmark',
      'ugc/1484451058820933128/F8F7AE0F88F23D8DFD6663C50CFDBBAFFC399BB5/',
      'ugc/1484451058820933596/C673C15688315018335F917D85F9F21088899D01/', 75),
  },
  {
    datasheetId: 'necron_flayedones', datasheetName: 'Flayed Ones', faction: 'Necrons',
    objectName: 'Flayed Ones', match: 'exact',
    asset: one('Flayed One',
      'ugc/1774952891096878209/17839F0DAA9A14F7D09BFDDF52BD7E4533F6BEBF/',
      'ugc/1774952891096878669/F97E719597A06DD647F1BCAA37A3C99B46EBCBDC/', 61),
  },

  // Ultramarines / Space Marines --------------------------------------------
  {
    datasheetId: 'ultramarines_intercessors', datasheetName: 'Intercessor Squad', faction: 'Ultramarines',
    objectName: 'Primaris Intercessor', match: 'exact',
    asset: one('Primaris Intercessor',
      'ugc/853850382738774982/B36C70F87F048E05B5AB2EB1D3D81B1C47CA1FEE/',
      'ugc/779609027850159533/61B1A4DF7515B198B1011E585C801CB0EE4F58C5/'),
  },
  {
    datasheetId: 'ultramarines_captain', datasheetName: 'Captain', faction: 'Ultramarines',
    objectName: 'Primaris Captain – Power Sword/Auto Bolt Rifle', match: 'exact',
    asset: one('Primaris Captain',
      'ugc/787496483805877114/5F72BC7EE39645D198A513D29791A4EAC1C4A6AF/',
      'ugc/811122628122325417/12EC8F03025D4FA10AC4C2DBC286E1EDD543CC3F/'),
  },
  {
    datasheetId: 'ultramarines_assault_intercessors', datasheetName: 'Assault Intercessor Squad', faction: 'Ultramarines',
    objectName: 'Primaris Assault Intercessor', match: 'exact',
    asset: one('Primaris Assault Intercessor',
      'ugc/1299801906153554514/38FE80DAAFABD2E9D686C0A6A374EDFA3205E24C/',
      'ugc/779609027850159533/61B1A4DF7515B198B1011E585C801CB0EE4F58C5/'),
  },
  {
    datasheetId: 'ultramarines_terminators', datasheetName: 'Terminator Squad', faction: 'Ultramarines',
    objectName: 'Terminator – Power Fist/Storm Bolter', match: 'exact',
    asset: one('Space Marine Terminator',
      'ugc/80340029171150091/5D9CECBB157F9470E6F496E23D5C390D037E9720/',
      'ugc/1689373660281830513/5BB7922A2D55347F0D11702A4E3252DF1C3FD074/'),
    note: 'Exact classic Terminator mesh; uses the closest live Ultramarines Terminator atlas.',
  },
  {
    datasheetId: 'ultramarines_hellblasters', datasheetName: 'Hellblaster Squad', faction: 'Ultramarines',
    objectName: 'Primaris Hellblaster', match: 'exact',
    asset: one('Primaris Hellblaster',
      'ugc/853849837145381571/5C1660F08B8A312C7DC3B2405FD2A59A47AAA6B1/',
      'ugc/779609027850159533/61B1A4DF7515B198B1011E585C801CB0EE4F58C5/'),
  },
  {
    datasheetId: 'ultramarines_redemptor', datasheetName: 'Redemptor Dreadnought', faction: 'Ultramarines',
    objectName: 'Redemptor Dreadnought – Gatling', match: 'exact',
    asset: one('Redemptor Dreadnought',
      'ugc/2012583396722994137/9196D481BBF4740CB6390DB908AE3DAAD70068CB/',
      'ugc/782986727575530545/706D47AAC1FEC028427FBF52A538947C92828AD7/'),
  },
  {
    datasheetId: 'ultramarines_bladeguard', datasheetName: 'Bladeguard Veteran Squad', faction: 'Ultramarines',
    objectName: 'Primaris Bladeguard Veteran', match: 'exact',
    asset: one('Primaris Bladeguard Veteran',
      'ugc/1338082650360925864/08463D93C0382CD9BA8BCCB5156188A7AAE0127D/',
      'ugc/811122628122325417/12EC8F03025D4FA10AC4C2DBC286E1EDD543CC3F/'),
  },
  {
    datasheetId: 'ultramarines_lieutenant', datasheetName: 'Lieutenant', faction: 'Ultramarines',
    objectName: 'Primaris Lieutenant – Bolt Rifle/Power Sword', match: 'exact',
    asset: one('Primaris Lieutenant',
      'ugc/2031727998154158016/38AB4F44ECE67E67C5B53856B97173F9FE4A56F6/',
      'ugc/811122628122325417/12EC8F03025D4FA10AC4C2DBC286E1EDD543CC3F/'),
  },
  {
    datasheetId: 'ultramarines_eradicators', datasheetName: 'Eradicator Squad', faction: 'Ultramarines',
    objectName: 'Primaris Eradicator – Multimelta', match: 'exact',
    asset: one('Primaris Eradicator',
      'ugc/1633075017407680939/FCCC260FA94F2D3DC28E5FC297EB9D9F2C9D2377/',
      'ugc/922542965620487281/8109D52897186098568660D7FF65C891F2175F2A/'),
  },
  {
    datasheetId: 'ultra_aggressors', datasheetName: 'Aggressor Squad', faction: 'Ultramarines',
    objectName: 'Deathwatch Aggressor – Boltstorm', match: 'variant',
    asset: one('Primaris Aggressor',
      'ugc/782997977951229071/01DB6D76DFD310BAA50279B7CF11F40BF5D35209/',
      'ugc/782998227650607030/8BCF985CC928C88EE94D817571FD71061DBE0E57/'),
    note: 'Exact Aggressor sculpt; painted as Deathwatch rather than Ultramarines.',
  },
  {
    datasheetId: 'ultra_inceptors', datasheetName: 'Inceptor Squad', faction: 'Ultramarines',
    objectName: 'Primaris Inceptor', match: 'exact',
    asset: one('Primaris Inceptor',
      'ugc/769481639409475697/7E68932195D0083F2A98C0248BA767E60864BB21/',
      'ugc/907906080762904066/C18B2BA26BF43888FF911172221AE989AA4EF36B/'),
  },

  // Orks --------------------------------------------------------------------
  {
    datasheetId: 'ork_boyz', datasheetName: 'Boyz', faction: 'Orks',
    objectName: 'Ork Boy – Slugga/Choppa photoscan', match: 'exact',
    asset: one('Ork Boy',
      'ugc/1829035802509755541/7E83C6574CCEEA47FD88C9C80F738E4831618039/',
      'ugc/1829035802509756371/B9240BD4A60745C6BDC9C09C46AFC251840D3F22/'),
  },
  {
    datasheetId: 'ork_nobz', datasheetName: 'Nobz', faction: 'Orks',
    objectName: 'Nob', match: 'exact',
    asset: one('Ork Nob',
      'ugc/769490653296419453/F73BE638452ED75CD724E3CF4E8EC351D8950CAB/',
      'ugc/769490912701460596/5790531B5AAFDF2106D62AF346136F74004C14CC/'),
  },
  {
    datasheetId: 'ork_warboss', datasheetName: 'Warboss', faction: 'Orks',
    objectName: 'Warboss with Attack Squig photoscan', match: 'exact',
    asset: one('Ork Warboss',
      'ugc/1974293920374671089/1A4507E68EE0AEE1A1CF04173A05B31CF1C54990/',
      'ugc/1974293920374677352/4205F6005CF89B2EF6433657D9394A528D6A2668/'),
  },
  {
    datasheetId: 'ork_trukk', datasheetName: 'Trukk', faction: 'Orks',
    objectName: 'Truck – Bad Moons', match: 'exact',
    asset: one('Ork Trukk',
      'ugc/2023843030286738057/B549E41596716EB3C1BD57E1986D0A991764DC1F/',
      'ugc/2023843030267429695/85FF82365A80AC62A97D071D72A4B3E1F7BB857E/'),
    note: 'Bad Moons painted Trukk scan; geometry and texture were checked before inclusion.',
  },
  {
    datasheetId: 'ork_gretchin', datasheetName: 'Gretchin', faction: 'Orks',
    objectName: 'Gretchin', match: 'exact',
    asset: one('Gretchin',
      'ugc/769490028809749053/EF9AB16021A0811F75DD408AC0F988507E95793F/',
      'ugc/769490028809850566/45DFE2DDE6B5120399E952F2C186FAF60D890635/'),
  },
  {
    datasheetId: 'ork_meganobz', datasheetName: 'Meganobz', faction: 'Orks',
    objectName: 'Meganob', match: 'exact',
    asset: one('Ork Meganob',
      'ugc/950731768228084084/A1C94E27D12FD86B5517F62CB86077822CF34291/',
      'ugc/950731768228066781/802DDD206C6E675ACF2C188D25BC06DD02F4D01D/'),
  },
  {
    datasheetId: 'ork_killakans', datasheetName: 'Killa Kans', faction: 'Orks',
    objectName: 'Killa Kan with Skorcha photoscan', match: 'exact',
    asset: many('Killa Kan', [
      part('ugc/1832406432255633762/885A7AC704655DE947752099AE1B5359A0408D40/', 'ugc/1832406432255634471/89DE7DBCD2669E3F5F3CB286FEB02597C36DAFE6/'),
      part('ugc/1832406432255635550/3859BE7A2C103348262FE82D3C3C17C8AE2D4245/', 'ugc/1832406432255634471/89DE7DBCD2669E3F5F3CB286FEB02597C36DAFE6/'),
    ]),
  },
  {
    datasheetId: 'ork_deffkoptas', datasheetName: 'Deffkoptas', faction: 'Orks',
    objectName: 'Deffkopta 2021 photoscan', match: 'exact',
    asset: many('Ork Deffkopta', [
      part('ugc/1781731425145041466/1E0EAB403A8B2F1D80CED1375DF961BD41004C43/', 'ugc/1781731425145042453/5EBE44C3324F2BDB64F1BE7233A8E5B816DC41BE/'),
      part('ugc/1781731425145043420/9F3C1172C6DECBE8A1953ADE5FD134D7B684DC72/', 'ugc/1781731425145042453/5EBE44C3324F2BDB64F1BE7233A8E5B816DC41BE/'),
      part('ugc/1781731425145044539/B28989CE1BCBAECE91D6DBC9B29184FF3B3E8305/', 'ugc/1781731425145042453/5EBE44C3324F2BDB64F1BE7233A8E5B816DC41BE/'),
    ]),
  },

  // Chaos Space Marines ------------------------------------------------------
  {
    datasheetId: 'chaos_legionaries', datasheetName: 'Legionaries', faction: 'Chaos Space Marines',
    objectName: 'Chaos Space Marine Legionary photoscan', match: 'exact',
    asset: one('Chaos Legionary',
      'ugc/1832406432237158038/E8371FC76014C0FE0313C9180D765C9DA8D52B28/',
      'ugc/1832406432237153191/B06036FBE055DCD85579E94153D882EE593D9D0C/'),
  },
  {
    datasheetId: 'chaos_chosen', datasheetName: 'Chosen', faction: 'Chaos Space Marines',
    objectName: 'Chaos Space Marine Chosen – Big Axe photoscan', match: 'exact',
    asset: one('Chaos Chosen',
      'ugc/1832408124492850192/1BE1DD1990B99D2B016A2AFECC7C4766EC7BB414/',
      'ugc/1832408124492850376/2F92D1B7F88A18A2DC9447C621445E2D9D8C5550/'),
  },
  {
    datasheetId: 'chaos_lord', datasheetName: 'Chaos Lord', faction: 'Chaos Space Marines',
    objectName: 'Chaos Lord – Power Maul photoscan', match: 'exact',
    asset: one('Chaos Lord',
      'ugc/1832406284765968366/90B31532435A0DBB71EB6C53C3872BA7CABDE12A/',
      'ugc/1832406284765968932/AEDA10E5B7B6BC6A8DCC267580B9DAAF2342E279/'),
  },
  {
    datasheetId: 'chaos_cultists', datasheetName: 'Accursed Cultists', faction: 'Chaos Space Marines',
    objectName: 'Accursed Cultist Mutant', match: 'exact',
    asset: one('Accursed Cultist Mutant',
      'ugc/1762617374859062303/162A9794027C4277D542AA09FCC9EE45E52F5ACF/',
      'ugc/1762617374859062038/9567FE1477698C267D1385E899DF50E6811C5EF2/'),
  },
  {
    datasheetId: 'chaos_raptors', datasheetName: 'Raptors', faction: 'Chaos Space Marines',
    objectName: 'Raptor – Bolt Pistol', match: 'exact',
    asset: one('Chaos Raptor',
      'ugc/80340382496307181/721A9A4CD5C87DF09B6160F24A77FCB403CFF76A/',
      'ugc/952982844382642130/1AAF927217AD93E113F55FCD1F95F200D3E9C96A/'),
  },
  {
    datasheetId: 'chaos_helbrute', datasheetName: 'Helbrute', faction: 'Chaos Space Marines',
    objectName: 'Chaos Helbrute – Fist/Melta', match: 'exact',
    asset: one('Chaos Helbrute',
      'ugc/1691626400085282658/6FB04D3582119DB1DFD056B1F29D0CAA9BF0B653/',
      'ugc/1691625928964479389/C200E211E3A3205AF82DFF45EEC9E4F867125A0B/'),
  },
  {
    datasheetId: 'chaos_master_of_possession', datasheetName: 'Master of Possession', faction: 'Chaos Space Marines',
    objectName: 'Master of Possession', match: 'exact',
    asset: one('Master of Possession',
      'ugc/1821148798397443854/04DF8503FC186CFE8EC7A5DD40B15ECF7BCFF0AD/',
      'ugc/1821148798397444231/463477E668950DE2DB226439CBFCB8A0211D880E/'),
  },
  {
    datasheetId: 'chaos_possessed', datasheetName: 'Possessed', faction: 'Chaos Space Marines',
    objectName: 'Possessed 2022 B photoscan', match: 'exact',
    asset: one('Chaos Possessed',
      'ugc/1762617374859051324/17F9C03E9EFE8515A4E21CFBF0C5EA9D3BA2C804/',
      'ugc/1762617374859051003/5FF2BA48D84577BFB87632955E9211C2AE7A1FBF/'),
  },
  {
    datasheetId: 'chaos_spawn', datasheetName: 'Chaos Spawn', faction: 'Chaos Space Marines',
    objectName: 'Chaos Spawn 2016 B photoscan', match: 'exact',
    asset: one('Chaos Spawn',
      'ugc/1781730535072729955/D6F709BDDC54B99BD8EA14E856BA58FA0471E647/',
      'ugc/1781730535072730979/DE19480BA27C0E44A84197F70F0EF152EB1A4CE1/'),
  },
];

export const COMMUNITY_MODEL_BY_DATASHEET = new Map(
  COMMUNITY_MODEL_PACK.map((definition) => [definition.datasheetId, definition]),
);

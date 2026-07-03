import fs from 'fs';
const data = JSON.parse(fs.readFileSync('scratchpad/wargear-raw.json','utf8'));
const withOpts = data.filter(u=>u.hasOptions && (u.options||[]).length);

// attacks/damage: keep dice strings, convert pure integers to numbers
const num = (v)=> (typeof v==='string' && /^\d+$/.test(v)) ? Number(v) : (typeof v==='string' ? JSON.stringify(v) : v);
const arr = (a)=> '['+a.map(s=>JSON.stringify(s)).join(', ')+']';

function emitWeapon(w){
  // w([id,name,kind,range,attacks,skill,strength,ap,damage,kw])
  const spec = [JSON.stringify(w.id), JSON.stringify(w.name), JSON.stringify(w.kind),
    w.range, num(w.attacks), w.skill, w.strength, w.ap, num(w.damage), arr(w.keywords||[])];
  return `    w([${spec.join(', ')}])`;
}
function emitChoice(c){
  return `        { id: ${JSON.stringify(c.id)}, label: ${JSON.stringify(c.label)}, add: ${arr(c.add)}, remove: ${arr(c.remove)} }`;
}
function emitOption(o){
  return `      {\n        id: ${JSON.stringify(o.id)}, label: ${JSON.stringify(o.label)}, defaultChoiceId: ${JSON.stringify(o.defaultChoiceId)},\n        choices: [\n${o.choices.map(emitChoice).join(',\n')},\n        ],\n      }`;
}
function emitUnit(u){
  const ew = (u.extraWeapons||[]).length ? `[\n${u.extraWeapons.map(emitWeapon).join(',\n')},\n    ]` : '[]';
  const opts = `[\n${u.options.map(emitOption).join(',\n')},\n    ]`;
  return `  ${JSON.stringify(u.datasheetId)}: {\n    extraWeapons: ${ew},\n    options: ${opts},\n  }`;
}
const body = withOpts.map(emitUnit).join(',\n');
const out = `export const WARGEAR: Record<string, WargearCatalogue> = {\n${body},\n};\n`;
fs.writeFileSync('scratchpad/wargear-body.ts', out);
console.log('generated', withOpts.length, 'entries,', out.length, 'chars');

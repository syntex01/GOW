/**
 * One-shot refactor of ThreeScene.ts onto the modular gfx/ visual system.
 * Brace-aware: locates each method by its signature line, scans to the matching
 * closing brace at the same indent, then replaces or deletes the whole method.
 * Fails loudly (no write) if any anchor is missing so a partial state is never
 * saved. Run once; verify with tsc afterwards.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/render/ThreeScene.ts';
const src = readFileSync(FILE, 'utf8');
let lines = src.split('\n');

/** Find the line index of a method signature (exact indent match). */
function findSig(sig) {
  const i = lines.findIndex((l) => l.startsWith(sig));
  if (i === -1) throw new Error(`anchor not found: ${sig}`);
  return i;
}

/** Given a signature line index, return the index of its closing "  }". */
function methodEnd(start) {
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') depth--;
    }
    if (opened && depth === 0) return i;
  }
  throw new Error(`unbalanced braces from line ${start + 1}`);
}

/** Replace the whole method that starts with `sig` by `body` (array of lines). */
function replaceMethod(sig, body) {
  const s = findSig(sig);
  const e = methodEnd(s);
  lines.splice(s, e - s + 1, ...body);
}

/** Delete the whole method that starts with `sig`. */
function deleteMethod(sig) {
  const s = findSig(sig);
  const e = methodEnd(s);
  // Also swallow the doc comment directly above (scan back over /** ... */).
  let ds = s;
  if (lines[s - 1]?.trim().endsWith('*/')) {
    let j = s - 1;
    while (j >= 0 && !lines[j].trim().startsWith('/**')) j--;
    if (j >= 0) ds = j;
  }
  lines.splice(ds, e - ds + 1);
}

function deleteLineContaining(text) {
  const i = lines.findIndex((l) => l.includes(text));
  if (i === -1) throw new Error(`line not found: ${text}`);
  lines.splice(i, 1);
}

/* ------------------------------- 1. imports ------------------------------- */
{
  const i = findSig("import { RoomEnvironment }");
  lines.splice(i + 1, 0,
    "import { buildBoard } from './gfx/board';",
    "import { buildTerrain } from './gfx/terrain';",
    "import { buildScatter } from './gfx/scatter';",
    "import { buildAtmosphere } from './gfx/sky';",
    "import { buildLights } from './gfx/lights';",
    "import { buildPostChain, type PostChain } from './gfx/post';",
    "import type { Built, GfxQuality, AvoidRect } from './gfx/contract';",
  );
}

/* ------------------------------- 2. fields -------------------------------- */
{
  const i = findSig('  private boardGroup = new THREE.Group();');
  lines.splice(i + 1, 0,
    '  /** Modular visual builds (board/terrain/scatter/sky/lights) — updated + disposed uniformly. */',
    '  private gfx: Built[] = [];',
    '  /** The modular post-processing chain (composer + tuned passes). */',
    '  private postChain: PostChain | null = null;',
  );
}

/* --------------------------- 3. method swaps ------------------------------ */

replaceMethod('  private setupLights(): void {', [
  '  /** Tuned grimdark light rig, built by the gfx/lights module. */',
  '  private setupLights(): void {',
  '    const l = buildLights(this.board, this.quality.shadowMapSize, this.quality.tier);',
  '    this.gfx.push(l);',
  '    this.scene.add(l.group);',
  '  }',
  '',
  '  /** Quality knobs shared with the gfx modules. */',
  '  private gfxQuality(): GfxQuality {',
  '    return {',
  '      tier: this.quality.tier,',
  '      texturePx: this.quality.battlematPx,',
  '      ringSegments: this.quality.ringSegments,',
  '    };',
  '  }',
]);

replaceMethod('  private setupComposer(): void {', [
  '  /** Post chain (GTAO/bloom/grade/DoF/SMAA) built by the gfx/post module. The',
  '   *  pass references are mirrored onto the legacy fields so the adaptive',
  '   *  governor and capture paths keep working unchanged. */',
  '  private setupComposer(): void {',
  '    if (!this.quality.bloom) {',
  '      this.composer = null;',
  '      this.bloomPass = null;',
  '      return;',
  '    }',
  '    const size = new THREE.Vector2();',
  '    this.renderer.getSize(size);',
  '    const chain = buildPostChain(this.renderer, this.scene, this.camera, {',
  '      tier: this.quality.tier,',
  '      width: Math.max(1, size.x),',
  '      height: Math.max(1, size.y),',
  '      bloomDownscale: Math.max(1, this.quality.bloomDownscale),',
  '    });',
  '    if (!chain) {',
  '      this.composer = null;',
  '      this.bloomPass = null;',
  '      return;',
  '    }',
  '    chain.setPixelRatio(this.quality.pixelRatioCap);',
  '    this.postChain = chain;',
  '    this.composer = chain.composer;',
  '    this.bloomPass = chain.bloom;',
  '    this.gtaoPass = chain.gtao;',
  '    this.bokehPass = chain.bokeh;',
  '    this.smaaPass = chain.smaa;',
  '    this.gradePass = chain.grade;',
  '  }',
]);

deleteMethod('  private addGradePass(composer: EffectComposer): void {');

replaceMethod('  private buildBoard(): void {', [
  '  /** Displaced PBR ground + gothic-industrial war table (gfx/board). */',
  '  private buildBoard(): void {',
  '    const b = buildBoard(this.board, this.gfxQuality(), 1337);',
  '    this.gfx.push(b);',
  '    this.boardGroup.add(b.group);',
  '  }',
]);

deleteMethod('  private buildWarTableFrame(width: number, height: number): void {');
deleteMethod('  private makeHazardStripeTexture(): THREE.Texture {');
deleteLineContaining('private hazardStripeTex: THREE.Texture | null = null;');

replaceMethod('  private buildAtmosphere(): void {', [
  '  /** Sky dome, horizon war-glow, smoke, haze and dust motes (gfx/sky). */',
  '  private buildAtmosphere(): void {',
  '    const a = buildAtmosphere(this.board, this.gfxQuality(), 6011);',
  '    this.gfx.push(a);',
  '    this.scene.add(a.group);',
  '  }',
]);

deleteMethod('  private makeHazeTexture(): THREE.Texture {');
deleteMethod('  private makeMoteTexture(): THREE.Texture {');
deleteLineContaining('private hazeTex: THREE.Texture | null = null;');
deleteLineContaining('private moteTex: THREE.Texture | null = null;');

deleteMethod('  private makeBattlematTextures(');

replaceMethod('  private buildTerrain(state: GameState): void {', [
  '  /** Ruined gothic shells + crater bowls for the rules terrain (gfx/terrain).',
  '   *  Footprints are rules geometry — the module fills but never exceeds them. */',
  '  private buildTerrain(state: GameState): void {',
  '    const t = buildTerrain(state.terrain, this.board, this.gfxQuality(), 2029);',
  '    this.gfx.push(t);',
  '    this.boardGroup.add(t.group);',
  '  }',
]);

replaceMethod('  private buildScatter(state: GameState): void {', [
  '  /** Instanced battlefield litter, kept out of terrain footprints, objective',
  '   *  areas and the two deployment bands (gfx/scatter). Skipped on low tier. */',
  '  private buildScatter(state: GameState): void {',
  '    if (this.quality.tier === \'low\') return;',
  '    const zd = this.board.height * 0.22;',
  '    const avoid: AvoidRect[] = [',
  '      ...state.terrain.map((t) => ({ x: t.center.x, y: t.center.y, w: t.width, d: t.depth })),',
  '      ...state.objectives.map((o) => ({',
  '        x: o.position.x,',
  '        y: o.position.y,',
  '        w: (o.radius + 1) * 2,',
  '        d: (o.radius + 1) * 2,',
  '      })),',
  '      { x: this.board.width / 2, y: zd / 2, w: this.board.width, d: zd },',
  '      { x: this.board.width / 2, y: this.board.height - zd / 2, w: this.board.width, d: zd },',
  '    ];',
  '    const s = buildScatter(this.board, avoid, this.gfxQuality(), 4099);',
  '    this.gfx.push(s);',
  '    this.boardGroup.add(s.group);',
  '  }',
]);

deleteMethod('  private hashId(id: string): number {');
deleteMethod('  private buildRuinWall(');
deleteMethod('  private wallBlockGeo(w: number, h: number, d: number): THREE.BufferGeometry {');
deleteMethod('  private makeConcreteTexture(): THREE.Texture {');

/* -------------------- 4. fields for old atmosphere ------------------------ */
// Delete the haze/dustMotes/dustData fields (their doc comments too).
for (const f of [
  'private haze: THREE.Mesh | null = null;',
  'private dustMotes: THREE.Points | null = null;',
]) {
  const i = lines.findIndex((l) => l.includes(f));
  if (i === -1) throw new Error(`field not found: ${f}`);
  // swallow one-line doc comment above if present
  const ds = lines[i - 1]?.trim().startsWith('/**') ? i - 1 : i;
  lines.splice(ds, i - ds + 1);
}
{
  // dustData is a multi-line field declaration; delete from its start to ';'
  const i = lines.findIndex((l) => l.includes('private dustData:'));
  if (i === -1) throw new Error('dustData field not found');
  let e = i;
  while (!lines[e].includes('null;') && e < i + 6) e++;
  const ds = lines[i - 1]?.trim().startsWith('/**') ? i - 1 : i;
  lines.splice(ds, e - ds + 1);
}

/* --------------------- 5. per-frame + resize + dispose -------------------- */

replaceMethod('  private updateAtmosphere(dt: number, t: number): void {', [
  '  /** Advance the modular visual builds (sky drift, smoke, ember flicker…). */',
  '  private updateAtmosphere(dt: number, t: number): void {',
  '    if (this.reducedMotion) return;',
  '    for (const g of this.gfx) g.update?.(t, dt);',
  '  }',
]);

// animate(): grade uTime + bokeh focus block -> one postChain call.
{
  const s = lines.findIndex((l) => l.includes("// Advance the grade pass's grain time"));
  if (s === -1) throw new Error('grade block anchor missing');
  const apIdx = lines.findIndex((l, i) => i > s && l.includes('u.aperture.value = 0.00055'));
  if (apIdx === -1) throw new Error('bokeh aperture anchor missing');
  // the if-block closes on the line after the aperture write
  const e = apIdx + 1;
  if (lines[e].trim() !== '}') throw new Error('bokeh close brace not where expected');
  lines.splice(s, e - s + 1,
    '    // Advance the post chain (grain time, zoom-adaptive depth of field).',
    '    if (this.postChain) {',
    '      this.postChain.updatePerFrame(t, this.camera.position.distanceTo(this.orbitTarget));',
    '    }',
  );
}

// resize(): individual pass resizes -> chain.setSize.
{
  const s = lines.findIndex((l) => l.includes('if (this.composer) this.composer.setSize(w, h);'));
  if (s === -1) throw new Error('resize anchor missing');
  const rIdx = lines.findIndex((l, i) => i > s && l.includes('(res.value as THREE.Vector2).set(w, h);'));
  if (rIdx === -1) throw new Error('resize uResolution anchor missing');
  let e = rIdx + 1;
  if (lines[e].trim() !== '}') throw new Error('resize close brace not where expected');
  lines.splice(s, e - s + 1,
    '    // The chain owns resizing every pass (composer, bloom, GTAO, grade res).',
    '    if (this.postChain) this.postChain.setSize(w, h);',
  );
}

// dispose(): post chain + gfx builds; drop the deleted-fields teardown.
{
  const s = lines.findIndex((l) => l.includes('this.composer?.dispose();'));
  if (s === -1) throw new Error('dispose anchor missing');
  if (!lines[s + 1].includes('gtaoPass?.dispose')) throw new Error('dispose shape changed');
  lines.splice(s, 4,
    '    this.postChain?.dispose();',
    '    this.postChain = null;',
    '    this.composer = null;',
    '    this.gtaoPass = null;',
    '    this.gradePass = null;',
    '    for (const g of this.gfx) g.dispose();',
    '    this.gfx = [];',
  );
}
{
  const s = lines.findIndex((l) => l.includes('// Atmosphere + frame textures.'));
  if (s === -1) throw new Error('atmo dispose anchor missing');
  if (!lines[s + 5].includes('this.dustMotes')) throw new Error('atmo dispose shape changed');
  lines.splice(s, 6);
}

writeFileSync(FILE, lines.join('\n'));
console.log('surgery OK —', lines.length, 'lines');

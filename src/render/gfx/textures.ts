/**
 * Procedural PBR texture factory for the gfx modules.
 *
 * Everything here is generated on 2D canvases at build time — zero fetched
 * assets, fully deterministic (all randomness flows through `sRNG(seed)` from
 * the contract). Three factories are exposed:
 *
 *  - `makeGroundSet`  — a FULL-BLEED (non-tiled, clamp-to-edge) battlemat set
 *    that covers the whole board 1:1: fBm ash base, cracked-earth cells,
 *    scorch rings, tank-tread arcs, dust drifts, plus an emissive layer of
 *    sparse hot ember cracks that feeds the bloom pass.
 *  - `makeStoneSet`   — TILEABLE dark gothic ashlar masonry for ruins.
 *  - `makeMetalSet`   — TILEABLE near-black brushed iron with rust patina.
 *
 * Design constraints honoured throughout:
 *  - GAMEPLAY READABILITY: ground albedo sits in the 0.05–0.35 luminance band
 *    with very low saturation so faction colours and overlay rings pop. All
 *    "colour" in the mat is warm/cool *tinted greys* plus tiny ember accents.
 *  - PERF: per-pixel JS work is capped at ~3 passes per set (fBm height-field
 *    write, one Sobel read→normal write). Every other layer is a plain canvas
 *    draw call (gradients/strokes/fills) which the browser rasterises natively.
 *  - Normal maps are derived from an internal grayscale HEIGHT canvas via a
 *    Sobel filter, so albedo detail (cracks, mortar, seams) and surface relief
 *    stay perfectly aligned — the single biggest "reads as real" win.
 *  - Tileable sets wrap seamlessly: noise lattices are periodic (index mod),
 *    block/panel grids are exact-period, and free-floating decals near an edge
 *    are re-stamped on the opposite side (torus draw).
 *  - Albedo + emissive canvases are sRGB; normal/roughness stay linear.
 *  - Each `PBRSet.dispose()` frees every texture the factory created.
 */
import * as THREE from 'three';
import { sRNG } from './contract';
import type { BoardSpec, GfxQuality, PBRSet } from './contract';

const TAU = Math.PI * 2;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/* ------------------------------------------------------------------------ */
/*                              canvas plumbing                              */
/* ------------------------------------------------------------------------ */

interface CanvasPair {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/**
 * Create a canvas + 2D context. `readBack` hints the browser to keep the
 * bitmap CPU-side (we call getImageData on height canvases for the Sobel
 * pass; without the hint some browsers round-trip through the GPU).
 */
function makeCanvas(w: number, h: number, readBack = false): CanvasPair {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext(
    '2d',
    readBack ? { willReadFrequently: true } : undefined,
  )!;
  return { canvas, ctx };
}

/**
 * Wrap a canvas in a THREE texture with the right colour space + wrap mode.
 * Anisotropy is deliberately NOT set here (needs renderer caps) — the
 * consuming module (board/terrain) sets it from the host renderer.
 */
function toTexture(
  canvas: HTMLCanvasElement,
  opts: { srgb?: boolean; tile?: boolean },
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  if (opts.srgb) tex.colorSpace = THREE.SRGBColorSpace;
  const wrap = opts.tile ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.needsUpdate = true;
  return tex;
}

/** Assemble the PBRSet with a dispose() that frees every owned texture. */
function bundle(
  map: THREE.Texture,
  normalMap: THREE.Texture,
  roughnessMap: THREE.Texture,
  emissiveMap?: THREE.Texture,
): PBRSet {
  const set: PBRSet = {
    map,
    normalMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
      emissiveMap?.dispose();
    },
  };
  if (emissiveMap) set.emissiveMap = emissiveMap;
  return set;
}

/** Rounded-rect path helper (avoids relying on ctx.roundRect availability). */
function rrect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = clamp(r, 0, Math.min(w, h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/**
 * Stamp a decal onto a square RxR tile with torus wrap-around: if the decal
 * (radius `pad`) overlaps an edge it is re-drawn shifted by ±R so the tile
 * stays seamless. Worst case 4 extra draws — cheap for the decal counts here.
 */
function stampWrapped(
  ctx: CanvasRenderingContext2D,
  R: number,
  x: number,
  y: number,
  pad: number,
  draw: () => void,
): void {
  const xo: number[] = [0];
  if (x - pad < 0) xo.push(R);
  if (x + pad > R) xo.push(-R);
  const yo: number[] = [0];
  if (y - pad < 0) yo.push(R);
  if (y + pad > R) yo.push(-R);
  for (const ox of xo) {
    for (const oy of yo) {
      ctx.save();
      ctx.translate(ox, oy);
      draw();
      ctx.restore();
    }
  }
}

/* ------------------------------------------------------------------------ */
/*                        noise + normal-map generation                      */
/* ------------------------------------------------------------------------ */

/**
 * Periodic value-noise fBm, returned as a normalised Float32Array (0..1).
 * The lattice indices are taken modulo the octave's cell count, so the field
 * tiles seamlessly across the canvas by construction — used both for the
 * tileable stone/metal sets and (harmlessly) for the clamped ground mat.
 * This is the single "expensive" per-pixel pass; ~octaves × w × h lerps.
 */
function fbm(
  w: number,
  h: number,
  cellsX: number,
  cellsY: number,
  octaves: number,
  rng: () => number,
): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1;
  let norm = 0;
  let cx = cellsX;
  let cy = cellsY;
  for (let o = 0; o < octaves; o++) {
    const lattice = new Float32Array(cx * cy);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
    const sx = cx / w;
    const sy = cy / h;
    let p = 0;
    for (let y = 0; y < h; y++) {
      const fy = y * sy;
      const y0 = fy | 0;
      const y1 = (y0 + 1) % cy;
      let ty = fy - y0;
      ty = ty * ty * (3 - 2 * ty); // smoothstep — kills lattice diamonds
      const r0 = y0 * cx;
      const r1 = y1 * cx;
      for (let x = 0; x < w; x++, p++) {
        const fx = x * sx;
        const x0 = fx | 0;
        const x1 = (x0 + 1) % cx;
        let tx = fx - x0;
        tx = tx * tx * (3 - 2 * tx);
        const a = lattice[r0 + x0];
        const b = lattice[r0 + x1];
        const c = lattice[r1 + x0];
        const d = lattice[r1 + x1];
        const top = a + (b - a) * tx;
        const bot = c + (d - c) * tx;
        out[p] += (top + (bot - top) * ty) * amp;
      }
    }
    norm += amp;
    amp *= 0.55;
    cx *= 2;
    cy *= 2;
  }
  const inv = 1 / norm;
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}

/**
 * Write a Float32 field into a fresh grayscale canvas mapped to [lo..hi].
 * Returned pair doubles as (a) the height accumulation surface that layers
 * then stroke grooves/bumps onto and (b) an "overlay" source for modulating
 * albedo/roughness canvases via one GPU-composited drawImage.
 */
function grayFromField(
  w: number,
  h: number,
  field: Float32Array,
  lo: number,
  hi: number,
): CanvasPair {
  const pair = makeCanvas(w, h, true);
  const img = pair.ctx.createImageData(w, h);
  const d = img.data;
  const span = (hi - lo) * 255;
  const base = lo * 255;
  for (let i = 0, p = 0; i < field.length; i++, p += 4) {
    const v = (base + span * field[i]) | 0;
    d[p] = v;
    d[p + 1] = v;
    d[p + 2] = v;
    d[p + 3] = 255;
  }
  pair.ctx.putImageData(img, 0, 0);
  return pair;
}

/**
 * Derive a tangent-space normal map from a grayscale height canvas via a
 * Sobel filter (one getImageData read, one ImageData write — this is the
 * second/third per-pixel pass). `wrap` selects torus vs clamped neighbour
 * lookups so tileable sets get seam-free normals too.
 *
 * Channel convention: CanvasTexture has flipY=true, so with canvas +y going
 * down, +v goes up ⇒ G encodes +dH/dy(canvas) — OpenGL-style green, which is
 * what three.js expects.
 */
function normalFromHeight(
  src: CanvasRenderingContext2D,
  w: number,
  h: number,
  strength: number,
  wrap: boolean,
): HTMLCanvasElement {
  const data = src.getImageData(0, 0, w, h).data;
  const pair = makeCanvas(w, h, true);
  const img = pair.ctx.createImageData(w, h);
  const d = img.data;
  // Precompute wrapped/clamped neighbour indices — keeps the hot loop
  // branch-free (~w*h*8 fetches, fine at build time even for 2048² ground).
  const xm = new Int32Array(w);
  const xp = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    xm[x] = x > 0 ? x - 1 : wrap ? w - 1 : 0;
    xp[x] = x < w - 1 ? x + 1 : wrap ? 0 : w - 1;
  }
  const ym = new Int32Array(h);
  const yp = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    ym[y] = y > 0 ? y - 1 : wrap ? h - 1 : 0;
    yp[y] = y < h - 1 ? y + 1 : wrap ? 0 : h - 1;
  }
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ra = ym[y] * w;
    const rb = y * w;
    const rc = yp[y] * w;
    for (let x = 0; x < w; x++, p += 4) {
      const l = xm[x];
      const r = xp[x];
      const tl = data[(ra + l) << 2];
      const tc = data[(ra + x) << 2];
      const tr = data[(ra + r) << 2];
      const ml = data[(rb + l) << 2];
      const mr = data[(rb + r) << 2];
      const bl = data[(rc + l) << 2];
      const bc = data[(rc + x) << 2];
      const br = data[(rc + r) << 2];
      const dx = (tr + 2 * mr + br - tl - 2 * ml - bl) / 1020; // /(255*4)
      const dy = (bl + 2 * bc + br - tl - 2 * tc - tr) / 1020;
      const nx = -dx * strength;
      const ny = dy * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      d[p] = (127.5 + nx * inv * 127.5) | 0;
      d[p + 1] = (127.5 + ny * inv * 127.5) | 0;
      d[p + 2] = (127.5 + inv * 127.5) | 0;
      d[p + 3] = 255;
    }
  }
  pair.ctx.putImageData(img, 0, 0);
  return pair.canvas;
}

/** Composite a grayscale detail canvas over `ctx` with 'overlay' blending. */
function overlayDetail(
  ctx: CanvasRenderingContext2D,
  detail: HTMLCanvasElement,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(detail, 0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/** Detail multiplier per tier — scales decal/stroke counts, not resolution. */
function tierDetail(q: GfxQuality): number {
  return q.tier === 'high' ? 1 : q.tier === 'medium' ? 0.75 : 0.5;
}

/* ------------------------------------------------------------------------ */
/*                                GROUND SET                                 */
/* ------------------------------------------------------------------------ */

interface Pt {
  x: number;
  y: number;
}

/** Stroke a wobbly polyline (crack segment). */
function strokePoly(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

/**
 * Full-bleed battlemat PBR set covering the whole board (clamp-to-edge; the
 * board plane maps UV 0..1 across its full extent). Long edge = q.texturePx,
 * short edge proportional to the board aspect so texels stay square.
 *
 * Layer stack (all layers stamped consistently across height → albedo →
 * roughness → emissive so relief, colour, gloss and glow line up):
 *   1. fBm ash base           — low-frequency undulation + grain
 *   2. cracked-earth cells    — jittered lattice, wobbly dark crack lines
 *   3. scorch rings           — dark burns with a faint warm cooled rim
 *   4. tank-tread arcs        — paired dashed arcs (tread plates)
 *   5. dust drifts            — soft wind-aligned pale smears
 *   6. ember cracks (emissive)— sparse crack subset glowing 0xff5a22
 */
export function makeGroundSet(
  spec: BoardSpec,
  q: GfxQuality,
  seed: number,
): PBRSet {
  const rng = sRNG(seed);
  const detail = tierDetail(q);

  // Canvas dimensions: long edge = budget, short edge keeps board aspect.
  const long = Math.max(spec.width, spec.height);
  const cw = Math.max(64, Math.round((q.texturePx * spec.width) / long));
  const ch = Math.max(64, Math.round((q.texturePx * spec.height) / long));
  const ppi = cw / spec.width; // pixels per table inch

  /* ---- cracked-earth cell network (shared by all layers) --------------- */
  // Jittered lattice of cell corners ~3 inches apart; edges between corners
  // become wobbly crack polylines; the quads become per-cell tint patches.
  const cols = Math.max(4, Math.round(spec.width / 3.2));
  const rows = Math.max(4, Math.round(spec.height / 3.2));
  const nxc = cols + 1;
  const cellW = cw / cols;
  const cellH = ch / rows;
  const cornX = new Float32Array(nxc * (rows + 1));
  const cornY = new Float32Array(nxc * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const k = j * nxc + i;
      cornX[k] = clamp(i * cellW + (rng() - 0.5) * cellW * 0.62, 0, cw);
      cornY[k] = clamp(j * cellH + (rng() - 0.5) * cellH * 0.62, 0, ch);
    }
  }
  const cracks: Pt[][] = [];
  const addCrack = (x0: number, y0: number, x1: number, y1: number): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len;
    const pts: Pt[] = [{ x: x0, y: y0 }];
    for (let s = 1; s < 3; s++) {
      const t = s / 3;
      const off = (rng() - 0.5) * len * 0.24;
      pts.push({ x: x0 + dx * t + px * off, y: y0 + dy * t + py * off });
    }
    pts.push({ x: x1, y: y1 });
    cracks.push(pts);
  };
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const k = j * nxc + i;
      if (i < cols && rng() > 0.07)
        addCrack(cornX[k], cornY[k], cornX[k + 1], cornY[k + 1]);
      if (j < rows && rng() > 0.07)
        addCrack(cornX[k], cornY[k], cornX[k + nxc], cornY[k + nxc]);
    }
  }

  /* ---- shared decal placements (height/albedo/roughness reuse these) --- */
  const scorches: { x: number; y: number; r: number }[] = [];
  const nScorch = Math.round(((spec.width * spec.height) / 170) * detail) + 4;
  for (let i = 0; i < nScorch; i++) {
    scorches.push({
      x: rng() * cw,
      y: rng() * ch,
      r: (1.4 + rng() * 2.8) * ppi,
    });
  }
  const treads: {
    cx: number;
    cy: number;
    r: number;
    a0: number;
    a1: number;
    gauge: number;
  }[] = [];
  const nTread = Math.round(4 * detail) + 1;
  for (let i = 0; i < nTread; i++) {
    // Huge-radius arcs read as a vehicle turning across the field.
    treads.push({
      cx: rng() * cw,
      cy: rng() * ch,
      r: (14 + rng() * 28) * ppi,
      a0: rng() * TAU,
      a1: 0.25 + rng() * 0.5, // angular span
      gauge: (2.1 + rng() * 0.9) * ppi,
    });
  }
  const drifts: { x: number; y: number; len: number; ang: number }[] = [];
  const windDir = rng() * TAU; // one prevailing wind direction, ± spread
  const nDrift = Math.round(34 * detail) + 8;
  for (let i = 0; i < nDrift; i++) {
    drifts.push({
      x: rng() * cw,
      y: rng() * ch,
      len: (2.5 + rng() * 5) * ppi,
      ang: windDir + (rng() - 0.5) * 0.7,
    });
  }
  const wets: { x: number; y: number; r: number }[] = [];
  const nWet = Math.round(10 * detail) + 3;
  for (let i = 0; i < nWet; i++) {
    wets.push({ x: rng() * cw, y: rng() * ch, r: (1.2 + rng() * 2.6) * ppi });
  }

  /* ---- HEIGHT field (drives the normal map) ---------------------------- */
  const cellsY = Math.max(2, Math.round((6 * ch) / cw));
  const field = fbm(cw, ch, 6, cellsY, 5, rng);
  const height = grayFromField(cw, ch, field, 0.32, 0.72);
  const hx = height.ctx;
  hx.lineCap = 'round';
  hx.lineJoin = 'round';
  // Dust drifts: gentle raised smears.
  for (const dr of drifts) {
    hx.save();
    hx.translate(dr.x, dr.y);
    hx.rotate(dr.ang);
    hx.scale(1, 0.22);
    const g = hx.createRadialGradient(0, 0, 1, 0, 0, dr.len);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    hx.fillStyle = g;
    hx.beginPath();
    hx.arc(0, 0, dr.len, 0, TAU);
    hx.fill();
    hx.restore();
  }
  // Crack grooves: a soft wide shoulder then a sharp dark core — Sobel turns
  // this into a crisp V-groove in the normal map.
  hx.strokeStyle = 'rgba(0,0,0,0.22)';
  hx.lineWidth = Math.max(3, ppi * 0.12);
  for (const c of cracks) strokePoly(hx, c);
  hx.strokeStyle = 'rgba(0,0,0,0.55)';
  hx.lineWidth = Math.max(1.5, ppi * 0.05);
  for (const c of cracks) strokePoly(hx, c);
  // Scorch: slight depression (cooked, compacted ash).
  for (const s of scorches) {
    const g = hx.createRadialGradient(s.x, s.y, s.r * 0.1, s.x, s.y, s.r);
    g.addColorStop(0, 'rgba(0,0,0,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    hx.fillStyle = g;
    hx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
  }
  // Tread rails: dashed dark arcs = individual tread-plate impressions.
  hx.strokeStyle = 'rgba(0,0,0,0.30)';
  hx.lineWidth = Math.max(2, ppi * 0.45);
  hx.setLineDash([ppi * 0.32, ppi * 0.2]);
  for (const t of treads) {
    for (const side of [-0.5, 0.5]) {
      hx.beginPath();
      hx.arc(t.cx, t.cy, t.r + t.gauge * side, t.a0, t.a0 + t.a1);
      hx.stroke();
    }
  }
  hx.setLineDash([]);

  const normalCanvas = normalFromHeight(hx, cw, ch, 2.2, false);

  /* ---- ALBEDO ----------------------------------------------------------- */
  const alb = makeCanvas(cw, ch);
  const ax = alb.ctx;
  ax.lineCap = 'round';
  ax.lineJoin = 'round';
  // Base: cool ash grey with a faint diagonal drift. Everything stays in the
  // 0.05–0.35 luminance band, near-zero saturation, for overlay readability.
  const baseGrad = ax.createLinearGradient(0, 0, cw, ch);
  baseGrad.addColorStop(0, '#26282c');
  baseGrad.addColorStop(0.5, '#1f2125');
  baseGrad.addColorStop(1, '#242629');
  ax.fillStyle = baseGrad;
  ax.fillRect(0, 0, cw, ch);
  // Per-cell tonal variation: each cracked-earth plate gets its own faint
  // warm/cool grey so the cells read even before the cracks do.
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * nxc + i;
      const s = 24 + Math.floor(rng() * 40);
      const warm = rng() < 0.4;
      ax.fillStyle = warm
        ? `rgba(${s + 6},${s + 2},${s},0.10)`
        : `rgba(${s},${s + 2},${s + 5},0.10)`;
      ax.beginPath();
      ax.moveTo(cornX[k], cornY[k]);
      ax.lineTo(cornX[k + 1], cornY[k + 1]);
      ax.lineTo(cornX[k + 1 + nxc], cornY[k + 1 + nxc]);
      ax.lineTo(cornX[k + nxc], cornY[k + nxc]);
      ax.closePath();
      ax.fill();
    }
  }
  // Modulate by the finished height layer — one composited drawImage keys
  // albedo grain to relief (crack shadows, drift highlights) for free.
  overlayDetail(ax, height.canvas, 0.35);
  // Fine rubble flecks / ash grit.
  const nFleck = Math.round(1400 * detail * ((cw * ch) / (2048 * 1500)));
  for (let i = 0; i < nFleck; i++) {
    const s = 16 + Math.floor(rng() * 34);
    ax.fillStyle = `rgba(${s},${s + 1},${s + 3},${0.05 + rng() * 0.08})`;
    const fs = (0.6 + rng() * 2.6) * (cw / 1024);
    ax.fillRect(rng() * cw, rng() * ch, fs, fs * (0.5 + rng()));
  }
  // Crack lines: soft dark shoulder + near-black core.
  ax.strokeStyle = 'rgba(12,10,9,0.35)';
  ax.lineWidth = Math.max(2.5, ppi * 0.1);
  for (const c of cracks) strokePoly(ax, c);
  ax.strokeStyle = 'rgba(9,8,7,0.6)';
  ax.lineWidth = Math.max(1.2, ppi * 0.045);
  for (const c of cracks) strokePoly(ax, c);
  // Scorch rings: charred centre, faint ember-warm cooled rim (the only
  // saturation on the mat besides the emissive cracks — kept very low alpha).
  for (const s of scorches) {
    const g = ax.createRadialGradient(s.x, s.y, s.r * 0.08, s.x, s.y, s.r);
    g.addColorStop(0, 'rgba(9,8,7,0.5)');
    g.addColorStop(0.45, 'rgba(13,11,9,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ax.fillStyle = g;
    ax.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
    ax.strokeStyle = `rgba(122,58,26,${0.06 + rng() * 0.06})`;
    ax.lineWidth = Math.max(1, ppi * 0.05);
    ax.beginPath();
    ax.arc(s.x, s.y, s.r * (0.45 + rng() * 0.3), 0, TAU);
    ax.stroke();
  }
  // Tread arcs: dashed plate marks + a continuous faint rail line.
  for (const t of treads) {
    for (const side of [-0.5, 0.5]) {
      const rr = t.r + t.gauge * side;
      ax.strokeStyle = 'rgba(13,12,11,0.40)';
      ax.lineWidth = Math.max(2, ppi * 0.42);
      ax.setLineDash([ppi * 0.32, ppi * 0.2]);
      ax.beginPath();
      ax.arc(t.cx, t.cy, rr, t.a0, t.a0 + t.a1);
      ax.stroke();
      ax.setLineDash([]);
      ax.strokeStyle = 'rgba(40,39,38,0.18)';
      ax.lineWidth = Math.max(1, ppi * 0.08);
      ax.beginPath();
      ax.arc(t.cx, t.cy, rr, t.a0, t.a0 + t.a1);
      ax.stroke();
    }
  }
  // Dust drifts: pale desaturated smears aligned with the wind.
  for (const dr of drifts) {
    ax.save();
    ax.translate(dr.x, dr.y);
    ax.rotate(dr.ang);
    ax.scale(1, 0.22);
    const g = ax.createRadialGradient(0, 0, 1, 0, 0, dr.len);
    g.addColorStop(0, 'rgba(122,118,110,0.09)');
    g.addColorStop(1, 'rgba(122,118,110,0)');
    ax.fillStyle = g;
    ax.beginPath();
    ax.arc(0, 0, dr.len, 0, TAU);
    ax.fill();
    ax.restore();
  }
  // Damp patches darken slightly (roughness map dips at the same spots).
  for (const wp of wets) {
    const g = ax.createRadialGradient(wp.x, wp.y, 1, wp.x, wp.y, wp.r);
    g.addColorStop(0, 'rgba(10,12,14,0.18)');
    g.addColorStop(1, 'rgba(10,12,14,0)');
    ax.fillStyle = g;
    ax.fillRect(wp.x - wp.r, wp.y - wp.r, wp.r * 2, wp.r * 2);
  }

  /* ---- ROUGHNESS (0.6..0.98; wet patches are the glossy floor) ---------- */
  const rough = makeCanvas(cw >> 1 || 1, ch >> 1 || 1);
  const rx = rough.ctx;
  rx.scale(0.5, 0.5); // roughness is low-frequency — half res, same coords
  rx.lineCap = 'round';
  rx.fillStyle = '#e0e0e0'; // ~0.88 base: dry ash is very rough
  rx.fillRect(0, 0, cw, ch);
  overlayDetail(rx, height.canvas, 0.25); // keeps result ~0.84..0.94
  rx.strokeStyle = 'rgba(248,248,248,0.5)'; // cracks: crumbly, rougher
  rx.lineWidth = Math.max(2, ppi * 0.09);
  for (const c of cracks) strokePoly(rx, c);
  for (const s of scorches) {
    // Glazed burn centres are a touch smoother.
    const g = rx.createRadialGradient(s.x, s.y, 1, s.x, s.y, s.r * 0.8);
    g.addColorStop(0, 'rgba(178,178,178,0.5)');
    g.addColorStop(1, 'rgba(178,178,178,0)');
    rx.fillStyle = g;
    rx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
  }
  for (const wp of wets) {
    // Wet floor: pulls roughness down toward 0.6 so patches catch the light.
    const g = rx.createRadialGradient(wp.x, wp.y, 1, wp.x, wp.y, wp.r);
    g.addColorStop(0, 'rgba(153,153,153,0.85)');
    g.addColorStop(0.7, 'rgba(165,165,165,0.4)');
    g.addColorStop(1, 'rgba(165,165,165,0)');
    rx.fillStyle = g;
    rx.fillRect(wp.x - wp.r, wp.y - wp.r, wp.r * 2, wp.r * 2);
  }

  /* ---- EMISSIVE: sparse hot ember cracks feeding the bloom pass --------- */
  // Mostly black; a few "hot zones" pick up crack segments that still glow.
  // Half resolution is plenty — bloom blurs it anyway.
  const emis = makeCanvas(cw >> 1 || 1, ch >> 1 || 1);
  const ex = emis.ctx;
  ex.fillStyle = '#000000';
  ex.fillRect(0, 0, emis.canvas.width, emis.canvas.height);
  ex.scale(0.5, 0.5); // draw in full-res coordinates
  ex.lineCap = 'round';
  ex.lineJoin = 'round';
  const zones: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < 3; i++) {
    zones.push({ x: rng() * cw, y: rng() * ch, r: (5 + rng() * 4) * ppi });
  }
  const hot: Pt[][] = [];
  for (const c of cracks) {
    if (hot.length >= 42) break;
    const m = c[Math.floor(c.length / 2)];
    for (const z of zones) {
      const dx = m.x - z.x;
      const dy = m.y - z.y;
      if (dx * dx + dy * dy < z.r * z.r && rng() < 0.55) {
        hot.push(c);
        break;
      }
    }
  }
  // Wide faint halo, then a thin hot core (0xff5a22-ish), then white-hot nodes.
  ex.strokeStyle = 'rgba(255,80,26,0.22)';
  ex.lineWidth = Math.max(5, ppi * 0.22);
  for (const c of hot) strokePoly(ex, c);
  ex.strokeStyle = 'rgba(255,90,34,0.9)';
  ex.lineWidth = Math.max(1.6, ppi * 0.06);
  for (const c of hot) strokePoly(ex, c);
  ex.fillStyle = 'rgba(255,161,78,0.9)';
  for (const c of hot) {
    if (rng() < 0.5) continue;
    const m = c[1 + Math.floor(rng() * (c.length - 2))];
    ex.beginPath();
    ex.arc(m.x, m.y, Math.max(1.5, ppi * 0.05), 0, TAU);
    ex.fill();
  }
  // A handful of lone embers glinting in the ash away from the zones.
  for (let i = 0; i < Math.round(14 * detail); i++) {
    ex.fillStyle = `rgba(255,${70 + Math.floor(rng() * 60)},30,${0.35 + rng() * 0.4})`;
    ex.beginPath();
    ex.arc(rng() * cw, rng() * ch, Math.max(1, ppi * 0.03), 0, TAU);
    ex.fill();
  }

  return bundle(
    toTexture(alb.canvas, { srgb: true }),
    toTexture(normalCanvas, {}),
    toTexture(rough.canvas, {}),
    toTexture(emis.canvas, { srgb: true }),
  );
}

/* ------------------------------------------------------------------------ */
/*                                 STONE SET                                 */
/* ------------------------------------------------------------------------ */

/**
 * Tileable dark gothic ashlar masonry (RepeatWrapping, square, res
 * q.texturePx/2). Staggered block courses with recessed mortar seams, corner
 * chips and vertical grime streaks. Seamlessness strategy:
 *  - course boundaries span 0..R exactly (top/bottom edges are mortar lines),
 *  - per-course block boundaries repeat with period R (jitter indexed mod
 *    cols) and every block is drawn twice at x and x−R,
 *  - grime streaks and the fBm grain use torus stamping / periodic lattices.
 */
export function makeStoneSet(q: GfxQuality, seed: number): PBRSet {
  const rng = sRNG(seed);
  const detail = tierDetail(q);
  const R = Math.max(256, Math.round(q.texturePx / 2));
  const rows = 8;
  const cols = 5;
  const rowH = R / rows;
  const bw = R / cols;
  const mortar = Math.max(3, R * 0.008);

  // Course boundaries (exact 0..R span ⇒ vertical wrap is trivially clean).
  const by = new Float32Array(rows + 1);
  for (let j = 0; j <= rows; j++) {
    by[j] =
      j === 0 || j === rows ? j * rowH : j * rowH + (rng() - 0.5) * rowH * 0.14;
  }

  // Blocks, with all per-layer parameters decided once so albedo / height /
  // roughness stay in perfect registration.
  interface Block {
    x: number;
    y: number;
    w: number;
    h: number;
    shade: number; // albedo grey
    hshade: number; // height brightness 0..255
    chip: number; // 0..3 chipped corner count
  }
  const blocks: Block[] = [];
  for (let j = 0; j < rows; j++) {
    const base = rng() * bw; // per-course stagger
    const jit = new Float32Array(cols);
    for (let k = 0; k < cols; k++) jit[k] = (rng() - 0.5) * bw * 0.24;
    for (let k = 0; k < cols; k++) {
      const x0 = base + k * bw + jit[k];
      const x1 = base + (k + 1) * bw + jit[(k + 1) % cols];
      blocks.push({
        x: x0,
        y: by[j],
        w: x1 - x0,
        h: by[j + 1] - by[j],
        shade: 40 + Math.floor(rng() * 22),
        hshade: 145 + Math.floor(rng() * 45),
        chip: rng() < 0.4 ? 1 + Math.floor(rng() * 2) : 0,
      });
    }
  }

  // Periodic fBm grain shared by all layers (stone tooling / weathering).
  const grain = grayFromField(R, R, fbm(R, R, 5, 5, 4, rng), 0.25, 0.75);

  /* ---- HEIGHT ----------------------------------------------------------- */
  const hgt = makeCanvas(R, R, true);
  const hx = hgt.ctx;
  hx.fillStyle = '#4a4a4a'; // mortar depth
  hx.fillRect(0, 0, R, R);
  const drawBlockTwice = (
    ctx: CanvasRenderingContext2D,
    b: Block,
    fill: string,
  ): void => {
    ctx.fillStyle = fill;
    for (const ox of [0, -R]) {
      rrect(
        ctx,
        b.x + ox + mortar * 0.5,
        b.y + mortar * 0.5,
        b.w - mortar,
        b.h - mortar,
        mortar * 1.4,
      );
      ctx.fill();
    }
  };
  for (const b of blocks) {
    const v = b.hshade;
    drawBlockTwice(hx, b, `rgb(${v},${v},${v})`);
  }
  overlayDetail(hx, grain.canvas, 0.3);
  // Chips: dark bites out of block corners (height only needs the recess;
  // albedo adds the fresh-fracture tone below).
  const chipAt = (
    ctx: CanvasRenderingContext2D,
    b: Block,
    fill: string,
    r2: () => number,
  ): void => {
    for (let c = 0; c < b.chip; c++) {
      const cxr = r2() < 0.5 ? b.x + mortar : b.x + b.w - mortar;
      const cyr = r2() < 0.5 ? b.y + mortar : b.y + b.h - mortar;
      const s = (0.06 + r2() * 0.12) * Math.min(b.w, b.h);
      ctx.fillStyle = fill;
      for (const ox of [0, -R]) {
        ctx.beginPath();
        ctx.moveTo(cxr + ox - s, cyr);
        ctx.lineTo(cxr + ox + s * (r2() - 0.5) * 2, cyr - s);
        ctx.lineTo(cxr + ox + s, cyr + s * 0.6);
        ctx.closePath();
        ctx.fill();
      }
    }
  };
  // Deterministic chip placement must match across layers ⇒ dedicated RNG
  // seeded from the same master stream, re-created per layer.
  const chipSeed = Math.floor(rng() * 0xffffffff);
  {
    const cr = sRNG(chipSeed);
    for (const b of blocks) chipAt(hx, b, 'rgba(40,40,40,0.8)', cr);
  }
  const stoneNormal = normalFromHeight(hx, R, R, 2.6, true);

  /* ---- ALBEDO ------------------------------------------------------------ */
  const alb = makeCanvas(R, R);
  const ax = alb.ctx;
  ax.fillStyle = '#141518'; // deep mortar shadow
  ax.fillRect(0, 0, R, R);
  for (const b of blocks) {
    const s = b.shade;
    drawBlockTwice(ax, b, `rgb(${s},${s + 2},${s + 5})`); // cold grey-blue
    // Bevel: lit top/left edge, shadowed bottom/right — sells the relief even
    // at grazing view angles where the normal map fades.
    for (const ox of [0, -R]) {
      const x = b.x + ox + mortar;
      const y = b.y + mortar;
      const w = b.w - mortar * 2;
      const h = b.h - mortar * 2;
      ax.strokeStyle = 'rgba(210,220,235,0.07)';
      ax.lineWidth = Math.max(1, R * 0.0015);
      ax.beginPath();
      ax.moveTo(x, y + h);
      ax.lineTo(x, y);
      ax.lineTo(x + w, y);
      ax.stroke();
      ax.strokeStyle = 'rgba(0,0,0,0.35)';
      ax.beginPath();
      ax.moveTo(x + w, y);
      ax.lineTo(x + w, y + h);
      ax.lineTo(x, y + h);
      ax.stroke();
    }
  }
  overlayDetail(ax, grain.canvas, 0.22);
  {
    const cr = sRNG(chipSeed);
    for (const b of blocks) chipAt(ax, b, 'rgba(15,16,18,0.75)', cr);
  }
  // Grime streaks: soot bleeding down from under random blocks.
  const nGrime = Math.round(rows * cols * 0.5 * detail) + 4;
  for (let i = 0; i < nGrime; i++) {
    const b = blocks[Math.floor(rng() * blocks.length)];
    const gx = b.x + rng() * b.w;
    const gy = b.y + b.h;
    const glen = rowH * (0.6 + rng() * 1.6);
    const gw = bw * (0.06 + rng() * 0.12);
    stampWrapped(ax, R, ((gx % R) + R) % R, gy, glen, () => {
      const g = ax.createLinearGradient(0, gy, 0, gy + glen);
      g.addColorStop(0, 'rgba(8,8,9,0.30)');
      g.addColorStop(1, 'rgba(8,8,9,0)');
      ax.fillStyle = g;
      ax.fillRect(gx - gw / 2, gy, gw, glen);
      ax.fillRect(gx - gw / 2 - R, gy, gw, glen); // horizontal wrap partner
    });
  }

  /* ---- ROUGHNESS ---------------------------------------------------------- */
  const rough = makeCanvas(R, R);
  const rx = rough.ctx;
  rx.fillStyle = '#ececec'; // mortar: very rough
  rx.fillRect(0, 0, R, R);
  for (const b of blocks) {
    const v = 196 + Math.floor((b.shade - 40) * 1.4); // worn faces slightly smoother
    drawBlockTwice(rx, b, `rgb(${v},${v},${v})`);
  }
  overlayDetail(rx, grain.canvas, 0.2);

  return bundle(
    toTexture(alb.canvas, { srgb: true, tile: true }),
    toTexture(stoneNormal, { tile: true }),
    toTexture(rough.canvas, { tile: true }),
  );
}

/* ------------------------------------------------------------------------ */
/*                                 METAL SET                                 */
/* ------------------------------------------------------------------------ */

/**
 * Tileable near-black iron (RepeatWrapping, square, res q.texturePx/2):
 * brushed horizontal streaks, an exact-period panel grid with seam highlights
 * and rivets, and clustered rust patina blotches. Brushed streaks span the
 * full width (trivially wrap in X, 1px tall in Y); panels/rivets sit on a
 * period-R grid; rust decals are torus-stamped.
 */
export function makeMetalSet(q: GfxQuality, seed: number): PBRSet {
  const rng = sRNG(seed);
  const detail = tierDetail(q);
  const R = Math.max(256, Math.round(q.texturePx / 2));
  const panels = 4;
  const P = R / panels;

  // Shared placement lists so albedo / height / roughness stay registered.
  const streaks: { y: number; v: number; a: number }[] = [];
  const nStreak = Math.round(R * 1.1 * detail);
  for (let i = 0; i < nStreak; i++) {
    streaks.push({
      y: rng() * R,
      v: rng() < 0.5 ? 6 + Math.floor(rng() * 18) : 70 + Math.floor(rng() * 55),
      a: 0.015 + rng() * 0.04,
    });
  }
  const rusts: { x: number; y: number; r: number }[] = [];
  const nRust = Math.round(22 * detail) + 6;
  for (let i = 0; i < nRust; i++) {
    // Bias rust toward panel seams where water would sit.
    const onSeam = rng() < 0.55;
    const seam = Math.floor(rng() * panels) * P;
    const x = onSeam && rng() < 0.5 ? seam + (rng() - 0.5) * P * 0.16 : rng() * R;
    const y = onSeam && !(rng() < 0.5) ? seam + (rng() - 0.5) * P * 0.16 : rng() * R;
    rusts.push({
      x: ((x % R) + R) % R,
      y: ((y % R) + R) % R,
      r: R * (0.02 + rng() * 0.06),
    });
  }
  const panelTint = new Float32Array(panels * panels);
  for (let i = 0; i < panelTint.length; i++) panelTint[i] = rng();

  const grain = grayFromField(R, R, fbm(R, R, 6, 6, 4, rng), 0.3, 0.7);

  const drawStreaks = (
    ctx: CanvasRenderingContext2D,
    alphaScale: number,
  ): void => {
    ctx.lineWidth = 1;
    for (const s of streaks) {
      ctx.strokeStyle = `rgba(${s.v},${s.v},${s.v + 4},${s.a * alphaScale})`;
      ctx.beginPath();
      ctx.moveTo(0, s.y);
      ctx.lineTo(R, s.y);
      ctx.stroke();
    }
  };
  const drawSeams = (
    ctx: CanvasRenderingContext2D,
    dark: string,
    darkW: number,
    light: string | null,
  ): void => {
    for (let k = 0; k <= panels; k++) {
      const c = k * P;
      ctx.strokeStyle = dark;
      ctx.lineWidth = darkW;
      ctx.beginPath();
      ctx.moveTo(c, 0);
      ctx.lineTo(c, R);
      ctx.moveTo(0, c);
      ctx.lineTo(R, c);
      ctx.stroke();
      if (light) {
        ctx.strokeStyle = light;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(c + darkW, 0);
        ctx.lineTo(c + darkW, R);
        ctx.moveTo(0, c + darkW);
        ctx.lineTo(R, c + darkW);
        ctx.stroke();
      }
    }
  };
  // Rivets sit at fixed insets inside each panel corner ⇒ period-R positions.
  const rivetR = Math.max(2, R * 0.006);
  const rivetD = P * 0.07;
  const eachRivet = (fn: (x: number, y: number) => void): void => {
    for (let py = 0; py < panels; py++) {
      for (let px = 0; px < panels; px++) {
        const x0 = px * P;
        const y0 = py * P;
        fn(x0 + rivetD, y0 + rivetD);
        fn(x0 + P - rivetD, y0 + rivetD);
        fn(x0 + rivetD, y0 + P - rivetD);
        fn(x0 + P - rivetD, y0 + P - rivetD);
      }
    }
  };

  /* ---- HEIGHT ----------------------------------------------------------- */
  const hgt = makeCanvas(R, R, true);
  const hx = hgt.ctx;
  hx.fillStyle = '#808080';
  hx.fillRect(0, 0, R, R);
  overlayDetail(hx, grain.canvas, 0.12);
  drawStreaks(hx, 1.2);
  drawSeams(hx, 'rgba(0,0,0,0.5)', Math.max(2, R * 0.003), null);
  eachRivet((x, y) => {
    hx.fillStyle = 'rgba(235,235,235,0.85)';
    hx.beginPath();
    hx.arc(x, y, rivetR, 0, TAU);
    hx.fill();
  });
  for (const ru of rusts) {
    // Rust eats into the surface — shallow pitted depression.
    stampWrapped(hx, R, ru.x, ru.y, ru.r, () => {
      const g = hx.createRadialGradient(ru.x, ru.y, 1, ru.x, ru.y, ru.r);
      g.addColorStop(0, 'rgba(30,30,30,0.22)');
      g.addColorStop(1, 'rgba(30,30,30,0)');
      hx.fillStyle = g;
      hx.fillRect(ru.x - ru.r, ru.y - ru.r, ru.r * 2, ru.r * 2);
    });
  }
  const metalNormal = normalFromHeight(hx, R, R, 1.8, true);

  /* ---- ALBEDO ------------------------------------------------------------ */
  const alb = makeCanvas(R, R);
  const ax = alb.ctx;
  ax.fillStyle = '#121317'; // near-black cold iron
  ax.fillRect(0, 0, R, R);
  // Faint per-panel tonal steps so big flat hulls don't read as one slab.
  for (let py = 0; py < panels; py++) {
    for (let px = 0; px < panels; px++) {
      const t = panelTint[py * panels + px];
      ax.fillStyle =
        t < 0.5
          ? `rgba(0,0,0,${0.05 * (1 - t * 2)})`
          : `rgba(150,158,172,${0.035 * (t * 2 - 1)})`;
      ax.fillRect(px * P, py * P, P, P);
    }
  }
  overlayDetail(ax, grain.canvas, 0.15);
  drawStreaks(ax, 1);
  drawSeams(
    ax,
    'rgba(0,0,0,0.55)',
    Math.max(2, R * 0.003),
    'rgba(170,180,200,0.06)',
  );
  eachRivet((x, y) => {
    const g = ax.createRadialGradient(
      x - rivetR * 0.4,
      y - rivetR * 0.4,
      rivetR * 0.1,
      x,
      y,
      rivetR * 1.3,
    );
    g.addColorStop(0, 'rgba(120,128,142,0.5)');
    g.addColorStop(0.6, 'rgba(30,32,36,0.6)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ax.fillStyle = g;
    ax.beginPath();
    ax.arc(x, y, rivetR * 1.3, 0, TAU);
    ax.fill();
  });
  // Rust patina: warm oxide blotch + a spatter of darker speckles around it.
  for (const ru of rusts) {
    stampWrapped(ax, R, ru.x, ru.y, ru.r * 1.4, () => {
      const g = ax.createRadialGradient(ru.x, ru.y, 1, ru.x, ru.y, ru.r);
      g.addColorStop(0, 'rgba(96,52,26,0.34)');
      g.addColorStop(0.6, 'rgba(70,38,20,0.18)');
      g.addColorStop(1, 'rgba(70,38,20,0)');
      ax.fillStyle = g;
      ax.fillRect(ru.x - ru.r, ru.y - ru.r, ru.r * 2, ru.r * 2);
      ax.fillStyle = 'rgba(118,58,26,0.35)';
      for (let s = 0; s < 7; s++) {
        const a = rng() * TAU;
        const d = rng() * ru.r * 1.3;
        ax.beginPath();
        ax.arc(
          ru.x + Math.cos(a) * d,
          ru.y + Math.sin(a) * d,
          0.6 + rng() * (R * 0.0025),
          0,
          TAU,
        );
        ax.fill();
      }
    });
  }

  /* ---- ROUGHNESS ---------------------------------------------------------- */
  const rough = makeCanvas(R, R);
  const rx = rough.ctx;
  rx.fillStyle = '#8f8f8f'; // ~0.56: worn brushed iron, dull but not matte
  rx.fillRect(0, 0, R, R);
  overlayDetail(rx, grain.canvas, 0.18);
  drawStreaks(rx, 1.6); // anisotropic-ish gloss variation along the brush
  drawSeams(rx, 'rgba(230,230,230,0.35)', Math.max(2, R * 0.003), null);
  for (const ru of rusts) {
    // Oxide is porous ⇒ much rougher than the surrounding metal.
    stampWrapped(rx, R, ru.x, ru.y, ru.r, () => {
      const g = rx.createRadialGradient(ru.x, ru.y, 1, ru.x, ru.y, ru.r);
      g.addColorStop(0, 'rgba(238,238,238,0.7)');
      g.addColorStop(1, 'rgba(238,238,238,0)');
      rx.fillStyle = g;
      rx.fillRect(ru.x - ru.r, ru.y - ru.r, ru.r * 2, ru.r * 2);
    });
  }

  return bundle(
    toTexture(alb.canvas, { srgb: true, tile: true }),
    toTexture(metalNormal, { tile: true }),
    toTexture(rough.canvas, { tile: true }),
  );
}

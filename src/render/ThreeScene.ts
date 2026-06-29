import * as THREE from 'three';
import type {
  GameState,
  Objective,
  PlayerId,
  ProxyDescriptor,
  UnitInstance,
  Vec2,
} from '../engine/types';
import type { PickResult, SceneController } from './SceneController';
import {
  ModelLibrary,
  resolveModelEntry,
  type ModelRegistryEntry,
} from './ModelRegistry';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Three.js implementation of the renderer contract.
 *
 * Design goals:
 *  - Grimdark atmosphere: dark fog, filmic tone mapping, soft shadows.
 *  - Cheap & idempotent sync(): meshes are created lazily and cached; per-frame
 *    work is just transform updates, so calling sync() every frame is fine.
 *  - Robust input: a hand-rolled orbit/pan/zoom controller built on pointer
 *    events (no fragile example imports for the core experience).
 *
 * Coordinate convention: table coords are inches, origin bottom-left, X in
 * [0,width], Y in [0,height]. We map onto the XZ plane (y = up):
 *    worldX = tableX - width/2
 *    worldZ = -(tableY - height/2)
 * See tableToWorld / worldToTable.
 */

/* --------------------------- small math helpers --------------------------- */

const TAU = Math.PI * 2;
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ----------------------------- per-unit cache ----------------------------- */

interface ModelVisual {
  /** The whole model: base + body, positioned at table location. */
  group: THREE.Group;
  /**
   * The body sub-group (procedural silhouette OR a real glTF clone). Swapped in
   * place when an async GLB load completes; the base ring lives directly on
   * `group` so it shows immediately and survives the swap.
   */
  body: THREE.Group;
  /** Cached "alive" flag so we can detect death transitions. */
  alive: boolean;
  /** Animation progress for the death sink (1 = fully alive, 0 = sunk). */
  vitality: number;
}

interface UnitVisual {
  group: THREE.Group;
  models: ModelVisual[];
  ownerId: PlayerId;
  /** Optional imported model that replaces the procedural proxies. */
  imported?: THREE.Object3D;
}

/* ------------------------------ overlay types ----------------------------- */

interface FloatingNumber {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  baseY: number;
}

export class ThreeScene implements SceneController {
  /* --- three core --- */
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private container!: HTMLElement;
  private clock = new THREE.Clock();

  /* --- board --- */
  private board = { width: 60, height: 44 };
  private boardGroup = new THREE.Group();

  /* --- units / objectives --- */
  private unitVisuals = new Map<string, UnitVisual>();
  private objectiveMeshes = new Map<string, THREE.Mesh>();
  private unitsGroup = new THREE.Group();
  private objectivesGroup = new THREE.Group();

  /* --- overlays --- */
  private overlayGroup = new THREE.Group();
  private highlightRing: THREE.Mesh | null = null;
  private highlightedUnit: string | null = null;
  private targetRings = new Map<string, THREE.Mesh>();
  private floatingNumbers: FloatingNumber[] = [];

  /* --- selection/target ring template materials --- */
  private ringGeoCache = new Map<string, THREE.RingGeometry>();

  /* --- shared geometry / material caches (perf) --- */
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private matCache = new Map<string, THREE.Material>();

  /* --- real-model loader (GLB cache + per-model clones) --- */
  private modelLibrary = new ModelLibrary();

  /* --- input --- */
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private pickHandler: ((r: PickResult) => void) | null = null;
  private hoverHandler: ((r: PickResult) => void) | null = null;

  /* --- camera orbit state (hand-rolled controls) --- */
  private orbitTarget = new THREE.Vector3(0, 0, 0);
  private orbitAzimuth = 0.6; // radians around Y
  private orbitPolar = 0.95; // radians from +Y axis (down-tilt)
  private orbitRadius = 70;
  private orbitMinRadius = 12;
  private orbitMaxRadius = 220;
  // smoothed targets for inertia
  private targetAzimuth = 0.6;
  private targetPolar = 0.95;
  private targetRadius = 70;
  private targetPivot = new THREE.Vector3(0, 0, 0);

  private dragMode: 'none' | 'orbit' | 'pan' = 'none';
  private lastPointer = { x: 0, y: 0 };
  private movedDuringDrag = false;
  private activePointerId: number | null = null;

  private rafId = 0;
  private disposed = false;

  /* --- postprocessing (gentle bloom so glow/objectives pop) --- */
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;

  /* ============================== lifecycle ============================== */

  init(container: HTMLElement, state: GameState): void {
    this.container = container;
    this.board = { width: state.board.width, height: state.board.height };

    /* renderer */
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';

    /* scene + grimdark atmosphere */
    this.scene = new THREE.Scene();
    const bg = new THREE.Color(0x0a0c10);
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(0x0a0c10, this.board.width * 0.9, this.board.width * 2.6);

    /* camera */
    this.camera = new THREE.PerspectiveCamera(
      50,
      (container.clientWidth || 800) / (container.clientHeight || 600),
      0.1,
      1000,
    );

    /* lights */
    this.setupLights();

    /* world graph */
    this.scene.add(this.boardGroup);
    this.scene.add(this.objectivesGroup);
    this.scene.add(this.unitsGroup);
    this.scene.add(this.overlayGroup);

    this.buildBoard();
    this.buildTerrain(state);

    /* postprocessing (optional, robust): gentle bloom for glow + objectives */
    this.setupComposer();

    /* input + sizing */
    this.attachInput();
    this.resize();
    this.frameBoard();

    /* initial population */
    this.sync(state);

    /* render loop */
    this.clock.start();
    this.animate();
  }

  private setupLights(): void {
    // Hemisphere fill: cold sky, warm-ish ground bounce, kept dim for grimdark.
    const hemi = new THREE.HemisphereLight(0x6c7a96, 0x201a12, 0.9);
    this.scene.add(hemi);

    // Key directional light with shadows — raking angle for drama.
    const key = new THREE.DirectionalLight(0xfff2d8, 2.7);
    key.position.set(this.board.width * 0.4, this.board.width * 0.9, this.board.height * 0.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const span = Math.max(this.board.width, this.board.height) * 0.75;
    const cam = key.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 1;
    cam.far = this.board.width * 3;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    // Subtle cold fill from the opposite side, no shadows.
    const fill = new THREE.DirectionalLight(0x6a86ff, 0.6);
    fill.position.set(-this.board.width * 0.5, this.board.width * 0.4, -this.board.height * 0.4);
    this.scene.add(fill);
  }

  /**
   * Build an EffectComposer with a gentle UnrealBloom so Necron glow and
   * objective beacons pop. Wrapped in try/catch and a manual capability check:
   * if the GL context can't support the float targets bloom needs (e.g. some
   * headless contexts), we silently fall back to direct rendering — the scene
   * still looks good thanks to tuned emissive/lighting.
   */
  private setupComposer(): void {
    try {
      const size = new THREE.Vector2();
      this.renderer.getSize(size);
      const w = Math.max(1, size.x);
      const h = Math.max(1, size.y);

      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));

      // Keep the bloom gentle: low strength, generous threshold so only the
      // brightest emissive (glow/objectives) blooms, not the whole board.
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(w, h),
        0.55, // strength
        0.65, // radius
        0.82, // threshold (only bright emissive blooms)
      );
      composer.addPass(bloom);

      // OutputPass applies tone mapping + colour space conversion correctly when
      // rendering through a composer.
      composer.addPass(new OutputPass());

      composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      composer.setSize(w, h);

      this.composer = composer;
      this.bloomPass = bloom;
    } catch (err) {
      // Robust fallback: no composer, render directly. Never break the scene.
      console.warn('[ThreeScene] bloom composer unavailable, rendering directly', err);
      this.composer = null;
      this.bloomPass = null;
    }
  }

  /* ============================ coordinate maps ============================ */

  private tableToWorld(p: Vec2, y = 0): THREE.Vector3 {
    return new THREE.Vector3(p.x - this.board.width / 2, y, -(p.y - this.board.height / 2));
  }

  private worldToTable(v: THREE.Vector3): Vec2 {
    return { x: v.x + this.board.width / 2, y: -v.z + this.board.height / 2 };
  }

  /* ============================== board build ============================= */

  private buildBoard(): void {
    const { width, height } = this.board;

    // Procedural battlemat texture: dark ash with a faint 12" grid.
    const mat = new THREE.MeshStandardMaterial({
      map: this.makeBattlematTexture(width, height),
      roughness: 0.95,
      metalness: 0.0,
      color: 0xffffff,
    });
    const boardGeo = new THREE.PlaneGeometry(width, height, 1, 1);
    boardGeo.rotateX(-Math.PI / 2); // lie flat on XZ
    const boardMesh = new THREE.Mesh(boardGeo, mat);
    boardMesh.receiveShadow = true;
    boardMesh.name = 'battlemat';
    this.boardGroup.add(boardMesh);

    // Raised rim around the edge.
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x1b1f26,
      roughness: 0.6,
      metalness: 0.4,
    });
    const rimT = 1.4; // thickness inches
    const rimH = 0.9; // height inches
    const makeRim = (w: number, d: number, x: number, z: number) => {
      const g = new THREE.BoxGeometry(w, rimH, d);
      const m = new THREE.Mesh(g, rimMat);
      m.position.set(x, rimH / 2 - 0.02, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.boardGroup.add(m);
    };
    makeRim(width + rimT * 2, rimT, 0, height / 2 + rimT / 2);
    makeRim(width + rimT * 2, rimT, 0, -height / 2 - rimT / 2);
    makeRim(rimT, height, width / 2 + rimT / 2, 0);
    makeRim(rimT, height, -width / 2 - rimT / 2, 0);
  }

  private makeBattlematTexture(width: number, height: number): THREE.Texture {
    const canvas = document.createElement('canvas');
    const px = 1024;
    canvas.width = px;
    canvas.height = Math.round(px * (height / width));
    const ctx = canvas.getContext('2d')!;

    // Base dark urban/ash tone.
    ctx.fillStyle = '#15171c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Procedural mottling for an ashen, weathered look.
    for (let i = 0; i < 2600; i++) {
      const r = Math.random();
      const shade = 18 + Math.floor(Math.random() * 26);
      ctx.fillStyle = `rgba(${shade},${shade + 2},${shade + 6},${0.04 + r * 0.06})`;
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      const s = 2 + Math.random() * 26;
      ctx.beginPath();
      ctx.arc(x, y, s, 0, TAU);
      ctx.fill();
    }
    // A few rust/ember streaks.
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(120,60,30,${0.03 + Math.random() * 0.05})`;
      ctx.lineWidth = 1 + Math.random() * 3;
      ctx.beginPath();
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 120, y + (Math.random() - 0.5) * 120);
      ctx.stroke();
    }

    // Cracked, weathered plating: scatter darker fault lines for depth.
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 70; i++) {
      ctx.lineWidth = 0.5 + Math.random() * 1.5;
      ctx.beginPath();
      let x = Math.random() * canvas.width;
      let y = Math.random() * canvas.height;
      ctx.moveTo(x, y);
      const segs = 2 + Math.floor(Math.random() * 4);
      for (let s = 0; s < segs; s++) {
        x += (Math.random() - 0.5) * 90;
        y += (Math.random() - 0.5) * 90;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Faint grid every 12 inches.
    const pxPerInchX = canvas.width / width;
    const pxPerInchY = canvas.height / height;
    ctx.strokeStyle = 'rgba(120,140,170,0.12)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= width; gx += 12) {
      const x = gx * pxPerInchX;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let gy = 0; gy <= height; gy += 12) {
      const y = gy * pxPerInchY;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Vignette: radial edge darkening so the board reads as a lit arena and the
    // generic flat-plane feel is reduced.
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const grad = ctx.createRadialGradient(
      cx,
      cy,
      Math.min(cx, cy) * 0.35,
      cx,
      cy,
      Math.max(cx, cy) * 1.05,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.75, 'rgba(0,0,0,0.18)');
    grad.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Draw the engine's terrain pieces 1:1 — what you see is exactly the footprint
   * the rules use for line of sight and cover. Ruins are rendered as broken-wall
   * shells (so you can see models inside), craters as sunken discs.
   */
  private buildTerrain(state: GameState): void {
    const terrainGroup = new THREE.Group();

    const ruinMat = new THREE.MeshStandardMaterial({
      color: 0x4a4438,
      roughness: 0.82,
      metalness: 0.18,
    });
    const craterMat = new THREE.MeshStandardMaterial({
      color: 0x14110d,
      roughness: 1.0,
      metalness: 0.0,
    });

    for (const t of state.terrain) {
      const c = this.tableToWorld(t.center);
      if (t.kind === 'crater') {
        const r = Math.max(t.width, t.depth) / 2;
        const geo = new THREE.CylinderGeometry(r * 0.8, r * 1.1, 0.4, 20);
        const mesh = new THREE.Mesh(geo, craterMat);
        mesh.position.set(c.x, 0.06, c.z);
        mesh.receiveShadow = true;
        terrainGroup.add(mesh);
        continue;
      }
      // Ruin: four low wall segments around the footprint with gaps (a shell).
      const hw = t.width / 2;
      const hd = t.depth / 2;
      const th = 0.6; // wall thickness
      const walls: Array<[number, number, number, number]> = [
        [0, hd, t.width, th], // back
        [0, -hd, t.width * 0.55, th], // front (gap)
        [-hw, 0, th, t.depth], // left
        [hw, 0, th, t.depth * 0.55], // right (gap)
      ];
      for (const [ox, oz, ww, dd] of walls) {
        const geo = new THREE.BoxGeometry(ww, t.height, dd);
        const mesh = new THREE.Mesh(geo, ruinMat);
        mesh.position.set(c.x + ox, t.height / 2, c.z - oz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        terrainGroup.add(mesh);
      }
      // A faint floor pad to read the footprint from above.
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(t.width, 0.12, t.depth),
        new THREE.MeshStandardMaterial({ color: 0x39342b, roughness: 0.95 }),
      );
      pad.position.set(c.x, 0.07, c.z);
      pad.receiveShadow = true;
      terrainGroup.add(pad);
    }

    this.boardGroup.add(terrainGroup);
  }

  /* ============================ shared resources ========================== */

  private getMaterial(key: string, make: () => THREE.Material): THREE.Material {
    let m = this.matCache.get(key);
    if (!m) {
      m = make();
      this.matCache.set(key, m);
    }
    return m;
  }

  private getGeometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geoCache.get(key);
    if (!g) {
      g = make();
      this.geoCache.set(key, g);
    }
    return g;
  }

  /** Standard material keyed by the proxy's visual signature, so it is shared. */
  private proxyMaterials(proxy: ProxyDescriptor): {
    primary: THREE.Material;
    secondary: THREE.Material;
  } {
    const metal = proxy.metalness ?? 0.3;
    const glow = proxy.glow ?? '';
    const pKey = `prim:${proxy.primary}:${metal}:${glow}`;
    const sKey = `sec:${proxy.secondary}:${metal}:${glow}`;
    const primary = this.getMaterial(pKey, () => {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(proxy.primary),
        metalness: metal,
        roughness: 0.55,
      });
      if (glow) {
        m.emissive = new THREE.Color(glow);
        m.emissiveIntensity = 0.6;
      }
      return m;
    });
    const secondary = this.getMaterial(sKey, () => {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(proxy.secondary),
        metalness: clamp(metal + 0.2, 0, 1),
        roughness: 0.4,
      });
      return m;
    });
    return { primary, secondary };
  }

  /* ============================== unit visuals ============================ */

  private defaultProxy(unit: UnitInstance): ProxyDescriptor {
    // Fallback proxy if the unit carries none — colour by owner.
    const owner = unit.ownerId;
    return {
      silhouette: unit.isCharacter ? 'character' : 'infantry',
      primary: owner === 'A' ? '#2b4f8e' : '#8e2b2b',
      secondary: owner === 'A' ? '#16263f' : '#3f1616',
      metalness: 0.3,
      heightInches: unit.isCharacter ? 2.4 : 1.8,
    };
  }

  /**
   * Build the faction-coloured round base (dark disc + a coloured rim ring) for
   * a single model. The base lives directly on the per-model group so it shows
   * immediately and persists whether the body is procedural or a real glTF clone.
   */
  private buildBase(proxy: ProxyDescriptor, baseRadius: number): THREE.Group {
    const g = new THREE.Group();

    // Dark plinth disc.
    const baseGeo = this.getGeometry(`base:${baseRadius.toFixed(2)}`, () =>
      new THREE.CylinderGeometry(baseRadius, baseRadius, 0.18, 24),
    );
    const baseMat = this.getMaterial('baseMat', () =>
      new THREE.MeshStandardMaterial({ color: 0x0d0e11, roughness: 0.8, metalness: 0.2 }),
    );
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.09;
    base.castShadow = true;
    base.receiveShadow = true;
    base.userData.isBase = true;
    g.add(base);

    // Faction-coloured rim ring around the top edge of the base, so even units
    // sharing a model read their colour at a glance.
    const ringGeo = this.getGeometry(`baseRing:${baseRadius.toFixed(2)}`, () => {
      const rg = new THREE.RingGeometry(baseRadius * 0.78, baseRadius, 24);
      rg.rotateX(-Math.PI / 2);
      return rg;
    });
    const ringMat = this.getMaterial(`baseRingMat:${proxy.primary}`, () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(proxy.primary),
        emissive: new THREE.Color(proxy.primary),
        emissiveIntensity: 0.35,
        roughness: 0.5,
        metalness: 0.3,
      }),
    );
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.181;
    g.add(ring);
    return g;
  }

  /** Build a procedural model body (silhouette only) for a unit's proxy. */
  private buildProceduralBody(proxy: ProxyDescriptor, baseRadius: number): THREE.Group {
    const body = new THREE.Group();
    const { primary, secondary } = this.proxyMaterials(proxy);
    const h = proxy.heightInches ?? 1.8;
    body.position.y = 0.18;

    switch (proxy.silhouette) {
      case 'infantry':
        this.buildInfantry(body, primary, secondary, h, baseRadius);
        break;
      case 'character':
        this.buildCharacter(body, primary, secondary, h, baseRadius);
        break;
      case 'monster':
        this.buildMonster(body, primary, secondary, h, baseRadius);
        break;
      case 'vehicle':
        this.buildVehicle(body, primary, secondary, h, baseRadius);
        break;
    }

    body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return body;
  }

  private addMesh(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  private buildInfantry(
    body: THREE.Group,
    primary: THREE.Material,
    secondary: THREE.Material,
    h: number,
    r: number,
  ): void {
    const w = r * 0.9;
    const legH = h * 0.4;
    const torsoH = h * 0.42;
    const headR = r * 0.34;
    // legs
    this.addMesh(body, this.getGeometry(`leg:${w}:${legH}`, () =>
      new THREE.BoxGeometry(w * 0.85, legH, w * 0.6)), secondary, 0, legH / 2, 0);
    // torso
    this.addMesh(body, this.getGeometry(`torso:${w}:${torsoH}`, () =>
      new THREE.BoxGeometry(w, torsoH, w * 0.7)), primary, 0, legH + torsoH / 2, 0);
    // head
    this.addMesh(body, this.getGeometry(`head:${headR}`, () =>
      new THREE.SphereGeometry(headR, 10, 8)), secondary, 0, legH + torsoH + headR * 0.9, 0);
    // a small shoulder weapon nub
    this.addMesh(body, this.getGeometry(`gun:${w}`, () =>
      new THREE.BoxGeometry(w * 0.2, w * 0.2, w * 1.3)), secondary, w * 0.55, legH + torsoH * 0.7, w * 0.2);
  }

  private buildCharacter(
    body: THREE.Group,
    primary: THREE.Material,
    secondary: THREE.Material,
    h: number,
    r: number,
  ): void {
    const w = r * 0.95;
    const legH = h * 0.42;
    const torsoH = h * 0.46;
    const headR = r * 0.33;
    this.addMesh(body, this.getGeometry(`cleg:${w}:${legH}`, () =>
      new THREE.BoxGeometry(w * 0.9, legH, w * 0.62)), secondary, 0, legH / 2, 0);
    this.addMesh(body, this.getGeometry(`ctorso:${w}:${torsoH}`, () =>
      new THREE.BoxGeometry(w * 1.05, torsoH, w * 0.75)), primary, 0, legH + torsoH / 2, 0);
    this.addMesh(body, this.getGeometry(`chead:${headR}`, () =>
      new THREE.SphereGeometry(headR, 10, 8)), secondary, 0, legH + torsoH + headR, 0);
    // Cloak: a thin tapered slab behind the torso.
    const cloak = this.addMesh(body, this.getGeometry(`cloak:${w}:${h}`, () =>
      new THREE.BoxGeometry(w * 1.2, torsoH * 1.3, w * 0.12)), primary, 0, legH + torsoH * 0.55, -w * 0.42);
    cloak.rotation.x = -0.12;
    // Banner pole + flag accent (secondary colour, slight glow look via emissive
    // is left to material; here just a tall thin pole + flag).
    this.addMesh(body, this.getGeometry('pole', () =>
      new THREE.CylinderGeometry(0.04, 0.04, h * 1.1, 6)), secondary, w * 0.6, legH + torsoH + h * 0.2, -w * 0.2);
    this.addMesh(body, this.getGeometry(`flag:${w}`, () =>
      new THREE.BoxGeometry(w * 0.5, h * 0.5, 0.04)), primary, w * 0.85, legH + torsoH + h * 0.5, -w * 0.2);
  }

  private buildMonster(
    body: THREE.Group,
    primary: THREE.Material,
    secondary: THREE.Material,
    h: number,
    r: number,
  ): void {
    const w = r * 1.4;
    const legH = h * 0.38;
    const torsoH = h * 0.5;
    // hunched bulky torso
    this.addMesh(body, this.getGeometry(`mleg:${w}:${legH}`, () =>
      new THREE.BoxGeometry(w * 1.1, legH, w * 0.9)), secondary, 0, legH / 2, 0);
    const torso = this.addMesh(body, this.getGeometry(`mtorso:${w}:${torsoH}`, () =>
      new THREE.BoxGeometry(w * 1.25, torsoH, w)), primary, 0, legH + torsoH / 2, 0);
    torso.rotation.x = 0.15;
    // head low and forward
    this.addMesh(body, this.getGeometry(`mhead:${r}`, () =>
      new THREE.SphereGeometry(r * 0.5, 10, 8)), secondary, 0, legH + torsoH * 0.9, w * 0.5);
    // two arms / claws
    this.addMesh(body, this.getGeometry(`marm:${w}`, () =>
      new THREE.BoxGeometry(w * 0.3, torsoH * 0.9, w * 0.3)), primary, w * 0.75, legH + torsoH * 0.6, w * 0.2);
    this.addMesh(body, this.getGeometry(`marm:${w}`, () =>
      new THREE.BoxGeometry(w * 0.3, torsoH * 0.9, w * 0.3)), primary, -w * 0.75, legH + torsoH * 0.6, w * 0.2);
  }

  private buildVehicle(
    body: THREE.Group,
    primary: THREE.Material,
    secondary: THREE.Material,
    h: number,
    r: number,
  ): void {
    const w = r * 1.7;
    const hullH = h * 0.5;
    // main hull
    this.addMesh(body, this.getGeometry(`hull:${w}:${hullH}`, () =>
      new THREE.BoxGeometry(w * 1.6, hullH, w)), primary, 0, hullH / 2, 0);
    // sloped glacis
    const glacis = this.addMesh(body, this.getGeometry(`glacis:${w}`, () =>
      new THREE.BoxGeometry(w * 0.6, hullH * 0.8, w)), secondary, w * 0.85, hullH * 0.5, 0);
    glacis.rotation.z = 0.4;
    // turret
    this.addMesh(body, this.getGeometry(`turret:${w}`, () =>
      new THREE.CylinderGeometry(w * 0.4, w * 0.5, hullH * 0.6, 10)), secondary, -w * 0.1, hullH + hullH * 0.3, 0);
    // barrel
    const barrel = this.addMesh(body, this.getGeometry('barrel', () =>
      new THREE.CylinderGeometry(0.08, 0.08, w * 1.0, 8)), secondary, w * 0.5, hullH + hullH * 0.3, 0);
    barrel.rotation.z = Math.PI / 2;
    // tracks
    this.addMesh(body, this.getGeometry(`track:${w}`, () =>
      new THREE.BoxGeometry(w * 1.6, hullH * 0.4, w * 0.22)), secondary, 0, hullH * 0.2, w * 0.5);
    this.addMesh(body, this.getGeometry(`track:${w}`, () =>
      new THREE.BoxGeometry(w * 1.6, hullH * 0.4, w * 0.22)), secondary, 0, hullH * 0.2, -w * 0.5);
  }

  private ensureUnitVisual(unit: UnitInstance): UnitVisual {
    let uv = this.unitVisuals.get(unit.id);
    if (uv) return uv;

    const proxy = unit.proxy ?? this.defaultProxy(unit);
    // Pick a real model from the unit's keywords; null => procedural fallback.
    const entry = resolveModelEntry(unit);
    const group = new THREE.Group();
    group.name = `unit:${unit.id}`;
    const models: ModelVisual[] = [];

    for (const m of unit.models) {
      // Per-model group: holds the base ring + a swappable body.
      const modelGroup = new THREE.Group();
      // Face direction by owner: A faces +Z, B faces -Z.
      modelGroup.rotation.y = unit.ownerId === 'A' ? 0 : Math.PI;

      // Base is always present and shows immediately.
      const base = this.buildBase(proxy, m.baseRadius);
      modelGroup.add(base);

      // Body: procedural by default. If a real model matched, we add the
      // procedural body now as an instant placeholder and swap it for the GLB
      // clone once it finishes loading (so the board is never empty).
      const body = this.buildProceduralBody(proxy, m.baseRadius);
      modelGroup.add(body);

      // Tag the whole model group for picking.
      modelGroup.userData.unitId = unit.id;
      modelGroup.traverse((o) => (o.userData.unitId = unit.id));

      group.add(modelGroup);
      const mv: ModelVisual = {
        group: modelGroup,
        body,
        alive: m.alive,
        vitality: m.alive ? 1 : 0,
      };
      models.push(mv);

      if (entry) {
        this.loadRealModelBody(unit.id, mv, proxy, entry);
      }
    }

    uv = { group, models, ownerId: unit.ownerId };
    this.unitVisuals.set(unit.id, uv);
    this.unitsGroup.add(group);
    return uv;
  }

  /**
   * Asynchronously load + clone a real glTF model for one model instance and
   * swap it in for the procedural placeholder body. The base ring, position,
   * death-sink and picking all keep working because we only replace `mv.body`.
   */
  private loadRealModelBody(
    unitId: string,
    mv: ModelVisual,
    proxy: ProxyDescriptor,
    entry: ModelRegistryEntry,
  ): void {
    this.modelLibrary.instantiate(
      entry.url,
      proxy,
      entry,
      (clone) => {
        // The unit may have been disposed before the load resolved.
        if (this.disposed) {
          this.disposeObject(clone);
          return;
        }
        // Rest the model on top of the base disc.
        clone.position.y = 0.18;
        // Tag clone meshes for picking.
        clone.userData.unitId = unitId;
        clone.traverse((o) => (o.userData.unitId = unitId));

        // Remove the procedural placeholder and attach the real model.
        mv.group.remove(mv.body);
        this.disposeObject(mv.body);
        mv.group.add(clone);
        mv.body = clone;
        // Re-apply current death-sink scale so a model that died while loading
        // doesn't pop to full size.
        clone.visible = mv.vitality > 0.01;
      },
      // On error we simply keep the procedural placeholder (graceful fallback).
    );
  }

  /* ================================= sync ================================= */

  sync(state: GameState): void {
    // Objectives.
    for (const obj of state.objectives) {
      this.ensureObjective(obj);
      this.retintObjective(obj);
    }

    // Units.
    for (const unit of Object.values(state.units)) {
      const uv = this.ensureUnitVisual(unit);

      // Units held in Strategic Reserves are off the table — hide them entirely
      // until they arrive (Deep Strike clears inReserves).
      uv.group.visible = !unit.inReserves;
      if (unit.inReserves) continue;

      // If an imported model is in use, keep it centred on the unit centroid.
      if (uv.imported) {
        this.positionImported(unit, uv);
        continue;
      }

      // Update each model transform; handle new/removed model counts gracefully.
      const n = Math.min(uv.models.length, unit.models.length);
      for (let i = 0; i < n; i++) {
        const mv = uv.models[i];
        const m = unit.models[i];
        const world = this.tableToWorld(m.position);
        mv.group.position.x = world.x;
        mv.group.position.z = world.z;

        // Death transition: sink + shrink. Revival: pop back.
        if (m.alive && !mv.alive) {
          mv.alive = true;
        } else if (!m.alive && mv.alive) {
          mv.alive = false;
        }
        mv.alive = m.alive;
      }
    }

    // Update highlight/target rings to follow units.
    this.updateAttachedRings(state);
  }

  private positionImported(unit: UnitInstance, uv: UnitVisual): void {
    // Centre the imported object on the average position of living models.
    const alive = unit.models.filter((m) => m.alive);
    const src = alive.length ? alive : unit.models;
    let x = 0;
    let y = 0;
    for (const m of src) {
      x += m.position.x;
      y += m.position.y;
    }
    x /= src.length || 1;
    y /= src.length || 1;
    const world = this.tableToWorld({ x, y });
    if (uv.imported) {
      uv.imported.position.x = world.x;
      uv.imported.position.z = world.z;
      uv.imported.visible = alive.length > 0;
    }
  }

  /* ============================== objectives ============================= */

  private ensureObjective(obj: Objective): THREE.Mesh {
    let mesh = this.objectiveMeshes.get(obj.id);
    if (mesh) return mesh;

    // A glowing disc + ring at the control radius.
    const group = new THREE.Group();
    const world = this.tableToWorld(obj.position);
    group.position.copy(world);

    const discGeo = this.getGeometry(`objdisc:${obj.radius}`, () => {
      const g = new THREE.CylinderGeometry(obj.radius, obj.radius, 0.12, 36);
      return g;
    });
    const discMat = new THREE.MeshStandardMaterial({
      color: 0x888888,
      emissive: 0x888888,
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0.28,
      roughness: 0.6,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.y = 0.07;
    disc.receiveShadow = true;
    group.add(disc);

    // Bright rim ring.
    const ringGeo = this.getGeometry(`objring:${obj.radius}`, () => {
      const g = new THREE.RingGeometry(obj.radius - 0.4, obj.radius, 48);
      g.rotateX(-Math.PI / 2);
      return g;
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xaaaaaa,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.13;
    group.add(ring);

    // A central beacon pillar.
    const beacon = new THREE.Mesh(
      this.getGeometry('objbeacon', () => new THREE.CylinderGeometry(0.25, 0.4, 3.2, 8)),
      discMat,
    );
    beacon.position.y = 1.6;
    group.add(beacon);

    this.objectivesGroup.add(group);
    // Store the disc mesh as the handle but keep group ref via userData.
    disc.userData.group = group;
    disc.userData.ringMat = ringMat;
    disc.userData.discMat = discMat;
    this.objectiveMeshes.set(obj.id, disc);
    return disc;
  }

  private objectiveColor(owner?: PlayerId): number {
    if (owner === 'A') return 0x3a7bff;
    if (owner === 'B') return 0xff4030;
    return 0x9aa0aa;
  }

  private retintObjective(obj: Objective): void {
    const disc = this.objectiveMeshes.get(obj.id);
    if (!disc) return;
    const col = this.objectiveColor(obj.controlledBy);
    const discMat = disc.userData.discMat as THREE.MeshStandardMaterial;
    const ringMat = disc.userData.ringMat as THREE.MeshBasicMaterial;
    discMat.color.setHex(col);
    discMat.emissive.setHex(col);
    discMat.emissiveIntensity = obj.controlledBy ? 0.6 : 0.25;
    ringMat.color.setHex(col);
  }

  /* =============================== overlays ============================== */

  private flatRingGeo(inner: number, outer: number): THREE.RingGeometry {
    const key = `${inner.toFixed(2)}:${outer.toFixed(2)}`;
    let g = this.ringGeoCache.get(key);
    if (!g) {
      g = new THREE.RingGeometry(inner, outer, 48);
      g.rotateX(-Math.PI / 2);
      this.ringGeoCache.set(key, g);
    }
    return g;
  }

  highlightUnit(unitId: string | null): void {
    this.highlightedUnit = unitId;
    if (!unitId) {
      if (this.highlightRing) this.highlightRing.visible = false;
      return;
    }
    if (!this.highlightRing) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffe27a,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      });
      this.highlightRing = new THREE.Mesh(this.flatRingGeo(1.6, 2.1), mat);
      this.highlightRing.name = 'highlightRing';
      this.overlayGroup.add(this.highlightRing);
    }
    this.highlightRing.visible = true;
    // Position handled in updateAttachedRings / animate (pulse).
  }

  setTargets(unitIds: string[]): void {
    // Hide existing target rings not in the new set.
    for (const [id, ring] of this.targetRings) {
      if (!unitIds.includes(id)) {
        ring.visible = false;
      }
    }
    const mat = this.getMaterial(
      'targetRingMat',
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xff3322,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        }),
    );
    for (const id of unitIds) {
      let ring = this.targetRings.get(id);
      if (!ring) {
        ring = new THREE.Mesh(this.flatRingGeo(1.3, 1.8), mat);
        ring.name = `targetRing:${id}`;
        this.overlayGroup.add(ring);
        this.targetRings.set(id, ring);
      }
      ring.visible = true;
    }
  }

  /** Re-centre highlight/target rings under the relevant units each sync. */
  private updateAttachedRings(state: GameState): void {
    if (this.highlightRing && this.highlightedUnit) {
      const c = this.unitCenterWorld(state, this.highlightedUnit);
      if (c) {
        this.highlightRing.position.set(c.x, 0.16, c.z);
        this.highlightRing.visible = true;
      } else {
        this.highlightRing.visible = false;
      }
    }
    for (const [id, ring] of this.targetRings) {
      if (!ring.visible) continue;
      const c = this.unitCenterWorld(state, id);
      if (c) ring.position.set(c.x, 0.15, c.z);
      else ring.visible = false;
    }
  }

  private unitCenterWorld(state: GameState, unitId: string): THREE.Vector3 | null {
    const unit = state.units[unitId];
    if (!unit) return null;
    const alive = unit.models.filter((m) => m.alive);
    const src = alive.length ? alive : unit.models;
    if (!src.length) return null;
    let x = 0;
    let y = 0;
    for (const m of src) {
      x += m.position.x;
      y += m.position.y;
    }
    return this.tableToWorld({ x: x / src.length, y: y / src.length });
  }

  showMeasurement(from: Vec2, to: Vec2, label?: string): void {
    const a = this.tableToWorld(from, 0.2);
    const b = this.tableToWorld(to, 0.2);

    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineDashedMaterial({
      color: 0x7fe9ff,
      dashSize: 1.0,
      gapSize: 0.6,
      transparent: true,
      opacity: 0.95,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    line.userData.overlayKind = 'measurement';
    this.overlayGroup.add(line);

    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const text = label ?? `${dist.toFixed(1)}"`;
    const sprite = this.makeTextSprite(text, '#aef4ff');
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y = 2.0;
    sprite.position.copy(mid);
    sprite.userData.overlayKind = 'measurement';
    this.overlayGroup.add(sprite);
  }

  showRange(center: Vec2, radius: number, color = 0x55ff88): void {
    const world = this.tableToWorld(center, 0.14);
    // translucent disc
    const discMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const discGeo = new THREE.CircleGeometry(radius, 48);
    discGeo.rotateX(-Math.PI / 2);
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.copy(world);
    disc.userData.overlayKind = 'range';
    this.overlayGroup.add(disc);

    // bright rim
    const rimMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    const rim = new THREE.Mesh(new THREE.RingGeometry(radius - 0.25, radius, 64), rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.copy(world);
    rim.position.y += 0.01;
    rim.userData.overlayKind = 'range';
    this.overlayGroup.add(rim);
  }

  clearOverlays(): void {
    // Remove measurement lines & range rings (but keep highlight/target rings).
    const toRemove: THREE.Object3D[] = [];
    for (const child of this.overlayGroup.children) {
      const kind = child.userData.overlayKind;
      if (kind === 'measurement' || kind === 'range') toRemove.push(child);
    }
    for (const c of toRemove) {
      this.overlayGroup.remove(c);
      this.disposeObject(c);
    }
  }

  private disposeObject(o: THREE.Object3D): void {
    o.traverse((child) => {
      const mesh = child as THREE.Mesh & THREE.Line & THREE.Sprite;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat.dispose();
      }
    });
  }

  /* ============================ floating numbers ========================= */

  flashDamage(unitId: string, amount: number): void {
    const uv = this.unitVisuals.get(unitId);
    if (!uv) return;
    // Anchor above the first model's group.
    const anchor = uv.models[0]?.group.position ?? new THREE.Vector3();
    const sprite = this.makeTextSprite(`-${amount}`, '#ff5544', 56, true);
    const baseY = 3.0;
    sprite.position.set(anchor.x, baseY, anchor.z);
    this.overlayGroup.add(sprite);
    this.floatingNumbers.push({ sprite, age: 0, life: 1.4, baseY });
  }

  private updateFloatingNumbers(dt: number): void {
    for (let i = this.floatingNumbers.length - 1; i >= 0; i--) {
      const fn = this.floatingNumbers[i];
      fn.age += dt;
      const t = fn.age / fn.life;
      fn.sprite.position.y = fn.baseY + t * 2.5;
      const mat = fn.sprite.material as THREE.SpriteMaterial;
      mat.opacity = clamp(1 - t, 0, 1);
      if (fn.age >= fn.life) {
        this.overlayGroup.remove(fn.sprite);
        this.disposeObject(fn.sprite);
        this.floatingNumbers.splice(i, 1);
      }
    }
  }

  /* ============================== text sprites =========================== */

  /** Build a Sprite from a canvas texture for crisp world-space labels. */
  private makeTextSprite(
    text: string,
    color = '#ffffff',
    fontPx = 44,
    bold = false,
  ): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const pad = 24;
    const font = `${bold ? 'bold ' : ''}${fontPx}px system-ui, sans-serif`;
    ctx.font = font;
    const metrics = ctx.measureText(text);
    const w = Math.ceil(metrics.width) + pad * 2;
    const h = fontPx + pad * 2;
    canvas.width = w;
    canvas.height = h;
    // re-set after resize
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // soft dark plate for legibility
    ctx.fillStyle = 'rgba(8,10,14,0.55)';
    this.roundRect(ctx, 2, 2, w - 4, h - 4, 10);
    ctx.fill();
    // outline + text
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, w / 2, h / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    // Scale to world units; keep text ~constant readable size.
    const worldH = 1.6;
    sprite.scale.set(worldH * (w / h), worldH, 1);
    return sprite;
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ================================ picking ============================== */

  onPick(handler: (result: PickResult) => void): void {
    this.pickHandler = handler;
  }

  onHover(handler: (result: PickResult) => void): void {
    this.hoverHandler = handler;
  }

  private computePick(clientX: number, clientY: number): PickResult | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // First, test against unit meshes for a unitId.
    const hits = this.raycaster.intersectObject(this.unitsGroup, true);
    let unitId: string | undefined;
    if (hits.length) {
      // Walk up to find a unitId tag.
      let o: THREE.Object3D | null = hits[0].object;
      while (o && unitId === undefined) {
        if (o.userData && typeof o.userData.unitId === 'string') {
          unitId = o.userData.unitId as string;
        }
        o = o.parent;
      }
    }

    // Always resolve the table point via the ground plane.
    const point = new THREE.Vector3();
    const ok = this.raycaster.ray.intersectPlane(this.tablePlane, point);
    if (!ok) return null;
    const table = this.worldToTable(point);
    return unitId !== undefined ? { point: table, unitId } : { point: table };
  }

  /* =============================== input ================================= */

  private attachInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', this.onWindowResize);
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.activePointerId = e.pointerId;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.movedDuringDrag = false;
    // Right button or shift => pan; left => orbit.
    if (e.button === 2 || e.shiftKey) this.dragMode = 'pan';
    else this.dragMode = 'orbit';
  };

  private onPointerMove = (e: PointerEvent): void => {
    // Hover handler regardless of drag (but skip while actively dragging camera).
    if (this.dragMode === 'none') {
      if (this.hoverHandler) {
        const res = this.computePick(e.clientX, e.clientY);
        if (res) this.hoverHandler(res);
      }
      return;
    }

    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) this.movedDuringDrag = true;
    this.lastPointer = { x: e.clientX, y: e.clientY };

    if (this.dragMode === 'orbit') {
      this.targetAzimuth -= dx * 0.005;
      this.targetPolar = clamp(this.targetPolar - dy * 0.005, 0.15, Math.PI / 2 - 0.05);
    } else if (this.dragMode === 'pan') {
      // Pan in the camera's local right/forward (projected to ground) basis.
      const panScale = this.orbitRadius * 0.0016;
      const right = new THREE.Vector3();
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      right.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      // dragging right should move the view left (content follows cursor)
      this.targetPivot.addScaledVector(right, -dx * panScale);
      this.targetPivot.addScaledVector(fwd, dy * panScale);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.activePointerId !== null) {
      (e.target as HTMLElement).releasePointerCapture?.(this.activePointerId);
    }
    const wasDrag = this.movedDuringDrag;
    const mode = this.dragMode;
    this.dragMode = 'none';
    this.activePointerId = null;

    // A click (no significant drag) with the left button => pick.
    if (!wasDrag && mode === 'orbit' && this.pickHandler) {
      const res = this.computePick(e.clientX, e.clientY);
      if (res) this.pickHandler(res);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0012);
    this.targetRadius = clamp(this.targetRadius * factor, this.orbitMinRadius, this.orbitMaxRadius);
  };

  private onWindowResize = (): void => this.resize();

  /* =============================== camera ================================ */

  private updateCamera(dt: number): void {
    // Smoothly approach targets (frame-rate independent damping).
    const k = 1 - Math.pow(0.0001, dt);
    this.orbitAzimuth = lerp(this.orbitAzimuth, this.targetAzimuth, k);
    this.orbitPolar = lerp(this.orbitPolar, this.targetPolar, k);
    this.orbitRadius = lerp(this.orbitRadius, this.targetRadius, k);
    this.orbitTarget.lerp(this.targetPivot, k);

    const sinP = Math.sin(this.orbitPolar);
    const x = this.orbitRadius * sinP * Math.sin(this.orbitAzimuth);
    const y = this.orbitRadius * Math.cos(this.orbitPolar);
    const z = this.orbitRadius * sinP * Math.cos(this.orbitAzimuth);
    this.camera.position.set(
      this.orbitTarget.x + x,
      this.orbitTarget.y + y,
      this.orbitTarget.z + z,
    );
    this.camera.lookAt(this.orbitTarget);
  }

  frameBoard(): void {
    // Position the orbit pivot at board centre and pick a radius that fits.
    this.targetPivot.set(0, 0, 0);
    const maxDim = Math.max(this.board.width, this.board.height);
    this.targetRadius = clamp(maxDim * 1.15, this.orbitMinRadius, this.orbitMaxRadius);
    this.targetAzimuth = 0.5;
    this.targetPolar = 0.95;
  }

  resize(): void {
    if (!this.renderer) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Keep the composer + bloom render targets in sync with the canvas.
    if (this.composer) this.composer.setSize(w, h);
    if (this.bloomPass) this.bloomPass.setSize(w, h);
  }

  /* ============================== animation ============================== */

  private animate = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    this.updateCamera(dt);
    this.updateDeathAnimations(dt);
    this.updateFloatingNumbers(dt);

    // Pulse the highlight ring.
    if (this.highlightRing && this.highlightRing.visible) {
      const s = 1 + Math.sin(t * 4) * 0.08;
      this.highlightRing.scale.set(s, 1, s);
      (this.highlightRing.material as THREE.MeshBasicMaterial).opacity =
        0.6 + 0.35 * (0.5 + 0.5 * Math.sin(t * 4));
    }
    // Pulse target rings subtly.
    for (const ring of this.targetRings.values()) {
      if (!ring.visible) continue;
      const s = 1 + Math.sin(t * 6) * 0.06;
      ring.scale.set(s, 1, s);
    }

    // Render through the bloom composer when available, else direct.
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  };

  /** Smoothly sink dead models and pop revived ones. */
  private updateDeathAnimations(dt: number): void {
    const speed = dt * 4;
    for (const uv of this.unitVisuals.values()) {
      if (uv.imported) continue;
      for (const mv of uv.models) {
        const target = mv.alive ? 1 : 0;
        if (mv.vitality === target) {
          mv.group.visible = mv.vitality > 0.01;
          continue;
        }
        mv.vitality += (target - mv.vitality) * Math.min(1, speed);
        if (Math.abs(mv.vitality - target) < 0.01) mv.vitality = target;
        const v = mv.vitality;
        mv.group.visible = v > 0.01;
        mv.group.scale.setScalar(clamp(v, 0.001, 1));
        // sink into the table as it dies
        mv.group.position.y = (v - 1) * 0.6;
      }
    }
  }

  /* ========================= imported-model hook ========================= */

  /**
   * Replace a unit's procedural proxy models with an imported Object3D.
   * Public so ModelImport.applyImportedModelToUnit can drive it.
   */
  setUnitModel(unitId: string, object3d: THREE.Object3D): void {
    const uv = this.unitVisuals.get(unitId);
    if (!uv) return;
    // Remove old imported, if any.
    if (uv.imported) {
      uv.group.remove(uv.imported);
      this.disposeObject(uv.imported);
      uv.imported = undefined;
    }
    // Hide procedural models.
    for (const mv of uv.models) mv.group.visible = false;
    // Tag for picking and attach.
    object3d.traverse((o) => {
      o.userData.unitId = unitId;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    uv.group.add(object3d);
    uv.imported = object3d;
  }

  /** Access the live scene (used by import helpers if needed). */
  getScene(): THREE.Scene {
    return this.scene;
  }

  /** Tear down the renderer and listeners. */
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    const el = this.renderer?.domElement;
    if (el) {
      el.removeEventListener('pointerdown', this.onPointerDown);
      el.removeEventListener('pointermove', this.onPointerMove);
      el.removeEventListener('pointerup', this.onPointerUp);
      el.removeEventListener('pointercancel', this.onPointerUp);
      el.removeEventListener('wheel', this.onWheel);
    }
    window.removeEventListener('resize', this.onWindowResize);
    this.composer?.dispose();
    this.renderer?.dispose();
    if (el && el.parentElement) el.parentElement.removeChild(el);
  }
}

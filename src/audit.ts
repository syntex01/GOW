import './ui/audit.css';
import * as THREE from 'three';
import {
  COMMUNITY_MODEL_PACK,
  COMMUNITY_MODEL_SOURCE,
  type CommunityModelDefinition,
} from './render/CommunityModelPack';
import { loadModel } from './render/ModelImport';
import { encodeTtsModel } from './render/TtsImport';
import { ThreeScene } from './render/ThreeScene';
import { createGame, type ArmyList } from './engine/factory';
import { DATASHEETS } from './engine/data/index';
import type { GameState } from './engine/types';

type Kind = 'model' | 'effect';
interface Item { id: string; name: string; detail: string; kind: Kind; community?: CommunityModelDefinition; }
interface Finding { status: 'pending' | 'pass' | 'issue'; flags: string[]; notes: string; }

const FLAGS = ['Wrong model', 'Rotated', 'Incomplete', 'No color', 'Ugly', 'Wrong scale', 'Clipping', 'Buggy'];
const EFFECTS = ['Bolter', 'Gauss', 'Plasma', 'Melta', 'Flamer', 'Heavy', 'Missile', 'Sniper', 'Generic', 'Melee', 'Impact', 'Damage number', 'Death animation'];
const models: Item[] = COMMUNITY_MODEL_PACK.map((community) => ({
  id: `model:${community.datasheetId}`,
  name: community.datasheetName,
  detail: `${community.faction} · ${community.objectName}${community.match === 'variant' ? ' · VARIANT' : ''}`,
  kind: 'model',
  community,
}));
const effects: Item[] = EFFECTS.map((name) => ({ id: `effect:${name.toLowerCase().replaceAll(' ', '-')}`, name, detail: 'In-engine effect', kind: 'effect' }));
const items = [...models, ...effects];
const findings = new Map<string, Finding>(items.map((item) => [item.id, { status: 'pending', flags: [], notes: '' }]));

const root = document.querySelector<HTMLDivElement>('#audit')!;
root.innerHTML = `
  <header><div><h1>Community Model Audit</h1><p>Review 39 community candidates and every effect. Keys 1–8 flag problems · P passes · ←/→ moves · Space replays · E exports.</p></div><button id="export">Export report.txt</button></header>
  <main>
    <aside><div class="tabs"><button class="tab on" data-kind="model">Models <b>${models.length}</b></button><button class="tab" data-kind="effect">Effects <b>${effects.length}</b></button></div><div id="progress"></div><div id="list"></div></aside>
    <section class="stage">
      <div id="modelStage"></div><div id="effectStage"></div>
      <div class="stage-label"><h2 id="title"></h2><code id="detail"></code></div>
      <div class="stage-help">Drag to rotate · wheel to zoom</div>
    </section>
    <section class="review">
      <div class="review-head"><span>What is wrong?</span><button id="pass">✓ Looks good <kbd>P</kbd></button></div>
      <div id="flags"></div>
      <label>Notes<textarea id="notes" placeholder="Optional details: backwards by 90°, missing weapon, texture is pink…"></textarea></label>
      <div class="nav"><button id="prev">← Previous</button><button id="replay">↻ Replay</button><button id="next">Next →</button></div>
    </section>
  </main>`;

let kind: Kind = 'model';
let current = 0;
const list = root.querySelector<HTMLDivElement>('#list')!;
const progress = root.querySelector<HTMLDivElement>('#progress')!;
const title = root.querySelector<HTMLHeadingElement>('#title')!;
const detail = root.querySelector<HTMLElement>('#detail')!;
const notes = root.querySelector<HTMLTextAreaElement>('#notes')!;
const modelStage = root.querySelector<HTMLDivElement>('#modelStage')!;
const effectStage = root.querySelector<HTMLDivElement>('#effectStage')!;

const activeItems = (): Item[] => (kind === 'model' ? models : effects);
const active = (): Item => activeItems()[current];

function saveCurrent(): void {
  findings.get(active().id)!.notes = notes.value.trim();
}

function renderList(): void {
  const group = activeItems();
  list.replaceChildren(...group.map((item, index) => {
    const finding = findings.get(item.id)!;
    const button = document.createElement('button');
    button.className = `item ${index === current ? 'on' : ''} ${finding.status}`;
    button.innerHTML = `<span>${finding.status === 'pass' ? '✓' : finding.status === 'issue' ? '!' : '·'}</span><b></b><small>${index + 1}/${group.length}</small>`;
    button.querySelector('b')!.textContent = item.name;
    button.onclick = () => { saveCurrent(); current = index; render(); };
    return button;
  }));
  list.querySelector('.item.on')?.scrollIntoView({ block: 'nearest' });
  const done = group.filter((item) => findings.get(item.id)!.status !== 'pending').length;
  progress.textContent = `${done}/${group.length} reviewed`;
}

function renderFinding(): void {
  const finding = findings.get(active().id)!;
  notes.value = finding.notes;
  root.querySelectorAll<HTMLButtonElement>('.flag').forEach((button) => {
    button.classList.toggle('on', finding.flags.includes(button.dataset.flag!));
  });
  root.querySelector<HTMLButtonElement>('#pass')!.classList.toggle('on', finding.status === 'pass');
}

function render(): void {
  const item = active();
  title.textContent = item.name;
  detail.textContent = item.detail;
  modelStage.style.display = kind === 'model' ? 'block' : 'none';
  effectStage.style.display = kind === 'effect' ? 'block' : 'none';
  renderList();
  renderFinding();
  if (kind === 'model') showModel(item);
  else playEffect(item.name);
}

function move(delta: number): void {
  saveCurrent();
  const length = activeItems().length;
  current = (current + delta + length) % length;
  render();
}

root.querySelectorAll<HTMLButtonElement>('.tab').forEach((button) => {
  button.onclick = () => {
    saveCurrent();
    kind = button.dataset.kind as Kind;
    current = 0;
    root.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('on', tab === button));
    render();
  };
});

const flags = root.querySelector<HTMLDivElement>('#flags')!;
flags.replaceChildren(...FLAGS.map((flag, index) => {
  const button = document.createElement('button');
  button.className = 'flag';
  button.dataset.flag = flag;
  button.innerHTML = `<kbd>${index + 1}</kbd><span>${flag}</span>`;
  button.onclick = () => toggleFlag(flag);
  return button;
}));

function toggleFlag(flag: string): void {
  const finding = findings.get(active().id)!;
  finding.flags = finding.flags.includes(flag) ? finding.flags.filter((value) => value !== flag) : [...finding.flags, flag];
  finding.status = finding.flags.length ? 'issue' : 'pending';
  renderList();
  renderFinding();
}

function pass(): void {
  const finding = findings.get(active().id)!;
  finding.flags = [];
  finding.status = 'pass';
  move(1);
}

root.querySelector<HTMLButtonElement>('#pass')!.onclick = pass;
root.querySelector<HTMLButtonElement>('#prev')!.onclick = () => move(-1);
root.querySelector<HTMLButtonElement>('#next')!.onclick = () => move(1);
root.querySelector<HTMLButtonElement>('#replay')!.onclick = () => kind === 'model' ? showModel(active()) : playEffect(active().name);
root.querySelector<HTMLButtonElement>('#export')!.onclick = exportReport;
notes.oninput = saveCurrent;
window.onkeydown = (event) => {
  if (event.target === notes) return;
  if (/^[1-8]$/.test(event.key)) toggleFlag(FLAGS[Number(event.key) - 1]);
  else if (event.key.toLowerCase() === 'p') pass();
  else if (event.key === 'ArrowLeft') move(-1);
  else if (event.key === 'ArrowRight') move(1);
  else if (event.key === ' ') { event.preventDefault(); kind === 'model' ? showModel(active()) : playEffect(active().name); }
  else if (event.key.toLowerCase() === 'e') exportReport();
};

function exportReport(): void {
  saveCurrent();
  const lines = [
    'GRIMDARK VISUAL AUDIT',
    `Generated: ${new Date().toISOString()}`,
    'Branch: graphics-overhaul-tts-models',
    `Community source: ${COMMUNITY_MODEL_SOURCE.title}`,
    COMMUNITY_MODEL_SOURCE.url,
    COMMUNITY_MODEL_SOURCE.notice,
    '',
  ];
  for (const groupKind of ['model', 'effect'] as const) {
    lines.push(groupKind === 'model' ? 'MODELS' : 'VISUAL EFFECTS', '='.repeat(groupKind === 'model' ? 6 : 14));
    for (const item of items.filter((candidate) => candidate.kind === groupKind)) {
      const finding = findings.get(item.id)!;
      lines.push(`[${finding.status.toUpperCase()}] ${item.name}`, `Source: ${item.detail}`, `Problems: ${finding.flags.join(', ') || 'none'}`, `Notes: ${finding.notes || '-'}`, '');
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `grimdark-visual-audit-${new Date().toISOString().slice(0, 10)}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/* ------------------------------ model viewer ----------------------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
modelStage.appendChild(renderer.domElement);
const modelScene = new THREE.Scene();
modelScene.background = new THREE.Color(0x11161e);
const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 100);
camera.position.set(4.2, 3.1, 5.4);
camera.lookAt(0, 1.25, 0);
modelScene.add(new THREE.HemisphereLight(0x9eb8df, 0x26180f, 1.5));
const key = new THREE.DirectionalLight(0xffd5a0, 4.2); key.position.set(4, 6, 4); key.castShadow = true; modelScene.add(key);
const rim = new THREE.DirectionalLight(0x729cff, 2.4); rim.position.set(-4, 3, -4); modelScene.add(rim);
const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.35, 0.15, 64), new THREE.MeshStandardMaterial({ color: 0x25272b, metalness: 0.2, roughness: 0.78 }));
floor.position.y = -0.075; modelScene.add(floor);
let shown: THREE.Object3D | null = null;
let loadToken = 0;
let yaw = 0;
let pitch = 0;
let zoom = 1;
let dragging = false;
let pointer = { x: 0, y: 0 };

function showModel(item: Item): void {
  if (!item.community) return;
  const token = ++loadToken;
  yaw = 0; pitch = 0; zoom = 1;
  detail.textContent = `${item.detail} — loading…`;
  const datasheet = DATASHEETS[item.community.datasheetId];
  void loadModel(encodeTtsModel(item.community.asset), 'tts', {
    targetHeightInches: datasheet?.proxy?.heightInches ?? 2,
  }).then((object) => {
    if (token !== loadToken) { disposeModel(object); return; }
    if (shown) { modelScene.remove(shown); disposeModel(shown); }
    const pivot = new THREE.Group();
    pivot.add(object); // keep the asset's baked facing correction on the child
    pivot.position.y = 0.08;
    shown = pivot;
    modelScene.add(shown);
    detail.textContent = item.detail;
  }).catch(() => {
    if (token === loadToken) detail.textContent = `${item.detail} — FAILED TO LOAD`;
  });
}

function disposeModel(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      standard.map?.dispose();
      standard.normalMap?.dispose();
      material.dispose();
    }
  });
}

renderer.domElement.onpointerdown = (event) => { dragging = true; pointer = { x: event.clientX, y: event.clientY }; renderer.domElement.setPointerCapture(event.pointerId); };
renderer.domElement.onpointerup = () => { dragging = false; };
renderer.domElement.onpointermove = (event) => {
  if (!dragging) return;
  yaw += (event.clientX - pointer.x) * 0.012;
  pitch = THREE.MathUtils.clamp(pitch + (event.clientY - pointer.y) * 0.006, -0.5, 0.5);
  pointer = { x: event.clientX, y: event.clientY };
};
renderer.domElement.onwheel = (event) => { event.preventDefault(); zoom = THREE.MathUtils.clamp(zoom * Math.exp(-event.deltaY * 0.001), 0.55, 2.1); };

/* ------------------------------ effect viewer ---------------------------- */
let fxScene: ThreeScene | null = null;
let fxState: GameState | null = null;
let fxIds: [string, string] | null = null;

function ensureEffects(): void {
  if (fxScene) return;
  const a: ArmyList = { name: 'Audit A', faction: 'necrons', entries: [{ datasheetId: 'necron_warriors', modelCount: 1 }] };
  const b: ArmyList = { name: 'Audit B', faction: 'ultramarines', entries: [{ datasheetId: 'ultramarines_intercessors', modelCount: 1 }] };
  fxState = createGame({ seed: 40, players: { A: { name: 'A', faction: 'necrons' }, B: { name: 'B', faction: 'ultramarines' } } }, DATASHEETS, a, b);
  const units = Object.values(fxState.units);
  units[0].models[0].position = { x: 25, y: 22 };
  units[1].models[0].position = { x: 35, y: 22 };
  fxIds = [units[0].id, units[1].id];
  fxScene = new ThreeScene();
  fxScene.init(effectStage, fxState);
  fxScene.focusOn({ x: 30, y: 22 }, { radius: 16, azimuth: 0.5, polar: 1.0, immediate: true });
}

function playEffect(name: string): void {
  ensureEffects();
  if (!fxScene || !fxState || !fxIds) return;
  const [from, to] = fxIds;
  const target = fxState.units[to];
  if (!target.models[0].alive) { target.models[0].alive = true; fxScene.sync(fxState); }
  const archetype = name.toLowerCase();
  if (['bolter', 'gauss', 'plasma', 'melta', 'flamer', 'heavy', 'missile', 'sniper', 'generic'].includes(archetype)) fxScene.playShoot(from, to, { volleys: 4, archetype });
  else if (name === 'Melee') fxScene.playMelee(from, to);
  else if (name === 'Impact') fxScene.playImpact(to, 1.2);
  else if (name === 'Damage number') { fxScene.playImpact(to); fxScene.flashDamage(to, 3); }
  else if (name === 'Death animation') { target.models[0].alive = false; fxScene.sync(fxState); }
}

function resize(): void {
  const rect = modelStage.getBoundingClientRect();
  if (rect.width && rect.height) {
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }
  fxScene?.resize();
}

function animate(): void {
  requestAnimationFrame(animate);
  if (shown) {
    if (!dragging) yaw += 0.004;
    shown.rotation.set(pitch, yaw, 0);
    shown.scale.setScalar(zoom);
  }
  renderer.render(modelScene, camera);
}

window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(root.querySelector('.stage')!);
render(); resize(); animate();

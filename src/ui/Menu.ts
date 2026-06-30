/* =========================================================================
   MAIN MENU + FACTION SELECT + SETTINGS  (Battle Forge)
   Grimdark Warhammer-40k-style front-end. Pure DOM/CSS, no deps, no images.
   Presentation only — emits a config via onStart(); no game logic here.
   Styles live under the `/* === MAIN MENU === *\/` block in styles.css.
   ========================================================================= */
import { FACTIONS, SAMPLE_ARMIES, DATASHEETS } from '../engine/data/index';

export interface GameSettings {
  diceSpeed: number; // 0.25 (fast) .. 2 (slow); 1 = normal
  quality: 'auto' | 'low' | 'high';
  aiPlayer: 'B' | null;
}

export interface StartConfig {
  aFaction: string;
  bFaction: string;
  mode: 'hotseat' | 'ai' | 'online';
  online?: { action: 'host' | 'join'; code?: string };
  settings: GameSettings;
}

type Mode = StartConfig['mode'];

/** Map a faction id to the HUD accent class used elsewhere in the theme. */
const ACCENT: Record<string, string> = { necrons: 'necron', ultramarines: 'imperial', orks: 'ork' };

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  html?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

export class Menu {
  readonly root: HTMLElement; // full-screen overlay
  private startCb: ((cfg: StartConfig) => void) | null = null;

  private aFaction = 'necrons';
  private bFaction = 'ultramarines';
  private mode: Mode = 'hotseat';
  private onlineAction: 'host' | 'join' = 'host';
  private settings: GameSettings = { diceSpeed: 1, quality: 'auto', aiPlayer: null };

  // Re-render hooks for live regions.
  private rosterA!: HTMLElement;
  private rosterB!: HTMLElement;
  private gridA!: HTMLElement;
  private gridB!: HTMLElement;
  private onlinePane!: HTMLElement;
  private statusEl!: HTMLElement;
  private roomCodeEl!: HTMLElement;
  private codeInput!: HTMLInputElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'menu', '');
    this.root.setAttribute('data-accent', ACCENT[this.aFaction] ?? '');
    this.root.appendChild(this.buildScroll());
    parent.appendChild(this.root);
    this.syncMode();
    this.renderRoster('A');
    this.renderRoster('B');
  }

  /* --------------------------------- API --------------------------------- */
  onStart(cb: (cfg: StartConfig) => void): void {
    this.startCb = cb;
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setOnlineStatus(text: string): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('show', !!text);
  }

  setRoomCode(code: string): void {
    this.roomCodeEl.querySelector('.rc-code')!.textContent = code || '——————';
    this.roomCodeEl.classList.toggle('show', !!code);
  }

  /* ------------------------------ structure ------------------------------ */
  private buildScroll(): HTMLElement {
    const scroll = el('div', 'menu-scroll');
    scroll.appendChild(this.buildHero());
    scroll.appendChild(this.buildFactions());
    scroll.appendChild(this.buildMode());
    scroll.appendChild(this.buildSettings());
    scroll.appendChild(this.buildDeploy());
    return scroll;
  }

  private buildHero(): HTMLElement {
    const hero = el('header', 'menu-hero');
    hero.innerHTML = `
      <div class="mh-crest" aria-hidden="true"><i></i></div>
      <div class="mh-kicker">Grimdark Tabletop</div>
      <h1 class="mh-title">Battle Forge</h1>
      <div class="mh-sub">Muster your warhost. Consecrate the field. There is only war.</div>`;
    return hero;
  }

  /* --- Section 2: faction pickers ------------------------------------- */
  private buildFactions(): HTMLElement {
    const sec = el('section', 'menu-sec');
    sec.appendChild(this.secHead('I.', 'Choose Your Warhosts'));
    const cols = el('div', 'faction-cols');

    const a = this.buildFactionColumn('A');
    const b = this.buildFactionColumn('B');
    cols.appendChild(a);
    cols.appendChild(b);
    sec.appendChild(cols);
    return sec;
  }

  private buildFactionColumn(side: 'A' | 'B'): HTMLElement {
    const col = el('div', `faction-col side-${side.toLowerCase()}`);
    col.innerHTML = `<div class="fc-head"><span class="fc-tag">Player ${side}</span></div>`;
    const grid = el('div', 'faction-grid');
    if (side === 'A') this.gridA = grid;
    else this.gridB = grid;

    for (const id of Object.keys(FACTIONS)) {
      const f = FACTIONS[id];
      const card = el('button', 'faction-pick');
      card.type = 'button';
      card.dataset.fid = id;
      card.dataset.accent = ACCENT[id] ?? '';
      card.innerHTML = `<span class="fp-crest" aria-hidden="true"><i></i></span><span class="fp-name">${f.name}</span>`;
      card.addEventListener('click', () => this.pickFaction(side, id));
      grid.appendChild(card);
    }
    col.appendChild(grid);

    const roster = el('div', 'fc-roster');
    if (side === 'A') this.rosterA = roster;
    else this.rosterB = roster;
    col.appendChild(roster);
    return col;
  }

  private pickFaction(side: 'A' | 'B', id: string): void {
    if (side === 'A') this.aFaction = id;
    else this.bFaction = id;
    if (side === 'A') this.root.setAttribute('data-accent', ACCENT[id] ?? '');
    this.renderRoster(side);
  }

  private renderRoster(side: 'A' | 'B'): void {
    const id = side === 'A' ? this.aFaction : this.bFaction;
    const grid = side === 'A' ? this.gridA : this.gridB;
    const roster = side === 'A' ? this.rosterA : this.rosterB;
    grid.querySelectorAll<HTMLElement>('.faction-pick').forEach((b) => {
      b.classList.toggle('on', b.dataset.fid === id);
    });

    const army = (SAMPLE_ARMIES as Record<string, typeof SAMPLE_ARMIES.necrons>)[id];
    let total = 0;
    const rows: string[] = [];
    if (army) {
      for (const e of army.entries) {
        const ds = DATASHEETS[e.datasheetId];
        if (!ds) continue;
        total += ds.points;
        const tags: string[] = [];
        if (e.modelCount && e.modelCount > 1) tags.push(`×${e.modelCount}`);
        if (e.attachTo) tags.push('Leader');
        if (e.inReserves) tags.push('Reserves');
        rows.push(
          `<li><span class="rr-name">${ds.name}</span>` +
            `<span class="rr-meta">${tags.map((t) => `<em>${t}</em>`).join('')}` +
            `<b>${ds.points}</b></span></li>`,
        );
      }
    }
    roster.innerHTML =
      `<div class="rr-head"><span class="rr-army">${army ? army.name : id}</span>` +
      `<span class="rr-total">${total} pts</span></div>` +
      `<ul class="rr-list">${rows.join('')}</ul>`;
  }

  /* --- Section 3: mode ------------------------------------------------- */
  private buildMode(): HTMLElement {
    const sec = el('section', 'menu-sec');
    sec.appendChild(this.secHead('II.', 'Theatre of War'));

    const seg = el('div', 'seg');
    const modes: [Mode, string, string][] = [
      ['hotseat', 'Hotseat', 'Two warlords, one altar'],
      ['ai', 'vs Machine Spirit', 'Battle the cogitator'],
      ['online', 'Online', 'Cross the warp'],
    ];
    for (const [m, label, desc] of modes) {
      const b = el('button', 'seg-btn');
      b.type = 'button';
      b.dataset.mode = m;
      b.innerHTML = `<span class="sb-label">${label}</span><span class="sb-desc">${desc}</span>`;
      b.addEventListener('click', () => {
        this.mode = m;
        this.syncMode();
      });
      seg.appendChild(b);
    }
    sec.appendChild(seg);

    // Online sub-pane (revealed only in online mode).
    this.onlinePane = el('div', 'online-pane');
    const onlineSeg = el('div', 'seg seg-sub');
    for (const act of ['host', 'join'] as const) {
      const b = el('button', 'seg-btn small');
      b.type = 'button';
      b.dataset.act = act;
      b.textContent = act === 'host' ? 'Host War' : 'Join War';
      b.addEventListener('click', () => {
        this.onlineAction = act;
        this.syncOnline();
      });
      onlineSeg.appendChild(b);
    }
    this.onlinePane.appendChild(onlineSeg);

    // Host: room code + copy.
    this.roomCodeEl = el('div', 'room-code');
    this.roomCodeEl.innerHTML =
      `<span class="rc-label">Room Code</span><span class="rc-code">——————</span>`;
    const copy = el('button', 'btn small rc-copy', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', () => {
      const code = this.roomCodeEl.querySelector('.rc-code')!.textContent ?? '';
      void navigator.clipboard?.writeText(code).then(
        () => {
          copy.textContent = 'Copied';
          setTimeout(() => (copy.textContent = 'Copy'), 1400);
        },
        () => {},
      );
    });
    this.roomCodeEl.appendChild(copy);
    this.onlinePane.appendChild(this.roomCodeEl);

    // Join: code input.
    const joinWrap = el('div', 'join-wrap');
    this.codeInput = el('input', 'join-input') as HTMLInputElement;
    this.codeInput.type = 'text';
    this.codeInput.placeholder = 'ENTER ROOM CODE';
    this.codeInput.maxLength = 12;
    this.codeInput.autocapitalize = 'characters';
    this.codeInput.spellcheck = false;
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase();
    });
    joinWrap.appendChild(this.codeInput);
    this.onlinePane.appendChild(joinWrap);

    // Connection status line.
    this.statusEl = el('div', 'online-status');
    this.onlinePane.appendChild(this.statusEl);

    sec.appendChild(this.onlinePane);
    return sec;
  }

  private syncMode(): void {
    this.root.querySelectorAll<HTMLElement>('.seg-btn[data-mode]').forEach((b) => {
      b.classList.toggle('on', b.dataset.mode === this.mode);
    });
    this.onlinePane.classList.toggle('show', this.mode === 'online');
    // vs-AI implies an AI controlling player B.
    this.settings.aiPlayer = this.mode === 'ai' ? 'B' : this.settings.aiPlayer;
    if (this.mode === 'ai') this.setAiToggle(true);
    if (this.mode === 'hotseat') {
      this.settings.aiPlayer = null;
      this.setAiToggle(false);
    }
    if (this.mode === 'online') this.syncOnline();
  }

  private syncOnline(): void {
    this.onlinePane.querySelectorAll<HTMLElement>('.seg-btn[data-act]').forEach((b) => {
      b.classList.toggle('on', b.dataset.act === this.onlineAction);
    });
    this.onlinePane.classList.toggle('is-host', this.onlineAction === 'host');
    this.onlinePane.classList.toggle('is-join', this.onlineAction === 'join');
  }

  /* --- Section 4: settings -------------------------------------------- */
  private aiToggle!: HTMLElement;
  private setAiToggle(on: boolean): void {
    if (this.aiToggle) this.aiToggle.classList.toggle('on', on);
  }

  private buildSettings(): HTMLElement {
    const sec = el('section', 'menu-sec');
    sec.appendChild(this.secHead('III.', 'War Council'));
    const grid = el('div', 'settings-grid');

    // Dice speed slider (maps inverse: left = fast, right = slow).
    const diceRow = el('div', 'set-row');
    diceRow.innerHTML = `<label class="set-label">Dice Animation</label>`;
    const slider = el('input', 'set-slider') as HTMLInputElement;
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = '50';
    const speedVal = el('span', 'set-val', 'Normal');
    slider.addEventListener('input', () => {
      const t = Number(slider.value) / 100; // 0..1
      // 0 => 0.35x (fast), 1 => 2x (slow)
      this.settings.diceSpeed = 0.35 + t * 1.65;
      speedVal.textContent = t < 0.34 ? 'Swift' : t > 0.66 ? 'Deliberate' : 'Normal';
    });
    const sliderWrap = el('div', 'slider-wrap');
    sliderWrap.appendChild(slider);
    sliderWrap.appendChild(speedVal);
    diceRow.appendChild(sliderWrap);
    grid.appendChild(diceRow);

    // Graphics quality.
    const qRow = el('div', 'set-row');
    qRow.innerHTML = `<label class="set-label">Graphics</label>`;
    const qSeg = el('div', 'seg seg-mini');
    for (const q of ['auto', 'low', 'high'] as const) {
      const b = el('button', 'seg-btn small');
      b.type = 'button';
      b.dataset.q = q;
      b.textContent = q[0].toUpperCase() + q.slice(1);
      if (q === this.settings.quality) b.classList.add('on');
      b.addEventListener('click', () => {
        this.settings.quality = q;
        qSeg.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      });
      qSeg.appendChild(b);
    }
    qRow.appendChild(qSeg);
    grid.appendChild(qRow);

    // AI toggle.
    const aiRow = el('div', 'set-row');
    aiRow.innerHTML = `<label class="set-label">Machine Spirit (Player B)</label>`;
    this.aiToggle = el('button', 'toggle');
    this.aiToggle.setAttribute('role', 'switch');
    this.aiToggle.innerHTML = `<span class="tog-knob"></span>`;
    this.aiToggle.addEventListener('click', () => {
      const on = !this.aiToggle.classList.contains('on');
      this.aiToggle.classList.toggle('on', on);
      this.settings.aiPlayer = on ? 'B' : null;
      // Keep mode coherent: enabling AI in hotseat promotes to vs-AI.
      if (on && this.mode === 'hotseat') {
        this.mode = 'ai';
        this.syncMode();
      } else if (!on && this.mode === 'ai') {
        this.mode = 'hotseat';
        this.syncMode();
      }
    });
    aiRow.appendChild(this.aiToggle);
    grid.appendChild(aiRow);

    sec.appendChild(grid);
    return sec;
  }

  /* --- Section 5: deploy ---------------------------------------------- */
  private buildDeploy(): HTMLElement {
    const wrap = el('div', 'deploy-bar');
    const btn = el('button', 'btn primary deploy-btn', 'Deploy');
    btn.type = 'button';
    btn.addEventListener('click', () => this.emitStart());
    wrap.appendChild(btn);
    return wrap;
  }

  private emitStart(): void {
    const cfg: StartConfig = {
      aFaction: this.aFaction,
      bFaction: this.bFaction,
      mode: this.mode,
      settings: { ...this.settings },
    };
    if (this.mode === 'online') {
      cfg.online = {
        action: this.onlineAction,
        ...(this.onlineAction === 'join' ? { code: this.codeInput.value.trim() } : {}),
      };
    }
    this.startCb?.(cfg);
  }

  /* ------------------------------ helpers -------------------------------- */
  private secHead(numeral: string, title: string): HTMLElement {
    return el('div', 'sec-head', `<span class="sh-num">${numeral}</span><h2>${title}</h2>`);
  }
}

/* =========================================================================
   LOADING SPLASH — gothic spinner shown during scene/model init & connect.
   Reuses #loading-splash from index.html, but falls back to building its own
   root so the helper is fully self-contained.
   ========================================================================= */
function splashRoot(): HTMLElement {
  let s = document.getElementById('loading-splash');
  if (!s) {
    s = el('div', 'loading-splash');
    s.id = 'loading-splash';
    s.innerHTML =
      `<div class="ls-sigil" aria-hidden="true"><span></span><span></span><span></span></div>` +
      `<div class="ls-text"></div>`;
    document.body.appendChild(s);
  }
  return s;
}

export function showLoading(text = 'Summoning the war machine…'): void {
  const s = splashRoot();
  const t = s.querySelector('.ls-text');
  if (t) t.textContent = text;
  s.classList.add('show');
  s.setAttribute('aria-hidden', 'false');
}

export function hideLoading(): void {
  const s = document.getElementById('loading-splash');
  if (!s) return;
  s.classList.remove('show');
  s.setAttribute('aria-hidden', 'true');
}

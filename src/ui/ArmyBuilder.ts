/* =========================================================================
   ARMY BUILDER — an in-game list forge.
   Pick units from a faction's datasheets, set squad sizes, and watch points +
   legality update live (via the same validateArmy the import screen uses). No
   copyrighted text: it lists our own datasheet names/points and the structural
   matched-play rules only. Emits an ArmyList back to the menu.
   ========================================================================= */
import { FACTIONS, DATASHEETS } from '../engine/data/index';
import type { ArmyList, ArmyListEntry } from '../engine/factory';
import { validateArmy, armyPoints, entryPoints, POINTS_LIMITS } from '../engine/armyValidation';

interface BuilderOpts {
  faction: string;
  initial: ArmyList;
  pointsLimit: number;
  onSave: (list: ArmyList, pointsLimit: number) => void;
}

const clone = (l: ArmyList): ArmyList => ({
  name: l.name,
  faction: l.faction,
  entries: l.entries.map((e) => ({ ...e })),
});

/** Open the modal. Resolves through opts.onSave when the user deploys the list. */
export function openArmyBuilder(opts: BuilderOpts): void {
  const faction = FACTIONS[opts.faction];
  const sheetIds = faction?.datasheetIds ?? [];
  let limit = opts.pointsLimit;
  // Working copy — the caller's list is untouched until Save.
  const list = clone(opts.initial);
  list.faction = faction?.name ?? opts.faction;
  if (!list.name || list.name === opts.initial.faction) list.name = `${faction?.name ?? opts.faction} Warhost`;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop show';
  backdrop.innerHTML = `
    <div class="modal builder">
      <div class="ab-head">
        <h3>Forge Army — ${faction?.name ?? opts.faction}</h3>
        <label class="ab-limit">Limit
          <select id="abLimit">${POINTS_LIMITS.map((p) => `<option value="${p}"${p === limit ? ' selected' : ''}>${p}</option>`).join('')}</select>
        </label>
      </div>
      <div class="ab-status" id="abStatus"></div>
      <div class="ab-cols">
        <div class="ab-avail"><div class="ab-colhead">Available datasheets</div><div id="abAvail"></div></div>
        <div class="ab-roster"><div class="ab-colhead">Your list</div><div id="abList"></div></div>
      </div>
      <div class="row ab-actions">
        <button class="btn small" id="abCancel" type="button">Cancel</button>
        <button class="btn small" id="abClear" type="button">Clear</button>
        <button class="btn primary small" id="abSave" type="button">Save &amp; Deploy</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const $ = <T extends HTMLElement>(sel: string): T => backdrop.querySelector(sel) as T;
  const availEl = $('#abAvail');
  const listEl = $('#abList');
  const statusEl = $('#abStatus');
  const limitSel = $<HTMLSelectElement>('#abLimit');
  const close = () => backdrop.remove();

  const sizeOf = (e: ArmyListEntry): number => e.modelCount ?? DATASHEETS[e.datasheetId]?.composition[0]?.min ?? 1;

  const renderAvail = (): void => {
    availEl.innerHTML = sheetIds
      .map((id) => {
        const ds = DATASHEETS[id];
        if (!ds) return '';
        const min = ds.composition[0]?.min ?? 1;
        const kw = ds.isCharacter ? 'Character' : ds.keywords.includes('BATTLELINE') ? 'Battleline' : ds.keywords[0] ?? '';
        return `<button class="ab-add" type="button" data-id="${id}">
          <span class="ab-an">${ds.name}</span>
          <span class="ab-am">${kw ? `<em>${kw}</em>` : ''}<b>${entryPoints(ds, min)}</b><span class="ab-plus">＋</span></span>
        </button>`;
      })
      .join('');
    availEl.querySelectorAll<HTMLButtonElement>('.ab-add').forEach((b) => {
      b.onclick = () => {
        const ds = DATASHEETS[b.dataset.id!];
        list.entries.push({ datasheetId: b.dataset.id!, modelCount: ds.composition[0]?.min ?? 1 });
        renderList();
      };
    });
  };

  const renderList = (): void => {
    if (list.entries.length === 0) {
      listEl.innerHTML = `<div class="ab-empty">No units yet — add datasheets from the left.</div>`;
    } else {
      listEl.innerHTML = list.entries
        .map((e, i) => {
          const ds = DATASHEETS[e.datasheetId];
          if (!ds) return '';
          const comp = ds.composition[0];
          const n = sizeOf(e);
          const multi = comp && comp.max > comp.min;
          const stepper = multi
            ? `<span class="ab-step"><button type="button" data-dec="${i}">−</button><b>${n}</b><button type="button" data-inc="${i}">＋</button></span>`
            : `<span class="ab-single">${n} model${n > 1 ? 's' : ''}</span>`;
          return `<div class="ab-row">
            <span class="ab-rn">${ds.name}</span>
            ${stepper}
            <b class="ab-rp">${entryPoints(ds, n)}</b>
            <button class="ab-rem" type="button" data-rem="${i}" aria-label="Remove">✕</button>
          </div>`;
        })
        .join('');
      listEl.querySelectorAll<HTMLButtonElement>('[data-rem]').forEach((b) => {
        b.onclick = () => { list.entries.splice(Number(b.dataset.rem), 1); renderList(); };
      });
      listEl.querySelectorAll<HTMLButtonElement>('[data-inc]').forEach((b) => {
        b.onclick = () => { stepSize(Number(b.dataset.inc), +1); };
      });
      listEl.querySelectorAll<HTMLButtonElement>('[data-dec]').forEach((b) => {
        b.onclick = () => { stepSize(Number(b.dataset.dec), -1); };
      });
    }
    renderStatus();
  };

  // Step a squad up/down in whole "min bracket" increments, clamped to [min,max].
  const stepSize = (i: number, dir: 1 | -1): void => {
    const e = list.entries[i];
    const comp = DATASHEETS[e.datasheetId]?.composition[0];
    if (!comp) return;
    const step = comp.min || 1;
    const next = Math.max(comp.min, Math.min(comp.max, sizeOf(e) + dir * step));
    e.modelCount = next;
    renderList();
  };

  const renderStatus = (): void => {
    const pts = armyPoints(list, DATASHEETS);
    const v = validateArmy(list, DATASHEETS, { pointsLimit: limit });
    const badge = v.legal
      ? `<b class="ok">✓ Legal</b>`
      : `<b class="bad">✗ Illegal</b>`;
    const issues = [...v.issues.map((s) => `<span class="bad">• ${s}</span>`), ...v.warnings.map((s) => `<span class="warn">• ${s}</span>`)];
    statusEl.innerHTML =
      `<div class="ab-pts">${badge}<span class="ab-total ${pts > limit ? 'over' : ''}">${pts} / ${limit} pts</span></div>` +
      (issues.length ? `<div class="ab-issues">${issues.join('')}</div>` : '');
  };

  limitSel.onchange = () => { limit = Number(limitSel.value); renderStatus(); };
  $('#abCancel').onclick = close;
  $('#abClear').onclick = () => { list.entries = []; renderList(); };
  $('#abSave').onclick = () => {
    if (list.entries.length === 0) { renderStatus(); return; }
    opts.onSave(clone(list), limit);
    close();
  };
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };

  renderAvail();
  renderList();
}

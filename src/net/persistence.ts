/**
 * persistence — localStorage-backed save/load for GameStates.
 *
 * Every operation is guarded against the ways localStorage fails in the wild
 * (unavailable in private mode, quota exceeded on write, malformed/partial JSON
 * on read). Nothing here throws; failures return safe defaults so a storage
 * problem can never crash the game.
 */

const PREFIX = 'gow:save:';
const DEFAULT_SLOT = 'autosave';

/** Resolve the localStorage object, or null if it's unavailable. */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Accessing localStorage can itself throw (e.g. blocked by the browser).
    return null;
  }
}

const keyFor = (slot: string): string => PREFIX + slot;

/** Save a state to a named slot (default 'autosave'). Never throws. */
export function saveGame(state: unknown, slot: string = DEFAULT_SLOT): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(keyFor(slot), JSON.stringify(state));
  } catch {
    // Quota exceeded or serialization failure — silently give up.
  }
}

/** Load a state from a slot, or null if missing/corrupt. Never throws. */
export function loadGame(slot: string = DEFAULT_SLOT): any | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(keyFor(slot));
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** List the slot names that currently have a save. Never throws. */
export function listSaves(): string[] {
  const store = storage();
  if (!store) return [];
  const out: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
  } catch {
    return out;
  }
  return out;
}

/** Remove the save in a slot (default 'autosave'). Never throws. */
export function clearSave(slot: string = DEFAULT_SLOT): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(keyFor(slot));
  } catch {
    /* ignore */
  }
}

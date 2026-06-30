/**
 * Persistent per-datasheet model assignments.
 *
 * Lets a player map a model (a public URL, or a local file stored as a data URL)
 * to a whole unit TYPE (datasheet id), so every unit of that type shows that
 * figure — automatically, across battles. Stored in localStorage.
 *
 * This is the legal path to "my army looks like my models": the player supplies
 * models they have the rights to; the app never ships or fetches anyone's
 * copyrighted assets.
 */

export type ModelFormat = 'gltf' | 'glb' | 'obj' | 'stl';

export interface ModelAssignment {
  /** A remote URL, OR a data: URL for a locally-imported file. */
  src: string;
  format: ModelFormat;
  heightInches?: number;
}

const KEY = 'grimdark.modelAssignments.v1';

/** Load the full datasheetId -> assignment map (never throws). */
export function loadAssignments(): Record<string, ModelAssignment> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ModelAssignment>) : {};
  } catch {
    return {};
  }
}

/** Assign a model to a datasheet id (persisted). Safe against quota errors. */
export function setAssignment(datasheetId: string, a: ModelAssignment): boolean {
  try {
    const all = loadAssignments();
    all[datasheetId] = a;
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false; // e.g. data URL too large for localStorage quota
  }
}

/** Remove a datasheet's assignment. */
export function clearAssignment(datasheetId: string): void {
  try {
    const all = loadAssignments();
    delete all[datasheetId];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** Wipe all assignments. */
export function clearAllAssignments(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Read a File as a data: URL (for persisting local imports). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

export function formatFromName(name: string): ModelFormat {
  const e = name.toLowerCase().split('?')[0];
  if (e.endsWith('.glb')) return 'glb';
  if (e.endsWith('.obj')) return 'obj';
  if (e.endsWith('.stl')) return 'stl';
  return 'gltf';
}

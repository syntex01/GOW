/** Minimal, dependency-free reader for Tabletop Simulator save/object JSON. */

export interface TtsModelAsset {
  name: string;
  /** One-piece TTS CustomMesh. Multi-material scans use `parts` instead. */
  meshUrl?: string;
  diffuseUrl?: string;
  normalUrl?: string;
  yawDegrees?: number;
  parts?: TtsModelPart[];
}

/** One OBJ/material layer from a multi-part Tabletop Simulator figure. */
export interface TtsModelPart {
  meshUrl: string;
  diffuseUrl?: string;
  normalUrl?: string;
  /** Optional TTS child transform, retained for scans whose pieces are offset. */
  position?: [number, number, number];
  rotationDegrees?: [number, number, number];
  scale?: [number, number, number];
}

interface TtsObject {
  Name?: unknown;
  Nickname?: unknown;
  GUID?: unknown;
  CustomMesh?: Record<string, unknown>;
  ChildObjects?: unknown;
  ContainedObjects?: unknown;
  ObjectStates?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function children(value: unknown): TtsObject[] {
  if (Array.isArray(value)) return value.filter((item): item is TtsObject => !!item && typeof item === 'object');
  if (value && typeof value === 'object') return Object.values(value).filter((item): item is TtsObject => !!item && typeof item === 'object');
  return [];
}

/** Extract every Custom_Model/Custom_Figurine mesh from a TTS save or saved object. */
export function parseTtsModels(source: string): TtsModelAsset[] {
  const root = JSON.parse(source) as TtsObject;
  const out: TtsModelAsset[] = [];
  const seen = new Set<string>();

  const visit = (obj: TtsObject): void => {
    const custom = obj.CustomMesh;
    const meshUrl = text(custom?.MeshURL ?? custom?.mesh);
    if (meshUrl) {
      const diffuseUrl = text(custom?.DiffuseURL ?? custom?.diffuse);
      const normalUrl = text(custom?.NormalURL ?? custom?.normal);
      const name = text(obj.Nickname) || text(obj.Name) || `TTS model ${out.length + 1}`;
      const key = `${meshUrl}\n${diffuseUrl}\n${normalUrl}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          name,
          meshUrl,
          ...(diffuseUrl ? { diffuseUrl } : {}),
          ...(normalUrl ? { normalUrl } : {}),
        });
      }
    }
    for (const child of children(obj.ChildObjects)) visit(child);
    for (const child of children(obj.ContainedObjects)) visit(child);
    for (const child of children(obj.ObjectStates)) visit(child);
  };

  visit(root);
  return out;
}

export function encodeTtsModel(asset: TtsModelAsset): string {
  return JSON.stringify(asset);
}

export function decodeTtsModel(source: string): TtsModelAsset {
  const value = JSON.parse(source) as Partial<TtsModelAsset>;
  const parts = Array.isArray(value?.parts)
    ? value.parts.flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object' || !text(candidate.meshUrl)) return [];
        const part: TtsModelPart = {
          meshUrl: text(candidate.meshUrl),
          ...(text(candidate.diffuseUrl) ? { diffuseUrl: text(candidate.diffuseUrl) } : {}),
          ...(text(candidate.normalUrl) ? { normalUrl: text(candidate.normalUrl) } : {}),
        };
        if (isTriple(candidate.position)) part.position = candidate.position;
        if (isTriple(candidate.rotationDegrees)) part.rotationDegrees = candidate.rotationDegrees;
        if (isTriple(candidate.scale)) part.scale = candidate.scale;
        return [part];
      })
    : [];
  if (!value || typeof value !== 'object' || (!text(value.meshUrl) && parts.length === 0)) {
    throw new Error('The selected TTS object has no custom mesh URL.');
  }
  return {
    name: text(value.name) || 'TTS model',
    ...(text(value.meshUrl) ? { meshUrl: text(value.meshUrl) } : {}),
    ...(text(value.diffuseUrl) ? { diffuseUrl: text(value.diffuseUrl) } : {}),
    ...(text(value.normalUrl) ? { normalUrl: text(value.normalUrl) } : {}),
    ...(Number.isFinite(value.yawDegrees) ? { yawDegrees: Number(value.yawDegrees) } : {}),
    ...(parts.length ? { parts } : {}),
  };
}

function isTriple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

/**
 * Old TTS saves point at numbered `cloud-*.steamusercontent.com` hosts. Those
 * endpoints now frequently return 502/403 responses, while Steam's public CDN
 * serves the same UGC path over HTTPS with CORS enabled.
 */
export function normalizeTtsAssetUrl(value: string): string {
  const url = value.trim();
  if (!url) return url;
  return url.replace(
    /^http:\/\/cloud-\d+\.steamusercontent\.com\//i,
    'https://steamusercontent-a.akamaihd.net/',
  );
}

/** Ordered CDN fallbacks for a Steam UGC path (availability differs per host). */
export function ttsAssetUrlCandidates(value: string): string[] {
  const primary = normalizeTtsAssetUrl(value);
  try {
    const url = new URL(primary);
    if (!/^(?:images\.steamusercontent\.com|steamusercontent-a\.akamaihd\.net|cloud-\d+\.steamusercontent\.com)$/i.test(url.hostname)) {
      return [primary];
    }
    const path = `${url.pathname}${url.search}`;
    return [...new Set([
      primary,
      `https://steamusercontent-a.akamaihd.net${path}`,
      `https://images.steamusercontent.com${path}`,
    ])];
  } catch {
    return [primary];
  }
}

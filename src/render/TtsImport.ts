/** Minimal, dependency-free reader for Tabletop Simulator save/object JSON. */

export interface TtsModelAsset {
  name: string;
  meshUrl: string;
  diffuseUrl?: string;
  normalUrl?: string;
  yawDegrees?: number;
}

interface TtsObject {
  Name?: unknown;
  Nickname?: unknown;
  GUID?: unknown;
  CustomMesh?: Record<string, unknown>;
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
  if (!value || typeof value !== 'object' || !text(value.meshUrl)) {
    throw new Error('The selected TTS object has no custom mesh URL.');
  }
  return {
    name: text(value.name) || 'TTS model',
    meshUrl: text(value.meshUrl),
    ...(text(value.diffuseUrl) ? { diffuseUrl: text(value.diffuseUrl) } : {}),
    ...(text(value.normalUrl) ? { normalUrl: text(value.normalUrl) } : {}),
    ...(Number.isFinite(value.yawDegrees) ? { yawDegrees: Number(value.yawDegrees) } : {}),
  };
}

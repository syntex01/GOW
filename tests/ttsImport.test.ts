import { describe, expect, it } from 'vitest';
import {
  decodeTtsModel,
  encodeTtsModel,
  normalizeTtsAssetUrl,
  parseTtsModels,
  ttsAssetUrlCandidates,
} from '../src/render/TtsImport';

describe('Tabletop Simulator model import', () => {
  it('finds nested custom meshes and keeps their textures', () => {
    const models = parseTtsModels(JSON.stringify({
      SaveName: 'army',
      ObjectStates: [{
        Name: 'Bag',
        ContainedObjects: [{
          Name: 'Custom_Model',
          Nickname: 'Intercessor Sergeant',
          CustomMesh: {
            MeshURL: 'https://example.test/marine.obj',
            DiffuseURL: 'https://example.test/marine.png',
            NormalURL: 'https://example.test/marine-normal.png',
          },
        }],
      }],
    }));

    expect(models).toEqual([{
      name: 'Intercessor Sergeant',
      meshUrl: 'https://example.test/marine.obj',
      diffuseUrl: 'https://example.test/marine.png',
      normalUrl: 'https://example.test/marine-normal.png',
    }]);
  });

  it('deduplicates repeated model assets and round-trips a selected model', () => {
    const custom = { MeshURL: 'mesh.obj', DiffuseURL: 'paint.png' };
    const models = parseTtsModels(JSON.stringify({
      ObjectStates: [
        { Nickname: 'Warrior A', CustomMesh: custom },
        { Nickname: 'Warrior B', CustomMesh: custom },
      ],
    }));

    expect(models).toHaveLength(1);
    models[0].yawDegrees = 90;
    expect(decodeTtsModel(encodeTtsModel(models[0]))).toEqual(models[0]);
  });

  it('finds figure layers attached as TTS child objects', () => {
    const models = parseTtsModels(JSON.stringify({
      ObjectStates: [{
        Nickname: 'Outer base',
        ChildObjects: [{
          Nickname: 'Painted figure',
          CustomMesh: { MeshURL: 'figure.obj', DiffuseURL: 'figure.png' },
        }],
      }],
    }));
    expect(models).toEqual([{
      name: 'Painted figure',
      meshUrl: 'figure.obj',
      diffuseUrl: 'figure.png',
    }]);
  });

  it('round-trips multipart scans and upgrades retired Steam hosts', () => {
    const asset = {
      name: 'Multipart figure',
      parts: [
        { meshUrl: 'part-a.obj', diffuseUrl: 'paint.png' },
        { meshUrl: 'part-b.obj', diffuseUrl: 'paint.png', rotationDegrees: [0, 90, 0] as [number, number, number] },
      ],
    };
    expect(decodeTtsModel(encodeTtsModel(asset))).toEqual(asset);
    expect(normalizeTtsAssetUrl('http://cloud-3.steamusercontent.com/ugc/1/hash/'))
      .toBe('https://steamusercontent-a.akamaihd.net/ugc/1/hash/');
    expect(ttsAssetUrlCandidates('https://images.steamusercontent.com/ugc/1/hash/'))
      .toContain('https://steamusercontent-a.akamaihd.net/ugc/1/hash/');
  });
});

import { describe, expect, it } from 'vitest';
import { decodeTtsModel, encodeTtsModel, parseTtsModels } from '../src/render/TtsImport';

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
});

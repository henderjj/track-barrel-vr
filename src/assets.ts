import { AssetType, defineAssets } from '@iwsdk/core';
import { createHull, createTurret } from './scene-assets/cabin.scene-asset.js';
import { createTerrain } from './scene-assets/terrain.scene-asset.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

export default defineAssets({
  hull: createHull(),
  turret: createTurret(),
  ground: createTerrain(),
  // The crewmate (F6.3b, docs/crew-avatars.md): Quaternius's Universal Base Characters (CC0), dressed by
  // scripts/crewman-bake/. Loaded before the systems start.
  crewman: {
    url: publicAssetUrl('models/crewman/crewman.glb'),
    type: AssetType.GLTF,
    name: 'Crewman',
  },
  'crewman-crew-mask': {
    url: publicAssetUrl('models/crewman/crewman-crew-mask.png'),
    type: AssetType.Texture,
    name: 'Crewman crew colour mask',
  },
  'start-panel': {
    url: publicAssetUrl('ui/start.uikitml'),
    type: AssetType.UIKitML,
    name: 'Start Screen',
  },
  'menu-panel': {
    url: publicAssetUrl('ui/menu.uikitml'),
    type: AssetType.UIKitML,
    name: 'Game Menu',
  },
});

import { AssetType, defineAssets } from '@iwsdk/core';
import { createHull, createTurret } from './scene-assets/cabin.scene-asset.js';
import { createTerrain } from './scene-assets/terrain.scene-asset.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

export default defineAssets({
  hull: createHull(),
  turret: createTurret(),
  ground: createTerrain(),
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

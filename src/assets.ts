import { AssetType, defineAssets } from '@iwsdk/core';
import { createGround, createHull, createTurret } from './scene-assets/cabin.scene-asset.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

export default defineAssets({
  hull: createHull(),
  turret: createTurret(),
  ground: createGround(),
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

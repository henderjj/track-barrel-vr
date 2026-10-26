import { copyTankDrive, createTankDrive, extrapolateTankDrive, lerpTankDrive, type TankDrive } from '../sim/tank-drive.js';
import { StateBuffer } from './state-buffer.js';

export { MAX_EXTRAPOLATE_MS } from './state-buffer.js';

/**
 * The jitter buffer for the host's tank states (F1.4): the guest draws the
 * tank a little in the past, between two of them, and carries it on at its
 * speed and turn rate for a short while past the newest (StateBuffer).
 */
export class TankBuffer extends StateBuffer<TankDrive> {
  constructor() {
    super({ create: () => createTankDrive(), copy: copyTankDrive, lerp: lerpTankDrive, extrapolate: extrapolateTankDrive });
  }
}

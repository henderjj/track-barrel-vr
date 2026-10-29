import { createSystem } from '@iwsdk/core';
import { interiorUniforms, setInteriorLighting, setInteriorTurret } from '../scene-assets/cabin-light.js';
import { interiorLight } from '../sim/interior.js';
import { seating } from './seating.js';

interface InteriorDebug {
  /** Whether the interior lighting is on, and the turret angle its lights are turned to, rad. */
  state(): { on: boolean; yaw: number };
  /** Turn it off to compare with the sky's light everywhere, as before (docs/interior.md). */
  setLighting(on: boolean): void;
  /** What the sky's light is multiplied by at a hull-space point on a face with this normal, linear RGB. */
  light(point: number[], normal: number[]): number[];
}

/**
 * Keeps the cabin's lighting (src/scene-assets/cabin-light.ts) turned with
 * the turret: its hatch's daylight and its dome lamp, and where its inside
 * is. After TurretSystem, which sets the turret's angle as drawn.
 */
export class CabinLightSystem extends createSystem({}) {
  private yaw = Number.NaN;

  init(): void {
    (window as unknown as { __interior: InteriorDebug }).__interior = {
      state: () => ({ on: interiorUniforms.cabinOn.value > 0.5, yaw: interiorUniforms.cabinYaw.value }),
      setLighting: (on) => setInteriorLighting(on),
      light: (point, normal) => interiorLight(point, normal, seating.turretYaw, [0, 0, 0]),
    };
  }

  update(): void {
    if (seating.turretYaw === this.yaw) return;
    this.yaw = seating.turretYaw;
    setInteriorTurret(this.yaw);
  }
}

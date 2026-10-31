import { createSystem, type Object3D } from '@iwsdk/core';
import { onSettingChange } from '../live-settings.js';
import { interiorUniforms, setCabinLook, setInteriorLighting, setInteriorTurret } from '../scene-assets/cabin-light.js';
import { HATCH_LID_NAMES } from '../scene-assets/cabin.scene-asset.js';
import { settings } from '../settings.js';
import { type CabinLook, cabinLook, interiorLight, lookFor } from '../sim/interior.js';
import { seating } from './seating.js';

interface InteriorDebug {
  /** Whether the interior lighting is on, the turret angle its lights are turned to, rad, and the cabin's look. */
  state(): { on: boolean; yaw: number; look: CabinLook; lids: Record<string, boolean> };
  /** Turn it off to compare with the sky's light everywhere, as before (docs/interior.md). */
  setLighting(on: boolean): void;
  /** What the sky's light is multiplied by at a hull-space point on a face with this normal, linear RGB. */
  light(point: number[], normal: number[]): number[];
}

/**
 * Keeps the cabin's lighting (src/scene-assets/cabin-light.ts) turned with
 * the turret: its hatch's daylight and its dome lamp, and where its inside
 * is. After TurretSystem, which sets the turret's angle as drawn. Keeps the
 * cabin's look to the settings too: the hatches' lids open or shut, the
 * ambient and the lamps as the game menu's Sound and view tab sets them.
 */
export class CabinLightSystem extends createSystem({}) {
  private yaw = Number.NaN;
  /** Each hatch's lids: drawn open, and drawn shut. */
  private lids: { open: Object3D | null; closed: Object3D | null; hatch: 'driver' | 'gunner' }[] = [];

  init(): void {
    const hull = this.world.getSceneEntity('hull')?.object3D ?? null;
    const turret = this.world.getSceneEntity('turret')?.object3D ?? null;
    for (const [hatch, root] of [['driver', hull], ['gunner', turret]] as const) {
      const names = HATCH_LID_NAMES[hatch];
      this.lids.push({ hatch, open: root?.getObjectByName(names.open) ?? null, closed: root?.getObjectByName(names.closed) ?? null });
    }
    this.applyLook();
    this.cleanupFuncs.push(
      onSettingChange((key) => {
        if (key === 'hatches' || key === 'cabin' || key === 'lamps') this.applyLook();
      }),
    );
    (window as unknown as { __interior: InteriorDebug }).__interior = {
      state: () => ({
        on: interiorUniforms.cabinOn.value > 0.5,
        yaw: interiorUniforms.cabinYaw.value,
        look: { ...cabinLook },
        lids: Object.fromEntries(this.lids.map((l) => [l.hatch, l.open?.visible === true && l.closed?.visible !== true])),
      }),
      setLighting: (on) => setInteriorLighting(on),
      light: (point, normal) => interiorLight(point, normal, seating.turretYaw, [0, 0, 0]),
    };
  }

  update(): void {
    if (seating.turretYaw === this.yaw) return;
    this.yaw = seating.turretYaw;
    setInteriorTurret(this.yaw);
  }

  /** Light and draw the cabin as the settings ask. */
  private applyLook(): void {
    setCabinLook(lookFor(settings.hatches, settings.cabin, settings.lamps, cabinLook));
    for (const lid of this.lids) {
      const open = lid.hatch === 'driver' ? cabinLook.driverHatch : cabinLook.gunnerHatch;
      if (lid.open) lid.open.visible = open;
      if (lid.closed) lid.closed.visible = !open;
    }
  }
}

import { createSystem, type Mesh } from '@iwsdk/core';
import { createSmokeCloud } from '../scene-assets/smoke.scene-asset.js';
import { SMOKE, SMOKE_WIND_DIR, smokeBlocks, type SmokeCloud, smokeCentre, smokeHalfLength, smokeRadius } from '../sim/ammo.js';
import type { Vec3 } from '../sim/ballistics.js';
import { wrapTile } from '../sim/terrain.js';
import { tankState } from './drive-system.js';
import { landedListeners } from './firing-system.js';

let active: SmokeSystem | null = null;

/** The smoke clouds now (F3.1), oldest first: what the enemies' eyes can't see through (F3.2), with smokeNow()'s time. */
export function smokeClouds(): readonly Readonly<SmokeCloud>[] {
  return active?.clouds ?? [];
}

/** The time the clouds' `laidAt` is on, s (this page's own clock). */
export function smokeNow(): number {
  return active?.time ?? 0;
}

interface SmokeDebug {
  /** Each cloud: where it landed and where its middle is now (world space), its radius across, how far it reaches each way along the wind, and its age. */
  clouds(): { x: number; y: number; z: number; laidX: number; laidZ: number; radius: number; halfLength: number; age: number }[];
  /** Lay a cloud at world x, z (on the ground at y), as a smoke round landing there would. */
  lay(x: number, y: number, z: number): void;
  /** Whether the line between two world points passes through smoke now. */
  blocks(a: Vec3, b: Vec3): boolean;
}

/**
 * Smoke screens (F3.1, docs/ammunition.md): where a smoke round lands, on
 * either page (FiringSystem's landedListeners: both pages fly every shot
 * alike), a bank of smoke grows, holds and thins away, staying where it
 * landed while the wind draws it out downwind into a longer bank.
 * Nothing goes over the network: the shot does it. The clouds are children
 * of the ground, so they stay put in the world as the tank drives, and the
 * gunsight and periscopes see them as the eye does. Runs after
 * FiringSystem.
 */
export class SmokeSystem extends createSystem({}) {
  readonly clouds: SmokeCloud[] = [];
  time = 0;
  private meshes: Mesh[] = [];
  private centre: [number, number, number] = [0, 0, 0];

  init(): void {
    active = this;
    const ground = this.world.getSceneEntity('ground') ?? null;
    for (let i = 0; i < SMOKE.max; i++) {
      const mesh = createSmokeCloud(i);
      mesh.visible = false;
      // Its long axis (x) downwind.
      mesh.rotation.y = Math.atan2(-SMOKE_WIND_DIR[1], SMOKE_WIND_DIR[0]);
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      if (ground) this.world.createTransformEntity(mesh, { parent: ground });
    }
    const onLanded = (ammo: string, point: Readonly<Vec3>) => {
      if (ammo === 'smoke') this.lay(point[0], point[1], point[2]);
    };
    landedListeners.add(onLanded);
    this.cleanupFuncs.push(
      () => landedListeners.delete(onLanded),
      () => {
        if (active === this) active = null;
      },
    );

    const self = this;
    (window as unknown as { __smoke: SmokeDebug }).__smoke = {
      clouds: () =>
        self.clouds.map((c) => {
          const at = smokeCentre(c, self.time, [0, 0, 0]);
          const age = self.time - c.laidAt;
          return { x: at[0], y: at[1], z: at[2], laidX: c.x, laidZ: c.z, radius: smokeRadius(age), halfLength: smokeHalfLength(age), age };
        }),
      lay: (x, y, z) => self.lay(x, y, z),
      blocks: (a, b) => smokeBlocks(self.clouds, self.time, a, b),
    };
  }

  /** A smoke round landed at (x, y, z), world space: a new cloud, the oldest giving way if there are already SMOKE.max. */
  lay(x: number, y: number, z: number): void {
    // Clouds that have thinned away go first.
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      if (smokeRadius(this.time - this.clouds[i].laidAt) <= 0) this.clouds.splice(i, 1);
    }
    if (this.clouds.length >= SMOKE.max) this.clouds.shift();
    this.clouds.push({ x, y, z, laidAt: this.time });
    console.info(`[Smoke] laid at (${x.toFixed(0)}, ${z.toFixed(0)})`);
  }

  update(delta: number): void {
    this.time += Math.min(delta, 0.25);
    const tank = tankState();
    // The ground is drawn at the tank's position less whole tiles: world points are drawn that much nearer.
    const offX = tank.x - wrapTile(tank.x);
    const offZ = tank.z - wrapTile(tank.z);
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      const c = this.clouds[i];
      const age = c ? this.time - c.laidAt : 0;
      const r = c ? smokeRadius(age) : 0;
      if (r <= 0) {
        if (mesh.visible) mesh.visible = false;
        continue;
      }
      const at = smokeCentre(c, this.time, this.centre);
      mesh.position.set(at[0] - offX, at[1], at[2] - offZ);
      mesh.scale.set(smokeHalfLength(age), r * SMOKE.squash, r);
      if (!mesh.visible) mesh.visible = true;
    }
  }
}

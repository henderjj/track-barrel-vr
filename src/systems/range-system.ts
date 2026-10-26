import { createSystem, Fog, type Object3D, Vector3 } from '@iwsdk/core';
import {
  FOG,
  fogAmount,
  MARKER_RANGES,
  nearestTarget,
  PRACTICE_VIEW,
  RANGE_TARGETS,
  sightLimit,
  targetFoot,
  targetMiddle,
  viewFrom,
} from '../sim/range.js';
import { onSettingChange } from '../live-settings.js';
import { settings } from '../settings.js';
import { placeTank } from './drive-system.js';
import { ride } from './ride-system.js';

let active: RangeSystem | null = null;

/** Practice → Up the range: the tank parked on the road short of the middle target, facing it. */
export function goUpTheRange(): void {
  const [x, z, heading] = viewFrom(PRACTICE_VIEW.target, PRACTICE_VIEW.distance);
  placeTank(x, z, heading);
}

/** One line on the range for the game menu: the nearest target and how the fog is set. */
export function rangeStatus(): string {
  const at = active?.tankAt();
  if (at == null) return '';
  const { index, distance } = nearestTarget(at[0], at[1]);
  const target = RANGE_TARGETS[index];
  const fog = settings.fog ? `fog to about ${Math.round(sightLimit() / 10) * 10} m` : 'fog off';
  return `Nearest target: the ${target.kind} at ${target.range} m, ${Math.round(distance)} m away. ${fog}`;
}

interface RangeDebug {
  /** Each target: its range from the sight at the start, what it is, and where it stands (world space). */
  targets(): { range: number; kind: string; x: number; z: number; middle: number }[];
  /** The range markers' ranges, m. */
  markers(): number[];
  /** Whether the fog is on, and its numbers. */
  fog(): { on: boolean; near: number; far: number; limit: number; at500: number };
  /** Where the tank stands on the range (world space), and the nearest target to it. */
  tank(): { x: number; z: number; nearest: number; distance: number };
  /** How far target `i` is drawn from the player's eyes, m: it stands in the world, so this shrinks as the tank drives at it. */
  drawnRange(i: number): number;
  up(): void;
}

/**
 * The test range (F1.7, docs/range.md). The range itself is geometry: its
 * roads, targets and markers are built into the ground's model
 * (src/scene-assets/range.scene-asset.ts) so they move with the world as
 * the tank drives and need no system of their own.
 *
 * What is left for a system is the air: the fog that hides the drawn
 * ground's edge and limits how far the crew can see (about 600 m), the
 * menu's line about the nearest target, and the Practice shortcut that
 * parks the tank up the range. Spike S2's ride puts its own, thicker fog on
 * while it runs and puts this one back when it stops.
 */
export class RangeSystem extends createSystem({}) {
  private fog = new Fog(FOG.color, FOG.near, FOG.far);
  private ground: Object3D | null = null;
  private eye = new Vector3();
  private headAt = new Vector3();
  private at: [number, number] = [0, 0];
  private wasRiding = false;

  init(): void {
    active = this;
    this.ground = this.world.getSceneEntity('ground')?.object3D ?? null;
    this.applyFog();
    this.cleanupFuncs.push(
      onSettingChange((key) => {
        if (key === 'fog') this.applyFog();
      }),
      () => {
        if (active === this) active = null;
        if (this.scene.fog === this.fog) this.scene.fog = null;
      },
    );

    const self = this;
    (window as unknown as { __range: RangeDebug }).__range = {
      targets: () =>
        RANGE_TARGETS.map((t, i) => {
          const [x, z] = targetFoot(i);
          return { range: t.range, kind: t.kind, x, z, middle: targetMiddle(i) };
        }),
      markers: () => [...MARKER_RANGES],
      fog: () => ({ on: settings.fog, near: FOG.near, far: FOG.far, limit: sightLimit(), at500: fogAmount(500) }),
      tank: () => {
        const [x, z] = self.tankAt();
        const { index, distance } = nearestTarget(x, z);
        return { x, z, nearest: index, distance };
      },
      drawnRange: (i) => self.drawnRange(i),
      up: () => goUpTheRange(),
    };
  }

  update(): void {
    // The ride borrows the scene's fog; put the range's back when it stops.
    if (this.wasRiding && !ride.active) this.applyFog();
    this.wasRiding = ride.active;
  }

  /** The fog as the menu has it, unless the ride has borrowed the scene. */
  applyFog(): void {
    if (ride.active) return;
    this.scene.fog = settings.fog ? this.fog : null;
  }

  /**
   * Where the tank stands on the range (world space). The tank itself stays
   * at the origin and the ground moves (docs/tank-drive.md), so the ground's
   * own pose says where on the range the crew are: the world point drawn at
   * the hull's middle.
   */
  tankAt(): [number, number] {
    const ground = this.ground;
    if (ground == null) {
      this.at[0] = 0;
      this.at[1] = 0;
      return this.at;
    }
    this.eye.set(0, 0, 0);
    ground.worldToLocal(this.eye);
    this.at[0] = this.eye.x;
    this.at[1] = this.eye.z;
    return this.at;
  }

  /** How far target `i` is drawn from the player's head, m. */
  private drawnRange(i: number): number {
    const ground = this.ground;
    if (ground == null) return NaN;
    const [x, z] = targetFoot(i);
    // The target's foot, from the ground's space into the world as drawn.
    this.eye.set(x, 0, z);
    ground.localToWorld(this.eye);
    this.player.head.getWorldPosition(this.headAt);
    return Math.hypot(this.eye.x - this.headAt.x, this.eye.z - this.headAt.z);
  }
}

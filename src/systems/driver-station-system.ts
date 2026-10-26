import {
  CanvasTexture,
  createSystem,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { createNeedle } from '../scene-assets/driver-station.scene-asset.js';
import { createLever } from '../scene-assets/mechanism.scene-asset.js';
import {
  type Dial,
  dialCentre,
  DIALS,
  DRIVER_CONTROL_IDS,
  DRIVER_CONTROLS,
  type DriverControlId,
  GEAR_ANGLES,
  gearOfLever,
  needleAngle,
  PANEL,
  throttleAngle,
  throttleOf,
  tillerAngle,
} from '../sim/driver-station.js';
import { Lever } from '../sim/mechanism.js';
import { oilPressure, type TankDrive } from '../sim/tank-drive.js';
import { drive, shownDriverState, shownDriverControls } from './drive-system.js';
import { handUse } from './grip-system.js';
import { HoldKind } from './hand-lock.js';
import { buzz } from './haptics.js';
import { addControl, type Control } from './mechanism-system.js';
import { ride } from './ride-system.js';
import { seating } from './seating.js';

type Side = 'left' | 'right';
const SIDES: readonly Side[] = ['left', 'right'];
const DEG = Math.PI / 180;

/** Each control's `handUse` name and HoldKind. */
const NAMES: Record<DriverControlId, string> = {
  tillerLeft: 'driver-tiller-left',
  tillerRight: 'driver-tiller-right',
  gear: 'gear-lever',
  throttle: 'hand-throttle',
};
const KINDS: Record<DriverControlId, number> = {
  tillerLeft: HoldKind.TillerLeft,
  tillerRight: HoldKind.TillerRight,
  gear: HoldKind.GearLever,
  throttle: HoldKind.HandThrottle,
};

/** The crewmate's levers ease to where their packets put them at this rate, 1/s (packets come 45 times a second). */
const FOLLOW_RATE = 20;
/** While the gears grind, a rough buzz in each hand on a driver's control this often, s. */
const GRIND_EVERY = 0.08;
/** The dials' face canvas, px. */
const FACE_PX_W = 1024;
const FACE_PX_H = Math.round((FACE_PX_W * PANEL.height) / PANEL.width);

interface StationDebug {
  /** Each control's `window.__mechanisms` name. */
  names: Record<DriverControlId, string>;
  /** Each lever's angle (degrees) and who holds it, what the station reads from them, and how often the gears ground. */
  state(): {
    angles: Record<DriverControlId, number>;
    heldBy: Record<DriverControlId, Side | 'both' | null>;
    left: number;
    right: number;
    gear: number;
    throttle: number;
    tillersHeld: boolean;
    grinds: number;
    shifts: number;
    usable: boolean;
  };
  /** What each gauge's needle points at, in its dial's units (speed km/h, rpm, coolant °C, oil bar, fuel 0-1). */
  gauges(): Record<Dial['id'], number>;
  /** The middle of a control's handle, scene space: where it is, or where it would be at `degrees`. */
  handle(id: DriverControlId, degrees?: number): number[];
}

/**
 * The driver's station (F1.5, docs/driver-station.md): two tillers, a gear
 * lever with three notches (low back, neutral, high forwards) and a hand
 * throttle on the left wall, all mechanism-kit levers, and five gauges
 * under the vision slit (speed, RPM, coolant, oil pressure, fuel).
 *
 * MechanismSystem takes hold of the levers and moves them; this system,
 * after it, reads them into `drive` for DriveSystem while this player sits
 * in the driver's seat. While no hand is on a tiller the sticks (or keys)
 * drive and the tillers are drawn where they would be. On the crewmate's
 * page the levers follow the controls the tank is driven by
 * (shownDriverControls: the guest's DriverControls packets on the host,
 * the host's TankState packets on a guest), so each sees the other's
 * hands work them. The needles follow the tank as this page draws it.
 *
 * The gears grind with a rough buzz in the driver's hands on the controls
 * (the sign is DriveSystem's), and a gear going in gives a clunk in the
 * hand on the gear lever.
 */
export class DriverStationSystem extends createSystem({}) {
  private root = new Group();
  private levers = {} as Record<DriverControlId, Lever>;
  private mounts = {} as Record<DriverControlId, Group>;
  private pivots = {} as Record<DriverControlId, Object3D>;
  private needles: Object3D[] = [];
  private grindClock = 0;
  private grinds = 0;
  private shifts = 0;
  private wasGrinding = false;
  /** The gear engaged last frame (-1 before the first). */
  private engaged = -1;
  private tmp = new Vector3();

  init(): void {
    this.root.name = 'Driver Station';
    for (const id of DRIVER_CONTROL_IDS) {
      const { spec, pivot } = DRIVER_CONTROLS[id];
      const lever = new Lever(spec);
      this.levers[id] = lever;
      // The mount is the lever's space: at its pivot, turning with nothing but the hull.
      const mount = new Group();
      mount.position.set(pivot[0], pivot[1], pivot[2]);
      const part = createLever(spec);
      mount.add(part);
      this.root.add(mount);
      this.mounts[id] = mount;
      this.pivots[id] = part;
      const control: Control = {
        name: NAMES[id],
        mech: lever,
        frame: mount,
        kind: KINDS[id],
        active: () => this.usable(),
      };
      this.cleanupFuncs.push(addControl(control));
    }
    this.levers.gear.angle = GEAR_ANGLES[drive.gear];

    const panel = new Group();
    panel.position.set(...PANEL.centre);
    panel.rotation.x = -PANEL.tilt;
    panel.add(this.createFace());
    const at: [number, number] = [0, 0];
    for (let i = 0; i < DIALS.length; i++) {
      const needle = createNeedle();
      dialCentre(i, at);
      needle.position.set(at[0], at[1], 0);
      panel.add(needle);
      this.needles.push(needle);
    }
    this.root.add(panel);
    this.world.createTransformEntity(this.root);
    this.draw();

    const self = this;
    const debug: StationDebug = {
      names: { ...NAMES },
      state: () => {
        const angles = {} as Record<DriverControlId, number>;
        const heldBy = {} as Record<DriverControlId, Side | 'both' | null>;
        for (const id of DRIVER_CONTROL_IDS) {
          const l = self.levers[id];
          angles[id] = l.angle / DEG;
          heldBy[id] = l.held[0] && l.held[1] ? 'both' : l.held[0] ? 'left' : l.held[1] ? 'right' : null;
        }
        return {
          angles, heldBy,
          left: drive.left, right: drive.right, gear: drive.gear, throttle: drive.throttle, tillersHeld: drive.tillersHeld,
          grinds: self.grinds, shifts: self.shifts, usable: self.usable(),
        };
      },
      gauges: () => {
        const out = {} as Record<Dial['id'], number>;
        const s = shownDriverState();
        if (s) for (const dial of DIALS) out[dial.id] = gaugeValue(dial, s);
        return out;
      },
      handle: (id, degrees) => {
        const { spec } = DRIVER_CONTROLS[id];
        const a = degrees === undefined ? self.levers[id].angle : degrees * DEG;
        const r = spec.length - spec.gripLength / 2;
        self.mounts[id].updateWorldMatrix(true, false);
        return self.tmp.set(0, r * Math.cos(a), -r * Math.sin(a)).applyMatrix4(self.mounts[id].matrixWorld).toArray();
      },
    };
    (window as unknown as { __driverStation: StationDebug }).__driverStation = debug;
  }

  /** This player can work the controls: in the driver's seat, not riding or sat somewhere else. */
  private usable(): boolean {
    return seating.mine === 'driver' && !seating.away && !ride.active;
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    const { tillerLeft, tillerRight, gear, throttle } = this.levers;
    const shown = shownDriverControls();
    if (seating.mine === 'driver') {
      // The menu, keys or a test moved the gear lever.
      if (drive.gearAsked !== null) {
        if (!gear.anyHeld) gear.angle = GEAR_ANGLES[drive.gearAsked];
        drive.gearAsked = null;
      }
      const held = tillerLeft.anyHeld || tillerRight.anyHeld;
      drive.tillersHeld = held && this.usable();
      drive.left = tillerLeft.demand();
      drive.right = tillerRight.demand();
      drive.gear = gearOfLever(gear.angle);
      drive.throttle = throttleOf(throttle.angle);
      // The sticks or keys drive while no hand is on a tiller: draw the tillers where they would be.
      if (!held && shown) {
        tillerLeft.angle = tillerAngle(shown.left);
        tillerRight.angle = tillerAngle(shown.right);
      }
    } else {
      drive.tillersHeld = false;
      drive.gearAsked = null;
      if (shown) {
        // The crewmate drives (or nobody does): the levers follow the controls the tank runs on.
        const k = 1 - Math.exp(-FOLLOW_RATE * dt);
        tillerLeft.angle += (tillerAngle(shown.left) - tillerLeft.angle) * k;
        tillerRight.angle += (tillerAngle(shown.right) - tillerRight.angle) * k;
        gear.angle += (GEAR_ANGLES[shown.gear] - gear.angle) * k;
        throttle.angle += (throttleAngle(shown.throttle) - throttle.angle) * k;
      }
    }
    this.feel(dt);
    this.draw();
  }

  /** The gears grinding buzz the driver's hands on the controls; a gear going in clunks in the hand on the lever. */
  private feel(dt: number): void {
    const s = shownDriverState();
    if (!s) return;
    const mine = seating.mine === 'driver';
    if (s.grinding && !this.wasGrinding) this.grinds++;
    this.wasGrinding = s.grinding;
    if (s.gear !== 0 && s.gear !== this.engaged && this.engaged !== -1) {
      this.shifts++;
      if (mine) this.pulseHolding(this.levers.gear, 0.7, 45);
    }
    this.engaged = s.gear;
    if (!mine || !s.grinding) {
      this.grindClock = GRIND_EVERY;
      return;
    }
    this.grindClock += dt;
    if (this.grindClock < GRIND_EVERY) return;
    this.grindClock = 0;
    for (const id of DRIVER_CONTROL_IDS) this.pulseHolding(this.levers[id], id === 'gear' ? 0.75 : 0.4, 30);
  }

  private pulseHolding(lever: Lever, intensity: number, ms: number): void {
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i];
      if (lever.held[i] && handUse[side] !== null) buzz(this.input.xr.gamepads[side]?.gamepad, side, intensity, ms);
    }
  }

  /** Turn each lever and needle to where it is now. */
  private draw(): void {
    for (const id of DRIVER_CONTROL_IDS) this.pivots[id].rotation.x = -this.levers[id].angle;
    const s = shownDriverState();
    if (!s) return;
    for (let i = 0; i < DIALS.length; i++) {
      this.needles[i].rotation.z = -needleAngle(DIALS[i], gaugeValue(DIALS[i], s));
    }
  }

  /** The dials' faces, drawn once: numbered marks round each, its name under it, and a line on the gear lever. */
  private createFace(): Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = FACE_PX_W;
    canvas.height = FACE_PX_H;
    const ctx = canvas.getContext('2d')!;
    const px = FACE_PX_W / PANEL.width;
    ctx.fillStyle = '#26281f';
    ctx.fillRect(0, 0, FACE_PX_W, FACE_PX_H);
    const at: [number, number] = [0, 0];
    for (let i = 0; i < DIALS.length; i++) {
      const dial = DIALS[i];
      dialCentre(i, at);
      const cx = FACE_PX_W / 2 + at[0] * px;
      const cy = FACE_PX_H / 2 - at[1] * px;
      const r = PANEL.dialRadius * px;
      ctx.fillStyle = '#efe6c8';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#1a1a14';
      ctx.lineWidth = 3;
      ctx.stroke();
      // Marks: the numbered ones long, a short one between each pair.
      ctx.fillStyle = '#1a1a14';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(r * 0.3)}px sans-serif`;
      const marks = dial.marks;
      for (let m = 0; m < marks.length; m++) {
        const a = needleAngle(dial, marks[m]);
        tick(ctx, cx, cy, r, a, 0.22, 4);
        ctx.fillText(dial.text(marks[m]), cx + Math.sin(a) * r * 0.58, cy - Math.cos(a) * r * 0.58);
        if (m + 1 < marks.length) tick(ctx, cx, cy, r, needleAngle(dial, (marks[m] + marks[m + 1]) / 2), 0.12, 2);
      }
      ctx.font = `bold ${Math.round(r * 0.22)}px sans-serif`;
      ctx.fillText(dial.label, cx, cy + r * 0.62);
    }
    ctx.fillStyle = '#c9c0a0';
    ctx.font = `bold ${Math.round(FACE_PX_H * 0.09)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('GEAR LEVER: back LOW · middle NEUTRAL · forwards HIGH. Centre the tillers to shift.', FACE_PX_W / 2, FACE_PX_H * 0.93);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const face = new Mesh(new PlaneGeometry(PANEL.width, PANEL.height), new MeshBasicMaterial({ map: texture, toneMapped: false }));
    face.name = 'Gauge Face';
    this.cleanupFuncs.push(() => {
      texture.dispose();
      face.geometry.dispose();
      (face.material as MeshBasicMaterial).dispose();
    });
    return face;
  }
}

/** A mark from the rim inwards by `length` of the radius. */
function tick(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, a: number, length: number, width: number): void {
  const sx = Math.sin(a);
  const cy2 = -Math.cos(a);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(cx + sx * r * 0.95, cy + cy2 * r * 0.95);
  ctx.lineTo(cx + sx * r * (0.95 - length), cy + cy2 * r * (0.95 - length));
  ctx.stroke();
}

/** What a dial reads for the tank as drawn. */
function gaugeValue(dial: Dial, s: TankDrive): number {
  switch (dial.id) {
    case 'speed': return Math.abs(s.speed) * 3.6;
    case 'rpm': return s.rpm;
    case 'coolant': return s.coolant;
    case 'oil': return oilPressure(s.rpm, s.coolant);
    case 'fuel': return s.fuel;
  }
}

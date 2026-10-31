import {
  CanvasTexture,
  createSystem,
  Group,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { createLamp, createNeedle, LAMP_DARK } from '../scene-assets/driver-station.scene-asset.js';
import { createButtonCap, createLever } from '../scene-assets/mechanism.scene-asset.js';
import {
  CAP_PROUD,
  type Dial,
  dialCentre,
  DIALS,
  DRIVER_CONTROL_IDS,
  DRIVER_CONTROLS,
  type DriverControlId,
  ENGINE_CONTROL_IDS,
  ENGINE_CONTROLS,
  type EngineControlId,
  GEAR_ANGLES,
  gearOfLever,
  type LampId,
  LAMPS,
  needleAngle,
  onSwitchPanel,
  PANEL,
  GEAR_PLATE,
  SWITCH_ON_DEPTH,
  SWITCH_PANEL,
  throttleAngle,
  throttleOf,
  tillerAngle,
  VOLT_DIAL,
  VOLTMETER,
} from '../sim/driver-station.js';
import { volts } from '../sim/engine.js';
import { Button, Lever, MechEvent } from '../sim/mechanism.js';
import { type Gear, NEUTRAL } from '../sim/gearbox.js';
import { type DriverControls, oilPressure, type TankDrive } from '../sim/tank-drive.js';
import { drive, engineStart, gearboxMode, shownDriverState, shownDriverControls } from './drive-system.js';
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

/** Each engine control's `handUse` name (F1.17): pressed, not held, so HoldKind.None. */
export const ENGINE_NAMES: Record<EngineControlId, string> = {
  battery: 'driver-battery',
  ignition: 'driver-ignition',
  choke: 'driver-choke',
  starter: 'driver-starter',
  siren: 'driver-siren',
};
/** The voltmeter's needle is the dials' made smaller, and swings to a new reading at this rate, 1/s. */
const VOLT_NEEDLE_SCALE = 0.55;
const VOLT_RATE = 6;
/** With the battery off the dials' faces are this dark: the box's lamps light them. */
const UNLIT = 0.3;
/** The switch strip's face canvas, px. */
const STRIP_PX_W = 1024;
const STRIP_PX_H = Math.round((STRIP_PX_W * SWITCH_PANEL.height) / SWITCH_PANEL.width);

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
  /** What each gauge's needle points at, in its dial's units (speed km/h, rpm, coolant °C, oil bar, fuel 0-1, volts). */
  gauges(): Record<Dial['id'], number>;
  /** The instrument box (F1.17): each switch and button's kit name, whether it is on (pressed in), how often pressed, and the lamps lit. */
  engine(): {
    names: Record<EngineControlId, string>;
    on: Record<EngineControlId, boolean>;
    presses: Record<EngineControlId, number>;
    lamps: Record<LampId, boolean>;
    lit: boolean;
  };
  /** The middle of an engine control's cap face, scene space, and the way out of the face. */
  cap(id: EngineControlId): { at: number[]; out: number[] };
  /** The middle of a control's handle, scene space: where it is, or where it would be at `degrees`. */
  handle(id: DriverControlId, degrees?: number): number[];
}

/**
 * The driver's station (F1.5, docs/driver-station.md): two tillers, a gear
 * lever with a notch for each gear (F1.16, docs/gearbox.md: reverse,
 * neutral and 1st to 5th, back to front) and a hand throttle on the left
 * wall, all mechanism-kit levers, and five gauges in the instrument box
 * (speed, RPM, coolant, oil pressure, fuel). With the automatic box the
 * gear lever moves by itself to the gear engaged and can't be taken hold of.
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
  /** Whether the automatic box had the lever last frame: changing to a manual box puts it in neutral. */
  private wasAuto = true;
  /** The gear engaged last frame (-1 before the first). */
  private engaged = -1;
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  /** The instrument box's switches and buttons, their caps and mounts (F1.17). */
  private buttons = {} as Record<EngineControlId, Button>;
  private caps = {} as Record<EngineControlId, Mesh>;
  private capMounts = {} as Record<EngineControlId, Group>;
  private lamps = {} as Record<LampId, MeshBasicMaterial>;
  private lampLit = {} as Record<LampId, boolean>;
  private faces: MeshBasicMaterial[] = [];
  private voltNeedle!: Object3D;
  private voltsShown = 0;
  /** The engine ran last frame, and the Engine start setting then: started by a shortcut or changed to the Full procedure, the switches go on. */
  private wasRunning = false;
  private lastStart = engineStart();

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
        // The automatic box works the gear lever itself.
        active: id === 'gear' ? () => this.usable() && gearboxMode() !== 'auto' : () => this.usable(),
      };
      this.cleanupFuncs.push(addControl(control));
    }
    this.levers.gear.angle = GEAR_ANGLES[drive.gear];

    const panel = new Group();
    panel.position.set(...PANEL.centre);
    panel.rotation.set(-PANEL.tilt, PANEL.yaw, 0, 'YXZ');
    panel.add(this.createFace());
    const at: [number, number] = [0, 0];
    for (let i = 0; i < DIALS.length; i++) {
      const needle = createNeedle();
      dialCentre(i, at);
      needle.position.set(at[0], at[1], 0);
      panel.add(needle);
      this.needles.push(needle);
    }
    this.addSwitchPanel(panel);
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
        if (s) for (const dial of [...DIALS, VOLT_DIAL]) out[dial.id] = gaugeValue(dial, s);
        return out;
      },
      engine: () => {
        const on = {} as Record<EngineControlId, boolean>;
        const presses = {} as Record<EngineControlId, number>;
        for (const id of ENGINE_CONTROL_IDS) {
          on[id] = self.buttons[id].on;
          presses[id] = self.buttons[id].presses;
        }
        return { names: { ...ENGINE_NAMES }, on, presses, lamps: { ...self.lampLit }, lit: self.faces[0]?.color.r === 1 };
      },
      cap: (id) => {
        const mount = self.capMounts[id];
        mount.updateWorldMatrix(true, false);
        const at = self.tmp.set(0, 0, 0).applyMatrix4(mount.matrixWorld).toArray();
        const out = self.tmp2.set(0, 0, 1).transformDirection(mount.matrixWorld).toArray();
        return { at, out };
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
    const state = shownDriverState();
    const k = 1 - Math.exp(-FOLLOW_RATE * dt);
    if (seating.mine === 'driver') {
      const auto = gearboxMode() === 'auto';
      if (auto) {
        // The automatic box moves the lever to the gear it engages (the kit lets go of it: it isn't active).
        drive.gearAsked = null;
        if (state) gear.angle += (GEAR_ANGLES[engagedGear(state)] - gear.angle) * k;
        drive.gear = state ? engagedGear(state) : drive.gear;
      } else {
        // Taken over from the automatic box, the lever starts in neutral: the driver picks the gear, the clutch out
        // in the gear the box left would bog the engine.
        if (this.wasAuto && drive.gearAsked === null) drive.gearAsked = NEUTRAL;
        // The stick, keys or a test moved the gear lever.
        if (drive.gearAsked !== null) {
          if (!gear.anyHeld) gear.angle = GEAR_ANGLES[drive.gearAsked];
          drive.gearAsked = null;
        }
        drive.gear = gearOfLever(gear.angle);
      }
      this.wasAuto = auto;
      this.readSwitches(state);
      const held = tillerLeft.anyHeld || tillerRight.anyHeld;
      drive.tillersHeld = held && this.usable();
      drive.left = tillerLeft.demand();
      drive.right = tillerRight.demand();
      drive.throttle = throttleOf(throttle.angle);
      // The sticks or keys drive while no hand is on a tiller: draw the tillers where they would be.
      if (!held && shown) {
        tillerLeft.angle = tillerAngle(shown.left);
        tillerRight.angle = tillerAngle(shown.right);
      }
    } else {
      drive.tillersHeld = false;
      drive.gearAsked = null;
      drive.starter = false;
      drive.siren = false;
      // An empty driver's seat runs on the automatic box.
      this.wasAuto = true;
      if (shown) {
        // The switches stay as the tank's driver set them, so they are where they were when this player sits down.
        drive.battery = shown.battery;
        drive.ignition = shown.ignition;
        drive.choke = shown.choke;
        // The crewmate drives (or nobody does): the levers follow the controls the tank runs on.
        tillerLeft.angle += (tillerAngle(shown.left) - tillerLeft.angle) * k;
        tillerRight.angle += (tillerAngle(shown.right) - tillerRight.angle) * k;
        gear.angle += (GEAR_ANGLES[leverGear(shown, state)] - gear.angle) * k;
        throttle.angle += (throttleAngle(shown.throttle) - throttle.angle) * k;
      }
    }
    this.wasRunning = state?.running ?? this.wasRunning;
    this.lastStart = engineStart();
    this.feel(dt);
    this.draw();
    this.drawEngine(dt, shown, state);
  }

  /**
   * The driver's switches into `drive`: a latching switch pressed flips its
   * setting (the kit's `moved`), and is drawn from it here, so keys and
   * tests move it too; the buttons count while held in. Started by a
   * Practice shortcut, or changed to the Full procedure with it running,
   * the battery and ignition go on as if this driver had done it.
   */
  private readSwitches(state: TankDrive | null): void {
    const usable = this.usable();
    drive.starter = usable && this.buttons.starter.on;
    drive.siren = usable && this.buttons.siren.on;
    const running = state?.running ?? false;
    const start = engineStart();
    if (start === 'full' && running && ((!this.wasRunning && !this.buttons.starter.on) || this.lastStart !== 'full')) {
      drive.battery = true;
      drive.ignition = true;
    }
    for (const id of ['battery', 'ignition', 'choke'] as const) this.buttons[id].on = drive[id];
  }

  /** The kit pressed or let go of an engine control: a switch flips its setting, with a tick in the pressing hand. */
  private pressed(id: EngineControlId, events: number): void {
    const b = this.buttons[id];
    if (events & MechEvent.Press) {
      if (b.spec.latching && (id === 'battery' || id === 'ignition' || id === 'choke')) drive[id] = b.on;
      const side = b.pressedBy === 0 ? 'left' : b.pressedBy === 1 ? 'right' : null;
      if (side) buzz(this.input.xr.gamepads[side]?.gamepad, side, 0.5, 20);
    }
  }

  /** The switch strip: its face, the voltmeter's needle, the lamps, and a kit button on a mount for each switch (F1.17). */
  private addSwitchPanel(panel: Group): void {
    panel.add(this.createStripFace());
    const at: [number, number] = [0, 0];
    this.voltNeedle = createNeedle();
    onSwitchPanel(VOLTMETER.x, 0, at);
    this.voltNeedle.position.set(at[0], at[1], 0);
    this.voltNeedle.scale.set(VOLT_NEEDLE_SCALE, VOLT_NEEDLE_SCALE, 1);
    panel.add(this.voltNeedle);
    for (const lamp of LAMPS) {
      const mesh = createLamp(lamp.color);
      onSwitchPanel(lamp.x, lamp.y, at);
      mesh.position.set(at[0], at[1], 0);
      panel.add(mesh);
      this.lamps[lamp.id] = mesh.material as MeshBasicMaterial;
      this.lampLit[lamp.id] = false;
      this.cleanupFuncs.push(() => {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
      });
    }
    for (const id of ENGINE_CONTROL_IDS) {
      const { spec, x, color } = ENGINE_CONTROLS[id];
      const button = new Button(spec);
      this.buttons[id] = button;
      // The mount is the button's space: its cap's face, out, CAP_PROUD plus its travel in front of the strip.
      const mount = new Group();
      onSwitchPanel(x, SWITCH_PANEL.capY, at);
      mount.position.set(at[0], at[1], CAP_PROUD + spec.travel);
      const cap = createButtonCap(spec, color);
      mount.add(cap);
      panel.add(mount);
      this.caps[id] = cap;
      this.capMounts[id] = mount;
      const control: Control = {
        name: ENGINE_NAMES[id],
        mech: button,
        frame: mount,
        kind: HoldKind.None,
        active: () => this.usable(),
        moved: (events) => this.pressed(id, events),
      };
      this.cleanupFuncs.push(addControl(control));
    }
  }

  /**
   * The instrument box as the engine stands: the caps in or out (a switch
   * that is on sits half in, glowing; on the crewmate's page the buttons
   * follow their presses), the lamps, the voltmeter, and the faces dark
   * with the battery off.
   */
  private drawEngine(dt: number, shown: DriverControls | null, s: TankDrive | null): void {
    const mine = seating.mine === 'driver';
    for (const id of ENGINE_CONTROL_IDS) {
      const b = this.buttons[id];
      const { spec, color } = ENGINE_CONTROLS[id];
      const on = mine ? b.on : shown ? shown[id] : false;
      const latched = spec.latching && on ? spec.travel * SWITCH_ON_DEPTH : 0;
      const pressedIn = !spec.latching && on ? spec.travel : 0;
      this.caps[id].position.z = -Math.max(mine ? b.depth : 0, latched, pressedIn);
      const lit = this.caps[id].material as MeshStandardMaterial;
      lit.emissive.setHex(on ? color : 0x000000);
      lit.emissiveIntensity = on ? 0.6 : 0;
    }
    const power = s?.power ?? false;
    const stopped = s ? !s.running : true;
    this.lampLit.oil = power && stopped;
    this.lampLit.generator = power && stopped;
    this.lampLit.brake = false;
    for (const lamp of LAMPS) this.lamps[lamp.id].color.setHex(lamp.color).multiplyScalar(this.lampLit[lamp.id] ? 1 : LAMP_DARK);
    const target = s ? volts(s) : 0;
    this.voltsShown += (target - this.voltsShown) * (1 - Math.exp(-VOLT_RATE * dt));
    this.voltNeedle.rotation.z = -needleAngle(VOLT_DIAL, this.voltsShown);
    for (const face of this.faces) face.color.setScalar(power ? 1 : UNLIT);
  }

  /** The switch strip's face, drawn once: the voltmeter's dial, the lamps' and switches' labels. */
  private createStripFace(): Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = STRIP_PX_W;
    canvas.height = STRIP_PX_H;
    const ctx = canvas.getContext('2d')!;
    const px = STRIP_PX_W / SWITCH_PANEL.width;
    const X = (x: number) => STRIP_PX_W / 2 + x * px;
    const Y = (y: number) => STRIP_PX_H / 2 - y * px;
    ctx.fillStyle = '#26281f';
    ctx.fillRect(0, 0, STRIP_PX_W, STRIP_PX_H);
    // The voltmeter.
    const vx = X(VOLTMETER.x);
    const vy = Y(0);
    const r = VOLTMETER.radius * px;
    ctx.fillStyle = '#efe6c8';
    ctx.beginPath();
    ctx.arc(vx, vy, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#1a1a14';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#1a1a14';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(r * 0.3)}px sans-serif`;
    for (const mark of VOLTMETER.marks) {
      const a = needleAngle(VOLT_DIAL, mark);
      tick(ctx, vx, vy, r, a, 0.2, 3);
      ctx.fillText(String(mark), vx + Math.sin(a) * r * 0.6, vy - Math.cos(a) * r * 0.6);
    }
    ctx.font = `bold ${Math.round(r * 0.24)}px sans-serif`;
    ctx.fillText('VOLTS', vx, vy + r * 0.62);
    // The lamps' and switches' labels, painted on the box.
    ctx.fillStyle = '#c9c0a0';
    ctx.textAlign = 'left';
    ctx.font = `bold ${Math.round(0.0075 * px)}px sans-serif`;
    // Squeezed to end short of the Battery switch's label, which the bottom lamp's shares a line with.
    for (const lamp of LAMPS) ctx.fillText(lamp.label, X(lamp.x + 0.01), Y(lamp.y), 0.022 * px);
    ctx.textAlign = 'center';
    for (const id of ENGINE_CONTROL_IDS) {
      const { x, label } = ENGINE_CONTROLS[id];
      ctx.fillText(label, X(x), Y(SWITCH_PANEL.labelY), 0.029 * px);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({ map: texture, toneMapped: false });
    const face = new Mesh(new PlaneGeometry(SWITCH_PANEL.width, SWITCH_PANEL.height), material);
    face.position.set(0, SWITCH_PANEL.y, 0);
    face.name = 'Switch Panel Face';
    this.faces.push(material);
    this.cleanupFuncs.push(() => {
      texture.dispose();
      face.geometry.dispose();
      material.dispose();
    });
    return face;
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
    // The gear plate, in the bottom row's third place.
    dialCentre(GEAR_PLATE, at);
    const gx = FACE_PX_W / 2 + at[0] * px;
    const gy = FACE_PX_H / 2 - at[1] * px;
    const line = PANEL.dialRadius * px * 0.42;
    ctx.fillStyle = '#c9c0a0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ['GEARS', 'R N 1 2 3 4 5', 'back  >  fwd', 'clutch L trig', 'gears R stick'].forEach((text, i) => {
      ctx.font = `bold ${Math.round(line * (i === 0 ? 0.95 : i === 4 ? 0.7 : 0.9))}px sans-serif`;
      ctx.fillText(text, gx, gy + (i - 2) * line * 1.1, PANEL.dialSpacing * px - 8);
    });
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const face = new Mesh(new PlaneGeometry(PANEL.width, PANEL.height), new MeshBasicMaterial({ map: texture, toneMapped: false }));
    face.name = 'Gauge Face';
    this.faces.push(face.material as MeshBasicMaterial);
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

/** The gear the box has engaged, or is putting in. */
function engagedGear(s: TankDrive): Gear {
  return s.gear !== NEUTRAL ? s.gear : s.toGear;
}

/** Where the driver's gear lever is drawn on the other page: the gear the automatic box engaged, or the driver's lever. */
function leverGear(c: DriverControls, s: TankDrive | null): Gear {
  return c.mode === 'auto' && s ? engagedGear(s) : c.gear;
}

/** What a dial reads for the tank as drawn. */
function gaugeValue(dial: Dial, s: TankDrive): number {
  switch (dial.id) {
    case 'speed': return Math.abs(s.speed) * 3.6;
    case 'rpm': return s.rpm;
    case 'coolant': return s.coolant;
    case 'oil': return oilPressure(s.rpm, s.coolant);
    case 'fuel': return s.fuel;
    case 'volts': return volts(s);
  }
}

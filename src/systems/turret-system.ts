import { createSystem, type Entity, Group, type Mesh, type Object3D, Vector3, VisibilityState } from '@iwsdk/core';
import { PacketType } from '../net/pose-codec.js';
import { StateBuffer } from '../net/state-buffer.js';
import type { TankHeader } from '../net/tank-codec.js';
import { decodeTurretState, encodeTurretState, TURRET_STATE_BYTES } from '../net/turret-codec.js';
import { createGun } from '../scene-assets/cabin.scene-asset.js';
import { createTwistGrip, createWheel } from '../scene-assets/mechanism.scene-asset.js';
import { hullToSeat, SEATS, TURRET, turnAboutHead } from '../sim/cabin.js';
import { MechEvent, TwistGrip, Wheel } from '../sim/mechanism.js';
import {
  angleDelta,
  copyTurretState,
  createGunnerInput,
  createTurretState,
  ELEVATION_WHEEL,
  elevationForWheel,
  extrapolateTurretState,
  lerpTurretState,
  POWER_GRIP,
  STATION,
  type StationControl,
  stepTurret,
  TRAVERSE_CRANK,
  TRUNNION,
  type TurretState,
  wheelForElevation,
  wrapAngle,
} from '../sim/turret.js';
import { engineRpm } from './drive-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { HoldKind } from './hand-lock.js';
import { addControl } from './mechanism-system.js';
import { bufferDelayMs, netLink } from './net-system.js';
import { ride } from './ride-system.js';
import { seating } from './seating.js';

const DEG = Math.PI / 180;
const SEND_HZ = 45;
/** Longest step the turret takes in one go, s; a slow frame takes several. */
const MAX_STEP = 1 / 60;
/** How long a sign stays up, s. */
const SIGN_SECONDS = 8;

let active: TurretSystem | null = null;

/** The turret and gun as drawn on this page (the gunner's own, or the gunner's packets): for the gunsight and firing (F1.9, F1.10). */
export function turretState(): Readonly<TurretState> {
  return active?.shown ?? createTurretState();
}

/** Whether this page lays the gun: the gunner's page, or this one alone. */
export function ownsTurret(): boolean {
  return active?.isOwner() ?? true;
}

/** The gun's entity, inside the turret's: the gunsight's objective rides on it (F1.9). */
export function gunEntity(): Entity | null {
  return active?.gunEntity ?? null;
}

/** Practice → Lay the gun → Gunner: into the gunner's seat, with a sign saying how to lay the gun. */
export function startGunning(): void {
  seating.ask('gunner');
  active?.sayHowToLay();
}

/** Practice → Lay the gun → Forward: the turret and gun back to straight ahead (the gunner's page does it; the other asks). */
export function turretForward(): void {
  active?.forward();
}

/**
 * How many times the power grip's trigger, or the trigger bar on the
 * elevation handwheel's handle, has been pulled on this page
 * since the last call, and reset: the gun's trigger (F1.10, LoadingSystem
 * fires a loaded breech with it). Only the gunner's page's pulls count.
 */
export function takeTriggerPulls(): number {
  const a = active;
  if (a == null) return 0;
  const n = a.triggerPulls;
  a.triggerPulls = 0;
  return n;
}

/** Lay the gun straight to a turn and elevation (rad), on the page that owns the turret: the tests, the gunsight's Practice lay (F1.9), and later the practice crewmate's aim (F1.13). */
export function aimTurret(yaw: number, elevation: number): void {
  active?.aim(yaw, elevation);
}

/** One line on the turret for the menu: who lays the gun, where it points. */
export function turretStatus(): string {
  const s = active?.shown;
  if (s == null) return '';
  const who = seating.mine === 'gunner' ? 'You lay the gun' : netLink.connected && seating.crew === 'gunner' ? 'Your crewmate lays the gun' : 'Nobody lays the gun';
  const yaw = Math.round(-s.yaw / DEG);
  const where = yaw === 0 ? 'ahead' : `${Math.abs(yaw)}° ${yaw > 0 ? 'right' : 'left'}`;
  return `${who}: turret ${where}, gun ${s.elevation >= 0 ? '+' : ''}${(s.elevation / DEG).toFixed(1)}°`;
}

/** What a test can ask of the gunner's controls in place of hands. */
interface TurretOverride {
  /** The power grip's demand, −1 (full right) to 1 (full left). */
  traverse?: number;
  /** The gun's elevation, degrees (the handwheel goes there). */
  elevation?: number;
}

interface TurretDebug {
  /** The turret as drawn on this page, angles in radians and in degrees. */
  state(): TurretState & { yawDeg: number; elevationDeg: number; rateDeg: number };
  /** Whether this page owns the turret (it is the gunner's, or nobody's and alone). */
  owner(): boolean;
  /** Lay as if from the controls (tests), or null to go back to the hands. */
  set(override: TurretOverride | null): void;
  /** Turn the crank by this many turns, as a hand would (tests). */
  crank(turns: number): void;
  forward(): void;
  /** Turn the turret and lay the gun straight to these angles, degrees (tests; the owner's page). */
  aim(yawDeg: number, elevationDeg: number): void;
  /** Pull the power grip's trigger, as a hand on it would (tests). */
  pullTrigger(): void;
  /** Each control's name in window.__mechanisms. */
  names: Record<StationControl, string>;
  /** The turret mesh's turn and the gun mesh's elevation as drawn, degrees. */
  drawn(): { yaw: number; elevation: number };
  /** This player's head in turret space (it stays put while the turret turns under a seated gunner). */
  headInTurret(): number[];
  readonly sign: string;
  readonly sent: number;
  readonly received: number;
  readonly lateFrames: number;
}

/**
 * The turret and gun laying (F1.8, docs/turret.md). The gunner lays the
 * gun with three controls built from the mechanism kit, mounted in the
 * turret: the power traverse grip on the right (twist to traverse, faster
 * as the engine revs), the manual traverse crank for fine aim, and the
 * elevation handwheel on the left, turned by its handle, with a trigger bar
 * on it. The sums are src/sim/turret.ts.
 *
 * The gunner's page owns the turret (plan decision 2): it steps the turret
 * at once from its own hands, with the engine RPM the drive draws, and
 * sends the turret's state 45 times a second (PacketType 7). The other page
 * draws the turret, the gun and the gunner's controls from those, a little
 * in the past (StateBuffer). Alone, this page owns it whichever seat it
 * sits in; with nobody's hands on the controls it holds where it is.
 *
 * A seated gunner's play space turns with the turret about the ring's
 * centre, as a real basket does, so their head and hands stay put in the
 * turret while the hull and the world turn past (spike S2). Runs after
 * MechanismSystem (it reads the controls the hands moved this frame) and
 * before OwnHandsSystem, which draws the hands on them.
 */
export class TurretSystem extends createSystem({}) {
  /** The owner's turret. */
  private sim = createTurretState();
  /** What is drawn: the owner's turret, or the gunner's packets. */
  readonly shown = createTurretState();
  private hands = createGunnerInput();
  private elevationWheel = new Wheel(ELEVATION_WHEEL);
  private crankWheel = new Wheel(TRAVERSE_CRANK);
  private grip = new TwistGrip(POWER_GRIP);
  private parts = {} as Record<StationControl, Object3D>;
  private names = {} as Record<StationControl, string>;
  private lastCrank = 0;
  private wasOwner = true;
  private override: TurretOverride | null = null;
  /** Trigger pulls on the power grip not yet taken (takeTriggerPulls). */
  triggerPulls = 0;
  private turret: Object3D | null = null;
  private gun: Mesh | null = null;
  gunEntity: Entity | null = null;
  private buffer = new StateBuffer<TurretState>({
    create: createTurretState,
    copy: copyTurretState,
    lerp: lerpTurretState,
    extrapolate: extrapolateTurretState,
  });
  private incoming = createTurretState();
  private header: TankHeader = { seq: 0, timeMs: 0 };
  private packet = new ArrayBuffer(TURRET_STATE_BYTES);
  private seq = 0;
  private sendAccumulator = 0;
  private sent = 0;
  private received = 0;
  private turned: [number, number] = [0, 0];
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private time = 0;
  private head = new Vector3();

  init(): void {
    active = this;
    const entity = this.world.getSceneEntity('turret');
    this.turret = entity?.object3D ?? null;
    if (entity == null) console.warn('[Turret] no turret in the scene');
    else this.build(entity);
    this.sign = new FloatingSign('Turret Sign', 0.75, [600, 200], 1.1, 0.3);
    this.world.createTransformEntity(this.sign.mesh);

    netLink.handlers.set(PacketType.TurretState, (view) => this.onTurretState(view));
    netLink.events.set('turret-forward', () => {
      if (this.isOwner()) this.forward();
    });
    this.cleanupFuncs.push(
      () => {
        if (active === this) active = null;
      },
      () => netLink.handlers.delete(PacketType.TurretState),
      () => netLink.events.delete('turret-forward'),
    );

    const self = this;
    (window as unknown as { __turret: TurretDebug }).__turret = {
      state: () => ({ ...self.shown, yawDeg: self.shown.yaw / DEG, elevationDeg: self.shown.elevation / DEG, rateDeg: self.shown.rate / DEG }),
      owner: () => self.isOwner(),
      set: (override) => {
        self.override = override === null ? null : { ...override };
      },
      crank: (turns) => {
        if (!self.crankWheel.anyHeld) self.crankWheel.angle += turns * 2 * Math.PI;
      },
      forward: () => self.forward(),
      aim: (yawDeg, elevationDeg) => self.aim(yawDeg * DEG, elevationDeg * DEG),
      pullTrigger: () => {
        if (self.isOwner()) self.triggerPulls++;
      },
      names: { ...self.names },
      drawn: () => ({ yaw: (self.turret?.rotation.y ?? 0) / DEG, elevation: (self.gun?.rotation.x ?? 0) / DEG }),
      headInTurret: () => {
        self.player.head.getWorldPosition(self.head);
        return hullToSeat(SEATS.gunner, seating.turretYaw, self.head.toArray(), [0, 0, 0]);
      },
      get sign() { return self.sign.visible ? self.signText : ''; },
      get sent() { return self.sent; },
      get received() { return self.received; },
      get lateFrames() { return self.buffer.late; },
    };
  }

  /** The gun on its trunnions, and the gunner's three controls on their mounts, all inside the turret. */
  private build(turret: Entity): void {
    const gun = createGun();
    gun.position.set(0, TRUNNION.y, TRUNNION.z);
    this.gunEntity = this.world.createTransformEntity(gun, { parent: turret });
    this.gun = gun;
    const controls = {
      elevation: { mech: this.elevationWheel, part: createWheel(ELEVATION_WHEEL), kind: HoldKind.ElevationWheel },
      crank: { mech: this.crankWheel, part: createWheel(TRAVERSE_CRANK), kind: HoldKind.TraverseCrank },
      twist: { mech: this.grip, part: createTwistGrip(POWER_GRIP), kind: HoldKind.PowerTraverse },
    };
    for (const key of Object.keys(STATION) as StationControl[]) {
      const { mech, part, kind } = controls[key];
      // The mount is the mechanism's space; the part inside it moves.
      const mount = new Group();
      mount.name = `Turret ${key} mount`;
      const [x, y, z] = STATION[key].at;
      // Turret space has its origin at the ring's centre, as the turret mesh does.
      mount.position.set(x, y, z);
      mount.rotation.x = STATION[key].tilt;
      mount.add(part);
      this.world.createTransformEntity(mount, { parent: turret });
      this.parts[key] = part;
      this.names[key] = `turret-${key}`;
      this.cleanupFuncs.push(addControl({
        name: this.names[key],
        mech,
        frame: mount,
        kind,
        // Spike S2's ride hides the cabin while it runs. Only the gunner's seat is in reach of them.
        active: () => !ride.active,
        // The power grip's trigger, and the bar on the elevation handwheel's handle, are the gun's (F1.10).
        moved: key !== 'crank' ? (events) => {
          if (events & MechEvent.Press && this.isOwner()) this.triggerPulls++;
        } : undefined,
      }));
    }
  }

  /** The gunner's page owns the turret; alone, this page does whichever seat it sits in. */
  isOwner(): boolean {
    return !netLink.connected || seating.mine === 'gunner';
  }

  forward(): void {
    if (!this.isOwner()) {
      netLink.sendEvent({ t: 'turret-forward' });
      return;
    }
    Object.assign(this.sim, createTurretState());
    this.crankWheel.angle = 0;
    this.lastCrank = 0;
    if (!this.elevationWheel.anyHeld) this.elevationWheel.angle = 0;
    copyTurretState(this.sim, this.shown);
    console.info('[Turret] forward');
  }

  /** Straight to a turn and elevation (tests): the owner's turret, and the elevation wheel to match. */
  aim(yaw: number, elevation: number): void {
    if (!this.isOwner()) return;
    this.sim.yaw = wrapAngle(yaw);
    this.sim.rate = 0;
    this.override = null;
    if (!this.elevationWheel.anyHeld) this.elevationWheel.angle = wheelForElevation(elevation);
    this.sim.elevation = elevationForWheel(this.elevationWheel.angle);
    copyTurretState(this.sim, this.shown);
  }

  sayHowToLay(): void {
    const vr = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    this.say('Laying the gun', vr ? ['Right grip: twist to traverse. Crank: fine aim', 'Left crank: clockwise raises. Triggers fire'] : ['In a headset: twist grip, crank, elevation wheel', 'Practice: Forward puts the turret back']);
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.25);
    this.time += dt;
    const owner = this.isOwner();
    if (owner && !this.wasOwner) {
      // The gunner's seat came to this page: carry on from the turret as drawn.
      copyTurretState(this.shown, this.sim);
      this.lastCrank = this.crankWheel.angle;
      console.info('[Turret] laying the gun here now');
    } else if (!owner && this.wasOwner) {
      this.buffer.clear();
    }
    this.wasOwner = owner;

    if (owner) {
      this.lay(dt);
    } else {
      this.followGunner();
    }
    this.send(delta);
    this.draw();
    this.signs(delta);
  }

  /** The owner: step the turret from the gunner's controls (or a test's). */
  private lay(dt: number): void {
    const o = this.override;
    if (o?.elevation !== undefined && !this.elevationWheel.anyHeld) {
      this.elevationWheel.angle = wheelForElevation(o.elevation * DEG);
    }
    const input = this.hands;
    input.traverse = o?.traverse ?? this.grip.demand();
    input.elevation = elevationForWheel(this.elevationWheel.angle);
    const crank = this.crankWheel.angle;
    const crankTurned = crank - this.lastCrank;
    this.lastCrank = crank;
    if (ride.active) {
      // Spike S2's ride has its own turret.
      input.traverse = 0;
    }
    const rpm = engineRpm();
    let first = true;
    for (let left = dt; left > 1e-6; left -= MAX_STEP) {
      // The crank's turn is applied once, in the first step.
      input.crank = first ? crankTurned : 0;
      first = false;
      stepTurret(this.sim, input, rpm, Math.min(left, MAX_STEP));
    }
    this.sim.crank = wrapAngle(crank);
    this.sim.twist = this.grip.angle;
    copyTurretState(this.sim, this.shown);
  }

  /** Not the gunner: draw the gunner's turret a little in the past, and their controls where they have them. */
  private followGunner(): void {
    const b = this.buffer;
    if (b.count > 0) {
      const delay = Math.max(0, b.transit) + bufferDelayMs(b.interval, b.jitter);
      b.sample(performance.now() - delay, this.shown);
    }
    // The gunner's controls as the gunner has them, unless a hand of this page's holds one.
    const s = this.shown;
    if (!this.elevationWheel.anyHeld) this.elevationWheel.angle = wheelForElevation(s.elevation);
    if (!this.crankWheel.anyHeld) this.crankWheel.angle = this.crankWheel.angle + angleDelta(this.crankWheel.angle, s.crank);
    if (!this.grip.anyHeld) this.grip.angle = s.twist;
  }

  /** 45 times a second, the owner sends the turret. */
  private send(delta: number): void {
    if (!netLink.connected || !this.isOwner()) return;
    this.sendAccumulator += delta;
    if (this.sendAccumulator < 1 / SEND_HZ) return;
    this.sendAccumulator = Math.min(this.sendAccumulator - 1 / SEND_HZ, 1 / SEND_HZ);
    netLink.send(this.packet, encodeTurretState(this.packet, this.seq, performance.now(), this.sim));
    this.seq = (this.seq + 1) & 0xffff;
    this.sent++;
  }

  private onTurretState(view: DataView): void {
    if (this.isOwner() || !decodeTurretState(view, this.header, this.incoming)) return;
    this.received++;
    // Until the clocks are matched, a packet's time can't be placed.
    if (!netLink.clockSynced) return;
    this.buffer.push(netLink.toLocal(this.header.timeMs), performance.now(), this.incoming);
  }

  /** Turn the turret, elevate the gun, move the controls, and turn a seated gunner's play space with the turret. */
  private draw(): void {
    const s = this.shown;
    const turn = angleDelta(seating.turretYaw, s.yaw);
    seating.turretYaw = s.yaw;
    seating.turretRate = s.rate;
    if (this.turret) this.turret.rotation.y = s.yaw;
    if (this.gun) this.gun.rotation.x = s.elevation;
    const parts = this.parts;
    if (parts.elevation) {
      parts.elevation.rotation.z = this.elevationWheel.angle;
      parts.crank.rotation.z = this.crankWheel.angle;
      parts.twist.rotation.y = this.grip.angle;
    }
    if (turn !== 0 && seating.mine === 'gunner' && !seating.away && this.world.session) {
      // The basket turns under the gunner: their play space turns with it about the ring's centre.
      const player = this.player;
      turnAboutHead(player.position.x, player.position.z, 0, TURRET.z, turn, this.turned);
      player.position.x = this.turned[0];
      player.position.z = this.turned[1];
      player.rotation.y += turn;
    }
  }

  private signs(delta: number): void {
    if (!this.sign.visible) return;
    if (this.time > this.signUntil) this.sign.setVisible(false);
    else this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
  }

  private say(title: string, lines: [string, string]): void {
    const { ctx, width, height } = this.sign;
    drawSignBackground(ctx, width, height);
    ctx.fillStyle = '#f4ead8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(title, width / 2, 64);
    ctx.font = '28px sans-serif';
    ctx.fillText(lines[0], width / 2, 118);
    ctx.fillText(lines[1], width / 2, 160);
    this.sign.refresh();
    this.sign.setVisible(true);
    this.signText = `${title}. ${lines.join(' ')}`;
    this.signUntil = this.time + SIGN_SECONDS;
    console.info(`[Turret] sign: ${this.signText}`);
  }
}

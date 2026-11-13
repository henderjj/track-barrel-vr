import { BackSide, createSystem, Mesh, MeshBasicMaterial, SphereGeometry, VisibilityState } from '@iwsdk/core';
import {
  applyHit,
  DAMAGE,
  type DamageHit,
  damageLine,
  type DamageState,
  freshDamage,
  hitLine,
  parseDamage,
  parseHit,
  repair,
} from '../sim/damage.js';
import { setDriveDamage } from './drive-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { netLink } from './net-system.js';
import { seating } from './seating.js';

/** How long a note stays on the sign, s. */
const NOTE_SECONDS = 5;
/** The host sends the damage again this often while there is any, s, in case a guest missed it. */
const RESYNC_SECONDS = 5;
/** A crewman hit: the view flashes this red, then dims to `dim` and clears over the stun (DAMAGE.stunSeconds, twice that badly wounded). */
const WOUND = { flash: 0.6, dim: 0.35, flashSeconds: 0.25 } as const;
/** Practice hits (Combat → Damage): what each does. */
export const TEST_HITS = ['engine', 'track', 'turret', 'crew'] as const;
export type TestHit = (typeof TEST_HITS)[number];

let active: DamageSystem | null = null;
/** Hits through the armour that knock the tank out (F3.10's tuning, set by CombatSystem on the host). */
let knockOutAfter: number = DAMAGE.knockOut;

/** The tuning's knock-out (F3.10): this many hits through the armour knock the tank out from the next hit on. */
export function setKnockOut(hits: number): void {
  if (Number.isFinite(hits) && hits >= 1) knockOutAfter = Math.round(hits);
}

/** The tank's damage as this page has it (F3.4). */
export function damageState(): Readonly<DamageState> {
  return active?.state ?? freshDamage();
}

/** One line for the menu. */
export function damageStatus(): string {
  return damageLine(damageState());
}

/** Host: an enemy shell has struck the tank (EnemySystem, when it gets there). */
export function takeHit(hit: Readonly<DamageHit>): void {
  if (netLink.isHost) active?.take(hit, false);
}

/** Combat → Damage → Repair (and starting the enemies): everything mended, the engine restarted if a hit stopped it. The host does it; a guest asks. */
export function repairTank(): void {
  if (!netLink.isHost) {
    const event = { t: 'damage-ask', repair: true };
    netLink.sendEvent(event);
    return;
  }
  active?.repairAll();
}

/** Combat → Damage → a practice hit: through the engine, on a track, through the turret (the power traverse) or onto this player's own seat. The host does it; a guest asks. */
export function testHit(kind: TestHit): void {
  const seat = seating.mine === 'driver' ? 'driver' : 'gunner';
  if (!netLink.isHost) {
    const event = { t: 'damage-ask', test: kind, seat };
    netLink.sendEvent(event);
    return;
  }
  active?.take(practiceHit(kind, seat), true);
}

/** The hit a practice button makes. */
export function practiceHit(kind: TestHit, seat: 'driver' | 'gunner'): DamageHit {
  switch (kind) {
    case 'engine':
      return { zone: 'hull-rear', through: true, armour: 39, pen: 110, effects: ['engine'], right: false };
    case 'track':
      return { zone: 'running-gear', through: true, armour: 0, pen: 0, effects: ['right-track'], right: true };
    case 'turret':
      return { zone: 'turret-side', through: true, armour: 52, pen: 110, effects: ['traverse'], right: true };
    default:
      return seat === 'driver'
        ? { zone: 'hull-front', through: true, armour: 91, pen: 110, effects: ['driver'], right: false }
        : { zone: 'turret-front', through: true, armour: 88, pen: 110, effects: ['gunner'], right: false };
  }
}

interface DamageDebug {
  state(): DamageState & { last: DamageHit | null; stun: number; dark: number };
  /** Host: a hit, as an enemy shell's would be. */
  take(hit: DamageHit): void;
  test(kind: TestHit): void;
  repair(): void;
  readonly sign: string;
}

/**
 * The tank's damage (F3.4, docs/damage.md). The host keeps it: an enemy
 * shell that strikes (EnemySystem decides where and what it does when the
 * enemy fires, src/sim/damage.ts) is taken when it gets there, and Combat
 * → Damage's practice hits and Repair change it too. The host tells the
 * guest (`damage`, reliable) and sets the drive from it every frame (a
 * damaged engine, a knocked-out one, tracks held); TurretSystem reads the
 * power traverse from it on the gunner's page. On each page, a hit on this
 * player's own crewman flashes the view red and dims it a few seconds; a
 * sign below the enemy's says what the last hit did, and when the tank is
 * knocked out.
 */
export class DamageSystem extends createSystem({}) {
  readonly state: DamageState = freshDamage();
  last: DamageHit | null = null;
  private time = 0;
  private sentV = -1;
  private sentAt = 0;
  private wasConnected = false;
  /** This player's crewman's wounds as last seen, and the stun: until when, and how long in all, s. */
  private myWounds = 0;
  private stunUntil = 0;
  private stunFor = 0;
  private dark = 0;
  private blind!: Mesh;
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private notes: string[] = [];

  init(): void {
    active = this;
    this.sign = new FloatingSign('Damage Sign', 0.85, [560, 120], 1.1, 0.3);
    this.world.createTransformEntity(this.sign.mesh);
    // Dark red round the eyes, drawn over everything, as the seat's fade is (SeatSystem's Head Fade).
    this.blind = new Mesh(
      new SphereGeometry(0.45, 16, 12),
      new MeshBasicMaterial({ color: 0x5a0000, side: BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    this.blind.name = 'Wound Fade';
    this.blind.frustumCulled = false;
    this.blind.renderOrder = 999;
    this.blind.visible = false;
    this.camera.add(this.blind);

    netLink.events.set('damage', (e) => {
      if (netLink.isHost) return;
      const s = parseDamage(e);
      if (!s) return;
      const last = parseHit((e as { last?: unknown }).last);
      this.apply(s, last);
    });
    netLink.events.set('damage-ask', (e) => {
      if (!netLink.isHost) return;
      const ask = e as { repair?: unknown; test?: unknown; seat?: unknown };
      if (ask.repair === true) this.repairAll();
      else if ((TEST_HITS as readonly unknown[]).includes(ask.test)) this.take(practiceHit(ask.test as TestHit, ask.seat === 'driver' ? 'driver' : 'gunner'), true);
    });
    this.cleanupFuncs.push(
      () => netLink.events.delete('damage'),
      () => netLink.events.delete('damage-ask'),
      () => {
        if (active === this) active = null;
      },
    );

    const self = this;
    (window as unknown as { __damage: DamageDebug }).__damage = {
      state: () => ({ ...self.state, last: self.last ? { ...self.last, effects: [...self.last.effects] } : null, stun: Math.max(0, self.stunUntil - self.time), dark: self.dark }),
      take: (hit) => {
        if (netLink.isHost) self.take(hit, false);
      },
      test: (kind) => testHit(kind),
      repair: () => repairTank(),
      get sign() {
        return self.sign.visible ? self.signText : '';
      },
    };
  }

  /** Host: take a hit (a practice one says so). */
  take(hit: Readonly<DamageHit>, practice: boolean): void {
    if (!netLink.isHost) return;
    const next: DamageState = { ...this.state };
    applyHit(next, hit, knockOutAfter);
    this.apply(next, { ...hit, effects: [...hit.effects] });
    console.info(`[Damage] ${practice ? 'practice ' : ''}hit: ${hitLine(hit)}. ${damageLine(this.state)}`);
  }

  /** Host: everything mended. */
  repairAll(): void {
    if (!netLink.isHost) return;
    const next: DamageState = { ...this.state };
    repair(next);
    this.apply(next, null);
    console.info('[Damage] repaired');
  }

  /** Take the damage as the host has it: notes for what changed, the wound on this player's crewman. */
  private apply(s: DamageState, last: DamageHit | null): void {
    const was = { ...this.state };
    Object.assign(this.state, s);
    const hit = s.hits > was.hits;
    if (hit) this.last = last;
    if (s.hits === 0 && was.hits > 0) {
      this.last = null;
      this.note('Repaired: the tank is fit to fight');
    } else if (hit && last && !was.out) {
      // Knocked out, a shell still in flight changes nothing worth saying.
      this.note(hitLine(last));
    }
    if (s.out && !was.out) this.note('Knocked out! Combat → Damage → Repair to fight on');
    const mine = seating.mine === 'driver' ? s.driver : seating.mine === 'gunner' ? s.gunner : 0;
    if (mine > this.myWounds) {
      this.stunFor = DAMAGE.stunSeconds * mine;
      this.stunUntil = this.time + this.stunFor;
    }
    this.myWounds = mine;
  }

  private note(text: string): void {
    this.notes.push(text);
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.25);
    this.time += dt;
    if (netLink.isHost) this.host();
    this.drawWound();
    this.drawSign(delta);
  }

  /** The host's part: the drive told every frame, and the guest kept told. */
  private host(): void {
    setDriveDamage(this.state.engine, this.state.immobile !== '');
    const joined = netLink.connected && !this.wasConnected;
    const resync = this.state.hits > 0 && this.time - this.sentAt >= RESYNC_SECONDS;
    if (netLink.connected && (joined || resync || this.sentV !== this.state.v)) {
      const event = { t: 'damage', ...this.state, last: this.last };
      netLink.sendEvent(event);
      this.sentV = this.state.v;
      this.sentAt = this.time;
    }
    this.wasConnected = netLink.connected;
  }

  /** The red over this player's eyes while their crewman is stunned: a flash, then dim, clearing. */
  private drawWound(): void {
    const left = this.stunUntil - this.time;
    let dark = 0;
    if (left > 0 && this.stunFor > 0) {
      const since = this.stunFor - left;
      dark = since < WOUND.flashSeconds
        ? WOUND.flash
        : WOUND.dim * Math.min(1, left / (this.stunFor * 0.5));
    }
    if (dark === this.dark) return;
    this.dark = dark;
    (this.blind.material as MeshBasicMaterial).opacity = dark;
    this.blind.visible = dark > 0;
  }

  /** The newest note (or a knock-out) on the sign below the enemy's, for a few seconds. */
  private drawSign(delta: number): void {
    if (this.notes.length > 0) {
      // The knock-out outranks a hit taken with it.
      const text = this.notes.find((n) => n.startsWith('Knocked out')) ?? this.notes[this.notes.length - 1];
      this.notes.length = 0;
      this.signText = text;
      this.signUntil = this.time + NOTE_SECONDS;
      const { ctx, width, height } = this.sign;
      drawSignBackground(ctx, width, height);
      ctx.fillStyle = /^(Through|Knocked out|Struck .*broken)/.test(text) ? '#ffb0a0' : '#f4ead8';
      ctx.textAlign = 'center';
      ctx.font = 'bold 36px sans-serif';
      ctx.fillText(text, width / 2, height / 2 + 12, width - 30);
      this.sign.refresh();
      this.sign.setVisible(true);
      console.info(`[Damage] sign: ${text}`);
    }
    if (this.sign.visible && this.time > this.signUntil) this.sign.setVisible(false);
    if (this.sign.visible) {
      this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
    }
  }
}

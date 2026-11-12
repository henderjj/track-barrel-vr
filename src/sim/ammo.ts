/**
 * Ammunition types (F3.1, docs/ammunition.md): armour piercing, high
 * explosive and smoke, what each does where it lands, which rack slot holds
 * which, and the smoke screen a smoke round lays. Engine-free and
 * deterministic, so both pages fly, burst and smoke every shot alike from
 * the `shot` event alone, the host decides hits, and later features (the
 * enemies of F3.2 and F3.3, the damage of F3.4) read the same numbers.
 *
 * World space as in src/sim/terrain.ts: +X east, -Z the tank's starting
 * heading, heights the ground's.
 */

/** The three rounds. In the network's order (the `shot` event's `k`, the loading packet's kinds): a new one goes on the end. */
export const AMMO_KINDS = ['ap', 'he', 'smoke'] as const;
export type AmmoKind = (typeof AMMO_KINDS)[number];

export interface AmmoSpec {
  /** On the board, the menu and the sight: "AP". */
  short: string;
  /** In full: "armour piercing". */
  long: string;
  /** Leaving the muzzle, m/s. */
  speed: number;
  /** The round's colours: the projectile and the band round it (src/scene-assets/loading.scene-asset.ts). */
  body: number;
  band: number;
  /** How far a burst reaches a soft target (a gun and its crew), m; 0 for none. */
  blast: number;
  /** Whether a direct hit counts as a hit (a smoke round on a board makes smoke, not a hole). */
  hits: boolean;
}

/**
 * The 75 mm M3's rounds, cut down to three (FM 23-95's AP M61, HE M48 and
 * smoke M89). The AP keeps Phase 1's 600 m/s, so the sight's AP marks and
 * every test from then still hold; the HE and smoke fly slower, as the real
 * ones did (the M48 at normal charge 1,470 ft/s, about 450 m/s), so they
 * drop more and the sight carries a second scale for them. The smoke shares
 * the HE's speed and scale (the real M89 was slower again; one scale for
 * both keeps the sight readable).
 */
export const AMMO: Readonly<Record<AmmoKind, AmmoSpec>> = {
  ap: { short: 'AP', long: 'armour piercing', speed: 600, body: 0x22262a, band: 0xc0c4c8, blast: 0, hits: true },
  he: { short: 'HE', long: 'high explosive', speed: 450, body: 0x4d5a3a, band: 0xd9b52c, blast: 5, hits: true },
  smoke: { short: 'Smoke', long: 'smoke', speed: 450, body: 0x9a9c98, band: 0xd9b52c, blast: 0, hits: false },
};

/** A kind from the network (an index into AMMO_KINDS), or armour piercing for anything else: a page on an older build sends none. */
export function parseAmmo(raw: unknown): AmmoKind {
  const i = Number(raw);
  return Number.isInteger(i) && i >= 0 && i < AMMO_KINDS.length ? AMMO_KINDS[i] : 'ap';
}

/** A kind's index in AMMO_KINDS, for the network. */
export function ammoIndex(kind: AmmoKind): number {
  return AMMO_KINDS.indexOf(kind);
}

// ------------------------------------------------------------------ Rack

/**
 * What the ready rack holds (the Combat tab's Ammunition rack): the mixed
 * load, or every slot one kind for practice.
 */
export const RACK_CHOICES = ['mixed', 'ap', 'he', 'smoke'] as const;
export type RackChoice = (typeof RACK_CHOICES)[number];

/**
 * The mixed rack, by slot (src/sim/loading.ts RACK_SLOTS: 0 and 1 the lower
 * row, 2 and 3 the upper, the nearer of each pair first): AP in the lower
 * row, the round a gunner reaches for most and the one the practice
 * crewmate takes first; HE above it nearest the hand; smoke at the far end
 * of the upper row. A fired round's slot refills with the same kind.
 */
export const MIXED_RACK: readonly AmmoKind[] = ['ap', 'ap', 'he', 'smoke'];

/** Each slot's kind for a rack choice, into `out` (one per slot). A limited biathlon line (F5.3b) is all AP: the race is about the gunnery, not the choice. */
export function rackKinds(choice: RackChoice, limited: boolean, out: AmmoKind[]): AmmoKind[] {
  for (let i = 0; i < out.length; i++) {
    out[i] = limited ? 'ap' : choice === 'mixed' ? MIXED_RACK[i % MIXED_RACK.length] : choice;
  }
  return out;
}

/** A rack choice from the network or a URL, or null if it isn't one. */
export function parseRackChoice(raw: unknown): RackChoice | null {
  return typeof raw === 'string' && (RACK_CHOICES as readonly string[]).includes(raw) ? (raw as RackChoice) : null;
}

// ------------------------------------------------------------------ Smoke

/**
 * A smoke round's screen: a bank of smoke that grows fast where the round
 * lands, holds, then thins away, drifting downwind. Sized from the M89's
 * (a cloud some 20 m across within seconds, lasting about a minute in a
 * light wind), so one round hides a tank at a few hundred metres.
 */
export const SMOKE = {
  /** Its radius once grown, m, and when it starts (the first puff), m. */
  radius: 11,
  firstRadius: 2.5,
  /** Its half height over its radius: a bank lower than it is wide. */
  squash: 0.6,
  /** How long it takes to grow, how long it holds, how long it takes to thin away, s. */
  grow: 4,
  hold: 40,
  fade: 12,
  /** The wind it drifts on, m/s: a light breeze from the west, across the range. */
  windX: 0.8,
  windZ: 0.2,
  /** Clouds at once: the oldest gives way to a new one. */
  max: 4,
} as const;

/** How long a cloud lasts in all, s. */
export const SMOKE_LIFE = SMOKE.grow + SMOKE.hold + SMOKE.fade;

/** A cloud's radius `age` s after it was laid, m (0 before and after). */
export function smokeRadius(age: number): number {
  if (age < 0 || age >= SMOKE_LIFE) return 0;
  if (age < SMOKE.grow) {
    // Fast at first, easing to its full size.
    const f = age / SMOKE.grow;
    return SMOKE.firstRadius + (SMOKE.radius - SMOKE.firstRadius) * (1 - (1 - f) * (1 - f));
  }
  if (age < SMOKE.grow + SMOKE.hold) return SMOKE.radius;
  const f = (age - SMOKE.grow - SMOKE.hold) / SMOKE.fade;
  return SMOKE.radius * (1 - f);
}

/** A cloud laid by a smoke round: where it landed (world space, on the ground) and when, s on the page's own clock. */
export interface SmokeCloud {
  x: number;
  y: number;
  z: number;
  laidAt: number;
}

/** Where a cloud's middle is at `time` (it drifts downwind; the middle stands a radius's squash above the ground), into `out`. */
export function smokeCentre(c: Readonly<SmokeCloud>, time: number, out: [number, number, number]): [number, number, number] {
  const age = Math.max(0, time - c.laidAt);
  const r = smokeRadius(age);
  out[0] = c.x + SMOKE.windX * age;
  out[1] = c.y + r * SMOKE.squash * 0.5;
  out[2] = c.z + SMOKE.windZ * age;
  return out;
}

const centre: [number, number, number] = [0, 0, 0];

/**
 * Whether the line from `a` to `b` (world space) passes through any of
 * `clouds` at `time`: the clouds as ellipsoids, `radius` across and
 * `radius × squash` high. What the enemies' eyes (F3.2) can't see through.
 * The tile's repeats are left out: a cloud is only ever near where it was
 * laid. Allocation free.
 */
export function smokeBlocks(
  clouds: readonly Readonly<SmokeCloud>[],
  time: number,
  a: Readonly<[number, number, number]>,
  b: Readonly<[number, number, number]>,
): boolean {
  for (const c of clouds) {
    const r = smokeRadius(time - c.laidAt);
    if (r <= 0) continue;
    smokeCentre(c, time, centre);
    const h = r * SMOKE.squash;
    // Into the cloud's own space, where it is a unit ball.
    const px = (a[0] - centre[0]) / r;
    const py = (a[1] - centre[1]) / h;
    const pz = (a[2] - centre[2]) / r;
    const dx = (b[0] - a[0]) / r;
    const dy = (b[1] - a[1]) / h;
    const dz = (b[2] - a[2]) / r;
    const dd = dx * dx + dy * dy + dz * dz;
    // The nearest point of the segment to the ball's middle.
    const s = dd > 0 ? Math.max(0, Math.min(1, -(px * dx + py * dy + pz * dz) / dd)) : 0;
    const nx = px + dx * s;
    const ny = py + dy * s;
    const nz = pz + dz * s;
    if (nx * nx + ny * ny + nz * nz < 1) return true;
  }
  return false;
}

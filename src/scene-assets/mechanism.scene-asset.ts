import { BoxGeometry, CylinderGeometry, Mesh, MeshStandardMaterial, TorusGeometry } from '@iwsdk/core';
import { beam, mergeParts, type Part } from './lowpoly.js';
import type { ButtonSpec, LeverSpec, PullSpec, ToggleSpec, TwistSpec, Vec3, WheelSpec, YokeSpec } from '../sim/mechanism.js';
import { BENCH, BEZEL, type BenchMount, MOUNTS, mountToBench, TWIST } from '../sim/mechanism-bench.js';
import { litInside } from './cabin-light.js';

/**
 * The mechanism kit's models (F1.3, docs/mechanisms.md): one moving part per
 * mechanism, built from its spec in that mechanism's own space (see
 * src/sim/mechanism.ts), so the stations that use them (F1.5, F1.6, F1.8)
 * draw the same parts at their own sizes; and the kit's test bench, the
 * static part that holds one of each. Low-poly, vertex-coloured, one mesh
 * each; a button's cap has its own material so it can light up.
 */

const STEEL = 0x55595e;
const STEEL_DARK = 0x3d4145;
const RUBBER = 0x1c1c1c;
const OLIVE = 0x4b5320;
const OLIVE_DARK = 0x363c18;
const FRAME = 0x2b2e2a;
/** Marks that show which way a part has turned. */
const MARK = 0xd8b030;

/** A handle's radius and a lever's rod's, m. */
export const GRIP_RADIUS = 0.019;
const ROD_RADIUS = 0.011;
/** A wheel's rim tube's radius, m. */
const RIM_TUBE = 0.011;
/** The screen sits this far in front of its frame's face, m. */
export const SCREEN_GAP = 0.006;

const material = litInside(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }));

const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];
const ALONG_X: readonly [number, number, number] = [0, 0, Math.PI / 2];

function named(geometry: ReturnType<typeof mergeParts>, name: string): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

/** A lever standing upright with its pivot at the origin: a steel rod and a rubber handle, the rod ending inside the handle, and a knob on top. */
export function createLever(spec: LeverSpec): Mesh {
  const handleStart = spec.length - spec.gripLength;
  return named(mergeParts([
    beam([0, -0.03, 0], [0, handleStart + 0.02, 0], ROD_RADIUS, STEEL, 6),
    { geometry: new CylinderGeometry(GRIP_RADIUS, GRIP_RADIUS, spec.gripLength, 8, 1), color: RUBBER, position: [0, handleStart + spec.gripLength / 2, 0] },
    // Wider than the handle so their faces don't meet.
    { geometry: new CylinderGeometry(GRIP_RADIUS + 0.004, GRIP_RADIUS + 0.006, 0.014, 8, 1), color: STEEL, position: [0, spec.length + 0.004, 0] },
  ]), 'Lever');
}

/**
 * A wheel facing +Z with its axle along Z: a rim, a hub and three spokes,
 * one of them marked so its turn shows, and for a crank a knob standing out
 * of the rim at the top (with a trigger bar along it, for a crank with a
 * `trigger`). Turn it with `rotation.z`.
 */
export function createWheel(spec: WheelSpec): Mesh {
  const r = spec.radius;
  const parts: Part[] = [
    { geometry: new TorusGeometry(r, RIM_TUBE, 6, 18), color: STEEL_DARK },
    { geometry: new CylinderGeometry(0.022, 0.022, 0.04, 8, 1), color: STEEL, rotation: ALONG_Z },
  ];
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3;
    const out = [-(r - 0.004) * Math.sin(a), (r - 0.004) * Math.cos(a), 0];
    parts.push(beam([-0.012 * Math.sin(a), 0.012 * Math.cos(a), 0], out, 0.007, i === 0 ? MARK : STEEL, 5));
  }
  if (spec.grip === 'crank') {
    // The knob: rubber on a steel pin that starts inside the rim.
    parts.push({ geometry: new CylinderGeometry(0.008, 0.008, 0.02, 6, 1), color: STEEL, position: [0, r, 0.004], rotation: ALONG_Z });
    parts.push({ geometry: new CylinderGeometry(0.015, 0.015, spec.knobLength - 0.01, 8, 1), color: RUBBER, position: [0, r, 0.01 + (spec.knobLength - 0.01) / 2], rotation: ALONG_Z });
    if (spec.trigger) {
      // The trigger bar along the knob's outer side, 4 mm off the rubber, on a stem from the pin.
      const along = spec.knobLength - 0.01;
      parts.push({ geometry: new BoxGeometry(0.012, 0.006, along), color: STEEL_DARK, position: [0, r + 0.022, 0.006 + along / 2] });
      parts.push({ geometry: new BoxGeometry(0.01, 0.02, 0.008), color: STEEL_DARK, position: [0, r + 0.015, 0.004] });
    }
  }
  return named(mergeParts(parts), spec.grip === 'crank' ? 'Crank' : 'Handwheel');
}

/**
 * A twist grip standing up the Y axis: a rubber handle on a steel flange,
 * a trigger at its front for the index finger and a mark on top pointing
 * ahead. Turn it with `rotation.y`.
 */
export function createTwistGrip(spec: TwistSpec): Mesh {
  const top = spec.base + spec.length;
  return named(mergeParts([
    { geometry: new CylinderGeometry(0.03, 0.03, 0.01, 10, 1), color: STEEL, position: [0, spec.base - 0.007, 0] },
    { geometry: new CylinderGeometry(GRIP_RADIUS, GRIP_RADIUS, spec.length + 0.004, 8, 1), color: RUBBER, position: [0, spec.base + spec.length / 2 - 0.002, 0] },
    { geometry: new BoxGeometry(0.012, 0.028, 0.015), color: STEEL_DARK, position: [0, top - 0.03, -GRIP_RADIUS - 0.004] },
    { geometry: new BoxGeometry(0.008, 0.008, 0.03), color: MARK, position: [0, top + 0.002, -0.012] },
  ]), 'Twist Grip');
}

/** The pedestal a twist grip stands on, its top 3 mm under the grip's flange. */
function twistPedestal(spec: TwistSpec, x: number, z: number): Part {
  const topY = spec.base - 0.015;
  return { geometry: new CylinderGeometry(0.034, 0.04, topY + 0.005, 10, 1), color: OLIVE_DARK, position: [x, (topY - 0.005) / 2, z] };
}

/**
 * A yoke turning about the Y axis: a hub with a mark pointing ahead, a bar
 * out each side and a rubber handle on each end. Turn it with `rotation.y`.
 */
export function createYoke(spec: YokeSpec): Mesh {
  const length = spec.outer - spec.inner;
  return named(mergeParts([
    { geometry: new BoxGeometry(0.05, 0.05, 0.05), color: OLIVE },
    { geometry: new BoxGeometry(0.01, 0.01, 0.03), color: MARK, position: [0, 0.03, -0.012] },
    beam([-spec.inner - 0.01, 0, 0], [spec.inner + 0.01, 0, 0], 0.012, STEEL, 6),
    ...[-1, 1].map((s) => ({
      geometry: new CylinderGeometry(GRIP_RADIUS, GRIP_RADIUS, length, 8, 1),
      color: RUBBER,
      position: [s * (spec.inner + length / 2), 0, 0] as const,
      rotation: ALONG_X,
    })),
    ...[-1, 1].map((s) => ({
      geometry: new CylinderGeometry(GRIP_RADIUS + 0.005, GRIP_RADIUS + 0.005, 0.012, 8, 1),
      color: STEEL,
      position: [s * (spec.outer + 0.004), 0, 0] as const,
      rotation: ALONG_X,
    })),
  ]), 'Yoke');
}

/**
 * A button's cap, its face at the origin facing +Z, to move in along -Z.
 * Its own material, so it can glow while on (`emissive`).
 */
export function createButtonCap(spec: ButtonSpec, color: number): Mesh {
  const geometry = mergeParts([
    { geometry: new CylinderGeometry(spec.radius, spec.radius, 0.014, 10, 1), color, position: [0, 0, -0.007], rotation: ALONG_Z },
  ]);
  const mesh = new Mesh(geometry, litInside(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 })));
  mesh.name = 'Button Cap';
  return mesh;
}

/** A toggle's nut, round the bat's pivot on the face: it stands this far proud, m. */
export const TOGGLE_NUT = { radius: 0.008, proud: 0.004 } as const;

/** A toggle switch's nut, fixed on the face at the origin (toggle space, +Z out of the face). */
export function createToggleNut(): Mesh {
  const mesh = new Mesh(
    mergeParts([{ geometry: new CylinderGeometry(TOGGLE_NUT.radius, TOGGLE_NUT.radius, TOGGLE_NUT.proud, 6, 1), color: STEEL, position: [0, 0, TOGGLE_NUT.proud / 2], rotation: ALONG_Z }]),
    material,
  );
  mesh.name = 'Toggle Nut';
  return mesh;
}

/**
 * A toggle switch's bat, from its pivot at the origin out along +Z, with a
 * knob of `color` on its end; turn it with `rotation.x` (negative leans it
 * up). Its own material, so the knob can glow while on (`emissive`).
 */
export function createToggleBat(spec: ToggleSpec, color: number): Mesh {
  const knob = spec.radius * 1.6;
  const geometry = mergeParts([
    { geometry: new CylinderGeometry(spec.radius * 0.7, spec.radius, spec.length - knob, 8, 1), color: STEEL, position: [0, 0, (spec.length - knob) / 2], rotation: ALONG_Z },
    { geometry: new CylinderGeometry(knob, knob, knob * 2, 8, 1), color, position: [0, 0, spec.length - knob], rotation: ALONG_Z },
  ]);
  const mesh = new Mesh(geometry, litInside(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 })));
  mesh.name = 'Toggle Bat';
  return mesh;
}

/**
 * A pull knob and its shaft, the knob's back at the origin facing out
 * along +Z and the shaft running back `travel` into the face; move it out
 * with `position.z`. Its own material, so it can glow while out.
 */
export function createPullKnob(spec: PullSpec, color: number): Mesh {
  const geometry = mergeParts([
    { geometry: new CylinderGeometry(spec.radius, spec.radius * 0.9, spec.depth, 10, 1), color, position: [0, 0, spec.depth / 2], rotation: ALONG_Z },
    { geometry: new CylinderGeometry(0.003, 0.003, spec.travel, 6, 1), color: STEEL, position: [0, 0, -spec.travel / 2], rotation: ALONG_Z },
  ]);
  const mesh = new Mesh(geometry, litInside(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 })));
  mesh.name = 'Pull Knob';
  return mesh;
}

/** The parts of `parts`, built in a mount's own space, put in bench space. */
function mounted(mount: BenchMount, parts: Part[]): Part[] {
  const at: Vec3 = [0, 0, 0];
  return parts.map((part) => {
    const p = part.position ?? [0, 0, 0];
    const rot = part.rotation ?? [0, 0, 0];
    mountToBench(mount, p, at);
    // Only turns about X are used here, which add.
    return { ...part, position: [at[0], at[1], at[2]] as const, rotation: [rot[0] + mount.tilt, rot[1], rot[2]] as const };
  });
}

/**
 * The test bench (Practice > Mechanism kit): a top on a post, a housing for
 * the lever, an axle boss and a stay for each wheel, the twist grip's
 * pedestal, the buttons' bezels, the yoke's column and the read-out
 * board's frame on two stalks. Bench space as in src/sim/mechanism-bench.ts.
 */
export function createBench(): Mesh {
  const { top, board } = BENCH;
  const parts: Part[] = [
    { geometry: new BoxGeometry(top.width, top.thickness, top.depth), color: OLIVE, position: [0, -top.thickness / 2, top.z] },
    beam([0, -0.55, top.z], [0, -top.thickness + 0.005, top.z], 0.03, OLIVE_DARK, 6),
    { geometry: new BoxGeometry(0.3, 0.02, 0.3), color: OLIVE_DARK, position: [0, -0.55, top.z] },
  ];
  // The lever's housing hides its pivot; a slot plate stands 4 mm proud of its top.
  const lever = MOUNTS.lever.at;
  parts.push({ geometry: new BoxGeometry(0.07, lever[1] + 0.03, 0.12), color: OLIVE_DARK, position: [lever[0], (lever[1] + 0.03) / 2 - 0.005, lever[2]] });
  parts.push({ geometry: new BoxGeometry(0.035, 0.008, 0.09), color: FRAME, position: [lever[0], lever[1] + 0.025, lever[2]] });
  // Each wheel turns on an axle boss behind its hub, held up by a stay from the bench.
  const rear: Vec3 = [0, 0, 0];
  for (const mount of [MOUNTS.crank, MOUNTS.wheel]) {
    parts.push(...mounted(mount, [{ geometry: new CylinderGeometry(0.016, 0.016, 0.06, 8, 1), color: STEEL_DARK, position: [0, 0, -0.045], rotation: ALONG_Z }]));
    mountToBench(mount, [0, 0, -0.07], rear);
    parts.push(beam([rear[0], rear[1], rear[2]], [rear[0], -0.01, rear[2]], 0.013, OLIVE_DARK, 6));
  }
  parts.push(twistPedestal(TWIST, MOUNTS.twist.at[0], MOUNTS.twist.at[2]));
  // The buttons' bezels: square plates whose faces stay 3 mm behind a cap pushed right in.
  for (const mount of [MOUNTS.button, MOUNTS.switch]) {
    const z = -(0.008 + BEZEL.gap + BEZEL.depth / 2);
    parts.push(...mounted(mount, [{ geometry: new BoxGeometry(2 * BEZEL.half, 2 * BEZEL.half, BEZEL.depth), color: FRAME, position: [0, 0, z] }]));
  }
  // The yoke turns on a column stopping 5 mm under its hub.
  const yoke = MOUNTS.yoke.at;
  parts.push(beam([yoke[0], -0.01, yoke[2]], [yoke[0], yoke[1] - 0.03, yoke[2]], 0.015, STEEL_DARK, 6));
  // The board's frame, tilted back, on a stalk each side from the back of the bench.
  const fy = board.y - Math.sin(board.tilt) * 0.01;
  const fz = board.z - Math.cos(board.tilt) * 0.01;
  parts.push({ geometry: new BoxGeometry(board.width + 0.03, board.height + 0.03, 0.02), color: FRAME, position: [0, fy, fz], rotation: [-board.tilt, 0, 0] });
  for (const s of [-1, 1]) {
    const x = s * (board.width / 2 - 0.01);
    parts.push(beam([x, -0.01, top.z - top.depth / 2 + 0.03], [x, fy - board.height * 0.3, fz - 0.005], 0.01, STEEL, 5));
  }
  return named(mergeParts(parts), 'Mechanism Bench');
}


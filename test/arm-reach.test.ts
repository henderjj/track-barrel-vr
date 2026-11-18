import { describe, expect, it } from 'vitest';
import { reachArm, STRAIGHTEST, type Vec3 } from '../src/sim/arm-reach.js';

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('arm reach (F6.3b)', () => {
  const shoulder: Vec3 = [0.2, 1.4, 0];
  const upper = 0.3;
  const lower = 0.27;

  it('keeps both bones their length and puts the wrist on a target in reach', () => {
    const elbow: Vec3 = [0, 0, 0];
    const wrist: Vec3 = [0, 0, 0];
    const target: Vec3 = [0.25, 1.15, -0.35];
    const back = reachArm(shoulder, target, [0.6, 1.0, 0.2], upper, lower, elbow, wrist);
    expect(back).toBe(0);
    expect(dist(wrist, target)).toBeLessThan(1e-9);
    expect(dist(shoulder, elbow)).toBeCloseTo(upper, 9);
    expect(dist(elbow, wrist)).toBeCloseTo(lower, 9);
  });

  it('bends the elbow towards the pole', () => {
    const elbow: Vec3 = [0, 0, 0];
    const wrist: Vec3 = [0, 0, 0];
    reachArm(shoulder, [0.2, 1.2, -0.35], [0.8, 1.2, 0], upper, lower, elbow, wrist);
    expect(elbow[0]).toBeGreaterThan(shoulder[0] + 0.05);
    reachArm(shoulder, [0.2, 1.2, -0.35], [-0.4, 1.2, 0], upper, lower, elbow, wrist);
    expect(elbow[0]).toBeLessThan(shoulder[0] - 0.05);
  });

  it('draws the arm straight towards a target out of reach, and says how far short it falls', () => {
    const elbow: Vec3 = [0, 0, 0];
    const wrist: Vec3 = [0, 0, 0];
    const target: Vec3 = [0.2, 1.4, -1.0];
    const back = reachArm(shoulder, target, [0.6, 1.0, 0], upper, lower, elbow, wrist);
    const most = (upper + lower) * STRAIGHTEST;
    expect(dist(shoulder, wrist)).toBeCloseTo(most, 9);
    expect(back).toBeCloseTo(1.0 - most, 9);
    expect(wrist[2]).toBeLessThan(0);
    expect(dist(shoulder, elbow)).toBeCloseTo(upper, 9);
    expect(dist(elbow, wrist)).toBeCloseTo(lower, 9);
  });

  it('still finds an elbow with the pole on the arm\'s line or the wrist on the shoulder', () => {
    const elbow: Vec3 = [0, 0, 0];
    const wrist: Vec3 = [0, 0, 0];
    reachArm(shoulder, [0.2, 1.0, 0], [0.2, 0.5, 0], upper, lower, elbow, wrist);
    expect(elbow.every(Number.isFinite)).toBe(true);
    expect(dist(shoulder, elbow)).toBeCloseTo(upper, 6);
    reachArm(shoulder, shoulder, [0.6, 1.0, 0], upper, lower, elbow, wrist);
    expect(elbow.every(Number.isFinite) && wrist.every(Number.isFinite)).toBe(true);
    expect(dist(elbow, wrist)).toBeCloseTo(lower, 6);
  });
});

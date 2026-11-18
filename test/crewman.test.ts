import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readGlb } from './support/glb.js';

/**
 * The textured crewman's files (F6.3b, docs/crew-avatars.md): small enough
 * for a Quest 3 to load and draw, with the bones and parts that
 * src/scene-assets/crewman.ts poses.
 */
describe('crewman model (F6.3b)', () => {
  const glb = readGlb('public/models/crewman/crewman.glb');

  it('is light: under 16,000 triangles, 1.2 MB, and its textures at most 1024 pixels', () => {
    const triangles = glb.meshes.reduce((n, m) => n + (m.indices ? m.indices.length : m.attributes.POSITION.length / 3) / 3, 0);
    expect(triangles).toBeLessThan(16000);
    expect(glb.bytes).toBeLessThan(1.2e6);
    for (const image of glb.json.images ?? []) {
      const bytes = glb.view(image.bufferView);
      // PNG keeps its size at bytes 16-23; a JPEG's is in its SOF marker.
      if (image.mimeType === 'image/png') {
        const dv = new DataView(bytes.buffer, bytes.byteOffset);
        expect(Math.max(dv.getUint32(16), dv.getUint32(20))).toBeLessThanOrEqual(1024);
      } else {
        expect(image.mimeType).toBe('image/jpeg');
        let at = 2;
        while (at < bytes.length && !(bytes[at] === 0xff && bytes[at + 1] >= 0xc0 && bytes[at + 1] <= 0xc2)) at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
        const height = (bytes[at + 5] << 8) | bytes[at + 6];
        const width = (bytes[at + 7] << 8) | bytes[at + 8];
        expect(Math.max(width, height)).toBeLessThanOrEqual(1024);
      }
    }
    expect(statSync('public/models/crewman/crewman-crew-mask.png').size).toBeLessThan(64e3);
  });

  it('has the bones the crewman is posed by, the headgear, and no hair or normal maps to load', () => {
    const names = new Set(glb.json.nodes.map((n) => n.name));
    for (const s of ['l', 'r']) {
      for (const b of ['clavicle', 'upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot', 'ball']) expect(names.has(`${b}_${s}`), `${b}_${s}`).toBe(true);
    }
    for (const b of ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head']) expect(names.has(b), b).toBe(true);
    expect(glb.meshes.map((m) => m.name).sort()).toEqual(['Eyebrows', 'Eyes', 'Headgear', 'SuperHero_Male']);
    const materials = (glb.json as { materials: { normalTexture?: unknown }[] }).materials;
    expect(materials.every((m) => m.normalTexture === undefined)).toBe(true);
  });
});

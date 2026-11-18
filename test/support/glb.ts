import { readFileSync } from 'node:fs';

/**
 * A small reader for the parts of a binary glTF (.glb) the tests need, with
 * no loader and no images: the JSON, and each mesh's vertex attributes and
 * triangle indices as typed arrays.
 */

interface Accessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
}

export interface GlbMesh {
  name: string;
  /** Attribute name (POSITION, COLOR_0, JOINTS_0...) to its values, flat. */
  attributes: Record<string, Float32Array | Uint8Array | Uint16Array | Uint32Array>;
  /** Components per element of each attribute. */
  sizes: Record<string, number>;
  indices: Uint16Array | Uint32Array | null;
}

export interface Glb {
  json: Record<string, unknown> & {
    nodes: { name?: string; mesh?: number; skin?: number; children?: number[] }[];
    skins?: { joints: number[] }[];
    images?: { bufferView: number; mimeType: string }[];
    bufferViews: { byteOffset?: number; byteLength: number }[];
  };
  bytes: number;
  meshes: GlbMesh[];
  /** The bytes of buffer view `index`. */
  view(index: number): Uint8Array;
}

const SIZES: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGlb(path: string): Glb {
  const file = readFileSync(path);
  const data = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${path} is not a .glb`);
  const jsonLength = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + jsonLength))) as Glb['json'] & {
    accessors: Accessor[];
    meshes: { name?: string; primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  };
  const binStart = 20 + jsonLength + 8;
  const view = (index: number) => {
    const v = json.bufferViews[index];
    return data.subarray(binStart + (v.byteOffset ?? 0), binStart + (v.byteOffset ?? 0) + v.byteLength);
  };
  const read = (index: number): [Float32Array | Uint8Array | Uint16Array | Uint32Array, number] => {
    const a = json.accessors[index];
    const size = SIZES[a.type];
    const bytes = view(a.bufferView);
    const offset = bytes.byteOffset + (a.byteOffset ?? 0);
    // Copy so the typed array is aligned.
    const n = a.count * size;
    switch (a.componentType) {
      case 5126:
        return [new Float32Array(data.buffer.slice(offset, offset + n * 4)), size];
      case 5121:
        return [new Uint8Array(data.buffer.slice(offset, offset + n)), size];
      case 5123:
        return [new Uint16Array(data.buffer.slice(offset, offset + n * 2)), size];
      case 5125:
        return [new Uint32Array(data.buffer.slice(offset, offset + n * 4)), size];
      default:
        throw new Error(`accessor component type ${a.componentType} not read`);
    }
  };
  const meshes: GlbMesh[] = [];
  json.nodes.forEach((node) => {
    if (node.mesh === undefined) return;
    const prim = json.meshes[node.mesh].primitives[0];
    const attributes: GlbMesh['attributes'] = {};
    const sizes: GlbMesh['sizes'] = {};
    for (const [name, index] of Object.entries(prim.attributes)) {
      const [values, size] = read(index);
      attributes[name] = values;
      sizes[name] = size;
    }
    const indices = prim.indices === undefined ? null : (read(prim.indices)[0] as Uint16Array | Uint32Array);
    meshes.push({ name: node.name ?? '', attributes, sizes, indices });
  });
  return { json, bytes: data.byteLength, meshes, view };
}

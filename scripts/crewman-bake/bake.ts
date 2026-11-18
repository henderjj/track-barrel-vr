import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, FrontSide, Euler, Matrix4, Matrix3, Mesh,
  MeshStandardMaterial, Object3D, OrthographicCamera, ShaderMaterial, TextureLoader, Quaternion, Scene, SkinnedMesh, SphereGeometry, TorusGeometry, SRGBColorSpace, Vector3, WebGLRenderer, Bone,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Bakes the textured crewman (F6.3b, docs/crew-avatars.md) from Quaternius's
 * Universal Base Characters (CC0): the uniform painted into the skin texture
 * on the GPU (in UV space, by where each texel sits on the body and which
 * bones move it), and the beret, badge and headset fitted to the head and
 * merged into one vertex-coloured mesh, `Headgear`. Writes, through
 * export.mjs, public/models/crewman/crewman.glb and the crew colour's mask,
 * crewman-crew-mask.png. See README.md for how to run it.
 *
 * A tool, not game code: it imports three directly and runs once in a
 * browser. Numbers are in the model as made: 1.81 m tall, facing +Z, its
 * left towards +X. URL parameters override the fitted values for trying
 * changes.
 */

const params = new URLSearchParams(location.search);
const CREW = 0x2f6db3;

const loader = new GLTFLoader();
const gltf = await loader.loadAsync('./source/Superhero_Male_FullBody.gltf');
const model = gltf.scene;
let body!: SkinnedMesh;
const meshes: SkinnedMesh[] = [];
model.traverse((o: any) => { if (o.isSkinnedMesh) { meshes.push(o); if (o.name === 'Eyebrows') { o.material.color = new Color(0x3a2a20); o.material.alphaTest = 0.5; } if (o.name === 'SuperHero_Male') body = o; o.frustumCulled = false; } });
const skeleton = body.skeleton;
const bone = (n: string) => skeleton.bones.find((b) => b.name === n)! as Bone;

// --- Paint the clothes into the skin texture, on the GPU in UV space ---------------------------
const g = body.geometry;
const pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
model.updateMatrixWorld(true);
const bindToWorld = new Matrix4().copy(body.matrixWorld);
const groupOf = (n: string): number => {
  if (n.startsWith('neck') || n === 'Head') return 0;
  if (/^(hand|index|middle|ring|pinky|thumb)_/.test(n)) return 1;
  if (/^(foot|ball)/.test(n)) return 2;
  if (/^(spine|pelvis)/.test(n)) return 3;
  if (n.startsWith('clavicle')) return 4;
  if (/^(upperarm|lowerarm)/.test(n)) return 5;
  return 6; // legs
};
const boneGroup = skeleton.bones.map((b) => groupOf(b.name));
const wA = new Float32Array(pos.count * 4), wB = new Float32Array(pos.count * 4), bp = new Float32Array(pos.count * 3);
const tv = new Vector3();
for (let i = 0; i < pos.count; i++) {
  for (let k = 0; k < 4; k++) {
    const grp = boneGroup[si.getComponent(i, k)], w = sw.getComponent(i, k);
    if (grp < 4) wA[i * 4 + grp] += w; else wB[i * 4 + grp - 4] += w;
  }
  tv.fromBufferAttribute(pos, i).applyMatrix4(bindToWorld);
  bp.set([tv.x, tv.y, tv.z], i * 3);
}
const uvGeom = new BufferGeometry();
uvGeom.setIndex(g.index);
uvGeom.setAttribute('position', new BufferAttribute(new Float32Array(pos.count * 3), 3));
uvGeom.setAttribute('uv', g.getAttribute('uv'));
uvGeom.setAttribute('bindPos', new BufferAttribute(bp, 3));
uvGeom.setAttribute('wA', new BufferAttribute(wA, 4));
uvGeom.setAttribute('wB', new BufferAttribute(wB, 4));
const handL = bone('hand_l').getWorldPosition(new Vector3()), handR = bone('hand_r').getWorldPosition(new Vector3());
const skinTex = await new TextureLoader().loadAsync('./source/T_Superhero_Male_Ligh.png');
skinTex.flipY = false; skinTex.colorSpace = SRGBColorSpace;
const lin = (hex: number) => new Color(hex);
const paint = new ShaderMaterial({
  uniforms: {
    skin: { value: skinTex }, handL: { value: handL }, handR: { value: handR },
    khaki: { value: lin(0x7a7150) }, jerkin: { value: lin(0x5a3d28) }, webbing: { value: lin(0x9c9672) }, boots: { value: lin(0x1e1a17) },
    leather: { value: lin(0x4a2f1c) }, crew: { value: lin(CREW) }, exportMode: { value: 0 }, maskMode: { value: 0 },
  },
  vertexShader: `attribute vec3 bindPos; attribute vec4 wA; attribute vec4 wB; varying vec3 vP; varying vec4 vA; varying vec4 vB; varying vec2 vUv;
    void main() { vP = bindPos; vA = wA; vB = wB; vUv = uv; gl_Position = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0); }`,
  fragmentShader: `uniform sampler2D skin; uniform vec3 handL, handR, khaki, jerkin, webbing, boots, leather, crew; uniform float exportMode, maskMode;
    varying vec3 vP; varying vec4 vA; varying vec4 vB; varying vec2 vUv;
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
    void main() {
      vec3 orig = texture2D(skin, vUv).rgb; // raw sRGB bytes: the painting is done in sRGB
      float lum = dot(orig, vec3(0.3, 0.59, 0.11));
      float head = vA.x, hand = vA.y, foot = vA.z, torso = vA.w, clav = vB.x, arm = vB.y, leg = vB.z;
      float dh = min(distance(vP, handL), distance(vP, handR));
      vec3 c; bool cloth = true; bool isCrew = false;
      if (dh < 0.072 || hand > 0.5) c = leather;
      else if (dh < 0.092) { if (exportMode > 0.5) c = leather; else c = crew; }
      else if (head > 0.5 && vP.y > 1.535) {
        // Short back and sides, painted on, under the beret.
        if (vP.y > 1.745 && vP.z < 0.07) { c = toSRGB(vec3(0.012, 0.012, 0.014)); cloth = false; } else {
        // Hairline: high over the ears, down to the nape at the back, none on the forehead.
        float hl = mix(1.705, 1.648, smoothstep(-0.015, -0.085, vP.z));
        float a = smoothstep(hl - 0.005, hl + 0.006, vP.y) * smoothstep(0.048, 0.03, vP.z);
        a = max(a, smoothstep(1.76, 1.77, vP.y));
        vec3 hairC = toSRGB(vec3(0.07, 0.047, 0.033) * (0.8 + 0.4 * fract(sin(dot(vUv * 2048.0, vec2(12.9898, 78.233))) * 43758.5453)));
        cloth = false; c = mix(orig, hairC, a * 0.95);
      } }
      else if (vP.y > 1.465 && length(vP.xz - vec2(0.0, -0.035)) < 0.082 && head + torso + clav > 0.5) { c = crew; isCrew = true; }
      else if (vP.y > 1.44 && length(vP.xz - vec2(0.0, -0.035)) < 0.105 && torso + clav > 0.3 && vP.z > -0.07) c = khaki;
      else if (foot > 0.3 || (leg > 0.5 && vP.y < 0.17)) c = boots;
      else if (leg > 0.5 && vP.y < 0.27) c = webbing;
      else if (vP.y > 0.945 && vP.y < 0.995 && torso + clav > 0.5 && arm < 0.4) c = webbing;
      else if (vP.y > 0.9 && arm < 0.3 && (torso + clav > 0.55 || (vP.z < -0.03 && abs(vP.x) < 0.13 && vP.y < 1.47))) c = jerkin;
      else c = khaki;
      if (cloth) { c *= 0.82 + 0.25 * clamp(lum / 0.45, 0.0, 1.4); c = toSRGB(c); }
      gl_FragColor = maskMode > 0.5 ? vec4(vec3(isCrew ? 1.0 : 0.0), 1.0) : vec4(c, 1.0);
    }`,
});
const paintR = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, alpha: true });
const TS = 2048;
paintR.setPixelRatio(1); paintR.setSize(TS, TS); paintR.setClearColor(0x000000, 0);
const pScene = new Scene(); const pMesh = new Mesh(uvGeom, paint); pMesh.frustumCulled = false; pScene.add(pMesh);
skinTex.colorSpace = '' as any; // the shader blends in sRGB space: sample raw bytes
skinTex.needsUpdate = true;
function bake(outSize: number): HTMLCanvasElement {
  paintR.render(pScene, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
  const cnv = document.createElement('canvas'); cnv.width = cnv.height = TS;
  const cctx = cnv.getContext('2d')!; cctx.drawImage(paintR.domElement, 0, 0);
  // Dilate into the empty gutters so mipmaps don't bleed.
  const id = cctx.getImageData(0, 0, TS, TS); const d = id.data;
  for (let pass = 0; pass < 6; pass++) {
    const src = new Uint8ClampedArray(d);
    for (let y = 1; y < TS - 1; y++) for (let x = 1; x < TS - 1; x++) {
      const p = (y * TS + x) * 4; if (src[p + 3] > 0) continue;
      for (const o of [-4, 4, -TS * 4, TS * 4]) { if (src[p + o + 3] > 0) { d[p] = src[p + o]; d[p + 1] = src[p + o + 1]; d[p + 2] = src[p + o + 2]; d[p + 3] = 255; break; } }
    }
  }
  // Anything still empty (far from every island) is opaque black, so a JPEG keeps no alpha.
  for (let p = 0; p < d.length; p += 4) if (d[p + 3] === 0) { d[p] = d[p + 1] = d[p + 2] = 0; d[p + 3] = 255; }
  cctx.putImageData(id, 0, 0);
  const small = document.createElement('canvas'); small.width = small.height = outSize;
  small.getContext('2d')!.drawImage(cnv, 0, 0, outSize, outSize);
  return small;
}
const bodyMat = body.material as MeshStandardMaterial;
bodyMat.normalMap = null; bodyMat.metalnessMap = null; bodyMat.roughnessMap = null; bodyMat.roughness = 0.85; bodyMat.metalness = 0;
const wp = (i: number) => new Vector3().fromBufferAttribute(pos, i).applyMatrix4(bindToWorld);
const vname: string[] = []; for (let i = 0; i < pos.count; i++) { let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } } vname[i] = skeleton.bones[best].name; }

// The headgear, placed in the model and parented to the head bone until it is merged below.
const head = bone('Head');
function onHead(obj: Object3D, worldAt: Vector3, worldQ?: Quaternion) {
  head.updateMatrixWorld(true);
  const inv = new Matrix4().copy(head.matrixWorld).invert();
  obj.position.copy(worldAt).applyMatrix4(inv);
  const hq = head.getWorldQuaternion(new Quaternion());
  obj.quaternion.copy(hq.invert().multiply(worldQ ?? new Quaternion()));
  const hs = head.getWorldScale(new Vector3());
  obj.scale.divide(hs);
  head.add(obj);
}
// Head extents in bind pose.
let hmin = new Vector3(1e9, 1e9, 1e9), hmax = new Vector3(-1e9, -1e9, -1e9);
for (let i = 0; i < pos.count; i++) if (vname[i] === 'Head') { const p = wp(i); hmin.min(p); hmax.max(p); }
const hc = hmin.clone().add(hmax).multiplyScalar(0.5);
// Beret: a band shell that hugs the skull (the head's own skin pushed out 6 mm, above the band line),
// and a smaller, flatter crown pulled down over the right ear.
const bandLine = (x: number, z: number) => Number(params.get('bl') ?? 1.733) + (z > 0 ? 0.014 : 0.007) * Math.max(-1, Math.min(1, z / 0.11)) + 0.004 * (x / 0.09);
const nrm = g.getAttribute('normal');
const nmat = new Matrix3().getNormalMatrix(bindToWorld);
const off = Number(params.get('boff') ?? 0.006);
const shellPos: number[] = [], shellNrm: number[] = [];
const idx = g.index!;
const nw = (i: number) => new Vector3().fromBufferAttribute(nrm, i).applyMatrix3(nmat).normalize();
const fOf = (p: Vector3) => p.y - bandLine(p.x, p.z);
for (let t = 0; t < idx.count; t += 3) {
  const ii = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
  if (!ii.every((i) => vname[i] === 'Head')) continue;
  // Clip the triangle at the band line (the line is linear in x and z, so the cut is exact).
  const poly: { p: Vector3; n: Vector3 }[] = ii.map((i) => ({ p: wp(i), n: nw(i) }));
  const out: { p: Vector3; n: Vector3 }[] = [];
  for (let k = 0; k < 3; k++) {
    const A = poly[k], B = poly[(k + 1) % 3], fa = fOf(A.p), fb = fOf(B.p);
    if (fa >= 0) out.push(A);
    if ((fa >= 0) !== (fb >= 0)) { const u = fa / (fa - fb); out.push({ p: A.p.clone().lerp(B.p, u), n: A.n.clone().lerp(B.n, u).normalize() }); }
  }
  for (let k = 1; k + 1 < out.length; k++) for (const v of [out[0], out[k], out[k + 1]]) {
    const q = v.p.clone().addScaledVector(v.n, off); shellPos.push(q.x, q.y, q.z); shellNrm.push(v.n.x, v.n.y, v.n.z);
  }
}
{
  const sg = new BufferGeometry(); sg.setAttribute('position', new BufferAttribute(new Float32Array(shellPos), 3)); sg.setAttribute('normal', new BufferAttribute(new Float32Array(shellNrm), 3));
  const shell = new Mesh(sg, new MeshStandardMaterial({ color: 0x1d1d20, roughness: 0.95, side: DoubleSide }));
  onHead(shell, new Vector3(0, 0, 0));
}
const crownR = Number(params.get('cr') ?? 0.118);
const crown = new Mesh(new SphereGeometry(crownR, 24, 10), new MeshStandardMaterial({ color: 0x1d1d20, roughness: 0.95 }));
crown.scale.set(1, Number(params.get('cs') ?? 0.26), 1.0);
onHead(crown, new Vector3(hc.x - Number(params.get('cx') ?? 0.028), hmax.y - Number(params.get('cd') ?? 0.022), hc.z + 0.004), new Quaternion().setFromEuler(new Euler(-0.04, 0, Number(params.get('ct') ?? 0.36))));
const badge = new Mesh(new CylinderGeometry(0.011, 0.011, 0.006, 8), new MeshStandardMaterial({ color: 0xb9b6a8, roughness: 0.5, metalness: 0.3 }));
{
  // On the band over the left eye: the shell's most forward point near x = +0.042, y ≈ band line + 1.3 cm.
  let best = -1, bd = 1e9;
  for (let i = 0; i < pos.count; i++) { if (vname[i] !== 'Head') continue; const p = wp(i); if (p.z < 0.05) continue; const d = Math.hypot(p.x - 0.042, p.y - (bandLine(0.042, 0.11) + 0.013)) - p.z * 0.2; if (d < bd) { bd = d; best = i; } }
  const n = new Vector3().fromBufferAttribute(nrm, best).applyMatrix3(nmat).normalize();
  const at = wp(best).addScaledVector(n, off + 0.003);
  onHead(badge, at, new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), n));
}
{
  // Headset band over the beret, cup to cup.
  const half = (hmax.x - hmin.x) / 2 + 0.012, top = (hmax.y - Number(params.get('cd') ?? 0.022) + crownR * Number(params.get('cs') ?? 0.26)) + Number(params.get('hbt') ?? 0.006) - (hc.y - 0.035);
  const bandG = new TorusGeometry(half, 0.006, 6, 24, Math.PI);
  bandG.scale(1, top / half, 1);
  const hb = new Mesh(bandG, new MeshStandardMaterial({ color: 0x2b2926, roughness: 0.6, metalness: 0.2 }));
  onHead(hb, new Vector3(hc.x, hc.y - 0.035, hc.z + 0.005));
}
for (const sx of [-1, 1]) {
  const cup = new Mesh(new CylinderGeometry(0.03, 0.032, 0.02, 16), new MeshStandardMaterial({ color: 0x232120, roughness: 0.5 }));
  onHead(cup, new Vector3(hc.x + sx * ((hmax.x - hmin.x) / 2 + 0.006), hc.y - 0.035, hc.z + 0.005), new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 2)));
}
{
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  // The skin with the crew colour's places in mid grey (tinted in the game), and a mask of where they are.
  paint.uniforms.exportMode.value = 1; paint.uniforms.crew.value = new Color(0.5, 0.5, 0.5);
  const baked = bake(1024);
  paint.uniforms.maskMode.value = 1;
  const maskC = bake(512);
  const bakedTex = new CanvasTexture(baked); bakedTex.flipY = false; bakedTex.colorSpace = SRGBColorSpace; bakedTex.userData.mimeType = 'image/jpeg';
  bodyMat.map = bakedTex;
  head.updateMatrixWorld(true);
  const props = head.children.filter((o: any) => o.isMesh) as Mesh[];
  const PP: number[] = [], NN: number[] = [], CC: number[] = [];
  for (const m of props) {
    const gg = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    if (!gg.getAttribute('normal')) gg.computeVertexNormals();
    gg.applyMatrix4(m.matrixWorld);
    const col = (m.material as MeshStandardMaterial).color;
    const pa = gg.getAttribute('position'), na = gg.getAttribute('normal');
    for (let i = 0; i < pa.count; i++) { PP.push(pa.getX(i), pa.getY(i), pa.getZ(i)); NN.push(na.getX(i), na.getY(i), na.getZ(i)); CC.push(col.r, col.g, col.b); }
  }
  for (const m of props) m.removeFromParent();
  const hg = new BufferGeometry();
  hg.setAttribute('position', new BufferAttribute(new Float32Array(PP), 3));
  hg.setAttribute('normal', new BufferAttribute(new Float32Array(NN), 3));
  hg.setAttribute('color', new BufferAttribute(new Float32Array(CC), 3));
  const headgear = new Mesh(hg, new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: DoubleSide }));
  headgear.name = 'Headgear';
  model.add(headgear);
  for (const m of meshes) {
    for (const k of Object.keys(m.geometry.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(k)) m.geometry.deleteAttribute(k);
    const mat = m.material as MeshStandardMaterial;
    mat.side = m.name === 'Eyebrows' ? DoubleSide : FrontSide;
    mat.normalMap = null; mat.roughnessMap = null; mat.metalnessMap = null; mat.aoMap = null; mat.emissiveMap = null;
    if (m.name === 'Eyebrows' || m.name === 'Eyes') {
      const img = mat.map!.image as CanvasImageSource & { width: number; height: number };
      const c = document.createElement('canvas'); c.width = c.height = 256;
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      const t = new CanvasTexture(c); t.flipY = mat.map!.flipY; t.colorSpace = SRGBColorSpace; t.userData.mimeType = 'image/png';
      mat.map = t; mat.roughness = m.name === 'Eyes' ? 0.3 : 0.9; mat.metalness = 0;
    }
  }
  const glb = (await new GLTFExporter().parseAsync(model, { binary: true })) as ArrayBuffer;
  const bytes = new Uint8Array(glb); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  (window as any).glb = btoa(bin);
  (window as any).mask = maskC.toDataURL('image/png');
  (window as any).exportInfo = { headgearTriangles: PP.length / 9 };
  (window as any).done = true;
}

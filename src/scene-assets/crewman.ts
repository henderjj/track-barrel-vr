import {
  type Bone,
  Color,
  Group,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Quaternion,
  type SkinnedMesh,
  type Texture,
  Vector3,
} from '@iwsdk/core';
import { litInside } from './cabin-light.js';
import { reachArm, type Vec3 } from '../sim/arm-reach.js';
import type { SeatedBody } from '../sim/seated-body.js';

/**
 * The textured crewman (F6.3b, docs/crew-avatars.md): the crewmate drawn as
 * a skinned human in British Royal Armoured Corps kit, built from
 * Quaternius's Universal Base Characters (CC0), with the uniform painted
 * into its skin texture and a beret, badge and headset fitted to its head
 * (public/models/crewman/, baked by scripts/crewman-bake/).
 *
 * It takes the same inputs as the low-poly crew before it: the seat's hip
 * point, the head's pose and the seated body that src/sim/seated-body.ts
 * solves from it (F1.1b). The legs sit in the seat; the spine leans from the
 * hips to the neck's base and turns the shoulders; the neck reaches the head,
 * which is turned as the headset is. The arms reach into the gauntlets
 * (`PosedHand`, still drawn at the grip poses and locked onto handles) with
 * two-bone reach (src/sim/arm-reach.ts); the model's own hands are folded
 * away inside the cuffs.
 *
 * The crew colour (the neckerchief) is a tint over a mask, so changing it
 * is a uniform, not a new texture.
 */

/** The model's size: 1.81 m tall as made, drawn 1.72 m, a typical crewman's. */
export const CREW_SCALE = 0.95;
/** Between the eyes, in the model as made (facing +Z, feet at y = 0), m. */
const EYES: readonly [number, number, number] = [0, 1.6986, 0.07];
/** Hands at rest on the thighs, when a controller isn't tracked, in the body's frame (forward +Z, hips at 0), m. */
const REST_WRIST: readonly [number, number, number] = [0.19, 0.11, 0.3];
/** How far forward of the hips the knees are, m, and how far apart they splay. */
const KNEE_FORWARD = 0.44;
const KNEE_SPLAY = -0.04;
/** Least and most the spine stretches to reach the neck's base. */
const SPINE_STRETCH: readonly [number, number] = [0.8, 1.3];

const Y_HALF_TURN = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
const UP = new Vector3(0, 1, 0);

/** The parts of the crew colour: a mask texture and a tint, spliced into the body's material. */
function tintedByCrew(material: MeshStandardMaterial, mask: Texture, tint: { value: Color }): void {
  litInside(material);
  const inner = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    inner.call(material, shader, renderer);
    shader.uniforms.crewTint = tint;
    shader.uniforms.crewMask = { value: mask };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 crewTint;\nuniform sampler2D crewMask;')
      // The texture holds the crew colour's shading as mid grey (0.5 is unshaded).
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, crewTint * diffuseColor.rgb * 2.0, texture2D(crewMask, vMapUv).r);',
      );
  };
  material.customProgramCacheKey = () => 'cabin-light-crewman';
}

interface Rest {
  bone: Bone;
  position: Vector3;
  quaternion: Quaternion;
}

export class Crewman {
  /** The whole body, placed at the seat's hip point and turned the seat's way. */
  readonly body = new Group();
  /** The beret, badge and headset, drawn at the head's pose (eye centre, facing -Z). */
  readonly head: Mesh;
  private readonly model: Object3D;
  private readonly tint = { value: new Color() };
  private readonly bones = new Map<string, Bone>();
  private readonly rest: Rest[] = [];
  /** The head bone's turn when the head faces -Z, and the eyes from it then (m). */
  private readonly headTurn = new Quaternion();
  private readonly eyesFromHead = new Vector3();
  /** Each arm's bones, and which way is out to its side in the body's frame. */
  private readonly arms: Record<'left' | 'right', { upper: Bone; lower: Bone; hand: Bone; out: number }>;
  /** The bones the spine's stretch moves apart. */
  private readonly stretched: Bone[];
  private readonly upperArm: number;
  private readonly foreArm: number;
  private hipHeight = -1;
  // Scratch, so posing allocates nothing.
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly c = new Vector3();
  private readonly d = new Vector3();
  private readonly q1 = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly q3 = new Quaternion();
  private readonly parentTurn = new Quaternion();
  private readonly aimFrom = new Vector3();
  private readonly aimNow = new Vector3();
  private readonly aimWant = new Vector3();
  private readonly aimTurn = new Quaternion();
  private readonly shoulder: Vec3 = [0, 0, 0];
  private readonly target: Vec3 = [0, 0, 0];
  private readonly pole: Vec3 = [0, 0, 0];
  private readonly elbowAt: Vec3 = [0, 0, 0];
  private readonly wristAt: Vec3 = [0, 0, 0];

  /**
   * Dress the crewman from the loaded model (`scene`, used as it is: make
   * one per crewmate), with the crew colour's mask texture, in crew colour
   * `color` (hex), named for crew `index`.
   */
  constructor(scene: Object3D, mask: Texture, color: number, index: number) {
    this.model = scene;
    this.tint.value.setHex(color);
    mask.flipY = false;
    mask.needsUpdate = true;
    scene.updateMatrixWorld(true);
    let headgear: Mesh | undefined;
    scene.traverse((o) => {
      if ((o as Bone).isBone) this.bones.set(o.name, o as Bone);
      const mesh = o as SkinnedMesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as MeshStandardMaterial;
      if (mesh.isSkinnedMesh) {
        mesh.frustumCulled = false;
        if (material.map && mesh.name !== 'Eyes' && mesh.name !== 'Eyebrows') tintedByCrew(material, mask, this.tint);
        else litInside(material);
      } else if (mesh.name === 'Headgear') {
        headgear = mesh;
      }
    });
    if (!headgear) throw new Error('crewman model has no Headgear');
    // The headgear, out of the model and into the head's frame: eyes at the origin, facing -Z, at the drawn size.
    headgear.removeFromParent();
    headgear.geometry.applyMatrix4(
      new Matrix4()
        .makeScale(CREW_SCALE, CREW_SCALE, CREW_SCALE)
        .multiply(new Matrix4().makeRotationY(Math.PI))
        .multiply(new Matrix4().makeTranslation(-EYES[0], -EYES[1], -EYES[2]))
        .multiply(headgear.matrixWorld),
    );
    headgear.position.set(0, 0, 0);
    headgear.quaternion.identity();
    headgear.scale.set(1, 1, 1);
    litInside(headgear.material as MeshStandardMaterial);
    headgear.name = `Crew ${index + 1} Head`;
    this.head = headgear;

    this.body.name = `Crew ${index + 1} Body`;
    this.body.add(scene);
    scene.scale.setScalar(CREW_SCALE);
    this.body.updateMatrixWorld(true);
    // Hips on the seat's hip point: the thighs' joints either side of it.
    this.worldOf('thigh_l', this.a).add(this.worldOf('thigh_r', this.b)).multiplyScalar(0.5);
    scene.position.sub(this.a);
    // The model's hands fold away inside the gauntlets' cuffs.
    this.bone('hand_l').scale.setScalar(0.001);
    this.bone('hand_r').scale.setScalar(0.001);
    this.body.updateMatrixWorld(true);
    for (const name of ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r']) {
      const bone = this.bone(name);
      this.rest.push({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() });
    }
    // The head bone's turn and the eyes' place from it, with the body facing -Z.
    this.bone('Head').getWorldQuaternion(this.headTurn).premultiply(Y_HALF_TURN);
    const eyes = scene.localToWorld(this.a.set(EYES[0], EYES[1], EYES[2]));
    this.eyesFromHead.subVectors(eyes, this.worldOf('Head', this.b)).applyQuaternion(Y_HALF_TURN);
    // The model's left is +X in the body's frame (it faces +Z there).
    this.arms = {
      left: { upper: this.bone('upperarm_l'), lower: this.bone('lowerarm_l'), hand: this.bone('hand_l'), out: 1 },
      right: { upper: this.bone('upperarm_r'), lower: this.bone('lowerarm_r'), hand: this.bone('hand_r'), out: -1 },
    };
    this.stretched = [this.bone('spine_02'), this.bone('spine_03'), this.bone('neck_01')];
    this.upperArm = this.worldOf('upperarm_l', this.a).distanceTo(this.worldOf('lowerarm_l', this.b));
    this.foreArm = this.worldOf('lowerarm_l', this.a).distanceTo(this.worldOf('hand_l', this.b));
  }

  /** Dress the neckerchief in crew colour `color` (hex). */
  setColor(color: number): void {
    this.tint.value.setHex(color);
  }

  setVisible(visible: boolean): void {
    this.body.visible = visible;
    this.head.visible = visible;
  }

  /**
   * Seat the crewman: hips at `hip` in a seat facing `seatYaw` (rad about +Y),
   * `hipHeight` above the floor, the head at `eye` turned `turn`, and the
   * spine and neck as `seated` (solveSeatedBody) has them. The arms are
   * posed after, with `reach`.
   */
  pose(hip: readonly number[], hipHeight: number, seatYaw: number, eye: Vector3, turn: Quaternion, seated: SeatedBody): void {
    this.body.position.set(hip[0], hip[1], hip[2]);
    this.body.quaternion.setFromAxisAngle(UP, seatYaw + Math.PI);
    for (let i = 0; i < this.rest.length; i++) {
      const r = this.rest[i];
      r.bone.position.copy(r.position);
      r.bone.quaternion.copy(r.quaternion);
    }
    this.body.updateMatrixWorld(true);
    if (hipHeight !== this.hipHeight) {
      this.hipHeight = hipHeight;
      this.poseLegs(hipHeight);
    }
    // Risen off the seat after the head: the hips follow (the legs stay).
    const pelvis = this.bone('pelvis');
    if (Math.hypot(seated.pivot[0] - hip[0], seated.pivot[1] - hip[1], seated.pivot[2] - hip[2]) > 1e-4) {
      this.worldOf('pelvis', this.a).add(this.b.set(seated.pivot[0] - hip[0], seated.pivot[1] - hip[1], seated.pivot[2] - hip[2]));
      this.setWorldPosition(pelvis, this.a);
    }
    // The spine: from its foot to the neck's base, the shoulders turned by the twist.
    const spine = this.bone('spine_01');
    const from = this.worldOf('spine_01', this.a);
    const restDir = this.worldOf('neck_01', this.b).sub(from);
    const restLength = restDir.length();
    restDir.divideScalar(restLength);
    const want = this.c.set(seated.neckFrom[0], seated.neckFrom[1], seated.neckFrom[2]).sub(from);
    const stretch = Math.min(SPINE_STRETCH[1], Math.max(SPINE_STRETCH[0], want.length() / restLength));
    want.normalize();
    spine.getWorldQuaternion(this.q1);
    this.q2.setFromAxisAngle(restDir, seated.twist);
    this.q3.setFromUnitVectors(restDir, want).multiply(this.q2).multiply(this.q1);
    this.setWorldQuaternion(spine, this.q3);
    for (let i = 0; i < this.stretched.length; i++) this.stretched[i].position.multiplyScalar(stretch);
    spine.updateMatrixWorld(true);
    // The neck reaches the head; the head turns as the headset does.
    const head = this.bone('Head');
    const headAt = this.d.copy(this.eyesFromHead).applyQuaternion(turn).negate().add(eye);
    this.aim(this.bone('neck_01'), head, headAt);
    this.setWorldPosition(head, headAt);
    this.setWorldQuaternion(head, this.q1.copy(turn).multiply(this.headTurn));
    head.updateMatrixWorld(true);
  }

  /**
   * Reach the `side` arm into the gauntlet: the forearm ending at `cuff`
   * and running back the way `opens` (both in the parent's space, from
   * `PosedHand.cuff`), or resting on the thigh when `cuff` is null.
   */
  reach(side: 'left' | 'right', cuff: Vector3 | null, opens: Vector3 | null): void {
    const { upper, lower, hand, out } = this.arms[side];
    upper.getWorldPosition(this.a);
    const at = this.b;
    const pole = this.c;
    if (cuff && opens) {
      at.copy(cuff);
      // The elbow back along the cuff, out to the side and down.
      pole.copy(opens).multiplyScalar(0.3).add(cuff);
      this.body.localToWorld(this.d.set(out * 0.15, -0.1, 0)).sub(this.body.position);
      pole.add(this.d);
    } else {
      this.body.localToWorld(at.set(out * REST_WRIST[0], REST_WRIST[1], REST_WRIST[2]));
      this.body.localToWorld(pole.set(out * 0.5, -0.2, -0.2));
    }
    this.a.toArray(this.shoulder);
    at.toArray(this.target);
    pole.toArray(this.pole);
    reachArm(this.shoulder, this.target, this.pole, this.upperArm, this.foreArm, this.elbowAt, this.wristAt);
    this.aim(upper, lower, this.d.fromArray(this.elbowAt));
    this.aim(lower, hand, this.d.fromArray(this.wristAt));
  }

  /** Where bone `name` is, in world space, into `out`. */
  boneWorld(name: string, out: Vector3): Vector3 {
    return this.worldOf(name, out);
  }

  private poseLegs(hipHeight: number): void {
    for (const s of ['l', 'r'] as const) {
      const out = s === 'l' ? 1 : -1;
      const thigh = this.body.worldToLocal(this.worldOf(`thigh_${s}`, this.a));
      const knee = this.b.set(thigh.x + out * KNEE_SPLAY, thigh.y - 0.01, thigh.z + KNEE_FORWARD);
      const ankle = this.c.set(knee.x, -hipHeight + 0.09, knee.z - 0.03);
      const ball = this.d.set(ankle.x, -hipHeight + 0.02, ankle.z + 0.13);
      this.body.localToWorld(knee);
      this.body.localToWorld(ankle);
      this.body.localToWorld(ball);
      this.aim(this.bone(`thigh_${s}`), this.bone(`calf_${s}`), knee);
      this.aim(this.bone(`calf_${s}`), this.bone(`foot_${s}`), ankle);
      this.aim(this.bone(`foot_${s}`), this.bone(`ball_${s}`), ball);
    }
  }

  private bone(name: string): Bone {
    const bone = this.bones.get(name);
    if (!bone) throw new Error(`crewman model has no bone ${name}`);
    return bone;
  }

  private worldOf(name: string, out: Vector3): Vector3 {
    return this.bone(name).getWorldPosition(out);
  }

  /** Turn `bone` so that its child `child` points at `target` (world space), the shortest way. */
  private aim(bone: Bone, child: Object3D, target: Vector3): void {
    const from = bone.getWorldPosition(this.aimFrom);
    const now = child.getWorldPosition(this.aimNow).sub(from).normalize();
    const want = this.aimWant.copy(target).sub(from).normalize();
    bone.getWorldQuaternion(this.aimTurn);
    this.aimTurn.premultiply(this.parentTurn.setFromUnitVectors(now, want));
    this.setWorldQuaternion(bone, this.aimTurn);
    bone.updateMatrixWorld(true);
  }

  private setWorldQuaternion(bone: Bone, q: Quaternion): void {
    bone.parent!.getWorldQuaternion(this.parentTurn).invert();
    bone.quaternion.copy(this.parentTurn).multiply(q);
  }

  private setWorldPosition(bone: Bone, p: Vector3): void {
    bone.position.copy(p);
    bone.parent!.worldToLocal(bone.position);
  }
}

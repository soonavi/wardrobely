/**
 * HumanRig — drives the Selv human avatar loaded from `assets/avatar/selv-human.glb`.
 *
 * The GLB (built by `tools/avatar-build`) is a normal glTF file: a skinned
 * body with named morph targets, a skeleton, and a set of separate meshes for
 * eyes, hair and garments. Any viewer can open it. What this class adds is the
 * part glTF has no vocabulary for:
 *
 * 1. **Shape is applied on the CPU, once per change, not per frame on the GPU.**
 *    Body shape changes when the user edits their character — a few times a
 *    session — so paying for morph blending in the vertex shader on every frame
 *    of a phone GPU buys nothing. Baking also gives exact recomputed normals
 *    and means the renderer never needs morph-target texture support, which
 *    has not been proven on expo-gl.
 *
 * 2. **Hair and garments carry no morph targets at all.** Each of their
 *    vertices is bound to a triangle of the body (or of MakeHuman's clothing
 *    helper surfaces, which ride along in a hidden "Guide" mesh) with
 *    barycentric weights plus an offset in that triangle's local frame — the
 *    same idea as MakeHuman's own clothes proxies. After the body is reshaped
 *    the bound meshes are rebuilt from it, so a garment follows *every*
 *    combination of sliders exactly, and adding a garment to the asset costs
 *    its triangles and nothing else.
 *
 * 3. **The skeleton is re-seated to the new shape.** Joints are centroids of
 *    body vertices, so a taller body has longer bones. The build exports how
 *    far each joint moves per target; we move the bones and recompute the
 *    inverse bind matrices so posing a reshaped body rotates about the right
 *    pivots.
 *
 * This file is framework-free on purpose (three.js only, no React, no Expo):
 * the build's headless preview renderer bundles it unchanged, so what gets
 * looked at during asset work is the code that ships.
 */
import * as THREE from "three";

export type TargetInfo = {
  /** Change in each body measurement at weight 1.0, in metres / BMI points. */
  metrics: { stature: number; bmi: number; chest: number; waist: number; hip: number };
  /** Flat [x, y, z] per joint: how far each joint moves at weight 1.0. */
  joints: number[];
};

export type PartInfo = {
  name: string;
  kind: string;
  follow: "direct" | "surface";
  visible: boolean;
  verts: number;
  tris: number;
  [key: string]: unknown;
};

export type HumanManifest = {
  formatVersion: number;
  joints: string[];
  metrics: { stature: number; bmi: number; chest: number; waist: number; hip: number };
  targets: Record<string, TargetInfo>;
  parts: PartInfo[];
};

export type ShapeWeights = Record<string, number>;
export type Pose = Record<string, [number, number, number]>;

type DirectPart = { mesh: THREE.Mesh; mhid: Uint32Array };
type SurfacePart = {
  mesh: THREE.Mesh;
  /** 3 basis vertex ids per vertex. */
  ids: Uint32Array;
  /** 3 barycentric weights per vertex. */
  bary: Float32Array;
  /** Offset from the bound point, in the bound triangle's local frame. */
  local: Float32Array;
  weld: Int32Array | null;
  /**
   * Keep the offset in world axes instead of rotating it with the triangle.
   * Right for anything that stands well off the surface (hair): a far vertex
   * rotated by a small triangle's tilt swings a long way.
   */
  worldOffset: boolean;
  /** Shape changed while this part was hidden; rebuild when it is shown. */
  stale: boolean;
};
type SparseTarget = { index: Uint32Array; delta: Float32Array };

/** Finds the manifest the build embeds in the glTF scene's extras. */
export function findHumanManifest(root: THREE.Object3D): HumanManifest | null {
  let found: HumanManifest | null = null;
  root.traverse((o) => {
    const m = (o.userData as { selv?: HumanManifest } | undefined)?.selv;
    if (!found && m && typeof m === "object" && m.targets && m.joints) found = m;
  });
  return found;
}

function attributeAsUint(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, width: number): Uint32Array {
  const out = new Uint32Array(attr.count * width);
  for (let i = 0; i < attr.count; i++) {
    out[i * width] = Math.round(attr.getX(i));
    if (width > 1) out[i * width + 1] = Math.round(attr.getY(i));
    if (width > 2) out[i * width + 2] = Math.round(attr.getZ(i));
  }
  return out;
}

/**
 * Writes the triangle's orthonormal frame (e1, e2, n) for corners a, b, c of
 * `p` into `f` (9 floats). A degenerate triangle yields a zero frame, which
 * makes the offset vanish rather than explode.
 */
function triangleFrame(p: Float32Array, a: number, b: number, c: number, f: Float32Array): void {
  const ax = p[a], ay = p[a + 1], az = p[a + 2];
  let e1x = p[b] - ax, e1y = p[b + 1] - ay, e1z = p[b + 2] - az;
  const e2x0 = p[c] - ax, e2y0 = p[c + 1] - ay, e2z0 = p[c + 2] - az;
  let nx = e1y * e2z0 - e1z * e2y0;
  let ny = e1z * e2x0 - e1x * e2z0;
  let nz = e1x * e2y0 - e1y * e2x0;
  const l1 = Math.hypot(e1x, e1y, e1z);
  const ln = Math.hypot(nx, ny, nz);
  if (l1 < 1e-12 || ln < 1e-12) {
    f.fill(0);
    return;
  }
  e1x /= l1; e1y /= l1; e1z /= l1;
  nx /= ln; ny /= ln; nz /= ln;
  f[0] = e1x; f[1] = e1y; f[2] = e1z;
  f[3] = ny * e1z - nz * e1y; f[4] = nz * e1x - nx * e1z; f[5] = nx * e1y - ny * e1x;
  f[6] = nx; f[7] = ny; f[8] = nz;
}

/**
 * Area-weighted vertex normals. Vertices that share a `weld` id share one
 * normal, so a UV seam (where one surface point is two vertices) does not show
 * up as a lighting seam.
 */
export function recomputeNormals(geometry: THREE.BufferGeometry, weld: ArrayLike<number> | null): void {
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const index = geometry.getIndex();
  if (!index) return;
  const p = pos.array as Float32Array;
  const idx = index.array as ArrayLike<number>;
  const n = pos.count;
  let groups = n;
  if (weld) {
    groups = 0;
    for (let i = 0; i < n; i++) if (weld[i] + 1 > groups) groups = weld[i] + 1;
  }
  const acc = new Float32Array(groups * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    const a = i0 * 3, b = i1 * 3, c = i2 * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const g0 = (weld ? weld[i0] : i0) * 3, g1 = (weld ? weld[i1] : i1) * 3, g2 = (weld ? weld[i2] : i2) * 3;
    acc[g0] += nx; acc[g0 + 1] += ny; acc[g0 + 2] += nz;
    acc[g1] += nx; acc[g1 + 1] += ny; acc[g1 + 2] += nz;
    acc[g2] += nx; acc[g2 + 1] += ny; acc[g2 + 2] += nz;
  }
  let normal = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
  if (!normal || normal.count !== n) {
    normal = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    geometry.setAttribute("normal", normal);
  }
  const out = normal.array as Float32Array;
  for (let i = 0; i < n; i++) {
    const g = (weld ? weld[i] : i) * 3;
    const x = acc[g], y = acc[g + 1], z = acc[g + 2];
    const l = Math.hypot(x, y, z) || 1;
    out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
  }
  normal.needsUpdate = true;
}

/** Part kinds a wearer chooses between; everything else is always on. */
export const OPTIONAL_KINDS = ["hair", "brows", "beard", "garment", "base", "accessory"] as const;

/**
 * Parts whose normals the runtime rebuilds ship without any, and glTF loaders
 * answer a mesh with no normals by switching its material to flat shading.
 * Undo that, per material, once.
 */
function smoothShade(mesh: THREE.Mesh): void {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    const std = m as THREE.MeshStandardMaterial;
    if (std.flatShading) {
      std.flatShading = false;
      std.needsUpdate = true;
    }
  }
}

export class HumanRig {
  readonly root: THREE.Object3D;
  readonly manifest: HumanManifest;
  /** Every renderable part by node name. */
  readonly parts = new Map<string, THREE.Mesh>();
  readonly partInfo = new Map<string, PartInfo>();

  private readonly basis0: Float32Array;
  private readonly basis: Float32Array;
  private readonly targets = new Map<string, SparseTarget>();
  private readonly direct: DirectPart[] = [];
  private readonly surface = new Map<string, SurfacePart>();
  private readonly bones: THREE.Bone[] = [];
  private readonly boneParent: number[] = [];
  private readonly joints0: Float32Array;
  private readonly skeletons: THREE.Skeleton[] = [];
  private readonly frame = new Float32Array(9);
  private weights: ShapeWeights = {};
  private bodyMesh: THREE.Mesh | null = null;
  private bodyMhid: Uint32Array | null = null;
  private bodyIndex0: ArrayLike<number> | null = null;
  private maskKey = "";
  private readonly ownedMaterials = new Set<THREE.Material>();
  /** Geometries this instance copied and therefore must free. */
  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();

  /**
   * @param root A glTF scene this rig may mutate. Clone the loader's cached
   *             scene first (`SkeletonUtils.clone`) — geometry is deep-copied
   *             here, but the scene graph is taken as given.
   */
  constructor(root: THREE.Object3D) {
    const manifest = findHumanManifest(root);
    if (!manifest) {
      throw new Error("HumanRig: this glTF has no Selv manifest (scene.extras.selv). Is it selv-human.glb?");
    }
    this.root = root;
    this.manifest = manifest;
    for (const info of manifest.parts) this.partInfo.set(info.name, info);

    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });

    let basisSize = 0;
    for (const mesh of meshes) {
      const mhidAttr = mesh.geometry.getAttribute("_mhid") as THREE.BufferAttribute | undefined;
      if (mhidAttr) {
        // Own the geometry: this instance rewrites positions and normals.
        // (Bound parts are copied later, on first show - an avatar wears one
        // hairstyle and a few garments, not all of them.)
        mesh.geometry = mesh.geometry.clone();
        this.ownedGeometries.add(mesh.geometry);
        const mhid = attributeAsUint(mhidAttr, 1);
        for (let i = 0; i < mhid.length; i++) if (mhid[i] + 1 > basisSize) basisSize = mhid[i] + 1;
        this.direct.push({ mesh, mhid });
      }
      this.parts.set(mesh.name, mesh);
      const info = this.partInfo.get(mesh.name);
      if (info && info.visible === false) mesh.visible = false;
      if (mesh.name === "Body") this.bodyMesh = mesh;
      smoothShade(mesh);
      // Skinned parts are culled against their rest-pose bounds, which a pose
      // or a reshape can leave behind. The avatar is one small object that is
      // always on screen; skipping the test is cheaper than getting it wrong.
      mesh.frustumCulled = false;
    }
    if (basisSize === 0) throw new Error("HumanRig: no mesh carries the _MHID attribute.");

    this.basis0 = new Float32Array(basisSize * 3);
    this.basis = new Float32Array(basisSize * 3);
    const stamp = new Int32Array(basisSize).fill(-1);
    let stampId = 0;

    for (const part of this.direct) {
      const g = part.mesh.geometry;
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < part.mhid.length; i++) {
        const b = part.mhid[i] * 3;
        this.basis0[b] = pos.getX(i);
        this.basis0[b + 1] = pos.getY(i);
        this.basis0[b + 2] = pos.getZ(i);
      }
    }

    // Lift the morph targets off the meshes into one sparse table keyed by
    // basis vertex, then strip them so no shader ever sees a morph attribute.
    const collected = new Map<string, { index: number[]; delta: number[] }>();
    for (const part of this.direct) {
      const mesh = part.mesh;
      const morphs = mesh.geometry.morphAttributes.position as THREE.BufferAttribute[] | undefined;
      const dict = mesh.morphTargetDictionary;
      if (morphs && dict) {
        for (const [name, slot] of Object.entries(dict)) {
          const attr = morphs[slot];
          if (!attr) continue;
          let bucket = collected.get(name);
          if (!bucket) {
            bucket = { index: [], delta: [] };
            collected.set(name, bucket);
          }
          const id = stampId++;
          // Re-stamp entries already written for this target by an earlier mesh.
          for (const seen of bucket.index) stamp[seen] = id;
          for (let i = 0; i < attr.count; i++) {
            const x = attr.getX(i), y = attr.getY(i), z = attr.getZ(i);
            if (x === 0 && y === 0 && z === 0) continue;
            const v = part.mhid[i];
            if (stamp[v] === id) continue;
            stamp[v] = id;
            bucket.index.push(v);
            bucket.delta.push(x, y, z);
          }
        }
      }
      mesh.geometry.morphAttributes = {};
      mesh.geometry.morphTargetsRelative = false;
      (mesh as { morphTargetInfluences?: number[] }).morphTargetInfluences = undefined;
      (mesh as { morphTargetDictionary?: Record<string, number> }).morphTargetDictionary = undefined;
    }
    for (const [name, bucket] of collected) {
      this.targets.set(name, { index: Uint32Array.from(bucket.index), delta: Float32Array.from(bucket.delta) });
    }

    for (const mesh of meshes) {
      if (mesh.geometry.getAttribute("_bind")) this.pendingSurface.set(mesh.name, mesh);
    }
    if (this.bodyMesh) {
      this.bodyMhid = this.direct.find((d) => d.mesh === this.bodyMesh)?.mhid ?? null;
      const index = this.bodyMesh.geometry.getIndex();
      this.bodyIndex0 = index ? Array.from(index.array as ArrayLike<number>) : null;
    }

    // Skeleton, in manifest order.
    const byName = new Map<string, THREE.Bone>();
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) byName.set(o.name, o as THREE.Bone);
    });
    this.joints0 = new Float32Array(manifest.joints.length * 3);
    manifest.joints.forEach((name, i) => {
      const bone = byName.get(name);
      if (!bone) throw new Error(`HumanRig: bone "${name}" is in the manifest but not in the scene.`);
      this.bones.push(bone);
      const parent = bone.parent && (bone.parent as THREE.Bone).isBone ? this.bones.indexOf(bone.parent as THREE.Bone) : -1;
      this.boneParent.push(parent);
      const px = parent >= 0 ? this.joints0[parent * 3] : 0;
      const py = parent >= 0 ? this.joints0[parent * 3 + 1] : 0;
      const pz = parent >= 0 ? this.joints0[parent * 3 + 2] : 0;
      this.joints0[i * 3] = px + bone.position.x;
      this.joints0[i * 3 + 1] = py + bone.position.y;
      this.joints0[i * 3 + 2] = pz + bone.position.z;
    });
    for (const mesh of meshes) {
      const sk = (mesh as THREE.SkinnedMesh).skeleton;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh && sk && !this.skeletons.includes(sk)) this.skeletons.push(sk);
    }

    this.setShape({});
  }

  private readonly pendingSurface = new Map<string, THREE.Mesh>();

  /**
   * Bind a hair/garment/eye mesh to the body: record each vertex's offset in
   * its triangle's frame (or in world axes) against the NEUTRAL body, and take
   * a private copy of the geometry. Done on first show.
   */
  private prepareSurfacePart(name: string): SurfacePart | null {
    const ready = this.surface.get(name);
    if (ready) return ready;
    const mesh = this.pendingSurface.get(name);
    if (!mesh) return null;
    this.pendingSurface.delete(name);
    const shared = mesh.geometry;
    const bind = shared.getAttribute("_bind") as THREE.BufferAttribute;
    const bindW = shared.getAttribute("_bindw") as THREE.BufferAttribute;
    const pos = shared.getAttribute("position") as THREE.BufferAttribute;
    const n = pos.count;
    const ids = attributeAsUint(bind, 3);
    const bary = new Float32Array(n * 3);
    const local = new Float32Array(n * 3);
    const f = this.frame;
    const p0 = this.basis0;
    const worldOffset = this.partInfo.get(name)?.offset === "world";
    for (let i = 0; i < n; i++) {
      const a = ids[i * 3] * 3, b = ids[i * 3 + 1] * 3, c = ids[i * 3 + 2] * 3;
      // Weights are stored quantised; renormalise so the bound point is exact.
      let wa = bindW.getX(i), wb = bindW.getY(i), wc = bindW.getZ(i);
      const sum = wa + wb + wc || 1;
      wa /= sum; wb /= sum; wc /= sum;
      bary[i * 3] = wa; bary[i * 3 + 1] = wb; bary[i * 3 + 2] = wc;
      const dx = pos.getX(i) - (wa * p0[a] + wb * p0[b] + wc * p0[c]);
      const dy = pos.getY(i) - (wa * p0[a + 1] + wb * p0[b + 1] + wc * p0[c + 1]);
      const dz = pos.getZ(i) - (wa * p0[a + 2] + wb * p0[b + 2] + wc * p0[c + 2]);
      if (worldOffset) {
        local[i * 3] = dx; local[i * 3 + 1] = dy; local[i * 3 + 2] = dz;
        continue;
      }
      triangleFrame(p0, a, b, c, f);
      local[i * 3] = dx * f[0] + dy * f[1] + dz * f[2];
      local[i * 3 + 1] = dx * f[3] + dy * f[4] + dz * f[5];
      local[i * 3 + 2] = dx * f[6] + dy * f[7] + dz * f[8];
    }
    const weldAttr = shared.getAttribute("_weld") as THREE.BufferAttribute | undefined;
    const weld = weldAttr ? Int32Array.from(attributeAsUint(weldAttr, 1)) : null;
    // Private copy without the binding attributes: they are in typed arrays
    // now and the GPU has no use for them.
    const own = shared.clone();
    own.deleteAttribute("_bind");
    own.deleteAttribute("_bindw");
    if (weldAttr) own.deleteAttribute("_weld");
    mesh.geometry = own;
    this.ownedGeometries.add(own);
    const part: SurfacePart = { mesh, ids, bary, local, weld, worldOffset, stale: true };
    this.surface.set(name, part);
    return part;
  }

  /** Names of every shape target in the asset. */
  get targetNames(): string[] {
    return Array.from(this.targets.keys());
  }

  get shape(): ShapeWeights {
    return { ...this.weights };
  }

  /**
   * Reshape the body. `weights` maps target name to weight; anything omitted is
   * zero. Unknown names are ignored and returned, so a caller can notice a
   * contract drift instead of silently rendering the neutral body.
   */
  setShape(weights: ShapeWeights): { unknown: string[] } {
    const unknown: string[] = [];
    const active: [SparseTarget, number, TargetInfo | undefined][] = [];
    const clean: ShapeWeights = {};
    for (const [name, w] of Object.entries(weights)) {
      if (!Number.isFinite(w) || w === 0) continue;
      const t = this.targets.get(name);
      if (!t) {
        unknown.push(name);
        continue;
      }
      clean[name] = w;
      active.push([t, w, this.manifest.targets[name]]);
    }
    this.weights = clean;

    const p = this.basis;
    p.set(this.basis0);
    for (const [t, w] of active) {
      const { index, delta } = t;
      for (let i = 0; i < index.length; i++) {
        const b = index[i] * 3, d = i * 3;
        p[b] += w * delta[d];
        p[b + 1] += w * delta[d + 1];
        p[b + 2] += w * delta[d + 2];
      }
    }

    for (const part of this.direct) {
      const g = part.mesh.geometry;
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < part.mhid.length; i++) {
        const b = part.mhid[i] * 3;
        arr[i * 3] = p[b]; arr[i * 3 + 1] = p[b + 1]; arr[i * 3 + 2] = p[b + 2];
      }
      pos.needsUpdate = true;
      if (part.mesh.visible || this.partInfo.get(part.mesh.name)?.visible !== false) {
        recomputeNormals(g, part.mhid);
      }
    }

    for (const [name, mesh] of Array.from(this.pendingSurface)) {
      if (mesh.visible) this.prepareSurfacePart(name);
    }
    for (const part of this.surface.values()) {
      if (part.mesh.visible) this.rebuildSurfacePart(part);
      else part.stale = true;
    }

    this.reseatSkeleton(active);
    this.ground();
    return { unknown };
  }

  private rebuildSurfacePart(part: SurfacePart): void {
    const { ids, bary, local, mesh } = part;
    const p = this.basis;
    const f = this.frame;
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const a = ids[k] * 3, b = ids[k + 1] * 3, c = ids[k + 2] * 3;
      const wa = bary[k], wb = bary[k + 1], wc = bary[k + 2];
      const lx = local[k], ly = local[k + 1], lz = local[k + 2];
      if (part.worldOffset) {
        arr[k] = wa * p[a] + wb * p[b] + wc * p[c] + lx;
        arr[k + 1] = wa * p[a + 1] + wb * p[b + 1] + wc * p[c + 1] + ly;
        arr[k + 2] = wa * p[a + 2] + wb * p[b + 2] + wc * p[c + 2] + lz;
        continue;
      }
      triangleFrame(p, a, b, c, f);
      arr[k] = wa * p[a] + wb * p[b] + wc * p[c] + lx * f[0] + ly * f[3] + lz * f[6];
      arr[k + 1] = wa * p[a + 1] + wb * p[b + 1] + wc * p[c + 1] + lx * f[1] + ly * f[4] + lz * f[7];
      arr[k + 2] = wa * p[a + 2] + wb * p[b + 2] + wc * p[c + 2] + lx * f[2] + ly * f[5] + lz * f[8];
    }
    pos.needsUpdate = true;
    recomputeNormals(mesh.geometry, part.weld);
    part.stale = false;
  }

  private reseatSkeleton(active: [SparseTarget, number, TargetInfo | undefined][]): void {
    if (this.bones.length === 0) return;
    const j = new Float32Array(this.joints0);
    for (const [, w, info] of active) {
      const d = info?.joints;
      if (!d || d.length !== j.length) continue;
      for (let i = 0; i < j.length; i++) j[i] += w * d[i];
    }
    this.bones.forEach((bone, i) => {
      const parent = this.boneParent[i];
      const px = parent >= 0 ? j[parent * 3] : 0, py = parent >= 0 ? j[parent * 3 + 1] : 0, pz = parent >= 0 ? j[parent * 3 + 2] : 0;
      bone.position.set(j[i * 3] - px, j[i * 3 + 1] - py, j[i * 3 + 2] - pz);
    });
    // Inverse bind matrices, written directly. Every bone rests unrotated, so
    // in the rig's own space a joint's bind matrix is a pure translation and
    // its inverse is the negated joint position.
    //
    // Deliberately NOT `skeleton.calculateInverses()`: that reads each bone's
    // world matrix, which includes whatever the rig is parented under. The
    // try-on screen keeps the avatar on a turntable, so a reshape mid-spin
    // baked the turntable's current angle into the bind pose and the body came
    // out skinned against a skeleton rotated relative to it.
    const index = new Map<THREE.Bone, number>();
    this.bones.forEach((bone, i) => index.set(bone, i));
    for (const sk of this.skeletons) {
      sk.bones.forEach((bone, k) => {
        const i = index.get(bone as THREE.Bone);
        if (i === undefined) return;
        sk.boneInverses[k].makeTranslation(-j[i * 3], -j[i * 3 + 1], -j[i * 3 + 2]);
      });
    }
  }

  /** Keep the soles on y = 0 whatever the shape did to leg length. */
  private ground(): void {
    const body = this.bodyMesh;
    if (!body) return;
    const arr = (body.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < arr.length; i += 3) {
      if (arr[i] < minY) minY = arr[i];
      if (arr[i] > maxY) maxY = arr[i];
    }
    let sole = 0;
    for (const [name, mesh] of this.parts) {
      const s = this.partInfo.get(name)?.sole;
      if (mesh.visible && typeof s === "number" && s > sole) sole = s;
    }
    this.root.position.y = -minY + sole;
    this.statureMetres = maxY - minY;
    this.root.updateMatrixWorld(true);
  }

  /** Crown-to-sole height of the current shape, in metres. */
  statureMetres = 0;

  /** Show or hide one part. Showing a part that missed a reshape rebuilds it. */
  setPartVisible(name: string, visible: boolean): boolean {
    const mesh = this.parts.get(name);
    if (!mesh) return false;
    if (mesh.visible !== visible) {
      if (visible) {
        const part = this.prepareSurfacePart(name);
        if (part && part.stale) this.rebuildSurfacePart(part);
      }
      mesh.visible = visible;
    }
    return true;
  }

  /**
   * Set which optional parts (hair, brows, garments, base layer, accessories)
   * are worn, in one call. Core parts (body, eyes, lashes) are untouched.
   * Afterwards the skin under the worn garments is dropped from the body and
   * the feet are re-grounded on whatever soles are now on.
   */
  setWorn(names: Iterable<string>, optionalKinds: readonly string[] = OPTIONAL_KINDS): { missing: string[] } {
    const want = new Set(names);
    const missing: string[] = [];
    for (const name of want) if (!this.parts.has(name)) missing.push(name);
    for (const [name] of this.parts) {
      const kind = this.partInfo.get(name)?.kind ?? "";
      if (!optionalKinds.includes(kind)) continue;
      this.setPartVisible(name, want.has(name));
    }
    this.refreshBodyMask();
    this.ground();
    return { missing };
  }

  /**
   * Drop the body triangles that sit safely under the visible garments. The
   * build records, per garment, which body vertices are covered and well back
   * from every hem; a triangle goes only when all three of its corners are.
   */
  refreshBodyMask(): void {
    const body = this.bodyMesh;
    if (!body || !this.bodyMhid || !this.bodyIndex0) return;
    const runs: number[][] = [];
    const keyParts: string[] = [];
    for (const [name, mesh] of this.parts) {
      if (!mesh.visible) continue;
      const hides = this.partInfo.get(name)?.hides as number[][] | undefined;
      if (hides && hides.length) {
        runs.push(...hides);
        keyParts.push(name);
      }
    }
    const key = keyParts.join("|");
    if (key === this.maskKey) return;
    this.maskKey = key;
    const src = this.bodyIndex0;
    let out: ArrayLike<number> = src;
    if (runs.length) {
      const hidden = new Uint8Array(this.basis0.length / 3);
      for (const [a, b] of runs) hidden.fill(1, a, b);
      const mhid = this.bodyMhid;
      const kept: number[] = [];
      for (let t = 0; t < src.length; t += 3) {
        if (hidden[mhid[src[t]]] && hidden[mhid[src[t + 1]]] && hidden[mhid[src[t + 2]]]) continue;
        kept.push(src[t], src[t + 1], src[t + 2]);
      }
      out = kept;
    }
    const count = (body.geometry.getAttribute("position") as THREE.BufferAttribute).count;
    body.geometry.setIndex(new THREE.BufferAttribute(count > 65535 ? Uint32Array.from(out) : Uint16Array.from(out), 1));
  }

  /** Names of parts of one kind, in asset order. */
  partsOfKind(kind: string): string[] {
    return this.manifest.parts.filter((p) => p.kind === kind).map((p) => p.name);
  }

  /** Bone rotations in radians (XYZ Euler). Bones not named return to rest. */
  setPose(pose: Pose): void {
    for (const bone of this.bones) {
      const r = pose[bone.name];
      if (r) bone.rotation.set(r[0], r[1], r[2]);
      else bone.rotation.set(0, 0, 0);
    }
  }

  bone(name: string): THREE.Bone | undefined {
    const i = this.manifest.joints.indexOf(name);
    return i >= 0 ? this.bones[i] : undefined;
  }

  /** Materials tagged with a role by the build (skin, iris, hair, ...). */
  materialsByRole(role: string): THREE.MeshStandardMaterial[] {
    const out: THREE.MeshStandardMaterial[] = [];
    for (const mesh of this.parts.values()) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if ((m.userData as { role?: string } | undefined)?.role === role && !out.includes(m as THREE.MeshStandardMaterial)) {
          out.push(m as THREE.MeshStandardMaterial);
        }
      }
    }
    return out;
  }

  /**
   * Give every part its own material instance. Call once on a cloned scene:
   * glTF clones share materials, and tinting one avatar must not tint another.
   */
  isolateMaterials(perPartKinds: readonly string[] = ["garment"]): void {
    const shared = new Map<THREE.Material, THREE.Material>();
    for (const [name, mesh] of this.parts) {
      const kind = this.partInfo.get(name)?.kind ?? "";
      const src = mesh.material as THREE.Material;
      if (perPartKinds.includes(kind)) {
        mesh.material = src.clone();
        mesh.material.userData = { ...src.userData };
        this.ownedMaterials.add(mesh.material);
        smoothShade(mesh);
      } else {
        let own = shared.get(src);
        if (!own) {
          own = src.clone();
          own.userData = { ...src.userData };
          this.ownedMaterials.add(own);
          shared.set(src, own);
        }
        mesh.material = own;
        smoothShade(mesh);
      }
    }
  }

  /**
   * Free what this instance copied. Geometry of parts that were never shown
   * still belongs to the loader's cached scene and is left alone - disposing
   * it would blank the same part on every other avatar on screen.
   */
  dispose(): void {
    for (const g of this.ownedGeometries) g.dispose();
    this.ownedGeometries.clear();
    for (const m of this.ownedMaterials) m.dispose();
    this.ownedMaterials.clear();
    for (const sk of this.skeletons) sk.dispose();
  }
}

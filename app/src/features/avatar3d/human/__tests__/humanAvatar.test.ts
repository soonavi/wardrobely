/**
 * The human avatar, end to end: the bundled .glb loaded through three's real
 * GLTFLoader and driven by the real runtime.
 *
 * These tests exist because the previous avatar path had 159 passing tests and
 * had never loaded a model. Nothing here uses a hand-built scene graph: if the
 * asset and the runtime disagree, this is where it shows.
 */
import * as THREE from "three";

import {
  ACCESSORIES,
  DEFAULT_CUSTOMIZATION,
  EYEBROW_STYLES,
  FACIAL_HAIR_STYLES,
  HAIR_STYLES,
} from "../../../creator/customization";
import { GARMENT_TEMPLATES, templatePartName } from "../garmentTemplates";
import { applyHumanLook, buildHumanLook } from "../humanLook";
import { STANCE_POSE } from "../humanPose";
import { HumanRig, type HumanManifest } from "../humanRig";
import { DEFAULT_HUMAN_SHAPE, predictMetrics, resolveShapeWeights } from "../humanShape";
import { loadAvatarScene, readGltfJson } from "./loadAvatar";

const LEGACY_CONTRACT = ["Short", "Tall", "Thin", "Heavy", "ChestSmall", "ChestLarge", "HipNarrow", "HipWide"];

async function makeRig(): Promise<HumanRig> {
  const rig = new HumanRig(await loadAvatarScene());
  rig.isolateMaterials();
  return rig;
}

function positions(rig: HumanRig, part: string): Float32Array {
  const mesh = rig.parts.get(part);
  if (!mesh) throw new Error(`no part ${part}`);
  return (mesh.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
}

function bounds(arr: Float32Array) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < arr.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (arr[i + k] < min[k]) min[k] = arr[i + k];
      if (arr[i + k] > max[k]) max[k] = arr[i + k];
    }
  }
  return { min, max };
}

describe("selv-human.glb (the file)", () => {
  const { json, bytes } = readGltfJson();
  const manifest = json.scenes[0].extras?.selv as HumanManifest;
  const nodeNames = new Set(json.nodes.map((n) => n.name));

  it("needs no decoder a phone cannot run", () => {
    // Draco and meshopt both decode in WebAssembly, which Hermes does not have.
    expect(json.extensionsRequired ?? []).toEqual([]);
    expect(json.extensionsUsed ?? []).toEqual([]);
  });

  it("embeds no textures", () => {
    // Embedded images go through a blob -> base64 -> temp-file path on React
    // Native that is known to be fragile. The avatar is vertex-coloured.
    expect(json.images ?? []).toHaveLength(0);
    expect(json.textures ?? []).toHaveLength(0);
  });

  it("stays inside its size budget", () => {
    expect(bytes).toBeLessThan(16 * 1024 * 1024);
  });

  it("carries a manifest with calibrated targets", () => {
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.joints.length).toBeGreaterThan(20);
    for (const [name, target] of Object.entries(manifest.targets)) {
      expect(target.joints).toHaveLength(manifest.joints.length * 3);
      expect(Number.isFinite(target.metrics.stature)).toBe(true);
      expect(name).toMatch(/^[A-Za-z_]+$/);
    }
    // The units the app's measurement code has always assumed.
    expect(manifest.targets.Tall.metrics.stature).toBeCloseTo(0.12, 3);
    expect(manifest.targets.Short.metrics.stature).toBeCloseTo(-0.12, 3);
    expect(manifest.targets.ChestLarge.metrics.chest).toBeCloseTo(0.09, 2);
    expect(manifest.targets.HipWide.metrics.hip).toBeCloseTo(0.09, 2);
  });

  it("still names the eight targets the original contract fixed", () => {
    for (const name of LEGACY_CONTRACT) expect(manifest.targets[name]).toBeDefined();
  });

  it("has a part for every option the character creator offers", () => {
    for (const { id } of HAIR_STYLES) if (id !== "bald") expect(nodeNames).toContain(`Hair_${id}`);
    for (const { id } of EYEBROW_STYLES) expect(nodeNames).toContain(`Brows_${id}`);
    for (const { id } of FACIAL_HAIR_STYLES) if (id !== "none") expect(nodeNames).toContain(`Beard_${id}`);
    for (const { id } of ACCESSORIES) if (id !== "none") expect(nodeNames).toContain(`Acc_${id}`);
  });

  it("has a mesh for every garment template the app can pick", () => {
    for (const id of GARMENT_TEMPLATES) expect(nodeNames).toContain(templatePartName(id));
    expect(nodeNames).toContain("G_base_top");
    expect(nodeNames).toContain("G_base_bottom");
  });

  it("puts morph targets only on the meshes that are MakeHuman vertices", () => {
    // Hair and garments follow the body by binding, not by carrying targets;
    // a garment with its own targets would be megabytes nobody drives.
    for (const part of manifest.parts) {
      const node = json.nodes.find((n) => n.name === part.name)!;
      const mesh = json.meshes[node.mesh!];
      const hasTargets = !!mesh.primitives[0].targets?.length;
      expect({ part: part.name, hasTargets }).toEqual({ part: part.name, hasTargets: part.follow === "direct" });
      if (part.follow === "surface") {
        expect(Object.keys(mesh.primitives[0].attributes)).toEqual(expect.arrayContaining(["_BIND", "_BINDW"]));
      }
    }
  });
});

describe("HumanRig on the real asset", () => {
  jest.setTimeout(60_000);

  it("starts as a person of ordinary height standing on the ground", async () => {
    const rig = await makeRig();
    expect(rig.statureMetres).toBeGreaterThan(1.55);
    expect(rig.statureMetres).toBeLessThan(1.8);
    const b = bounds(positions(rig, "Body"));
    // Y up, facing +Z, taller than wide.
    expect(b.max[1] - b.min[1]).toBeGreaterThan(b.max[0] - b.min[0]);
    expect(rig.root.position.y + b.min[1]).toBeCloseTo(0, 5);
    // No morph attribute survives: shape is baked on the CPU.
    for (const mesh of rig.parts.values()) {
      expect(Object.keys(mesh.geometry.morphAttributes)).toHaveLength(0);
      expect(mesh.morphTargetInfluences).toBeUndefined();
    }
  });

  it("solves a real height and weight onto the mesh", async () => {
    const rig = await makeRig();
    for (const [frame, heightCm, weightKg] of [[-1, 158, 52], [0, 170, 68], [1, 186, 92], [1, 178, 118]] as const) {
      const weights = resolveShapeWeights({ ...DEFAULT_HUMAN_SHAPE, frame, heightCm, weightKg }, rig.manifest);
      const { unknown } = rig.setShape(weights);
      expect(unknown).toEqual([]);
      // Stature is measured off the reshaped mesh, not predicted.
      expect(rig.statureMetres * 100).toBeGreaterThan(heightCm - 1.5);
      expect(rig.statureMetres * 100).toBeLessThan(heightCm + 1.5);
      const predicted = predictMetrics(weights, rig.manifest);
      const targetBmi = weightKg / (heightCm / 100) ** 2;
      // The heaviest case clamps; everything inside the range must land.
      if (targetBmi < 34) expect(Math.abs(predicted.bmi - targetBmi)).toBeLessThan(0.6);
      for (const v of positions(rig, "Body")) if (!Number.isFinite(v)) throw new Error("NaN in body");
    }
  });

  it("reports target names it does not have instead of ignoring them", async () => {
    const rig = await makeRig();
    expect(rig.setShape({ Tall: 1, NoSuchTarget: 1 }).unknown).toEqual(["NoSuchTarget"]);
  });

  it("carries hair and garments along with every body shape", async () => {
    const rig = await makeRig();
    rig.setWorn(["Hair_longStraight", "G_tee", "G_jeans", "G_sneakers"]);
    rig.setShape({});
    const head0 = bounds(positions(rig, "Hair_longStraight"));
    const tee0 = bounds(positions(rig, "G_tee"));
    const body0 = bounds(positions(rig, "Body"));

    rig.setShape({ Tall: 1.5, Heavy: 1.2 });
    const head1 = bounds(positions(rig, "Hair_longStraight"));
    const tee1 = bounds(positions(rig, "G_tee"));
    const body1 = bounds(positions(rig, "Body"));

    const rise = body1.max[1] - body0.max[1];
    expect(rise).toBeGreaterThan(0.05);
    // Hair top rises with the crown, to within a centimetre.
    expect(Math.abs(head1.max[1] - head0.max[1] - rise)).toBeLessThan(0.01);
    // The tee got wider with the body and still wraps it front to back.
    expect(tee1.max[2] - tee1.min[2]).toBeGreaterThan(tee0.max[2] - tee0.min[2] + 0.02);
    expect(tee1.max[2]).toBeGreaterThan(0);
    for (const v of positions(rig, "G_jeans")) if (!Number.isFinite(v)) throw new Error("NaN in jeans");
  });

  it("rebuilds a garment that was put on after the body changed", async () => {
    const rig = await makeRig();
    rig.setShape({ Heavy: 1.5 });
    rig.setWorn(["G_sweater"]);
    const late = bounds(positions(rig, "G_sweater"));

    const other = await makeRig();
    other.setWorn(["G_sweater"]);
    other.setShape({ Heavy: 1.5 });
    const early = bounds(positions(other, "G_sweater"));
    for (let k = 0; k < 3; k++) {
      expect(late.min[k]).toBeCloseTo(early.min[k], 5);
      expect(late.max[k]).toBeCloseTo(early.max[k], 5);
    }
  });

  it("drops skin under a garment and restores it when the garment comes off", async () => {
    const rig = await makeRig();
    const body = rig.parts.get("Body")!;
    const full = body.geometry.getIndex()!.count;
    rig.setWorn(["G_longsleeve", "G_jeans"]);
    const dressed = body.geometry.getIndex()!.count;
    // Most of the body's triangles are in the face, hands and feet, which
    // stay; the torso, arms and legs under the cloth are what goes.
    expect(dressed).toBeLessThan(full * 0.85);
    rig.setWorn([]);
    expect(body.geometry.getIndex()!.count).toBe(full);
  });

  it("stands on its soles when shoes are on", async () => {
    const rig = await makeRig();
    rig.setWorn([]);
    const barefoot = rig.root.position.y;
    rig.setWorn(["G_boots"]);
    expect(rig.root.position.y).toBeGreaterThan(barefoot + 0.01);
  });

  it("keeps a correct bind pose when reshaped while parented under a rotation", async () => {
    // Regression: the try-on screen spins the avatar on a turntable. A reshape
    // mid-spin used to bake the turntable angle into the inverse bind
    // matrices, and the body came out in the wrong pose after equipping.
    const rig = await makeRig();
    const turntable = new THREE.Group();
    turntable.rotation.y = 1.1;
    turntable.add(rig.root);
    turntable.updateMatrixWorld(true);
    rig.setPose(STANCE_POSE);
    rig.setShape({ Tall: 1 });

    const skinned = rig.parts.get("Body") as THREE.SkinnedMesh;
    const identityRotation = new THREE.Matrix4();
    for (const inverse of skinned.skeleton.boneInverses) {
      const rotationOnly = new THREE.Matrix4().extractRotation(inverse);
      for (let i = 0; i < 16; i++) expect(rotationOnly.elements[i]).toBeCloseTo(identityRotation.elements[i], 6);
    }
    // And the bind translation is the negated joint, in the rig's own space.
    const head = rig.bone("head")!;
    const k = skinned.skeleton.bones.indexOf(head);
    const joint = new THREE.Vector3();
    let node: THREE.Object3D | null = head;
    while (node && (node as THREE.Bone).isBone) {
      joint.add(node.position);
      node = node.parent;
    }
    const t = new THREE.Vector3().setFromMatrixPosition(skinned.skeleton.boneInverses[k]);
    expect(t.x).toBeCloseTo(-joint.x, 5);
    expect(t.y).toBeCloseTo(-joint.y, 5);
    expect(t.z).toBeCloseTo(-joint.z, 5);
  });

  it("does not free geometry that other avatars still share", async () => {
    const a = await makeRig();
    const b = await makeRig();
    const sharedBefore = b.parts.get("Hair_afro")!.geometry;
    const disposed = jest.fn();
    sharedBefore.addEventListener("dispose", disposed);
    a.dispose();
    expect(disposed).not.toHaveBeenCalled();
  });

  it("applies a whole look: parts, colours and shape", async () => {
    const rig = await makeRig();
    const look = buildHumanLook(
      { ...DEFAULT_CUSTOMIZATION, hairStyle: "curly", skinTone: "#5C3521", facialHair: "full", accessories: ["glasses"] },
      { top: { color: "#B5473C", name: "Red hoodie", category: "top" }, bottom: { color: "#22252B", name: "Black jeans", category: "bottom" } },
      { heightCm: 181, weightKg: 77 }
    );
    const { missing, unknownTargets } = applyHumanLook(rig, look);
    expect(missing).toEqual([]);
    expect(unknownTargets).toEqual([]);
    for (const name of ["Hair_curly", "Beard_full", "Acc_glasses", "G_hoodie", "G_jeans", "Brows_natural"]) {
      expect({ name, visible: rig.parts.get(name)!.visible }).toEqual({ name, visible: true });
    }
    // Covered by the hoodie and the jeans, so the base layer comes off.
    expect(rig.parts.get("G_base_top")!.visible).toBe(false);
    expect(rig.parts.get("G_base_bottom")!.visible).toBe(false);
    expect(rig.parts.get("Hair_short")!.visible).toBe(false);
    const skin = rig.materialsByRole("skin")[0];
    expect(`#${skin.color.getHexString()}`.toUpperCase()).toBe("#5C3521");
    const hoodie = rig.parts.get("G_hoodie")!.material as THREE.MeshStandardMaterial;
    expect(`#${hoodie.color.getHexString()}`.toUpperCase()).toBe("#B5473C");
    expect(Math.abs(rig.statureMetres * 100 - 181)).toBeLessThan(1.5);
  });
});

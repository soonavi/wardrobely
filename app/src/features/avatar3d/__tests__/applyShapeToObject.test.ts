import * as THREE from "three";

import { applyShapeToObject, type ShapeParams } from "../bodyModel";

/**
 * ============================================================================
 * applyShapeToObject — the morph-target seam.
 * ============================================================================
 * This function is what the whole human-mesh upgrade turns on, and before this
 * file it had ZERO test coverage: bodyModel.test.ts has 40 tests, none of them
 * touching a morph target. It was unexercised because nothing in the app loads
 * a GLB yet — but "untested until the asset arrives" is how a rig lands and
 * the avatar looks wrong for reasons nobody can localise.
 *
 * No GLB is needed to test it. The function traverses a scene graph looking
 * for `morphTargetDictionary` / `morphTargetInfluences`, so a hand-built
 * THREE.Mesh with those two fields set exercises exactly the production path.
 */

const NEUTRAL: ShapeParams = { height: 0, volume: 0, chest: 0, hip: 0 };

/** A mesh carrying the named morph targets, in the given order. */
function meshWithMorphs(names: string[]): THREE.Mesh {
  const mesh = new THREE.Mesh();
  const dict: Record<string, number> = {};
  names.forEach((name, i) => {
    dict[name] = i;
  });
  mesh.morphTargetDictionary = dict;
  mesh.morphTargetInfluences = names.map(() => 0);
  return mesh;
}

function rootWith(mesh: THREE.Mesh): THREE.Object3D {
  const root = new THREE.Object3D();
  root.add(mesh);
  return root;
}

/** Read one morph's influence by name. */
function influence(mesh: THREE.Mesh, name: string): number {
  const index = mesh.morphTargetDictionary![name];
  return mesh.morphTargetInfluences![index];
}

describe("no morph targets at all — the axis-scale stand-in", () => {
  it("reports the stand-in and scales the root instead", () => {
    const root = new THREE.Object3D();
    root.add(new THREE.Mesh());

    const result = applyShapeToObject(root, { ...NEUTRAL, height: 1 });

    expect(result.usedMorphTargets).toBe(false);
    expect(result.matchedMorphTargets).toEqual([]);
    expect(result.bindings).toEqual([]);
    expect(root.scale.y).toBeGreaterThan(1);
  });

  it("lists every axis as unmatched, because none is blendshape-driven", () => {
    const root = new THREE.Object3D();
    const result = applyShapeToObject(root, NEUTRAL);
    expect([...result.unmatchedAxes].sort()).toEqual([
      "chest",
      "height",
      "hip",
      "volume",
    ]);
  });
});

describe("bidirectional slider (rest at 0.5)", () => {
  it("puts a neutral-named morph at 0.5 when the axis is neutral", () => {
    const mesh = meshWithMorphs(["Weight"]);
    const result = applyShapeToObject(rootWith(mesh), NEUTRAL);

    expect(result.usedMorphTargets).toBe(true);
    expect(influence(mesh, "Weight")).toBe(0.5);
    expect(result.bindings).toContainEqual({
      axis: "volume",
      mode: "bidirectional",
      keys: ["Weight"],
    });
  });

  it("spans the full 0..1 range across the axis", () => {
    const low = meshWithMorphs(["Weight"]);
    applyShapeToObject(rootWith(low), { ...NEUTRAL, volume: -1 });
    expect(influence(low, "Weight")).toBe(0);

    const high = meshWithMorphs(["Weight"]);
    applyShapeToObject(rootWith(high), { ...NEUTRAL, volume: 1 });
    expect(influence(high, "Weight")).toBe(1);
  });

  it("matches names case- and separator-insensitively", () => {
    const mesh = meshWithMorphs(["Chest_Width"]);
    applyShapeToObject(rootWith(mesh), { ...NEUTRAL, chest: 1 });
    expect(influence(mesh, "Chest_Width")).toBe(1);
  });
});

describe("opposing pair (rest at 0) — the bug this fixes", () => {
  it("leaves BOTH poles at zero when the axis is neutral", () => {
    // THE REGRESSION. Before the polarity split, a "Heavy" morph matched the
    // volume list and was driven to (0+1)/2 = 0.5 at rest, so the avatar was
    // permanently half-heavy and no slider position could neutralise it.
    const mesh = meshWithMorphs(["Thin", "Heavy"]);
    const result = applyShapeToObject(rootWith(mesh), NEUTRAL);

    expect(influence(mesh, "Thin")).toBe(0);
    expect(influence(mesh, "Heavy")).toBe(0);
    expect(result.bindings).toContainEqual({
      axis: "volume",
      mode: "pair",
      keys: ["Thin", "Heavy"],
    });
  });

  it("drives only the positive pole above neutral", () => {
    const mesh = meshWithMorphs(["Thin", "Heavy"]);
    applyShapeToObject(rootWith(mesh), { ...NEUTRAL, volume: 1 });
    expect(influence(mesh, "Heavy")).toBe(1);
    expect(influence(mesh, "Thin")).toBe(0);
  });

  it("drives only the negative pole below neutral", () => {
    const mesh = meshWithMorphs(["Thin", "Heavy"]);
    applyShapeToObject(rootWith(mesh), { ...NEUTRAL, volume: -1 });
    expect(influence(mesh, "Thin")).toBe(1);
    expect(influence(mesh, "Heavy")).toBe(0);
  });

  it("never drives both poles at once, at any point on the axis", () => {
    // Two morphs pulling in opposite directions simultaneously is the visual
    // artefact a pair rig exists to avoid; assert it across the range rather
    // than at the three convenient points.
    for (const volume of [-1, -0.6, -0.2, 0, 0.2, 0.6, 1]) {
      const mesh = meshWithMorphs(["Thin", "Heavy"]);
      applyShapeToObject(rootWith(mesh), { ...NEUTRAL, volume });
      const both = influence(mesh, "Thin") > 0 && influence(mesh, "Heavy") > 0;
      expect(both).toBe(false);
    }
  });
});

describe("unipolar (one direction only)", () => {
  it("rests at 0 rather than 0.5", () => {
    // Same bug as the pair case, in its one-sided form: a lone directional
    // morph conventionally means 0 = off.
    const mesh = meshWithMorphs(["Heavy"]);
    const result = applyShapeToObject(rootWith(mesh), NEUTRAL);

    expect(influence(mesh, "Heavy")).toBe(0);
    expect(result.bindings).toContainEqual({
      axis: "volume",
      mode: "unipolar",
      keys: ["Heavy"],
    });
  });

  it("ramps a positive-only morph upward and ignores the other half", () => {
    const up = meshWithMorphs(["Heavy"]);
    applyShapeToObject(rootWith(up), { ...NEUTRAL, volume: 1 });
    expect(influence(up, "Heavy")).toBe(1);

    const down = meshWithMorphs(["Heavy"]);
    applyShapeToObject(rootWith(down), { ...NEUTRAL, volume: -1 });
    // The rig cannot express "thinner than neutral". Clamping to 0 is the
    // honest answer; driving it would make thin and heavy look identical.
    expect(influence(down, "Heavy")).toBe(0);
  });

  it("ramps a negative-only morph on the negative half", () => {
    const mesh = meshWithMorphs(["Thin"]);
    applyShapeToObject(rootWith(mesh), { ...NEUTRAL, volume: -1 });
    expect(influence(mesh, "Thin")).toBe(1);

    const other = meshWithMorphs(["Thin"]);
    applyShapeToObject(rootWith(other), { ...NEUTRAL, volume: 1 });
    expect(influence(other, "Thin")).toBe(0);
  });
});

describe("precedence", () => {
  it("prefers a bidirectional slider over an opposing pair", () => {
    // Deliberate, and the reasoning is asymmetric-failure: an undriven morph
    // sits at 0, which is neutral for a directional morph but a hard extreme
    // for a bidirectional one. Driving the slider and leaving the pair at 0 is
    // safe; the reverse pins the slider at its thinnest extreme.
    const mesh = meshWithMorphs(["Thin", "Heavy", "Weight"]);
    const result = applyShapeToObject(rootWith(mesh), NEUTRAL);

    expect(influence(mesh, "Weight")).toBe(0.5);
    expect(influence(mesh, "Thin")).toBe(0);
    expect(influence(mesh, "Heavy")).toBe(0);
    expect(result.bindings).toContainEqual({
      axis: "volume",
      mode: "bidirectional",
      keys: ["Weight"],
    });
  });

  it("claims BodyFat as a bidirectional slider, not as positive 'fat'", () => {
    // Guards the candidate-ordering note on the table: matching is
    // name-contains-candidate, so "bodyfat" has to be claimed by the neutral
    // list before the positive list's "fat" can reach it.
    const mesh = meshWithMorphs(["BodyFat"]);
    const result = applyShapeToObject(rootWith(mesh), NEUTRAL);
    expect(influence(mesh, "BodyFat")).toBe(0.5);
    expect(result.bindings).toContainEqual({
      axis: "volume",
      mode: "bidirectional",
      keys: ["BodyFat"],
    });
  });

  it("still treats a plainly-named Fat morph as a positive pole", () => {
    const mesh = meshWithMorphs(["Fat"]);
    const result = applyShapeToObject(rootWith(mesh), NEUTRAL);
    expect(influence(mesh, "Fat")).toBe(0);
    expect(result.bindings).toContainEqual({
      axis: "volume",
      mode: "unipolar",
      keys: ["Fat"],
    });
  });
});

describe("chest and hip pairs — reachable only with longest-match classification", () => {
  // REGRESSION. With list-order classification (neutral checked first), these
  // were unreachable: "chestsmall" contains the neutral candidate "chest", so
  // the pair read as a bidirectional control on ChestSmall and rested at 0.5 —
  // the opposing-pair bug, reintroduced for exactly the two axes whose pole
  // names are supersets of their neutral name.
  it("detects a chest pair and rests both poles at zero", () => {
    const mesh = meshWithMorphs(["ChestSmall", "ChestLarge"]);
    const result = applyShapeToObject(rootWith(mesh), NEUTRAL);

    expect(influence(mesh, "ChestSmall")).toBe(0);
    expect(influence(mesh, "ChestLarge")).toBe(0);
    expect(result.bindings).toContainEqual({
      axis: "chest",
      mode: "pair",
      keys: ["ChestSmall", "ChestLarge"],
    });
  });

  it("detects a hip pair", () => {
    const mesh = meshWithMorphs(["HipNarrow", "HipWide"]);
    const result = applyShapeToObject(rootWith(mesh), NEUTRAL);

    expect(influence(mesh, "HipNarrow")).toBe(0);
    expect(influence(mesh, "HipWide")).toBe(0);
    expect(result.bindings).toContainEqual({
      axis: "hip",
      mode: "pair",
      keys: ["HipNarrow", "HipWide"],
    });
  });

  it("drives a chest pair differentially", () => {
    const up = meshWithMorphs(["ChestSmall", "ChestLarge"]);
    applyShapeToObject(rootWith(up), { ...NEUTRAL, chest: 1 });
    expect(influence(up, "ChestLarge")).toBe(1);
    expect(influence(up, "ChestSmall")).toBe(0);

    const down = meshWithMorphs(["ChestSmall", "ChestLarge"]);
    applyShapeToObject(rootWith(down), { ...NEUTRAL, chest: -1 });
    expect(influence(down, "ChestSmall")).toBe(1);
    expect(influence(down, "ChestLarge")).toBe(0);
  });

  it("still reads a lone generic Chest morph as bidirectional", () => {
    // The specificity rule must not break the simple case it coexists with.
    const mesh = meshWithMorphs(["Chest"]);
    const result = applyShapeToObject(rootWith(mesh), NEUTRAL);
    expect(influence(mesh, "Chest")).toBe(0.5);
    expect(result.bindings).toContainEqual({
      axis: "chest",
      mode: "bidirectional",
      keys: ["Chest"],
    });
  });

  it("prefers a generic Chest control when a rig offers it alongside a pair", () => {
    // Selection precedence is unchanged by the classification fix: an undriven
    // morph rests at 0, neutral for a pole and extreme for a slider.
    const mesh = meshWithMorphs(["Chest", "ChestSmall", "ChestLarge"]);
    const result = applyShapeToObject(rootWith(mesh), NEUTRAL);

    expect(influence(mesh, "Chest")).toBe(0.5);
    expect(influence(mesh, "ChestSmall")).toBe(0);
    expect(influence(mesh, "ChestLarge")).toBe(0);
    expect(result.bindings).toContainEqual({
      axis: "chest",
      mode: "bidirectional",
      keys: ["Chest"],
    });
  });

  it("reads Overweight as a positive pole, not as neutral 'weight'", () => {
    // "overweight" (10 chars) beats "weight" (6). Under list-order
    // classification this rested at 0.5 and looked permanently heavy.
    const mesh = meshWithMorphs(["Underweight", "Overweight"]);
    const result = applyShapeToObject(rootWith(mesh), NEUTRAL);

    expect(influence(mesh, "Overweight")).toBe(0);
    expect(influence(mesh, "Underweight")).toBe(0);
    expect(result.bindings).toContainEqual({
      axis: "volume",
      mode: "pair",
      keys: ["Underweight", "Overweight"],
    });
  });
});

describe("partial rigs", () => {
  it("reports the axes a rig expresses nothing for", () => {
    const mesh = meshWithMorphs(["Height", "Weight"]);
    const result = applyShapeToObject(rootWith(mesh), NEUTRAL);

    expect([...result.unmatchedAxes].sort()).toEqual(["chest", "hip"]);
    expect(result.bindings.map((b) => b.axis).sort()).toEqual(["height", "volume"]);
  });

  it("leaves unrelated morphs completely alone", () => {
    // A face rig shares the dictionary with the body on many assets. Touching
    // a blink or a jaw morph because its name happened to brush a candidate
    // would be a visible, baffling bug.
    const mesh = meshWithMorphs(["Height", "EyeBlinkLeft", "JawOpen"]);
    applyShapeToObject(rootWith(mesh), { ...NEUTRAL, height: 1 });

    expect(influence(mesh, "EyeBlinkLeft")).toBe(0);
    expect(influence(mesh, "JawOpen")).toBe(0);
  });
});

describe("multiple meshes", () => {
  it("drives every mesh that carries a matching morph", () => {
    // Bodies are routinely split across meshes (body / head / hands), each
    // with its own copy of the shape blendshapes. Driving only the first would
    // tear the model apart at the seams.
    const body = meshWithMorphs(["Weight"]);
    const head = meshWithMorphs(["Weight"]);
    const root = new THREE.Object3D();
    root.add(body);
    root.add(head);

    applyShapeToObject(root, { ...NEUTRAL, volume: 1 });

    expect(influence(body, "Weight")).toBe(1);
    expect(influence(head, "Weight")).toBe(1);
  });

  it("finds morphs on deeply nested meshes", () => {
    // GLB exporters nest arbitrarily; the traversal has to be depth-first over
    // the whole graph, not a children scan.
    const mesh = meshWithMorphs(["Weight"]);
    const inner = new THREE.Object3D();
    inner.add(mesh);
    const outer = new THREE.Object3D();
    outer.add(inner);
    const root = new THREE.Object3D();
    root.add(outer);

    const result = applyShapeToObject(root, { ...NEUTRAL, volume: 1 });

    expect(result.usedMorphTargets).toBe(true);
    expect(influence(mesh, "Weight")).toBe(1);
  });
});

describe("idempotence and cleanup", () => {
  it("resets a leftover stand-in scale when a real rig is found", () => {
    // Matters if a root is reused across a GLB swap without a full remount:
    // a stale non-uniform scale on top of morph-driven geometry is a distorted
    // body that looks like a bad rig rather than a stale transform.
    const root = new THREE.Object3D();
    root.scale.set(1.3, 0.8, 1.2);
    root.add(meshWithMorphs(["Weight"]));

    applyShapeToObject(root, NEUTRAL);

    expect(root.scale.x).toBe(1);
    expect(root.scale.y).toBe(1);
    expect(root.scale.z).toBe(1);
  });

  it("is stable when applied repeatedly with the same params", () => {
    const mesh = meshWithMorphs(["Thin", "Heavy"]);
    const root = rootWith(mesh);

    applyShapeToObject(root, { ...NEUTRAL, volume: 0.5 });
    const first = [influence(mesh, "Thin"), influence(mesh, "Heavy")];
    applyShapeToObject(root, { ...NEUTRAL, volume: 0.5 });
    const second = [influence(mesh, "Thin"), influence(mesh, "Heavy")];

    expect(second).toEqual(first);
  });

  it("returns to the rest pose when the axis returns to neutral", () => {
    // The slider has to be reversible. A morph that only ever ratchets upward
    // would mean dragging a control and being unable to undo it.
    const mesh = meshWithMorphs(["Thin", "Heavy"]);
    const root = rootWith(mesh);

    applyShapeToObject(root, { ...NEUTRAL, volume: 1 });
    expect(influence(mesh, "Heavy")).toBe(1);

    applyShapeToObject(root, NEUTRAL);
    expect(influence(mesh, "Heavy")).toBe(0);
    expect(influence(mesh, "Thin")).toBe(0);
  });
});

describe("out-of-range input", () => {
  it("never drives an influence outside 0..1", () => {
    // morphTargetInfluences outside 0..1 extrapolates the blendshape and
    // produces torn geometry. applyShapeToObject clamps its params, so this
    // asserts the clamp actually reaches the influence write.
    const inputs: ShapeParams[] = [
      { height: 9, volume: 9, chest: 9, hip: 9 },
      { height: -9, volume: -9, chest: -9, hip: -9 },
    ];
    for (const params of inputs) {
      const mesh = meshWithMorphs(["Height", "Weight", "Chest", "Hip"]);
      applyShapeToObject(rootWith(mesh), params);
      for (const value of mesh.morphTargetInfluences!) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("clamps a pair rig's poles too", () => {
    const mesh = meshWithMorphs(["Thin", "Heavy"]);
    applyShapeToObject(rootWith(mesh), { ...NEUTRAL, volume: 9 });
    expect(influence(mesh, "Heavy")).toBe(1);
    expect(influence(mesh, "Thin")).toBe(0);
  });
});

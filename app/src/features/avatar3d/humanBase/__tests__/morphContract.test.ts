import * as THREE from "three";

import { applyShapeToObject, type ShapeParams } from "../../bodyModel";
import contract from "../morphContract.json";

/**
 * ============================================================================
 * The export pipeline's naming contract, asserted against the real matcher.
 * ============================================================================
 * `tools/avatar-export/morph_contract.json` declares the morph target names
 * the GLB will carry. `bodyModel.ts` decides which body axis each name drives,
 * by name. Nothing at runtime connects those two facts.
 *
 * If they drift, `applyShapeToObject` finds nothing, silently falls back to
 * whole-mesh axis scaling, and the avatar still responds to every slider — by
 * stretching geometry instead of deforming a body. It looks like it works.
 * That is exactly the state the mesh upgrade exists to escape, and a typo in
 * either file reintroduces it.
 *
 * So the contract is executable here: every declared name goes through the
 * production matcher, and this fails in CI the moment either side moves. It
 * needs no GLB and no Anny install, which is the point — the contract is
 * verifiable long before the asset exists.
 */

interface ContractPole {
  morphTarget: string;
  annyPhenotype: string;
  value: number;
}
interface ContractAxis {
  axis: keyof ShapeParams;
  mode: "pair" | "bidirectional" | "unipolar";
  negative: ContractPole;
  positive: ContractPole;
}

const AXES = (contract as unknown as { axes: ContractAxis[] }).axes;
const NEUTRAL: ShapeParams = { height: 0, volume: 0, chest: 0, hip: 0 };

/** A mesh carrying exactly the morph targets the pipeline will emit. */
function exportedMesh(): THREE.Mesh {
  const names = AXES.flatMap((a) => [a.negative.morphTarget, a.positive.morphTarget]);
  const mesh = new THREE.Mesh();
  const dict: Record<string, number> = {};
  names.forEach((n, i) => {
    dict[n] = i;
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

function influence(mesh: THREE.Mesh, name: string): number {
  return mesh.morphTargetInfluences![mesh.morphTargetDictionary![name]];
}

describe("contract shape", () => {
  it("covers all four axes the app drives, exactly once each", () => {
    expect(AXES.map((a) => a.axis).sort()).toEqual([
      "chest",
      "height",
      "hip",
      "volume",
    ]);
  });

  it("declares every axis as a pair", () => {
    // The base mesh is neutral, so all-zero influences have to be a rest pose.
    // A bidirectional axis would require the base to be one extreme.
    for (const axis of AXES) {
      expect(axis.mode).toBe("pair");
    }
  });

  it("uses a distinct morph target name for every pole", () => {
    const names = AXES.flatMap((a) => [a.negative.morphTarget, a.positive.morphTarget]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("every declared name binds to the axis it claims", () => {
  it.each(AXES.map((a) => [a.axis, a] as const))(
    "%s binds as a pair on the declared poles",
    (_label, axis) => {
      const mesh = exportedMesh();
      const result = applyShapeToObject(rootWith(mesh), NEUTRAL);

      expect(result.bindings).toContainEqual({
        axis: axis.axis,
        mode: axis.mode,
        keys: [axis.negative.morphTarget, axis.positive.morphTarget],
      });
    },
  );

  it("leaves no axis unbound", () => {
    // An unbound axis is a dimension of the user's body the avatar cannot
    // reflect, and the only outward sign is a slider that does nothing.
    const result = applyShapeToObject(rootWith(exportedMesh()), NEUTRAL);
    expect(result.unmatchedAxes).toEqual([]);
  });

  it("drives real morph targets rather than falling back to axis scaling", () => {
    const result = applyShapeToObject(rootWith(exportedMesh()), NEUTRAL);
    expect(result.usedMorphTargets).toBe(true);
  });
});

describe("the exported rig behaves correctly once driven", () => {
  it("rests every morph target at zero on a neutral body", () => {
    // The reason pairs were chosen. All-zero influences must be a person.
    const mesh = exportedMesh();
    applyShapeToObject(rootWith(mesh), NEUTRAL);

    for (const value of mesh.morphTargetInfluences!) {
      expect(value).toBe(0);
    }
  });

  it("drives only the positive pole of each axis at +1", () => {
    for (const axis of AXES) {
      const mesh = exportedMesh();
      applyShapeToObject(rootWith(mesh), { ...NEUTRAL, [axis.axis]: 1 });

      expect(influence(mesh, axis.positive.morphTarget)).toBe(1);
      expect(influence(mesh, axis.negative.morphTarget)).toBe(0);
    }
  });

  it("drives only the negative pole of each axis at -1", () => {
    for (const axis of AXES) {
      const mesh = exportedMesh();
      applyShapeToObject(rootWith(mesh), { ...NEUTRAL, [axis.axis]: -1 });

      expect(influence(mesh, axis.negative.morphTarget)).toBe(1);
      expect(influence(mesh, axis.positive.morphTarget)).toBe(0);
    }
  });

  it("keeps each axis independent", () => {
    // Driving height must not disturb chest. A name that accidentally matched
    // two axes' candidate lists would show up here and nowhere else.
    const mesh = exportedMesh();
    applyShapeToObject(rootWith(mesh), { ...NEUTRAL, height: 1 });

    const heightAxis = AXES.find((a) => a.axis === "height")!;
    for (const axis of AXES) {
      if (axis.axis === heightAxis.axis) continue;
      expect(influence(mesh, axis.positive.morphTarget)).toBe(0);
      expect(influence(mesh, axis.negative.morphTarget)).toBe(0);
    }
  });
});

describe("naming hazards the contract documents", () => {
  it("would MISS a name that collides with a neutral candidate", () => {
    // Guards the contract's own warning about "HeightShort": it contains the
    // neutral candidate "height", so it reads as a bidirectional slider and
    // rests at 0.5 — a permanently half-short avatar. Asserted so the hazard
    // stays true rather than becoming folklore.
    const mesh = new THREE.Mesh();
    mesh.morphTargetDictionary = { HeightShort: 0, HeightTall: 1 };
    mesh.morphTargetInfluences = [0, 0];

    const result = applyShapeToObject(rootWith(mesh), NEUTRAL);
    const heightBinding = result.bindings.find((b) => b.axis === "height");

    expect(heightBinding?.mode).toBe("bidirectional");
    expect(mesh.morphTargetInfluences[0]).toBe(0.5);
  });

  it("confirms the chosen names avoid that collision", () => {
    const mesh = exportedMesh();
    applyShapeToObject(rootWith(mesh), NEUTRAL);
    expect(mesh.morphTargetInfluences).not.toContain(0.5);
  });
});

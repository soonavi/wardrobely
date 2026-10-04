import * as THREE from "three";

import { formatHumanBaseReport, inspectHumanBase } from "../inspectHumanBase";

/**
 * Every requirement in humanBaseAsset.ts fails in a way that still renders
 * something plausible, which is why they are checked in code. These tests
 * build the failure modes deliberately.
 */

/** A box mesh with a real position attribute, so extents and triangles work. */
function boxMesh(width: number, height: number, depth: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth));
}

function withMorphs(mesh: THREE.Mesh, names: string[]): THREE.Mesh {
  const dict: Record<string, number> = {};
  names.forEach((n, i) => {
    dict[n] = i;
  });
  mesh.morphTargetDictionary = dict;
  mesh.morphTargetInfluences = names.map(() => 0);
  return mesh;
}

/** A mesh that passes as skinned, with a skeleton present. */
function asSkinned(mesh: THREE.Mesh): THREE.Mesh {
  const skinned = mesh as THREE.Mesh & { isSkinnedMesh: boolean; skeleton: unknown };
  skinned.isSkinnedMesh = true;
  skinned.skeleton = new THREE.Skeleton([]);
  return skinned;
}

function sceneOf(...meshes: THREE.Mesh[]): THREE.Object3D {
  const root = new THREE.Object3D();
  for (const m of meshes) root.add(m);
  return root;
}

/** A fully compliant asset: Y-up, blendshapes on all four axes, skinned. */
function goodAsset(): THREE.Object3D {
  const body = asSkinned(
    withMorphs(boxMesh(0.5, 1.7, 0.3), ["Height", "Weight", "Chest", "Hips"]),
  );
  return sceneOf(body);
}

describe("a compliant asset", () => {
  it("passes with no blocking findings", () => {
    const report = inspectHumanBase(goodAsset());
    expect(report.ok).toBe(true);
    expect(report.findings.filter((f) => f.severity === "blocking")).toEqual([]);
  });

  it("reports all four axes bound and none unmatched", () => {
    const report = inspectHumanBase(goodAsset());
    expect(report.bindings.map((b) => b.axis).sort()).toEqual([
      "chest",
      "height",
      "hip",
      "volume",
    ]);
    expect(report.unmatchedAxes).toEqual([]);
    expect(report.usedMorphTargets).toBe(true);
  });

  it("sees the skeleton", () => {
    expect(inspectHumanBase(goodAsset()).hasSkeleton).toBe(true);
  });

  it("counts geometry", () => {
    const report = inspectHumanBase(goodAsset());
    expect(report.meshCount).toBe(1);
    expect(report.triangleCount).toBe(12); // a box is 12 triangles
    expect(report.morphTargetCount).toBe(4);
  });
});

describe("requirement 2 — blendshapes", () => {
  it("blocks an asset with no morph targets at all", () => {
    // The quiet failure: applyShapeToObject falls back to axis scaling, the
    // avatar still moves when a slider moves, and the upgrade bought nothing.
    const report = inspectHumanBase(sceneOf(asSkinned(boxMesh(0.5, 1.7, 0.3))));

    expect(report.ok).toBe(false);
    expect(report.usedMorphTargets).toBe(false);
    expect(
      report.findings.some((f) => f.severity === "blocking" && f.requirement === 2),
    ).toBe(true);
  });

  it("warns, but does not block, on a partially-bound rig", () => {
    // A rig with height and weight but no chest or hip is usable; it just
    // cannot reflect two dimensions. That is a judgement call for Ben, not a
    // refusal for the validator.
    const report = inspectHumanBase(
      sceneOf(asSkinned(withMorphs(boxMesh(0.5, 1.7, 0.3), ["Height", "Weight"]))),
    );

    expect(report.ok).toBe(true);
    expect([...report.unmatchedAxes].sort()).toEqual(["chest", "hip"]);
    expect(
      report.findings.some((f) => f.severity === "warning" && f.requirement === 2),
    ).toBe(true);
  });
});

describe("requirement 4 — a skeleton garments can skin to", () => {
  it("blocks an asset with morph targets but no skeleton", () => {
    // The expensive one. Garments parent fine under the axis-scale fallback,
    // so this only breaks once blendshapes start working — later than the
    // change that caused it.
    const report = inspectHumanBase(
      sceneOf(withMorphs(boxMesh(0.5, 1.7, 0.3), ["Height", "Weight", "Chest", "Hips"])),
    );

    expect(report.ok).toBe(false);
    expect(report.hasSkeleton).toBe(false);
    expect(
      report.findings.some((f) => f.severity === "blocking" && f.requirement === 4),
    ).toBe(true);
  });

  it("accepts a skeleton on any mesh in the graph, not just the first", () => {
    const plain = withMorphs(boxMesh(0.2, 0.2, 0.2), ["Height"]);
    const skinned = asSkinned(withMorphs(boxMesh(0.5, 1.7, 0.3), ["Weight"]));
    expect(inspectHumanBase(sceneOf(plain, skinned)).hasSkeleton).toBe(true);
  });
});

describe("requirement 5 — orientation", () => {
  it("warns when the dominant extent is not Y", () => {
    // A Z-up asset: normalizeSceneToHeight scales it to the height of its own
    // depth and grounds it, so it renders lying down at a plausible size.
    const zUp = asSkinned(withMorphs(boxMesh(0.5, 0.3, 1.7), ["Height", "Weight"]));
    const report = inspectHumanBase(sceneOf(zUp));

    const finding = report.findings.find((f) => f.requirement === 5);
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("warning");
    expect(finding!.message).toContain("Z");
  });

  it("does not warn on a Y-dominant asset", () => {
    const report = inspectHumanBase(goodAsset());
    expect(report.findings.some((f) => f.requirement === 5)).toBe(false);
  });

  it("reports raw extents so the caller can judge for itself", () => {
    const report = inspectHumanBase(goodAsset());
    expect(report.extents.y).toBeCloseTo(1.7, 5);
    expect(report.extents.x).toBeCloseTo(0.5, 5);
    expect(report.extents.z).toBeCloseTo(0.3, 5);
  });
});

describe("requirement 6 — budget", () => {
  it("warns above the triangle budget without blocking", () => {
    // A heavy mesh is a measurement problem, not a correctness one. Blocking
    // would be the validator pretending to know how the device performs.
    const dense = asSkinned(
      withMorphs(
        new THREE.Mesh(new THREE.SphereGeometry(1, 220, 220)),
        ["Height", "Weight", "Chest", "Hips"],
      ),
    );
    const report = inspectHumanBase(sceneOf(dense));

    expect(report.triangleCount).toBeGreaterThan(50_000);
    expect(report.ok).toBe(true);
    const finding = report.findings.find((f) => f.requirement === 6);
    expect(finding?.severity).toBe("warning");
  });

  it("warns on a face rig's worth of unused morph targets", () => {
    const manyMorphs = Array.from({ length: 80 }, (_, i) => `Expression_${i}`);
    const mesh = asSkinned(
      withMorphs(boxMesh(0.5, 1.7, 0.3), ["Height", "Weight", ...manyMorphs]),
    );
    const report = inspectHumanBase(sceneOf(mesh));

    expect(report.ok).toBe(true);
    expect(
      report.findings.some(
        (f) => f.requirement === 6 && f.message.includes("morph targets"),
      ),
    ).toBe(true);
  });
});

describe("degenerate input", () => {
  it("blocks an empty scene rather than throwing", () => {
    const report = inspectHumanBase(new THREE.Object3D());
    expect(report.ok).toBe(false);
    expect(report.meshCount).toBe(0);
    expect(
      report.findings.some((f) => f.severity === "blocking" && f.requirement === 1),
    ).toBe(true);
  });

  it("survives a mesh with no geometry attributes", () => {
    // A scene graph can legitimately hold an empty placeholder mesh; a
    // validator that crashes on one is less useful than one reporting zero.
    const empty = new THREE.Mesh();
    expect(() => inspectHumanBase(sceneOf(empty))).not.toThrow();
    const report = inspectHumanBase(sceneOf(new THREE.Mesh()));
    expect(report.triangleCount).toBe(0);
    expect(report.extents).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("side effects", () => {
  it("leaves the rig in its rest pose, not a random one", () => {
    // inspect drives the rig to find the bindings; applying neutral params
    // means an asset inspected just before render is not left mid-slider.
    const mesh = asSkinned(withMorphs(boxMesh(0.5, 1.7, 0.3), ["Thin", "Heavy"]));
    inspectHumanBase(sceneOf(mesh));

    // A pair rig rests at 0/0 — see applyShapeToObject.test.ts.
    expect(mesh.morphTargetInfluences).toEqual([0, 0]);
  });
});

describe("formatHumanBaseReport", () => {
  it("leads with the verdict", () => {
    expect(formatHumanBaseReport(inspectHumanBase(goodAsset()))).toMatch(/^USABLE/);
    expect(formatHumanBaseReport(inspectHumanBase(new THREE.Object3D()))).toMatch(
      /^NOT USABLE/,
    );
  });

  it("names each axis binding and its mode", () => {
    const text = formatHumanBaseReport(inspectHumanBase(goodAsset()));
    expect(text).toContain("height: bidirectional via Height");
    expect(text).toContain("volume: bidirectional via Weight");
  });

  it("calls out a missing skeleton in the summary line", () => {
    const noSkeleton = sceneOf(
      withMorphs(boxMesh(0.5, 1.7, 0.3), ["Height", "Weight", "Chest", "Hips"]),
    );
    expect(formatHumanBaseReport(inspectHumanBase(noSkeleton))).toContain(
      "skeleton: NO",
    );
  });
});

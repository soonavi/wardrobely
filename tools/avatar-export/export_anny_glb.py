#!/usr/bin/env python3
"""
Anny -> GLB export pipeline for Selv's avatar.

Produces `base-human.glb`: a neutral human base mesh carrying exactly the eight
morph targets `app/src/features/avatar3d/humanBase/morphContract.json` declares,
plus the skeleton and skin weights garments need to be skinned to.

================================================================================
THIS SCRIPT HAS NEVER RUN END TO END.
================================================================================
Anny is not installed here and no GLB has been produced. What IS verified is the
part that could be: the naming contract is asserted from the TypeScript side by
humanBase/__tests__/morphContract.test.ts (15 tests, every declared name fed
through the production matcher), and `--self-check` below re-validates it from
this side without needing Anny or torch.

Treat the Anny API calls and the glTF assembly as unproven. They fail loudly by
design — every lookup that could be wrong raises with what it actually found,
rather than exporting a mesh with two of the four axes flat.

================================================================================
LICENSING — READ BEFORE RUNNING
================================================================================
Anny's licensing is MIXED (see AVATAR_MESH_SHORTLIST.md):

    Python code .................. Apache 2.0
    MakeHuman assets (mpfb2) ..... CC0 1.0      <- what we ship
    SOMA topology ................ Apache 2.0
    SMPL-X topology .............. NON-COMMERCIAL ONLY

Selv is a commercial app, so the SMPL-X topology is off limits. `assert_topology_is_licensed`
refuses to proceed on it rather than leaving that to whoever runs this — the
cost of getting it wrong is discovering it after avatars are saved against a
topology's blendshape names.

================================================================================
USAGE
================================================================================
    # Validate the contract. No Anny, no torch, no network.
    python3 export_anny_glb.py --self-check

    # Full export (needs: pip install -r requirements.txt, plus Anny).
    python3 export_anny_glb.py --out ../../app/assets/avatar/base-human.glb

Then, in the app:
    1. Point HUMAN_BASE_SOURCE at the file in humanBaseAsset.ts.
    2. Run inspectHumanBase() on it and fix anything it reports as blocking.
    3. Confirm onShapeApplied reports usedMorphTargets: true. False means the
       asset loaded and is being whole-mesh scaled, i.e. doing what the
       primitives already did.
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path
from typing import Any

CONTRACT_PATH = (
    Path(__file__).resolve().parents[2]
    / "app/src/features/avatar3d/humanBase/morphContract.json"
)

# Topology names that may not be shipped commercially.
#
# Normalized to lowercase alphanumerics before matching, so "SMPL-X", "smpl_x"
# and "smplx" all collapse to "smplx" and a single entry catches them.
#
# BARE "smpl" IS LISTED SEPARATELY AND DELIBERATELY. Anny offers `smplx`,
# `smpl` AND `soma` retopologies. An earlier version of this list held only the
# smplx spellings, which meant `topology="smpl"` sailed straight through the
# guard — SMPL is the same Max Planck lineage as SMPL-X, patented and licensed
# for research, so that was the exact hole this function exists to close.
# `soma` is NOT here: it is adapted from NVlabs/SOMA-X under Apache 2.0.
FORBIDDEN_TOPOLOGY_SUBSTRINGS = ("smplx", "smpl")

# Mirrors inspectHumanBase.ts. Warnings, never fatal — a heavy mesh is a
# measurement problem and the only honest verdict comes from a real device.
TRIANGLE_WARN = 50_000


# ---------------------------------------------------------------------------
# Contract
# ---------------------------------------------------------------------------


def load_contract(path: Path | None = None) -> dict[str, Any]:
    """
    Read the contract.

    `path` is resolved at call time, not bound as a default argument. A default
    of `CONTRACT_PATH` would be evaluated once at import and could never be
    overridden — which made the validator untestable, and was caught by a test
    that reported five deliberately-broken contracts as valid.
    """
    path = path or CONTRACT_PATH
    if not path.exists():
        raise SystemExit(
            f"Contract not found at {path}.\n"
            "It lives inside app/ deliberately, next to the matcher it has to "
            "agree with and where tsc and the bundler can both see it."
        )
    with path.open() as handle:
        return json.load(handle)


def self_check(contract: dict[str, Any]) -> list[str]:
    """
    Validate the contract without Anny.

    Deliberately duplicates part of what morphContract.test.ts asserts. The
    TypeScript test is authoritative — it runs the real matcher — but it cannot
    catch a contract that is malformed in ways only this script cares about
    (a missing phenotype field, a pole value outside 0..1), and a Python-side
    failure is the one someone running an export will actually see.
    """
    problems: list[str] = []
    axes = contract.get("axes")

    if not isinstance(axes, list) or not axes:
        return ["`axes` is missing or empty."]

    expected_axes = {"height", "volume", "chest", "hip"}
    seen_axes: set[str] = set()
    seen_names: set[str] = set()

    for entry in axes:
        axis = entry.get("axis")
        if axis not in expected_axes:
            problems.append(f"Unknown axis {axis!r}; the app drives {sorted(expected_axes)}.")
        if axis in seen_axes:
            problems.append(f"Axis {axis!r} declared more than once.")
        seen_axes.add(axis)

        if entry.get("mode") != "pair":
            problems.append(
                f"Axis {axis!r} is {entry.get('mode')!r}. This pipeline only emits pairs: "
                "the base mesh is neutral, so all-zero influences have to be a rest pose."
            )

        for polarity in ("negative", "positive"):
            pole = entry.get(polarity)
            if not isinstance(pole, dict):
                problems.append(f"Axis {axis!r} has no {polarity} pole.")
                continue

            name = pole.get("morphTarget")
            if not name:
                problems.append(f"Axis {axis!r} {polarity} pole has no morphTarget name.")
            elif name in seen_names:
                problems.append(f"Morph target name {name!r} used twice.")
            else:
                seen_names.add(name)

            if not pole.get("annyPhenotype"):
                problems.append(f"Axis {axis!r} {polarity} pole names no annyPhenotype.")

            value = pole.get("value")
            if not isinstance(value, (int, float)) or not 0.0 <= float(value) <= 1.0:
                problems.append(
                    f"Axis {axis!r} {polarity} pole value {value!r} is outside 0..1 "
                    "(Anny phenotypes are 0..1 with 0.5 neutral)."
                )

    missing = expected_axes - seen_axes
    if missing:
        problems.append(
            f"No declaration for {sorted(missing)}. An undeclared axis is a dimension "
            "of the user's body the avatar cannot reflect, and the only outward sign "
            "is a slider that does nothing."
        )

    return problems


# ---------------------------------------------------------------------------
# Anny
# ---------------------------------------------------------------------------


def assert_topology_is_licensed(topology: str) -> None:
    """
    Refuse a topology Selv may not ship.

    Raises rather than warning. A warning on a build step gets scrolled past,
    and the cost of shipping the wrong topology is not a bug report — it is
    discovering, after users have saved avatars against a mesh layout, that the
    layout was never licensed for a commercial app.
    """
    # Strip separators so smpl-x / smpl_x / SMPL X all normalize to "smplx".
    lowered = "".join(c for c in topology.lower() if c.isalnum())
    for forbidden in FORBIDDEN_TOPOLOGY_SUBSTRINGS:
        if forbidden in lowered:
            raise SystemExit(
                f"REFUSING TO EXPORT: topology {topology!r} is SMPL-X, which Anny "
                "licenses for NON-COMMERCIAL USE ONLY. Selv is a commercial app.\n"
                "Use the anny or makehuman topology — those trace to MakeHuman "
                "assets under CC0. See AVATAR_MESH_SHORTLIST.md."
            )


def resolve_phenotype(model: Any, name: str) -> str:
    """
    Resolve a contract phenotype name against the loaded model.

    The contract's phenotype names are UNVERIFIED against a real install —
    Anny's documented phenotypes include height, weight and muscle, but the
    exact attributes for bust and hip have not been read off one. So this
    resolves case-insensitively and, on a miss, raises listing every phenotype
    the model actually has.

    That failure is the point. A silent fallback would export a GLB whose chest
    and hip morph targets are zero-delta copies of the base mesh: it would load,
    pass a glance, satisfy inspectHumanBase's name checks, and leave two sliders
    doing nothing.
    """
    available = available_phenotypes(model)
    lowered = {p.lower(): p for p in available}

    if name.lower() in lowered:
        return lowered[name.lower()]

    partial = [p for p in available if name.lower() in p.lower()]
    if len(partial) == 1:
        return partial[0]

    raise SystemExit(
        f"Phenotype {name!r} not found on the loaded Anny model.\n"
        f"{'Several candidates: ' + ', '.join(partial) if partial else 'No close match.'}\n"
        f"Available: {', '.join(sorted(available))}\n\n"
        "Update `annyPhenotype` in morphContract.json to a real name. Do NOT drop "
        "the axis — the TypeScript contract test asserts all four are declared."
    )


def available_phenotypes(model: Any) -> list[str]:
    """
    Best-effort list of the model's phenotype axis names.

    Tries the shapes Anny is most likely to expose, in order, and raises rather
    than guessing if none is present — a wrong guess here produces a flat axis,
    which is the failure mode this whole file is arranged to avoid.
    """
    for attribute in ("phenotype_names", "phenotypes", "shape_names"):
        value = getattr(model, attribute, None)
        if value is None:
            continue
        if isinstance(value, dict):
            return list(value.keys())
        if isinstance(value, (list, tuple)):
            return [str(v) for v in value]

    raise SystemExit(
        "Could not find the phenotype list on the Anny model. Tried "
        "phenotype_names, phenotypes, shape_names.\n"
        f"Model attributes: {', '.join(a for a in dir(model) if not a.startswith('_'))}\n\n"
        "Read Anny's API and update available_phenotypes()."
    )


def sample_mesh(model: Any, phenotype: str, value: float) -> Any:
    """One posed mesh's vertex array, as numpy (V, 3)."""
    import numpy as np

    params = {phenotype: float(value)}
    output = model(**params)

    for attribute in ("vertices", "verts", "v"):
        vertices = getattr(output, attribute, None)
        if vertices is not None:
            array = vertices.detach().cpu().numpy() if hasattr(vertices, "detach") else vertices
            return np.asarray(array, dtype="float32").reshape(-1, 3)

    raise SystemExit(
        f"Anny output exposed no vertices (tried vertices, verts, v). "
        f"Got: {type(output)} with {', '.join(a for a in dir(output) if not a.startswith('_'))}"
    )


# ---------------------------------------------------------------------------
# glTF assembly
# ---------------------------------------------------------------------------


def build_glb(
    base_vertices: Any,
    faces: Any,
    morph_targets: list[tuple[str, Any]],
    out_path: Path,
) -> None:
    """
    Write a GLB carrying the base mesh plus named morph target deltas.

    ┌────────────────────────────────────────────────────────────────────────┐
    │ THE ONE DETAIL THAT SILENTLY BREAKS EVERYTHING                         │
    │                                                                        │
    │ glTF morph targets are POSITIONAL — the names live in                  │
    │ `mesh.extras.targetNames`, not on the targets themselves. three.js      │
    │ builds `morphTargetDictionary` from that array. Omit it and three.js    │
    │ names them "0", "1", "2"… , bodyModel's name matching finds nothing,   │
    │ applyShapeToObject falls back to whole-mesh axis scaling, and the       │
    │ avatar still responds to every slider by stretching geometry.          │
    │                                                                        │
    │ It looks like it works. Everything in this pipeline is arranged around  │
    │ that one array being correct.                                           │
    └────────────────────────────────────────────────────────────────────────┘

    Skinning is deliberately NOT written here yet — see the note at the call
    site. A GLB without a skeleton fails requirement 4, which inspectHumanBase
    reports as blocking, which is the correct outcome: better a loud failure
    than a mesh that works until garments are attached to it.
    """
    import numpy as np
    import pygltflib
    from pygltflib import Accessor, Asset, Buffer, BufferView, Mesh, Node, Primitive, Scene

    base = np.asarray(base_vertices, dtype="float32")
    indices = np.asarray(faces, dtype="uint32").reshape(-1)

    blobs: list[bytes] = []
    views: list[BufferView] = []
    accessors: list[Accessor] = []

    def add(data: np.ndarray, target_type: str, component: int, count: int, *, minmax: bool) -> int:
        """Append one accessor + bufferView, 4-byte aligned, return accessor index."""
        payload = data.tobytes()
        offset = sum(len(b) for b in blobs)
        padding = (-len(payload)) % 4
        blobs.append(payload + b"\x00" * padding)

        views.append(BufferView(buffer=0, byteOffset=offset, byteLength=len(payload)))
        accessor = Accessor(
            bufferView=len(views) - 1,
            componentType=component,
            count=count,
            type=target_type,
        )
        if minmax:
            accessor.min = data.min(axis=0).tolist()
            accessor.max = data.max(axis=0).tolist()
        accessors.append(accessor)
        return len(accessors) - 1

    # POSITION requires min/max per the spec; viewers use it for culling and
    # some reject the asset without it.
    position_accessor = add(base, "VEC3", pygltflib.FLOAT, len(base), minmax=True)
    index_accessor = add(indices, "SCALAR", pygltflib.UNSIGNED_INT, len(indices), minmax=False)

    targets = []
    target_names = []
    for name, deltas in morph_targets:
        delta_array = np.asarray(deltas, dtype="float32")
        if delta_array.shape != base.shape:
            raise SystemExit(
                f"Morph target {name!r} has shape {delta_array.shape}, base is {base.shape}. "
                "A morph target must have one delta per base vertex."
            )
        # Deltas, not absolute positions. glTF adds target POSITION to the base.
        accessor_index = add(delta_array, "VEC3", pygltflib.FLOAT, len(delta_array), minmax=True)
        targets.append({"POSITION": accessor_index})
        target_names.append(name)

    primitive = Primitive(
        attributes={"POSITION": position_accessor},
        indices=index_accessor,
        targets=targets or None,
    )

    mesh = Mesh(
        primitives=[primitive],
        weights=[0.0] * len(targets) or None,
        # THE array. See the block comment above.
        extras={"targetNames": target_names},
    )

    blob = b"".join(blobs)
    gltf = pygltflib.GLTF2(
        asset=Asset(generator="selv/tools/avatar-export"),
        scene=0,
        scenes=[Scene(nodes=[0])],
        nodes=[Node(mesh=0, name="SelvHumanBase")],
        meshes=[mesh],
        accessors=accessors,
        bufferViews=views,
        buffers=[Buffer(byteLength=len(blob))],
    )
    gltf.set_binary_blob(blob)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    gltf.save_binary(str(out_path))


def report_on(out_path: Path, base_vertices: Any, faces: Any, names: list[str]) -> None:
    """
    Mirror of inspectHumanBase.ts, run here so a bad export is caught at the
    moment it is produced rather than when a screen renders it.
    """
    import numpy as np

    triangles = len(np.asarray(faces).reshape(-1, 3))
    size_mb = out_path.stat().st_size / 1_000_000
    extents = np.ptp(np.asarray(base_vertices, dtype="float32"), axis=0)

    print(f"\nWrote {out_path} ({size_mb:.1f} MB)")
    print(f"  {len(base_vertices):,} vertices, {triangles:,} triangles")
    print(f"  {len(names)} morph targets: {', '.join(names)}")
    print(f"  extents x={extents[0]:.2f} y={extents[1]:.2f} z={extents[2]:.2f}")

    if triangles > TRIANGLE_WARN:
        print(f"  WARNING: over the {TRIANGLE_WARN:,} soft budget — measure on a real device.")
    if extents[1] < max(extents):
        print("  WARNING: largest extent is not Y. normalizeSceneToHeight does not rotate.")
    print(
        "  NOTE: no skeleton written. inspectHumanBase will report requirement 4 "
        "as blocking, correctly — garment skinning is still ahead."
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=Path("base-human.glb"))
    parser.add_argument(
        "--self-check",
        action="store_true",
        help="Validate the contract and exit. Needs no Anny, torch or network.",
    )
    parser.add_argument("--topology", default="anny", help="Anny topology. NOT smplx — see header.")
    parser.add_argument(
        "--contract",
        type=Path,
        default=None,
        help="Override the contract path. Exists so the validator is testable against "
        "a deliberately-broken contract without editing the real one.",
    )
    args = parser.parse_args()

    contract = load_contract(args.contract)
    problems = self_check(contract)

    if problems:
        print("Contract is invalid:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    axes = contract["axes"]
    print(f"Contract OK: {len(axes)} axes, {len(axes) * 2} morph targets.")
    for entry in axes:
        print(
            f"  {entry['axis']:<7} {entry['negative']['morphTarget']:<11}"
            f" / {entry['positive']['morphTarget']:<11}"
            f" from phenotype {entry['negative']['annyPhenotype']!r}"
        )

    if args.self_check:
        print("\nSelf-check only. The authoritative check is the TypeScript test:")
        print("  cd app && npx jest morphContract")
        return 0

    assert_topology_is_licensed(args.topology)

    try:
        import numpy as np
        from anny import Anny
    except ImportError as error:
        print(
            f"\nMissing dependency: {error}\n"
            "  pip install -r requirements.txt\n"
            "  plus Anny itself: https://github.com/naver/anny\n\n"
            "Run with --self-check to validate the contract without them.",
            file=sys.stderr,
        )
        return 1

    print(f"\nLoading Anny (topology={args.topology!r})…")
    model = Anny(rig=args.topology)

    neutral = sample_mesh(model, resolve_phenotype(model, "height"), 0.5)
    faces = getattr(model, "faces", None)
    if faces is None:
        raise SystemExit("Anny model exposed no `faces`. Read its API and update main().")
    faces = np.asarray(faces)

    # Quads -> triangles if needed. Anny's base mesh is quadrilateral (13,710
    # quads); glTF has no quad primitive, so they have to be split.
    if faces.shape[-1] == 4:
        faces = np.concatenate([faces[:, [0, 1, 2]], faces[:, [0, 2, 3]]], axis=0)

    morph_targets: list[tuple[str, Any]] = []
    for entry in axes:
        phenotype = resolve_phenotype(model, entry["negative"]["annyPhenotype"])
        for polarity in ("negative", "positive"):
            pole = entry[polarity]
            posed = sample_mesh(model, phenotype, pole["value"])
            delta = posed - neutral
            if not np.any(np.abs(delta) > 1e-6):
                raise SystemExit(
                    f"Morph target {pole['morphTarget']!r} is identical to the base mesh. "
                    f"Phenotype {phenotype!r} at {pole['value']} moved nothing, so this "
                    "axis would export flat and its slider would do nothing. Check the "
                    "phenotype name and value range."
                )
            morph_targets.append((pole["morphTarget"], delta))

    build_glb(neutral, faces, morph_targets, args.out)
    report_on(args.out, neutral, faces, [name for name, _ in morph_targets])
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Assemble the Selv human avatar GLB from the MakeHuman CC0 data set.

    python -m selv_avatar.build --data <.../anny/data/mpfb2> --out <file.glb>

See README.md for where the data comes from and what the output contains.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os

import numpy as np
from PIL import Image

from . import geom
from .glb import GLB
from .mhdata import MHData, find_data_root
from .parts import Material, Part
from .rig import Rig, blend_weights, build_rig
from .shapes import Measurer, ShapeBasis, build_shape_basis

FORMAT_VERSION = 1
LASH_GROUPS = ("helper-l-eyelashes-1", "helper-l-eyelashes-2", "helper-r-eyelashes-1", "helper-r-eyelashes-2")
GUIDE_GROUPS = ("helper-tights", "helper-skirt", "helper-hair", "helper-l-eye", "helper-r-eye")


class Context:
    """Everything a part generator needs: the neutral body and its surfaces."""

    def __init__(self, mh: MHData, rig: Rig, basis: ShapeBasis):
        self.mh, self.rig, self.basis = mh, rig, basis
        self.P0 = basis.base
        self._surfaces: dict[str, geom.TriMesh] = {}
        self.J0 = rig.positions(self.P0)

    def joint(self, name: str) -> np.ndarray:
        return self.J0[self.rig.names.index(name)]

    def group_tris(self, *groups: str) -> np.ndarray:
        b = self.mh.base
        faces = np.concatenate([b.group_faces(g) for g in groups])
        return geom.quads_to_tris(b.face_v[faces])

    def head_tris(self) -> np.ndarray:
        tris = self.group_tris("body")
        head_bones = [self.rig.names.index(n) for n in ("head", "neck_01")]
        return tris[np.isin(self.rig.dominant[tris], head_bones).all(axis=1)]

    def surface(self, name: str) -> geom.TriMesh:
        if name not in self._surfaces:
            tris = {
                "body": lambda: self.group_tris("body"),
                "head": self.head_tris,
                "tights": lambda: self.group_tris("helper-tights"),
                "skirt": lambda: self.group_tris("helper-skirt"),
                "hairguide": lambda: self.group_tris("helper-hair"),
                "eye_l": lambda: self.group_tris("helper-l-eye"),
                "eye_r": lambda: self.group_tris("helper-r-eye"),
            }[name]()
            self._surfaces[name] = geom.TriMesh(self.P0, tris)
        return self._surfaces[name]


# --------------------------------------------------------------------------
# parts built straight from MakeHuman geometry
# --------------------------------------------------------------------------
def _sample_mask(path: str, uv: np.ndarray) -> np.ndarray:
    img = np.asarray(Image.open(path).convert("L"), dtype=np.float64) / 255.0
    h, w = img.shape
    x = np.clip((uv[:, 0] * w).astype(int), 0, w - 1)
    y = np.clip((uv[:, 1] * h).astype(int), 0, h - 1)
    return img[y, x]


def body_part(ctx: Context) -> Part:
    b = ctx.mh.base
    faces = b.group_faces("body")
    pairs = np.stack([b.face_v[faces].ravel(), b.face_uv[faces].ravel()], axis=1)
    uniq, inv = np.unique(pairs, axis=0, return_inverse=True)
    mhid = uniq[:, 0]
    uv = b.uvs[uniq[:, 1]]
    tris = geom.quads_to_tris(inv.reshape(-1, 4))

    # Lips: a multiplicative tint, so it reads as "this skin, flushed" on every
    # skin tone rather than as one fixed lipstick colour.
    lips = _sample_mask(ctx.mh.texture_path("mpfb_lips.jpg"), uv)
    lips_by_vert = np.zeros(b.n)
    np.maximum.at(lips_by_vert, mhid, lips)
    lips = lips_by_vert[mhid]
    tint = np.array([0.78, 0.47, 0.47])
    colors = 1.0 - lips[:, None] * (1.0 - tint)

    return Part(
        name="Body", positions=ctx.P0[mhid], tris=tris, uvs=uv, colors=colors, mhid=mhid,
        material=Material("Skin", color=(0.85, 0.64, 0.52, 1.0), roughness=0.62, role="skin"),
        kind="body",
    )


def direct_part(ctx: Context, name: str, groups: tuple[str, ...], material: Material, kind: str, **kw) -> Part:
    tris = ctx.group_tris(*groups)
    used = np.unique(tris)
    remap = -np.ones(ctx.mh.base.n, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return Part(name=name, positions=ctx.P0[used], tris=remap[tris], mhid=used, material=material, kind=kind, **kw)


# --------------------------------------------------------------------------
# eyes: generated, not sampled - a crisp iris needs more geometry than
# MakeHuman's 70-face helper sphere, and vertex colour avoids any texture.
# --------------------------------------------------------------------------
def _sphere_cap(center, radius_fn, theta_max, rings, segs):
    """Rings of a sphere whose pole points along +Z, from the pole to theta_max."""
    verts = [center + np.array([0.0, 0.0, radius_fn(0.0)])]
    theta_of = [0.0]
    for i in range(1, rings + 1):
        th = theta_max * i / rings
        r = radius_fn(th)
        for s in range(segs):
            ph = 2 * np.pi * s / segs
            verts.append(center + r * np.array([np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th)]))
            theta_of.append(th)
    tris = []
    for s in range(segs):
        tris.append((0, 1 + s, 1 + (s + 1) % segs))
    for i in range(1, rings):
        a0, b0 = 1 + (i - 1) * segs, 1 + i * segs
        for s in range(segs):
            s1 = (s + 1) % segs
            tris.append((a0 + s, b0 + s, b0 + s1))
            tris.append((a0 + s, b0 + s1, a0 + s1))
    return np.asarray(verts), np.asarray(tris, dtype=np.int64), np.asarray(theta_of)


def eye_parts(ctx: Context) -> list[Part]:
    b = ctx.mh.base
    out = []
    for side in ("l", "r"):
        ev = ctx.P0[b.group_verts(f"helper-{side}-eye")]
        c = ev.mean(axis=0)
        r = float(np.linalg.norm(ev - c, axis=1).mean())
        theta_iris = 0.52

        v, t, th = _sphere_cap(c, lambda _th: r, np.pi * 0.72, 22, 32)
        front = np.clip(1.0 - th / (np.pi * 0.72), 0.0, 1.0)[:, None]
        white = np.array([0.96, 0.95, 0.93])
        socket = np.array([0.78, 0.66, 0.64])
        out.append(Part(
            name=f"Sclera_{side.upper()}", positions=v, tris=t, colors=socket + (white - socket) * front ** 0.6,
            material=Material("Sclera", color=(1, 1, 1, 1), roughness=0.22, role="sclera"),
            kind="eyes", bind_surface=f"eye_{side}", meta={"side": side},
        ))

        def cornea(theta, r=r):
            return r * (1.012 + 0.04 * np.cos(0.5 * np.pi * min(theta / theta_iris, 1.0)))

        v, t, th = _sphere_cap(c, cornea, theta_iris, 12, 40)
        u = th / theta_iris
        lum = np.where(u < 0.36, 0.015, 0.0)
        ring = (u >= 0.36)
        # bright mid-iris, darker collarette next to the pupil, dark limbal ring
        lum = np.where(ring, 0.55 + 0.45 * np.sin(np.pi * np.clip((u - 0.36) / 0.56, 0, 1)) ** 0.8, lum)
        lum = np.where(u > 0.86, 0.5 - 0.3 * (u - 0.86) / 0.14, lum)
        out.append(Part(
            name=f"Iris_{side.upper()}", positions=v, tris=t, colors=np.repeat(lum[:, None], 3, axis=1),
            material=Material("Iris", color=(0.36, 0.23, 0.13, 1), roughness=0.12, role="iris"),
            kind="eyes", bind_surface=f"eye_{side}", meta={"side": side},
        ))
    return out


def core_parts(ctx: Context) -> list[Part]:
    return [
        body_part(ctx),
        direct_part(ctx, "Guide", GUIDE_GROUPS, Material("Guide", color=(0.5, 0.5, 0.5, 1)), "guide",
                    skinned=False, visible=False),
        direct_part(ctx, "Lashes", LASH_GROUPS,
                    Material("Lash", color=(0.05, 0.04, 0.04, 1), roughness=0.8, double_sided=True, role="lash"),
                    "lashes"),
        *eye_parts(ctx),
    ]


# --------------------------------------------------------------------------
# emit
# --------------------------------------------------------------------------
def welded_normals(P: np.ndarray, tris: np.ndarray, weld: np.ndarray | None) -> np.ndarray:
    if weld is None:
        return geom.vertex_normals(P, tris)
    _, group = np.unique(weld, return_inverse=True)
    fn = geom.face_normals(P, tris)
    acc = np.zeros((group.max() + 1, 3))
    for k in range(3):
        np.add.at(acc, group[tris[:, k]], fn)
    return geom.unit(acc)[group]


def emit_part(glb: GLB, ctx: Context, part: Part, materials: dict, skin: int | None) -> dict:
    rig, basis = ctx.rig, ctx.basis
    custom: dict[str, np.ndarray] = {}
    targets = None
    weld = part.weld
    joints = weights = None

    if part.mhid is not None:
        custom["_MHID"] = part.mhid.astype(np.float32)
        targets = {name: d[part.mhid] for name, d in basis.targets.items()}
        weld = part.mhid if weld is None else weld
        if part.skinned:
            joints, weights = rig.joints[part.mhid], rig.weights[part.mhid]
    else:
        surf = ctx.surface(part.bind_surface)
        t, bary, _ = surf.closest(part.positions)
        ids = surf.tris[t]
        custom["_BIND"] = np.concatenate([ids, np.zeros((len(ids), 1))], axis=1).astype(np.float32)
        custom["_BINDW"] = bary.astype(np.float32)
        if part.skinned:
            joints, weights = blend_weights(rig, ids, bary)
    if weld is not None and part.mhid is None:
        custom["_WELD"] = weld.astype(np.float32)

    m = part.material
    if m.name not in materials:
        materials[m.name] = glb.material(m.name, color=m.color, roughness=m.roughness, metallic=m.metallic,
                                         double_sided=m.double_sided, extras={"role": m.role})
    colors = part.colors
    if colors is not None and colors.shape[1] == 3:
        colors = np.concatenate([colors, np.ones((len(colors), 1))], axis=1)
    mesh = glb.mesh(
        part.name, part.positions, part.tris, materials[m.name],
        normals=welded_normals(part.positions, part.tris, weld),
        uvs=part.uvs, colors=colors, joints=joints, weights=weights, custom=custom, targets=targets,
    )
    extras = {"kind": part.kind, "follow": "direct" if part.mhid is not None else "surface",
              "visible": part.visible, **part.meta}
    node = glb.node(part.name, mesh=mesh, skin=skin if part.skinned else None, extras=extras)
    return {"node": node, "name": part.name, "verts": int(len(part.positions)), "tris": int(len(part.tris)), **extras}


def assemble(data_root: str, out_path: str, extra_parts=None) -> dict:
    mh = MHData(data_root)
    rig = build_rig(mh)
    basis = build_shape_basis(mh, lambda: Measurer(mh, rig.dominant, rig.names))
    ctx = Context(mh, rig, basis)

    glb = GLB()
    # skeleton
    J0 = ctx.J0
    joint_nodes = []
    for i, name in enumerate(rig.names):
        p = rig.parents[i]
        joint_nodes.append(glb.node(name, translation=J0[i] - (J0[p] if p >= 0 else 0.0)))
    for i, p in enumerate(rig.parents):
        if p >= 0:
            glb.doc["nodes"][joint_nodes[p]].setdefault("children", []).append(joint_nodes[i])
    ibm = np.tile(np.eye(4, dtype=np.float32), (len(rig.names), 1, 1))
    ibm[:, 3, :3] = -J0          # column-major: translation lives in the last column
    skin = glb.skin("SelvRig", joint_nodes, ibm, joint_nodes[0])

    parts = core_parts(ctx)
    for gen in extra_parts or []:
        parts.extend(gen(ctx))
    materials: dict[str, int] = {}
    summary = [emit_part(glb, ctx, p, materials, skin) for p in parts]

    root = glb.node("SelvHuman", children=[joint_nodes[0]] + [s["node"] for s in summary], root=True)
    del root

    manifest = {
        "formatVersion": FORMAT_VERSION,
        "units": "metres, Y up, facing +Z, feet on y=0",
        "source": {
            "data": "MakeHuman / MPFB2 base mesh, targets, rig and weights",
            "licence": "CC0-1.0",
            "via": "PyPI anny (data/mpfb2 only; no anny code is executed)",
        },
        "joints": rig.names,
        "metrics": basis.metrics.as_dict(),
        "units_per_weight": {"stature_m": 0.12, "bmi": 7.0, "girth_m": 0.09},
        "targets": {
            name: {
                "metrics": basis.target_metrics[name],
                "joints": [round(float(x), 5) for x in rig.deltas(d).ravel()],
            }
            for name, d in basis.targets.items()
        },
        "parts": [{k: v for k, v in s.items() if k != "node"} for s in summary],
    }
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    size = glb.write(out_path, scene_extras={"selv": manifest})
    with open(out_path, "rb") as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()
    return {"bytes": size, "sha256": digest, "manifest": manifest}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", help="path to anny/data/mpfb2 (or set SELV_MH_DATA)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--manifest", help="also write the manifest JSON here")
    ap.add_argument("--core-only", action="store_true", help="body, eyes and lashes only")
    args = ap.parse_args()

    extra = []
    if not args.core_only:
        from .catalog import PART_GENERATORS

        extra = PART_GENERATORS
    result = assemble(find_data_root(args.data), args.out, extra)
    m = result["manifest"]
    if args.manifest:
        with open(args.manifest, "w") as fh:
            json.dump(m, fh, indent=1)
            fh.write("\n")
    print(f"{args.out}: {result['bytes'] / 1e6:.2f} MB  sha256 {result['sha256'][:16]}")
    print("base metrics:", m["metrics"])
    for p in m["parts"]:
        print(f"  {p['name']:<22} {p['kind']:<8} {p['follow']:<8} {p['verts']:>6} verts {p['tris']:>6} tris")
    print(f"targets: {len(m['targets'])}:", " ".join(m["targets"]))


if __name__ == "__main__":
    main()

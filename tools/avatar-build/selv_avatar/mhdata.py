"""Read the MakeHuman CC0 data set: base mesh, shape targets, rig, weights.

Everything here is a plain file read. Nothing in this module imports or runs
the `anny` package the data ships inside, which is the point: the only code in
that package that can fetch non-commercial assets (`paths.download_noncommercial_data`)
is never on our call path because none of its code is.

Coordinates: MakeHuman's `base.obj` is right-handed, Y up, the character facing
+Z, in decimetres. glTF is right-handed, Y up, +Z front, in metres. So the only
conversion is a scale of 0.1, applied once, here.
"""
from __future__ import annotations

import gzip
import json
import os
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np

SCALE = 0.1  # decimetres -> metres

# Face groups of base.obj that are helper geometry rather than skin.
HELPER_PREFIX = "helper-"
JOINT_PREFIX = "joint-"


@dataclass
class BaseMesh:
    verts: np.ndarray            # (N, 3) float64, metres
    uvs: np.ndarray              # (M, 2) float64, v flipped to glTF convention
    face_v: np.ndarray           # (F, 4) int32 vertex indices (quads)
    face_uv: np.ndarray          # (F, 4) int32 uv indices
    face_group: np.ndarray       # (F,) int32 index into `groups`
    groups: list[str] = field(default_factory=list)

    def group_faces(self, name: str) -> np.ndarray:
        gi = self.groups.index(name)
        return np.nonzero(self.face_group == gi)[0]

    def group_verts(self, name: str) -> np.ndarray:
        return np.unique(self.face_v[self.group_faces(name)])

    @property
    def n(self) -> int:
        return len(self.verts)


class MHData:
    """Locates and parses the `mpfb2` data directory."""

    def __init__(self, root: str):
        self.root = root
        if not os.path.isfile(os.path.join(root, "3dobjs", "base.obj")):
            raise FileNotFoundError(f"not an mpfb2 data dir: {root}")
        lic = os.path.join(root, "LICENSE.md")
        if not os.path.isfile(lic) or "CC0 1.0 Universal" not in open(lic).readline():
            raise RuntimeError(
                f"{lic} is missing or is not CC0 1.0 Universal. The licence of "
                "everything this pipeline emits rests on that file; refusing to build."
            )
        self.base = self._load_obj(os.path.join(root, "3dobjs", "base.obj"))

    # -- base mesh ---------------------------------------------------------
    @staticmethod
    def _load_obj(path: str) -> BaseMesh:
        verts, uvs, fv, fuv, fg, groups = [], [], [], [], [], []
        gi = -1
        with open(path) as fh:
            for line in fh:
                if line.startswith("v "):
                    _, x, y, z = line.split()
                    verts.append((float(x), float(y), float(z)))
                elif line.startswith("vt "):
                    p = line.split()
                    uvs.append((float(p[1]), 1.0 - float(p[2])))
                elif line.startswith("g "):
                    name = line.split()[1]
                    if name not in groups:
                        groups.append(name)
                    gi = groups.index(name)
                elif line.startswith("f "):
                    parts = line.split()[1:]
                    if len(parts) != 4:
                        raise ValueError(f"expected quads, got {len(parts)}-gon")
                    vi, ti = [], []
                    for p in parts:
                        a = p.split("/")
                        vi.append(int(a[0]) - 1)
                        ti.append(int(a[1]) - 1)
                    fv.append(vi)
                    fuv.append(ti)
                    fg.append(gi)
        return BaseMesh(
            verts=np.asarray(verts, dtype=np.float64) * SCALE,
            uvs=np.asarray(uvs, dtype=np.float64),
            face_v=np.asarray(fv, dtype=np.int32),
            face_uv=np.asarray(fuv, dtype=np.int32),
            face_group=np.asarray(fg, dtype=np.int32),
            groups=groups,
        )

    # -- targets -----------------------------------------------------------
    @lru_cache(maxsize=None)
    def target(self, rel: str) -> np.ndarray | None:
        """Dense (N, 3) delta in metres for `targets/<rel>.target[.gz]`, or
        None when the file does not exist (MakeHuman omits all-zero targets)."""
        base = os.path.join(self.root, "targets", rel)
        for suffix, opener in ((".target.gz", gzip.open), (".target", open)):
            p = base + suffix
            if os.path.isfile(p):
                out = np.zeros((self.base.n, 3), dtype=np.float64)
                with opener(p, "rt") as fh:
                    for line in fh:
                        if not line.strip() or line[0] == "#":
                            continue
                        i, x, y, z = line.split()
                        out[int(i)] = (float(x), float(y), float(z))
                return out * SCALE
        return None

    def has_target(self, rel: str) -> bool:
        base = os.path.join(self.root, "targets", rel)
        return os.path.isfile(base + ".target.gz") or os.path.isfile(base + ".target")

    # -- rig ---------------------------------------------------------------
    def rig(self, name: str = "game_engine") -> dict:
        with open(os.path.join(self.root, "rigs", "standard", f"rig.{name}.json")) as fh:
            return json.load(fh)

    def weights(self, name: str = "game_engine") -> dict:
        with open(os.path.join(self.root, "rigs", "standard", f"weights.{name}.json")) as fh:
            doc = json.load(fh)
        if doc.get("license") != "CC0":
            raise RuntimeError(f"weights.{name}.json is not marked CC0")
        return doc["weights"]

    def texture_path(self, name: str) -> str:
        return os.path.join(self.root, "textures", name)


def find_data_root(explicit: str | None = None) -> str:
    """Resolve the mpfb2 data dir: --data, $SELV_MH_DATA, or an installed anny."""
    for cand in (explicit, os.environ.get("SELV_MH_DATA")):
        if cand:
            return cand
    try:
        import importlib.util

        spec = importlib.util.find_spec("anny")  # locates files, does not import it
        if spec and spec.submodule_search_locations:
            return os.path.join(list(spec.submodule_search_locations)[0], "data", "mpfb2")
    except Exception:
        pass
    raise FileNotFoundError(
        "MakeHuman data not found. Pass --data <.../anny/data/mpfb2>, set "
        "SELV_MH_DATA, or see tools/avatar-build/README.md for how to fetch it."
    )

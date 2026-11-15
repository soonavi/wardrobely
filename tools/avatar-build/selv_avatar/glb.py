"""A small, dependency-free glTF 2.0 binary (.glb) writer.

Only what this pipeline needs: indexed triangle meshes, vertex attributes
(including custom `_NAME` attributes), named morph targets with sparse
accessors, one skin, flat PBR materials. No textures, no animations, no
extensions - so any glTF loader can read the output.
"""
from __future__ import annotations

import json
import struct

import numpy as np

FLOAT, UBYTE, USHORT, UINT = 5126, 5121, 5123, 5125
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963
_TYPES = {1: "SCALAR", 2: "VEC2", 3: "VEC3", 4: "VEC4", 16: "MAT4"}
_DTYPES = {FLOAT: np.float32, UBYTE: np.uint8, USHORT: np.uint16, UINT: np.uint32}


class GLB:
    def __init__(self, generator: str = "selv-avatar-build"):
        self.bin = bytearray()
        self.doc: dict = {
            "asset": {"version": "2.0", "generator": generator},
            "scene": 0,
            "scenes": [{"nodes": []}],
            "nodes": [],
            "meshes": [],
            "materials": [],
            "accessors": [],
            "bufferViews": [],
            "buffers": [{"byteLength": 0}],
        }

    # -- low level ---------------------------------------------------------
    def _view(self, data: bytes, target: int | None = None) -> int:
        while len(self.bin) % 4:
            self.bin.append(0)
        view = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target is not None:
            view["target"] = target
        self.bin.extend(data)
        self.doc["bufferViews"].append(view)
        return len(self.doc["bufferViews"]) - 1

    def accessor(
        self,
        array: np.ndarray,
        component: int = FLOAT,
        target: int | None = ARRAY_BUFFER,
        minmax: bool = False,
        normalized: bool = False,
    ) -> int:
        arr = np.ascontiguousarray(array, dtype=_DTYPES[component])
        width = 1 if arr.ndim == 1 else arr.shape[1]
        acc = {
            "bufferView": self._view(arr.tobytes(), target),
            "componentType": component,
            "count": int(arr.shape[0]),
            "type": _TYPES[width],
        }
        if normalized:
            acc["normalized"] = True
        if minmax:
            flat = arr.reshape(arr.shape[0], -1)
            acc["min"] = [float(x) for x in flat.min(axis=0)]
            acc["max"] = [float(x) for x in flat.max(axis=0)]
        self.doc["accessors"].append(acc)
        return len(self.doc["accessors"]) - 1

    def sparse_vec3(self, delta: np.ndarray, eps: float = 1e-7) -> int:
        """A VEC3 float accessor storing only the rows of `delta` that move.

        Most shape targets touch a fraction of the body (a face shape moves a
        few hundred vertices out of thousands), so this is where the file size
        goes or does not go.
        """
        delta = np.asarray(delta, dtype=np.float32)
        n = delta.shape[0]
        moved = np.nonzero(np.abs(delta).max(axis=1) > eps)[0]
        acc: dict = {
            "componentType": FLOAT,
            "count": int(n),
            "type": "VEC3",
            "min": [float(x) for x in delta.min(axis=0)],
            "max": [float(x) for x in delta.max(axis=0)],
        }
        if len(moved) == 0:
            # glTF requires sparse.count >= 1; one explicit zero row keeps it valid.
            moved = np.array([0])
        if len(moved) > 0.6 * n:
            acc["bufferView"] = self._view(delta.tobytes(), ARRAY_BUFFER)
        else:
            idx_type = USHORT if n <= 65535 else UINT
            acc["sparse"] = {
                "count": int(len(moved)),
                "indices": {
                    "bufferView": self._view(moved.astype(_DTYPES[idx_type]).tobytes()),
                    "componentType": idx_type,
                },
                "values": {"bufferView": self._view(delta[moved].tobytes())},
            }
        self.doc["accessors"].append(acc)
        return len(self.doc["accessors"]) - 1

    # -- scene graph -------------------------------------------------------
    def material(self, name: str, color=(1, 1, 1, 1), roughness=0.6, metallic=0.0,
                 double_sided=False, alpha_mode: str | None = None, extras: dict | None = None) -> int:
        mat = {
            "name": name,
            "pbrMetallicRoughness": {
                "baseColorFactor": [float(c) for c in color],
                "roughnessFactor": float(roughness),
                "metallicFactor": float(metallic),
            },
        }
        if double_sided:
            mat["doubleSided"] = True
        if alpha_mode:
            mat["alphaMode"] = alpha_mode
        if extras:
            mat["extras"] = extras
        self.doc["materials"].append(mat)
        return len(self.doc["materials"]) - 1

    def mesh(
        self,
        name: str,
        positions: np.ndarray,
        indices: np.ndarray,
        material: int,
        normals: np.ndarray | None = None,
        uvs: np.ndarray | None = None,
        colors: np.ndarray | None = None,
        joints: np.ndarray | None = None,
        weights: np.ndarray | None = None,
        custom: dict[str, np.ndarray] | None = None,
        targets: dict[str, np.ndarray] | None = None,
        extras: dict | None = None,
    ) -> int:
        attrs = {"POSITION": self.accessor(positions, minmax=True)}
        if normals is not None:
            attrs["NORMAL"] = self.accessor(normals)
        if uvs is not None:
            attrs["TEXCOORD_0"] = self.accessor(uvs)
        if colors is not None:
            attrs["COLOR_0"] = self.accessor(colors)
        if joints is not None:
            attrs["JOINTS_0"] = self.accessor(joints, component=UBYTE)
            attrs["WEIGHTS_0"] = self.accessor(weights)
        for key, arr in (custom or {}).items():
            if not key.startswith("_"):
                raise ValueError("custom attribute names must start with '_'")
            attrs[key] = self.accessor(arr)
        idx = np.asarray(indices).reshape(-1)
        comp = USHORT if len(positions) <= 65535 else UINT
        prim: dict = {
            "attributes": attrs,
            "indices": self.accessor(idx, component=comp, target=ELEMENT_ARRAY_BUFFER),
            "material": material,
            "mode": 4,
        }
        mesh: dict = {"name": name, "primitives": [prim]}
        mesh_extras = dict(extras or {})
        if targets:
            prim["targets"] = [{"POSITION": self.sparse_vec3(d)} for d in targets.values()]
            mesh["weights"] = [0.0] * len(targets)
            # three.js names morph targets from this array and nothing else.
            mesh_extras["targetNames"] = list(targets.keys())
        if mesh_extras:
            mesh["extras"] = mesh_extras
        self.doc["meshes"].append(mesh)
        return len(self.doc["meshes"]) - 1

    def node(self, name: str, mesh: int | None = None, skin: int | None = None,
             translation=None, children=None, extras: dict | None = None, root: bool = False) -> int:
        node: dict = {"name": name}
        if mesh is not None:
            node["mesh"] = mesh
        if skin is not None:
            node["skin"] = skin
        if translation is not None:
            node["translation"] = [float(x) for x in translation]
        if children:
            node["children"] = list(children)
        if extras:
            node["extras"] = extras
        self.doc["nodes"].append(node)
        i = len(self.doc["nodes"]) - 1
        if root:
            self.doc["scenes"][0]["nodes"].append(i)
        return i

    def skin(self, name: str, joints: list[int], inverse_bind: np.ndarray, skeleton: int) -> int:
        ibm = np.asarray(inverse_bind, dtype=np.float32).reshape(-1, 16)
        self.doc.setdefault("skins", []).append({
            "name": name,
            "joints": joints,
            "skeleton": skeleton,
            "inverseBindMatrices": self.accessor(ibm, target=None),
        })
        return len(self.doc["skins"]) - 1

    # -- output ------------------------------------------------------------
    def write(self, path: str, scene_extras: dict | None = None) -> int:
        if scene_extras:
            self.doc["scenes"][0]["extras"] = scene_extras
        while len(self.bin) % 4:
            self.bin.append(0)
        self.doc["buffers"][0]["byteLength"] = len(self.bin)
        js = json.dumps(self.doc, separators=(",", ":")).encode("utf-8")
        js += b" " * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, "wb") as fh:
            fh.write(struct.pack("<4sII", b"glTF", 2, total))
            fh.write(struct.pack("<I4s", len(js), b"JSON"))
            fh.write(js)
            fh.write(struct.pack("<I4s", len(self.bin), b"BIN\x00"))
            fh.write(bytes(self.bin))
        return total

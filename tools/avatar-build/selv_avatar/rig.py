"""Skeleton and skin weights from MakeHuman's `game_engine` rig (53 bones).

Joint positions are not constants: each joint is the centroid of a small cube
of helper vertices in the base mesh, and those vertices move with every shape
target. So a taller body gets longer bones for free, and the build can export
how far each joint moves per target for the runtime to re-seat the skeleton.

Rest orientation is identity for every bone (world-aligned local axes). That
makes procedural posing in the app trivial to reason about: rotating
`upperarm_l` about +Z always swings the arm in the frontal plane.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .mhdata import MHData

MAX_INFLUENCES = 4


@dataclass
class Rig:
    names: list[str]
    parents: list[int]              # index into names, -1 for the root
    anchors: list[np.ndarray]       # MH vertex indices whose centroid is the joint
    joints: np.ndarray              # (N, 4) uint8 bone indices per MH vertex
    weights: np.ndarray             # (N, 4) float32, rows sum to 1 where skinned
    dominant: np.ndarray            # (N,) strongest bone per MH vertex

    def positions(self, P: np.ndarray) -> np.ndarray:
        return np.stack([P[a].mean(axis=0) for a in self.anchors])

    def deltas(self, D: np.ndarray) -> np.ndarray:
        return np.stack([D[a].mean(axis=0) for a in self.anchors])


def build_rig(mh: MHData, rig_name: str = "game_engine") -> Rig:
    spec = mh.rig(rig_name)
    b = mh.base

    order: list[str] = []

    def visit(name: str) -> None:
        if name in order:
            return
        parent = spec[name]["parent"]
        if parent:
            visit(parent)
        order.append(name)

    for name in spec:
        visit(name)

    def anchor(end: dict) -> np.ndarray:
        if end["strategy"] == "CUBE":
            return b.group_verts(end["cube_name"])
        if end["strategy"] == "MEAN":
            return np.asarray(end["vertex_indices"], dtype=np.int64)
        raise ValueError(f"unknown joint strategy {end['strategy']}")

    anchors = [anchor(spec[n]["head"]) for n in order]
    parents = [order.index(spec[n]["parent"]) if spec[n]["parent"] else -1 for n in order]

    table = mh.weights(rig_name)
    dense = np.zeros((b.n, len(order)), dtype=np.float32)
    for bone, pairs in table.items():
        if not pairs:
            continue
        bi = order.index(bone)
        arr = np.asarray(pairs, dtype=np.float64)
        dense[arr[:, 0].astype(np.int64), bi] = arr[:, 1]

    top = np.argsort(-dense, axis=1)[:, :MAX_INFLUENCES]
    w = np.take_along_axis(dense, top, axis=1)
    total = w.sum(axis=1, keepdims=True)
    w = np.where(total > 0, w / np.maximum(total, 1e-12), 0.0).astype(np.float32)
    j = np.where(w > 0, top, 0).astype(np.uint8)
    return Rig(names=order, parents=parents, anchors=anchors, joints=j, weights=w, dominant=top[:, 0])


def blend_weights(rig: Rig, mh_ids: np.ndarray, bary: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Skin weights for points bound to MH triangles: the barycentric blend of
    the three corners' weights, reduced back to four influences."""
    n_b = len(rig.names)
    out = np.zeros((len(mh_ids), n_b), dtype=np.float64)
    rows = np.arange(len(mh_ids))
    for c in range(3):
        vid = mh_ids[:, c]
        for k in range(MAX_INFLUENCES):
            np.add.at(out, (rows, rig.joints[vid, k]), rig.weights[vid, k] * bary[:, c])
    top = np.argsort(-out, axis=1)[:, :MAX_INFLUENCES]
    w = np.take_along_axis(out, top, axis=1)
    w = w / np.maximum(w.sum(axis=1, keepdims=True), 1e-12)
    return np.where(w > 0, top, 0).astype(np.uint8), w.astype(np.float32)

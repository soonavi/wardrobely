"""Mesh geometry helpers: normals, closest point on a triangle mesh, ray casts."""
from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree


def quads_to_tris(quads: np.ndarray) -> np.ndarray:
    quads = np.asarray(quads)
    return np.concatenate([quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]])


def face_normals(P: np.ndarray, tris: np.ndarray) -> np.ndarray:
    return np.cross(P[tris[:, 1]] - P[tris[:, 0]], P[tris[:, 2]] - P[tris[:, 0]])


def vertex_normals(P: np.ndarray, tris: np.ndarray) -> np.ndarray:
    """Area-weighted vertex normals."""
    n = np.zeros_like(P, dtype=np.float64)
    fn = face_normals(P, tris)
    for k in range(3):
        np.add.at(n, tris[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def unit(v: np.ndarray) -> np.ndarray:
    v = np.asarray(v, dtype=np.float64)
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-12)


def _closest_on_tris(p: np.ndarray, a: np.ndarray, b: np.ndarray, c: np.ndarray):
    """Closest point on each triangle (a, b, c) to each point p; all (K, 3).
    Returns barycentric coordinates (K, 3). Ericson, Real-Time Collision
    Detection 5.1.5, vectorised."""
    ab, ac, ap = b - a, c - a, p - a
    d1 = np.einsum("ij,ij->i", ab, ap)
    d2 = np.einsum("ij,ij->i", ac, ap)
    bp = p - b
    d3 = np.einsum("ij,ij->i", ab, bp)
    d4 = np.einsum("ij,ij->i", ac, bp)
    cp = p - c
    d5 = np.einsum("ij,ij->i", ab, cp)
    d6 = np.einsum("ij,ij->i", ac, cp)
    vc = d1 * d4 - d3 * d2
    vb = d5 * d2 - d1 * d6
    va = d3 * d6 - d5 * d4

    bary = np.zeros((len(p), 3))
    done = np.zeros(len(p), dtype=bool)

    def put(mask, u, v, w):
        m = mask & ~done
        bary[m, 0], bary[m, 1], bary[m, 2] = u[m], v[m], w[m]
        done[m] = True

    one, zero = np.ones(len(p)), np.zeros(len(p))
    put((d1 <= 0) & (d2 <= 0), one, zero, zero)
    put((d3 >= 0) & (d4 <= d3), zero, one, zero)
    put((d6 >= 0) & (d5 <= d6), zero, zero, one)
    with np.errstate(divide="ignore", invalid="ignore"):
        v_ab = d1 / (d1 - d3)
        put((vc <= 0) & (d1 >= 0) & (d3 <= 0), 1 - v_ab, v_ab, zero)
        w_ac = d2 / (d2 - d6)
        put((vb <= 0) & (d2 >= 0) & (d6 <= 0), 1 - w_ac, zero, w_ac)
        w_bc = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        put((va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0), zero, 1 - w_bc, w_bc)
        denom = 1.0 / (va + vb + vc)
        v = vb * denom
        w = vc * denom
        put(np.ones(len(p), dtype=bool), 1 - v - w, v, w)
    return np.nan_to_num(bary, nan=1 / 3)


class TriMesh:
    """A triangle soup with a centroid KD-tree for nearest-surface queries."""

    def __init__(self, P: np.ndarray, tris: np.ndarray):
        self.P = np.asarray(P, dtype=np.float64)
        self.tris = np.asarray(tris, dtype=np.int64)
        self.centroids = self.P[self.tris].mean(axis=1)
        self.tree = cKDTree(self.centroids)

    def closest(self, pts: np.ndarray, k: int = 12):
        """For each point: (triangle index, barycentric (3,), closest point)."""
        pts = np.asarray(pts, dtype=np.float64)
        k = min(k, len(self.tris))
        _, cand = self.tree.query(pts, k=k)
        cand = cand.reshape(len(pts), k)
        best_d = np.full(len(pts), np.inf)
        best_t = np.zeros(len(pts), dtype=np.int64)
        best_b = np.zeros((len(pts), 3))
        best_q = np.zeros((len(pts), 3))
        for j in range(k):
            t = cand[:, j]
            a, b, c = (self.P[self.tris[t, i]] for i in range(3))
            bary = _closest_on_tris(pts, a, b, c)
            q = bary[:, :1] * a + bary[:, 1:2] * b + bary[:, 2:3] * c
            d = np.linalg.norm(q - pts, axis=1)
            better = d < best_d
            best_d[better], best_t[better] = d[better], t[better]
            best_b[better], best_q[better] = bary[better], q[better]
        return best_t, best_b, best_q

    def raycast(self, origins: np.ndarray, direction: np.ndarray):
        """First hit of each ray (shared direction). Returns (hit mask, point,
        triangle index). Brute force Moller-Trumbore; fine for the few hundred
        rays this pipeline casts."""
        origins = np.asarray(origins, dtype=np.float64)
        d = unit(np.asarray(direction, dtype=np.float64))
        a, b, c = (self.P[self.tris[:, i]] for i in range(3))
        e1, e2 = b - a, c - a
        h = np.cross(d, e2)
        det = np.einsum("ij,ij->i", e1, h)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
        hit = np.zeros(len(origins), dtype=bool)
        pts = np.zeros((len(origins), 3))
        tri = np.zeros(len(origins), dtype=np.int64)
        for i, o in enumerate(origins):
            s = o - a
            u = np.einsum("ij,ij->i", s, h) * inv
            q = np.cross(s, e1)
            v = (q @ d) * inv
            t = np.einsum("ij,ij->i", e2, q) * inv
            m = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-9)
            if m.any():
                idx = np.nonzero(m)[0]
                j = idx[np.argmin(t[idx])]
                hit[i], pts[i], tri[i] = True, o + d * t[j], j
        return hit, pts, tri


def signed_volume(P: np.ndarray, tris: np.ndarray) -> float:
    a, b, c = P[tris[:, 0]], P[tris[:, 1]], P[tris[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def girth(P: np.ndarray, tris: np.ndarray, y: float, x_limit: float | None = None) -> float:
    """Tape-measure circumference at height y: the perimeter of the convex hull
    of the horizontal slice. A tape pulled round a body spans concavities, so
    the hull - not the raw contour - is the right model. `x_limit` discards
    slice points beyond |x|, to keep arms out of a chest measurement."""
    a, b, c = P[tris[:, 0]], P[tris[:, 1]], P[tris[:, 2]]
    pts = []
    for p, q in ((a, b), (b, c), (c, a)):
        m = (p[:, 1] - y) * (q[:, 1] - y) < 0
        t = (y - p[m, 1]) / (q[m, 1] - p[m, 1])
        pts.append(p[m] + (q[m] - p[m]) * t[:, None])
    s = np.concatenate(pts)[:, [0, 2]]
    if x_limit is not None:
        s = s[np.abs(s[:, 0]) <= x_limit]
    if len(s) < 3:
        return 0.0
    from scipy.spatial import ConvexHull

    hull = s[ConvexHull(s).vertices]
    return float(np.linalg.norm(hull - np.roll(hull, -1, axis=0), axis=1).sum())

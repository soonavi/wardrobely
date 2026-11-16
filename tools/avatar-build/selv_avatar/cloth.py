"""Mesh operations for cutting garments out of MakeHuman's clothing helpers.

A garment starts life as a region of `helper-tights` (a full bodysuit) or
`helper-skirt`, both of which MakeHuman authors to sit just outside the body
under every shape target. The operations here turn a region into something
that reads as clothing: clean hems (iso-line clipping, not jagged face
selection), enough tessellation to shade smoothly, ease away from the skin,
and fabric that hangs from the widest point instead of clinging.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import geom


@dataclass
class Cloth:
    V: np.ndarray                                   # (n, 3)
    T: np.ndarray                                   # (m, 3)
    attrs: dict[str, np.ndarray] = field(default_factory=dict)   # per-vertex scalars

    def copy(self) -> "Cloth":
        return Cloth(self.V.copy(), self.T.copy(), {k: v.copy() for k, v in self.attrs.items()})

    def compact(self) -> "Cloth":
        used = np.unique(self.T)
        remap = -np.ones(len(self.V), dtype=np.int64)
        remap[used] = np.arange(len(used))
        return Cloth(self.V[used], remap[self.T], {k: v[used] for k, v in self.attrs.items()})

    def normals(self) -> np.ndarray:
        return geom.vertex_normals(self.V, self.T)

    def boundary_verts(self) -> np.ndarray:
        e = np.sort(np.concatenate([self.T[:, [0, 1]], self.T[:, [1, 2]], self.T[:, [2, 0]]]), axis=1)
        uniq, count = np.unique(e, axis=0, return_counts=True)
        return np.unique(uniq[count == 1])


def merge(parts: list[Cloth]) -> Cloth:
    V, T, base = [], [], 0
    keys = set(parts[0].attrs)
    for p in parts:
        V.append(p.V)
        T.append(p.T + base)
        base += len(p.V)
        keys &= set(p.attrs)
    return Cloth(np.concatenate(V), np.concatenate(T), {k: np.concatenate([p.attrs[k] for p in parts]) for k in keys})


def clip(c: Cloth, f: np.ndarray, threshold: float = 0.0) -> Cloth:
    """Keep the part of the mesh where `f >= threshold`, cutting triangles
    along the iso-line so the new edge is straight rather than stair-stepped."""
    f = np.asarray(f, dtype=np.float64) - threshold
    inside = f >= 0
    V = [c.V]
    attrs = {k: [v] for k, v in c.attrs.items()}
    fs = [f]
    cache: dict[tuple[int, int], int] = {}
    n = len(c.V)

    def cut(a: int, b: int) -> int:
        key = (a, b) if a < b else (b, a)
        if key not in cache:
            t = f[a] / (f[a] - f[b])
            V.append((c.V[a] + (c.V[b] - c.V[a]) * t)[None])
            for k, v in c.attrs.items():
                attrs[k].append(np.atleast_1d(v[a] + (v[b] - v[a]) * t))
            fs.append(np.zeros(1))
            cache[key] = n + len(cache)
        return cache[key]

    T = []
    for tri in c.T:
        m = inside[tri]
        k = int(m.sum())
        if k == 3:
            T.append(tuple(tri))
        elif k == 0:
            continue
        else:
            # rotate so the odd-one-out vertex comes first
            odd = np.nonzero(m)[0][0] if k == 1 else np.nonzero(~m)[0][0]
            a, b, d = (int(tri[(odd + i) % 3]) for i in range(3))
            ab, ad = cut(a, b), cut(a, d)
            if k == 1:
                T.append((a, ab, ad))
            else:
                T.append((ab, b, d))
                T.append((ab, d, ad))
    if not T:
        raise ValueError("clip removed the whole mesh")
    out = Cloth(np.concatenate(V), np.asarray(T, dtype=np.int64), {k: np.concatenate(v) for k, v in attrs.items()})
    return out.compact()


def subdivide(c: Cloth) -> Cloth:
    """Split every triangle into four at its edge midpoints."""
    n = len(c.V)
    e = np.concatenate([c.T[:, [0, 1]], c.T[:, [1, 2]], c.T[:, [2, 0]]])
    key = np.sort(e, axis=1)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    mid = n + inv.reshape(3, -1).T                      # (m, 3): midpoints of edges 01, 12, 20
    V = np.concatenate([c.V, 0.5 * (c.V[uniq[:, 0]] + c.V[uniq[:, 1]])])
    attrs = {k: np.concatenate([v, 0.5 * (v[uniq[:, 0]] + v[uniq[:, 1]])]) for k, v in c.attrs.items()}
    a, b, d = c.T[:, 0], c.T[:, 1], c.T[:, 2]
    ab, bd, da = mid[:, 0], mid[:, 1], mid[:, 2]
    T = np.concatenate([
        np.stack([a, ab, da], 1), np.stack([ab, b, bd], 1), np.stack([da, bd, d], 1), np.stack([ab, bd, da], 1)
    ])
    return Cloth(V, T, attrs)


def smooth(c: Cloth, iterations: int = 2, lam: float = 0.5, pin_boundary: bool = True) -> None:
    """Volume-preserving (Taubin) smoothing in place. Boundary vertices relax
    only along the boundary, so hems stay where they were cut but lose their
    zig-zag."""
    n = len(c.V)
    e = np.concatenate([c.T[:, [0, 1]], c.T[:, [1, 2]], c.T[:, [2, 0]]])
    e = np.unique(np.sort(e, axis=1), axis=0)
    deg = np.zeros(n)
    np.add.at(deg, e[:, 0], 1)
    np.add.at(deg, e[:, 1], 1)
    b = c.boundary_verts()
    is_b = np.zeros(n, dtype=bool)
    is_b[b] = True
    be = e[is_b[e[:, 0]] & is_b[e[:, 1]]]
    bdeg = np.zeros(n)
    np.add.at(bdeg, be[:, 0], 1)
    np.add.at(bdeg, be[:, 1], 1)
    def step(factor: float) -> None:
        acc = np.zeros_like(c.V)
        np.add.at(acc, e[:, 0], c.V[e[:, 1]])
        np.add.at(acc, e[:, 1], c.V[e[:, 0]])
        avg = acc / np.maximum(deg, 1)[:, None]
        new = c.V + factor * (avg - c.V)
        if pin_boundary:
            bacc = np.zeros_like(c.V)
            np.add.at(bacc, be[:, 0], c.V[be[:, 1]])
            np.add.at(bacc, be[:, 1], c.V[be[:, 0]])
            bavg = bacc / np.maximum(bdeg, 1)[:, None]
            ok = is_b & (bdeg >= 2)
            new[is_b] = c.V[is_b]
            new[ok] = c.V[ok] + factor * (bavg[ok] - c.V[ok])
        c.V = new

    # Taubin smoothing: a shrink step then a slightly larger inflate step.
    # Plain Laplacian smoothing shrinks every tube toward its axis, which left
    # sleeves and hems flaring where the pinned boundary did not shrink too.
    for _ in range(iterations):
        step(lam)
        step(-(lam + 0.03))


def push_out(c: Cloth, body: geom.TriMesh, min_dist: np.ndarray | float, passes: int = 2) -> None:
    """Move any vertex closer than `min_dist` to the body (or inside it) back
    out along the body's normal. The guarantee garments are built on."""
    min_dist = np.broadcast_to(np.asarray(min_dist, dtype=np.float64), (len(c.V),))
    for _ in range(passes):
        t, _, q = body.closest(c.V, k=10)
        n = geom.unit(geom.face_normals(body.P, body.tris[t]))
        d = np.einsum("ij,ij->i", c.V - q, n)
        short = d < min_dist
        c.V[short] += n[short] * (min_dist[short] - d[short])[:, None]


def hang(c: Cloth, axis_point: np.ndarray, axis_dir: np.ndarray, start: float, looseness: np.ndarray | float,
         taper: float = 0.0, n_ang: int = 48, step: float = 0.008, weight: np.ndarray | None = None,
         max_gain: float = 0.07) -> None:
    """Let fabric fall from where it is widest.

    Works in cylindrical coordinates around an axis (the spine, a thigh, an
    upper arm). Walking "down" the axis from `start`, the fabric's radius in
    each direction may not shrink faster than `taper` per metre - so a shirt
    drops straight from the chest instead of shrink-wrapping the waist.
    `looseness` (0..1, per vertex or scalar) blends between fitted and hung.
    """
    d = geom.unit(np.asarray(axis_dir, dtype=np.float64))
    rel = c.V - axis_point
    h = rel @ d                                   # distance along the axis (increasing = "down")
    radial = rel - h[:, None] * d
    rho = np.linalg.norm(radial, axis=1)
    ref = np.array([0.0, 0.0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = geom.unit(np.cross(d, ref))
    v = np.cross(d, u)
    ang = np.arctan2(radial @ v, radial @ u)
    ai = ((ang + np.pi) / (2 * np.pi) * n_ang).astype(int) % n_ang
    sel = h >= start
    if weight is not None:
        sel &= weight > 0.02
    if not sel.any():
        return
    hi = np.clip(((h - start) / step).astype(int), 0, None)
    n_h = int(hi[sel].max()) + 1
    grid = np.zeros((n_ang, n_h))
    # Only cloth that clearly belongs to this limb defines the silhouette. A
    # sleeve reaching past the hip must not teach the shirt's side seam to
    # follow it out there.
    src = sel if weight is None else sel & (weight > 0.6)
    if not src.any():
        return
    np.maximum.at(grid, (ai[src], hi[src]), rho[src])
    # fill empty cells from angular neighbours, then run the hang down the axis
    for _ in range(4):
        empty = grid == 0
        if not empty.any():
            break
        nb = np.maximum(np.roll(grid, 1, axis=0), np.roll(grid, -1, axis=0))
        grid = np.where(empty, nb, grid)
    for j in range(1, n_h):
        grid[:, j] = np.maximum(grid[:, j], grid[:, j - 1] - taper * step)
    # soften across directions so folds do not appear as ridges
    for _ in range(3):
        grid = 0.5 * grid + 0.25 * (np.roll(grid, 1, axis=0) + np.roll(grid, -1, axis=0))
    target = grid[ai, np.clip(hi, 0, n_h - 1)]
    loose = np.broadcast_to(np.asarray(looseness, dtype=np.float64), rho.shape)
    blend = loose * np.clip((h - start) / 0.06, 0.0, 1.0)
    if weight is not None:
        blend = blend * np.clip(weight, 0.0, 1.0)
    new_rho = np.where(sel, rho + np.clip(target - rho, 0.0, max_gain) * blend, rho)
    scale = np.where(rho > 1e-9, new_rho / np.maximum(rho, 1e-9), 1.0)
    c.V = axis_point + h[:, None] * d + radial * scale[:, None]


def planar_uv(c: Cloth) -> np.ndarray:
    """Front-projected UVs across the garment's own bounding box: u runs
    across the body, v from the top edge down. A photo of the garment laid
    flat maps onto it the way it was photographed."""
    lo, hi = c.V.min(axis=0), c.V.max(axis=0)
    span = np.maximum(hi - lo, 1e-6)
    return np.stack([(c.V[:, 0] - lo[0]) / span[0], (hi[1] - c.V[:, 1]) / span[1]], axis=1)

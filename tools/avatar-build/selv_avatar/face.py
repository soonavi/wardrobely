"""Face detail: lashes and eyebrows.

Both are thin alpha-blended geometry sitting a fraction of a millimetre above
the skin, bound to the face surface so they follow every eye and face-shape
target. Geometry rather than a painted texture, because it tints with one
material colour (any brow colour, any skin tone) and needs no image decode on
the device.
"""
from __future__ import annotations

import numpy as np

from . import geom
from .parts import Material, Part

LIFT = 0.0007  # metres above the skin; enough to win the depth test, too little to see


def _eye(ctx, side: str):
    ev = ctx.P0[ctx.mh.base.group_verts(f"helper-{side}-eye")]
    c = ev.mean(axis=0)
    return c, float(np.linalg.norm(ev - c, axis=1).mean())


def lash_parts(ctx) -> list[Part]:
    """Upper lashes only, shortened to a soft lash line.

    MakeHuman's lash helpers are wide ribbons meant to carry an alpha-mapped
    lash texture. Untextured they render as black bars, so each vertex is pulled
    most of the way back to the lid and fades out toward its tip instead.
    """
    b = ctx.mh.base
    head = ctx.surface("head")
    verts, tris, alpha = [], [], []
    for side in ("l", "r"):
        c, _ = _eye(ctx, side)
        for g in (f"helper-{side}-eyelashes-1", f"helper-{side}-eyelashes-2"):
            t = ctx.group_tris(g)
            used = np.unique(t)
            P = ctx.P0[used]
            if P[:, 1].mean() < c[1]:
                continue  # lower lashes: omitted, they read as smudged liner at this scale
            _, _, q = head.closest(P)
            reach = np.linalg.norm(P - q, axis=1)
            k = reach / max(reach.max(), 1e-9)
            remap = -np.ones(b.n, dtype=np.int64)
            remap[used] = np.arange(len(used)) + sum(len(v) for v in verts)
            verts.append(q + (P - q) * 0.5 + np.array([0, 0, LIFT]))
            alpha.append(1.0 - 0.85 * k ** 1.2)
            tris.append(remap[t])
    V = np.concatenate(verts)
    A = np.concatenate(alpha)
    colors = np.concatenate([np.ones((len(V), 3)), A[:, None]], axis=1)
    return [Part(
        name="Lashes", positions=V, tris=np.concatenate(tris), colors=colors,
        material=Material("Lash", color=(0.045, 0.035, 0.03, 1), roughness=0.85, double_sided=True,
                          alpha_blend=True, role="lash"),
        kind="lashes", bind_surface="head",
    )]


# name: (base height, arch, tail drop, thickness) in eye radii
BROW_STYLES = {
    "natural": (1.42, 0.30, 0.40, 0.62),
    "arched": (1.40, 0.56, 0.60, 0.54),
    "straight": (1.48, 0.08, 0.10, 0.58),
    "bold": (1.42, 0.30, 0.38, 0.88),
}


def brow_parts(ctx) -> list[Part]:
    head = ctx.surface("head")
    n_u, n_v = 22, 7
    out = []
    for style, (y0, arch, drop, thick) in BROW_STYLES.items():
        verts, tris, alpha = [], [], []
        for side, s in (("l", 1.0), ("r", -1.0)):
            c, r = _eye(ctx, side)
            pts = np.zeros((n_u, n_v, 3))
            a = np.zeros((n_u, n_v))
            for i in range(n_u):
                u = i / (n_u - 1)
                x = c[0] + s * r * (-1.15 + 3.15 * u)
                rise = np.sin(0.5 * np.pi * min(u / 0.62, 1.0))
                fall = max(0.0, (u - 0.62) / 0.38) ** 1.4
                y = c[1] + r * (y0 + arch * rise - drop * fall)
                # full at the head of the brow, tapering to a point at the tail
                half = 0.5 * r * thick * (0.55 + 0.45 * np.sin(np.pi * min(u / 0.35, 1.0) * 0.5)) * (1.0 - 0.72 * u ** 1.6)
                end_fade = min(1.0, u / 0.07) * min(1.0, (1.0 - u) / 0.12)
                for j in range(n_v):
                    v = -1.0 + 2.0 * j / (n_v - 1)
                    pts[i, j] = (x, y + v * half, c[2] + 0.2)
                    a[i, j] = end_fade * (1.0 - abs(v) ** 2.2)
            flat = pts.reshape(-1, 3)
            hit, on_face, tri_idx = head.raycast(flat, np.array([0.0, 0.0, -1.0]))
            if not hit.all():
                raise RuntimeError(f"brow '{style}' ({side}): {int((~hit).sum())} rays missed the face")
            nrm = geom.unit(geom.face_normals(head.P, head.tris[tri_idx]))
            base = sum(len(v) for v in verts)
            verts.append(on_face + nrm * LIFT)
            alpha.append(a.reshape(-1))
            for i in range(n_u - 1):
                for j in range(n_v - 1):
                    p00, p01 = base + i * n_v + j, base + i * n_v + j + 1
                    p10, p11 = base + (i + 1) * n_v + j, base + (i + 1) * n_v + j + 1
                    quad = (p00, p10, p11, p01) if s > 0 else (p00, p01, p11, p10)
                    tris.append((quad[0], quad[1], quad[2]))
                    tris.append((quad[0], quad[2], quad[3]))
        V = np.concatenate(verts)
        A = np.concatenate(alpha)
        out.append(Part(
            name=f"Brows_{style}", positions=V, tris=np.asarray(tris, dtype=np.int64),
            colors=np.concatenate([np.ones((len(V), 3)), A[:, None]], axis=1),
            material=Material("Brow", color=(0.16, 0.11, 0.08, 1), roughness=0.9, alpha_blend=True, role="brow"),
            kind="brows", bind_surface="head", visible=(style == "natural"), meta={"id": style},
        ))
    return out

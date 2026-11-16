"""Facial hair, glasses and earrings - the remaining options of the creator."""
from __future__ import annotations

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

from . import geom
from .cloth import Cloth, clip, smooth, subdivide
from .hair import tube
from .parts import Material, Part


def _ss(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


class Face:
    """The front of the head as cloth, with the landmarks beards are cut by."""

    def __init__(self, ctx):
        self.ctx = ctx
        b = ctx.mh.base
        tris = ctx.head_tris()
        used = np.unique(tris)
        remap = -np.ones(b.n, dtype=np.int64)
        remap[used] = np.arange(len(used))
        # lips mask per MH vertex (max over that vertex's UVs)
        img = np.asarray(Image.open(ctx.mh.texture_path("mpfb_lips.jpg")).convert("L"), dtype=np.float64) / 255.0
        faces = b.group_faces("body")
        uv = b.uvs[b.face_uv[faces].ravel()]
        vid = b.face_v[faces].ravel()
        h, w = img.shape
        val = img[np.clip((uv[:, 1] * h).astype(int), 0, h - 1), np.clip((uv[:, 0] * w).astype(int), 0, w - 1)]
        lips = np.zeros(b.n)
        np.maximum.at(lips, vid, val)
        self.cloth = Cloth(ctx.P0[used].copy(), remap[tris], {"lips": lips[used]})
        lip_pts = ctx.P0[used][lips[used] > 0.5]
        self.mouth = lip_pts.mean(axis=0)
        self.mouth_half = float(np.abs(lip_pts[:, 0]).max())
        self.lip_top, self.lip_bottom = float(lip_pts[:, 1].max()), float(lip_pts[:, 1].min())
        front = self.cloth.V[np.abs(self.cloth.V[:, 0]) < 0.012]
        chin = front[(front[:, 1] < self.lip_bottom - 0.012) & (front[:, 2] > self.mouth[2] - 0.045)]
        self.chin_y = float(chin[np.argmax(chin[:, 2] - 2.0 * chin[:, 1])][1])
        self.nose_base = self.lip_top + 0.016
        self.ear_z = float(ctx.joint("head")[2]) + 0.012


def _beard(face: Face, style: str) -> tuple[Cloth, np.ndarray, float]:
    c = face.cloth.copy()
    V = c.V
    x, y, z = np.abs(V[:, 0]), V[:, 1], V[:, 2]
    m, half = face.mouth, face.mouth_half
    not_lips = 0.35 - c.attrs["lips"]
    if style == "mustache":
        f = np.minimum.reduce([y - (face.lip_top + 0.0005), face.nose_base - 0.002 - y, (half + 0.007) - x, not_lips * 0.05])
        depth = 0.0035
    elif style == "goatee":
        f = np.minimum.reduce([(half + 0.006) - x, face.nose_base - 0.003 - y, y - (face.chin_y - 0.014),
                               z - (m[2] - 0.05), not_lips * 0.05])
        depth = 0.0045
    else:  # full / stubble
        cheek = face.lip_top + 0.006 + 0.058 * np.clip((x - half) / 0.055, 0.0, 1.0) ** 1.3
        f = np.minimum.reduce([cheek - y, y - (face.chin_y - 0.022), z - (face.ear_z + 0.004), not_lips * 0.05])
        depth = 0.0006 if style == "stubble" else 0.0055
    c = clip(c, f)
    c = subdivide(c)
    smooth(c, iterations=2, lam=0.4)
    edge = cKDTree(c.V[c.boundary_verts()])
    d = edge.query(c.V)[0]
    alpha = _ss(d / (0.004 if style in ("mustache", "goatee") else 0.008))
    grow = alpha if style != "stubble" else np.ones(len(d))
    c.V = c.V + c.normals() * (0.0006 + depth * grow)[:, None]
    return c, alpha, depth


def beard_parts(ctx) -> list[Part]:
    face = Face(ctx)
    out = []
    for style in ("stubble", "mustache", "goatee", "full"):
        c, alpha, _ = _beard(face, style)
        a = alpha * (0.42 if style == "stubble" else 1.0)
        rng = np.random.default_rng(3)
        lum = 0.9 + 0.2 * rng.random(len(c.V))
        colors = np.concatenate([np.repeat(lum[:, None], 3, axis=1), a[:, None]], axis=1)
        out.append(Part(
            name=f"Beard_{style}", positions=c.V, tris=c.T, colors=colors,
            material=Material("Beard", color=(0.16, 0.11, 0.08, 1), roughness=0.9, alpha_blend=True, role="beard"),
            kind="beard", bind_surface="head", visible=False, meta={"id": style},
        ))
    return out


def _ring(center, rx, ry, n=28):
    a = np.arange(n + 1) * 2 * np.pi / n
    return center + np.stack([rx * np.cos(a), ry * np.sin(a), np.zeros_like(a)], axis=1)


def accessory_parts(ctx) -> list[Part]:
    b = ctx.mh.base
    out = []
    # -- glasses -----------------------------------------------------------
    sheets = []
    eyes = {}
    for side in ("l", "r"):
        ev = ctx.P0[b.group_verts(f"helper-{side}-eye")]
        eyes[side] = (ev.mean(axis=0), float(np.linalg.norm(ev - ev.mean(axis=0), axis=1).mean()))
    r = eyes["l"][1]
    z_front = eyes["l"][0][2] + r + 0.011
    head_mesh = ctx.surface("head")
    hv = head_mesh.P[np.unique(head_mesh.tris)]
    for side, sgn in (("l", 1.0), ("r", -1.0)):
        c = eyes[side][0]
        centre = np.array([c[0] + sgn * 0.002, c[1] - 0.001, z_front])
        ring = _ring(centre, 1.52 * r, 1.22 * r)
        sheets.append(tube(ring[:-1], 0.0016, n_seg=8, seed=70))
        # close the ring: tube() caps its tip, so add the last segment explicitly
        sheets.append(tube(ring[-3:], 0.0016, n_seg=8, seed=71))
        hinge = centre + np.array([sgn * 1.52 * r, 0.004, 0.0])
        ear = hv[(hv[:, 0] * sgn > 0.07)]
        ear_top = ear[np.argmax(ear[:, 1])] if len(ear) else hinge + np.array([sgn * 0.02, 0.0, -0.1])
        tip = np.array([sgn * (abs(ear_top[0]) + 0.004), ear_top[1] + 0.004, ear_top[2] - 0.012])
        k = np.linspace(0, 1, 10)[:, None]
        path = hinge + (tip - hinge) * k
        path[:, 0] += sgn * 0.006 * np.sin(np.pi * k[:, 0])
        sheets.append(tube(path, 0.0014, n_seg=6, seed=72))
    bl, br = eyes["l"][0], eyes["r"][0]
    k = np.linspace(0, 1, 8)[:, None]
    p0 = np.array([bl[0] - 1.50 * r, bl[1] + 0.002, z_front])
    p1 = np.array([br[0] + 1.50 * r, br[1] + 0.002, z_front])
    bridge = p0 + (p1 - p0) * k
    bridge[:, 1] += 0.004 * np.sin(np.pi * k[:, 0])
    sheets.append(tube(bridge, 0.0015, n_seg=6, seed=73))
    V, T, base = [], [], 0
    for s in sheets:
        V.append(s.V)
        T.append(s.T + base)
        base += len(s.V)
    out.append(Part(
        name="Acc_glasses", positions=np.concatenate(V), tris=np.concatenate(T),
        material=Material("Frames", color=(0.06, 0.06, 0.07, 1), roughness=0.35, metallic=0.2, double_sided=True, role="frames"),
        kind="accessory", bind_surface="head", visible=False, meta={"id": "glasses", "offset": "world"},
    ))

    # -- earrings: a small stud under each lobe ---------------------------
    V, T, base = [], [], 0
    for sgn in (1.0, -1.0):
        ear = hv[hv[:, 0] * sgn > 0.068]
        lobe = ear[np.argmin(ear[:, 1])]
        c = lobe + np.array([sgn * 0.0065, -0.0055, 0.002])
        n_th, n_ph = 14, 9
        th = np.arange(n_th) * 2 * np.pi / n_th
        ph = np.linspace(-np.pi / 2, np.pi / 2, n_ph)
        TH, PH = np.meshgrid(th, ph, indexing="ij")
        pts = c + 0.0058 * np.stack([np.cos(PH) * np.cos(TH), np.sin(PH), np.cos(PH) * np.sin(TH)], axis=-1)
        V.append(pts.reshape(-1, 3))
        tri = []
        for i in range(n_th):
            i1 = (i + 1) % n_th
            for j in range(n_ph - 1):
                a, bb = i * n_ph + j, i * n_ph + j + 1
                cc, dd = i1 * n_ph + j, i1 * n_ph + j + 1
                tri += [(a, bb, cc), (bb, dd, cc)]
        T.append(np.asarray(tri, dtype=np.int64) + base)
        base += n_th * n_ph
    out.append(Part(
        name="Acc_earrings", positions=np.concatenate(V), tris=np.concatenate(T),
        material=Material("Jewellery", color=(0.83, 0.68, 0.32, 1), roughness=0.25, metallic=0.9, double_sided=True, role="jewellery"),
        kind="accessory", bind_surface="head", visible=False, meta={"id": "earrings", "offset": "world"},
    ))
    return out

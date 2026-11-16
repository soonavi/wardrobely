"""Garment templates.

Selv does not have a 3D model of the user's actual jacket and never will. What
it has is the garment's category, name, colour and photo. A *template* is the
silhouette that category of garment has - tee, hoodie, wide trousers, midi
dress - cut once here from MakeHuman's clothing helpers, and tinted or
textured per garment by the app.

Every template is bound to the helper surfaces, so it follows the body through
every shape slider with no morph targets of its own, and records which body
vertices it covers so the runtime can drop the skin underneath instead of
hoping it never pokes through.
"""
from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree

from . import geom
from .cloth import Cloth, clip, hang, merge, planar_uv, push_out, smooth, subdivide
from .parts import Material, Part

ARM_BONES = ("upperarm", "lowerarm", "hand", "thumb", "index", "middle", "ring", "pinky")
LEG_BONES = ("thigh", "calf", "foot", "ball")


def _smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


class Suit:
    """The clothing helpers plus the scalar fields garments are cut along."""

    def __init__(self, ctx):
        self.ctx = ctx
        rig = ctx.rig
        j = ctx.joint
        self.H = float(ctx.basis.metrics.stature)
        self.shoulder = {s: j(f"upperarm_{s}") for s in "lr"}
        self.elbow = {s: j(f"lowerarm_{s}") for s in "lr"}
        self.wrist = {s: j(f"hand_{s}") for s in "lr"}
        self.hip = {s: j(f"thigh_{s}") for s in "lr"}
        self.knee = {s: j(f"calf_{s}") for s in "lr"}
        self.ankle = {s: j(f"foot_{s}") for s in "lr"}
        H = self.H
        self.y_chest, self.y_underbust = 0.735 * H, 0.695 * H
        self.y_waist, self.y_hip = 0.635 * H, 0.525 * H
        self.y_crotch = float(self.hip["l"][1]) - 0.085
        self.y_knee, self.y_ankle = float(self.knee["l"][1]), float(self.ankle["l"][1])
        self.torso_z = float(j("spine_02")[2])
        self.body = ctx.surface("body")

        def bone_weight(mhid, prefixes):
            names = rig.names
            idx = np.array([any(n.startswith(p) for p in prefixes) for n in names])
            return (rig.weights[mhid] * idx[rig.joints[mhid]]).sum(axis=1)

        def helper(group):
            tris = ctx.group_tris(group)
            used = np.unique(tris)
            remap = -np.ones(ctx.mh.base.n, dtype=np.int64)
            remap[used] = np.arange(len(used))
            c = Cloth(ctx.P0[used].copy(), remap[tris], {
                "arm": bone_weight(used, ARM_BONES).astype(np.float64),
                "leg": bone_weight(used, LEG_BONES).astype(np.float64),
            })
            return c

        self.tights = helper("helper-tights")
        self.skirt = helper("helper-skirt")

    # -- fields (recomputed from positions, so they survive clipping) ------
    def t_arm(self, V):
        """0 at the shoulder joint, 1 at the elbow, 2 at the wrist."""
        out = np.zeros(len(V))
        for s, sign in (("l", 1.0), ("r", -1.0)):
            m = V[:, 0] * sign >= 0
            a, b, c = self.shoulder[s], self.elbow[s], self.wrist[s]
            u = (V[m] - a) @ (b - a) / ((b - a) @ (b - a))
            v = (V[m] - b) @ (c - b) / ((c - b) @ (c - b))
            out[m] = np.clip(u, -1.0, 1.0) + np.clip(v, 0.0, 2.0)
        return out

    def t_leg(self, V):
        """0 at the hip joint, 1 at the knee, 2 at the ankle, beyond 2 the foot."""
        out = np.zeros(len(V))
        for s, sign in (("l", 1.0), ("r", -1.0)):
            m = V[:, 0] * sign >= 0
            a, b, c = self.hip[s], self.knee[s], self.ankle[s]
            u = (V[m] - a) @ (b - a) / ((b - a) @ (b - a))
            v = (V[m] - b) @ (c - b) / ((c - b) @ (c - b))
            out[m] = np.clip(u, -1.0, 1.0) + np.clip(v, 0.0, 3.0)
        return out


# --------------------------------------------------------------------------
# cutting
# --------------------------------------------------------------------------
NECKS = {
    # centre offset from the neck joint (x, y, z) and radius of the opening
    "crew": ((0.0, 0.046, 0.005), 0.090),
    "scoop": ((0.0, 0.030, 0.045), 0.112),
    "wide": ((0.0, 0.040, 0.010), 0.118),
    "high": ((0.0, 0.075, 0.000), 0.078),
}


def cut_top(suit: Suit, hem_y: float, sleeve: float | None, neck: str = "crew") -> Cloth:
    """Torso from the neckline to `hem_y`, with sleeves to arm-parameter
    `sleeve` (None = sleeveless)."""
    c = suit.tights.copy()
    arm = _smoothstep((c.attrs["arm"] - 0.35) / 0.3)
    if sleeve is None:
        c = clip(c, 0.42 - c.attrs["arm"])
        c = clip(c, c.V[:, 1] - hem_y)
    else:
        # one field for "inside the garment": sleeve length on the arm, hem on the torso
        f = (1 - arm) * (c.V[:, 1] - hem_y) * 4.0 + arm * (sleeve - suit.t_arm(c.V))
        c = clip(c, f)
    centre, radius = NECKS[neck]
    n = suit.ctx.joint("neck_01") + np.asarray(centre)
    c = clip(c, np.linalg.norm(c.V - n, axis=1) - radius)
    return c


def cut_bottom(suit: Suit, waist_y: float, leg: float) -> Cloth:
    """Waist down to leg-parameter `leg` (1 = knee, 2 = ankle)."""
    c = suit.tights.copy()
    c = clip(c, 0.5 - c.attrs["arm"])
    c = clip(c, waist_y - c.V[:, 1])
    c = clip(c, leg - suit.t_leg(c.V) * _smoothstep((c.attrs["leg"] - 0.2) / 0.4))
    return c


def cut_skirt(suit: Suit, waist_y: float, hem_y: float) -> Cloth:
    c = suit.skirt.copy()
    c = clip(c, waist_y - c.V[:, 1])
    c = clip(c, c.V[:, 1] - hem_y)
    return c


def cut_shoe(suit: Suit, top: float) -> Cloth:
    c = suit.tights.copy()
    c = clip(c, c.attrs["leg"] - 0.5)
    c = clip(c, suit.t_leg(c.V) - top)
    return c


# --------------------------------------------------------------------------
# shaping
# --------------------------------------------------------------------------
def finish(suit: Suit, c: Cloth, ease: float, levels: int = 1, min_gap: float | None = None,
           arm_ease: float = 1.0, relax: int = 3) -> Cloth:
    """Tessellate, relax, and stand the cloth off the helper by `ease`.

    `relax` is how much of the body's own relief the cloth forgets: a base
    layer keeps it, a sweater should not show abdominal muscles."""
    for _ in range(levels):
        c = subdivide(c)
    smooth(c, iterations=relax, lam=0.5)
    e = ease * (1.0 + (arm_ease - 1.0) * _smoothstep((c.attrs.get("arm", np.zeros(len(c.V))) - 0.3) / 0.4))
    c.V = c.V + c.normals() * np.asarray(e)[:, None]
    push_out(c, suit.body, ease * 0.9 if min_gap is None else min_gap)
    return c


def drape_torso(suit: Suit, c: Cloth, looseness: float, start_y: float | None = None, taper: float = 0.05) -> None:
    y0 = suit.y_chest if start_y is None else start_y
    hang(c, np.array([0.0, y0, suit.torso_z]), np.array([0.0, -1.0, 0.0]), 0.0, looseness,
         taper=taper, weight=1.0 - _smoothstep((c.attrs["arm"] - 0.25) / 0.35))


def drape_legs(suit: Suit, c: Cloth, looseness: float, start_t: float, taper: float = 0.02) -> None:
    """Hang each trouser leg from `start_t` (0 hip .. 1 knee .. 2 ankle)."""
    for s, sign in (("l", 1.0), ("r", -1.0)):
        a, k, b = suit.hip[s], suit.knee[s], suit.ankle[s]
        origin = a + (k - a) * min(start_t, 1.0) + (b - k) * max(start_t - 1.0, 0.0)
        side = (c.V[:, 0] * sign > 0).astype(np.float64) * _smoothstep((c.attrs["leg"] - 0.35) / 0.3)
        hang(c, origin, b - origin, 0.0, looseness, taper=taper, n_ang=32, weight=side)


def shoe_sole(c: Cloth, thickness: float, rim: float = 0.004) -> np.ndarray:
    """Turn the bottom of a sock into a flat sole of the given thickness.
    Returns a per-vertex tint: 1 on the upper, darker on the sole."""
    floor = float(c.V[:, 1].min())
    # a rounder, longer toe box than a bare foot has
    z0, z1 = float(c.V[:, 2].min()), float(c.V[:, 2].max())
    toe = _smoothstep((c.V[:, 2] - (z0 + 0.55 * (z1 - z0))) / (0.45 * (z1 - z0)))
    low_foot = _smoothstep((floor + 0.07 - c.V[:, 1]) / 0.05)
    c.V[:, 2] += 0.012 * toe * low_foot
    c.V[:, 1] += 0.006 * toe * low_foot * _smoothstep((c.V[:, 1] - floor - 0.02) / 0.03)
    low = _smoothstep((floor + 0.03 - c.V[:, 1]) / 0.03)
    centre = c.V[:, [0, 2]].copy()
    for sign in (1.0, -1.0):
        m = c.V[:, 0] * sign > 0
        centre[m] = c.V[m][:, [0, 2]].mean(axis=0)
    out = geom.unit(np.concatenate([c.V[:, [0]] - centre[:, [0]], np.zeros((len(c.V), 1)), c.V[:, [2]] - centre[:, [1]]], axis=1))
    c.V = c.V + out * (rim * low)[:, None]
    sole = c.V[:, 1] < floor + 0.012
    c.V[:, 1] = np.where(sole, floor - thickness, c.V[:, 1] - thickness * low * 0.35)
    band = c.V[:, 1] < floor - thickness + max(thickness, 0.008) + 0.004
    return np.where(band, 0.32, 1.0)


# --------------------------------------------------------------------------
# templates
# --------------------------------------------------------------------------
def _tops(suit: Suit) -> dict[str, tuple[Cloth, dict]]:
    H = suit.H
    out = {}

    def make(name, hem, sleeve, neck, ease, loose, label, arm_ease=1.0, layer=2, start=None, taper=0.05):
        c = finish(suit, cut_top(suit, hem, sleeve, neck), ease, arm_ease=arm_ease, relax=3 + int(round(14 * loose)))
        if loose > 0:
            drape_torso(suit, c, loose, start_y=start, taper=taper)
            smooth(c, iterations=6, lam=0.45)
            push_out(c, suit.body, ease * 0.9)
        out[name] = (c, {"slot": "top", "label": label, "layer": layer})

    make("tank", suit.y_hip + 0.03, None, "scoop", 0.011, 0.25, "Tank top")
    make("tee", suit.y_hip + 0.01, 0.58, "crew", 0.013, 0.6, "T-shirt", arm_ease=1.5)
    make("crop", suit.y_waist + 0.035, 0.52, "crew", 0.012, 0.35, "Crop top", arm_ease=1.4)
    make("longsleeve", suit.y_hip + 0.01, 1.93, "crew", 0.012, 0.45, "Long-sleeve top", arm_ease=1.2)
    make("shirt", suit.y_hip - 0.02, 1.95, "high", 0.015, 0.8, "Shirt", arm_ease=1.3)
    make("sweater", suit.y_hip - 0.01, 1.96, "crew", 0.02, 0.95, "Sweater", arm_ease=1.25, taper=0.02)
    make("hoodie", suit.y_hip - 0.035, 1.97, "wide", 0.026, 1.0, "Hoodie", arm_ease=1.3, layer=3, taper=0.0)
    make("jacket", suit.y_hip - 0.02, 1.97, "wide", 0.03, 1.0, "Jacket", arm_ease=1.2, layer=4, taper=0.0)
    for name in ("hoodie", "jacket"):
        out[name][1]["slot"] = "outer" if name == "jacket" else "top"
    del H
    return out


def _bottoms(suit: Suit) -> dict[str, tuple[Cloth, dict]]:
    out = {}
    waist = suit.y_waist - 0.03

    def make(name, leg, ease, loose, start, label, taper=0.02, relax=3):
        c = finish(suit, cut_bottom(suit, waist, leg), ease, relax=relax)
        if loose > 0:
            drape_legs(suit, c, loose, start, taper=taper)
            smooth(c, iterations=4, lam=0.45)
            push_out(c, suit.body, ease * 0.9)
        out[name] = (c, {"slot": "bottom", "label": label, "layer": 1})

    make("leggings", 1.97, 0.0045, 0.0, 0.0, "Leggings")
    make("jeans", 1.97, 0.008, 0.55, 1.0, "Jeans", relax=5)
    make("trousers", 2.0, 0.012, 0.95, 0.35, "Wide trousers", taper=0.0, relax=10)
    make("shorts", 0.5, 0.013, 0.9, 0.12, "Shorts", taper=0.0, relax=8)

    for name, hem, label in (("skirt_mini", suit.y_crotch - 0.10, "Mini skirt"),
                             ("skirt_midi", suit.y_knee - 0.10, "Midi skirt"),
                             ("skirt_maxi", suit.y_ankle + 0.06, "Maxi skirt")):
        c = cut_skirt(suit, waist, hem)
        c = subdivide(c)
        smooth(c, iterations=2, lam=0.5)
        c.V = c.V + c.normals() * 0.006
        push_out(c, suit.body, 0.006)
        out[name] = (c, {"slot": "bottom", "label": label, "layer": 1, "skirt": True})
    return out


def _dresses_and_coats(suit: Suit) -> dict[str, tuple[Cloth, dict]]:
    out = {}
    skirt_top = float(suit.skirt.V[:, 1].max())

    def skirted(name, hem, sleeve, neck, ease, loose, label, slot, layer, relax=4):
        # The bodice runs a few centimetres past the top of the skirt helper and
        # sits just outside it, so the two read as one garment with no waist gap.
        bodice = finish(suit, cut_top(suit, skirt_top - 0.05, sleeve, neck), ease, arm_ease=1.2, relax=relax)
        skirt = subdivide(cut_skirt(suit, skirt_top + 1.0, hem))
        smooth(skirt, iterations=2, lam=0.5)
        skirt.V = skirt.V + skirt.normals() * (ease * 0.7)
        c = merge([bodice, skirt])
        # one hang over the merged cloth: the skirt inherits the bodice's width
        drape_torso(suit, c, loose, taper=0.03)
        smooth(c, iterations=5, lam=0.45)
        push_out(c, suit.body, ease * 0.7)
        out[name] = (c, {"slot": slot, "label": label, "layer": layer, "skirt": True})

    skirted("dress_mini", suit.y_crotch - 0.12, None, "scoop", 0.010, 0.35, "Mini dress", "dress", 2)
    skirted("dress_midi", suit.y_knee - 0.10, 0.5, "scoop", 0.010, 0.35, "Midi dress", "dress", 2)
    skirted("dress_maxi", suit.y_ankle + 0.06, None, "scoop", 0.010, 0.35, "Maxi dress", "dress", 2)
    skirted("coat", suit.y_knee + 0.05, 1.97, "wide", 0.032, 1.0, "Coat", "outer", 4, relax=16)
    return out


def _shoes(suit: Suit) -> dict[str, tuple[Cloth, dict]]:
    out = {}
    for name, top, ease, sole, label in (("sneakers", 1.86, 0.007, 0.016, "Sneakers"),
                                         ("boots", 1.42, 0.009, 0.02, "Boots"),
                                         ("flats", 1.99, 0.004, 0.006, "Flats")):
        # heavy relaxation melts the sock's toes into a shoe's rounded last
        c = finish(suit, cut_shoe(suit, top), ease, relax=18)
        c.attrs["tint"] = shoe_sole(c, sole)
        out[name] = (c, {"slot": "shoes", "label": label, "layer": 2, "sole": sole})
    return out


def _base(suit: Suit) -> dict[str, tuple[Cloth, dict]]:
    """The always-on base layer. The body underneath is anatomically shaped;
    this is what makes the avatar presentable with nothing else equipped."""
    top = cut_top(suit, suit.y_underbust - 0.045, None, "scoop")
    top = finish(suit, top, 0.004, min_gap=0.003)
    bottom = finish(suit, cut_bottom(suit, suit.y_hip + 0.055, 0.2), 0.004, min_gap=0.003)
    return {
        "base_top": (top, {"slot": "base", "label": "Base top", "layer": 0}),
        "base_bottom": (bottom, {"slot": "base", "label": "Base bottom", "layer": 0}),
    }


# --------------------------------------------------------------------------
# part emission
# --------------------------------------------------------------------------
def _hidden_body_verts(suit: Suit, c: Cloth, reach: float = 0.03, border: float = 0.03) -> list[list[int]]:
    """Body vertices safely under this garment, as [start, end) runs of MH ids.

    "Safely" means close beneath the cloth and well back from every opening,
    so removing the skin there can never show a hole at a cuff or hem.
    """
    body_ids = np.unique(suit.body.tris)
    P = suit.body.P[body_ids]
    lo, hi = c.V.min(axis=0) - reach, c.V.max(axis=0) + reach
    cand = np.all((P >= lo) & (P <= hi), axis=1)
    if not cand.any():
        return []
    g = geom.TriMesh(c.V, c.T)
    _, _, q = g.closest(P[cand], k=8)
    near = np.linalg.norm(P[cand] - q, axis=1) < reach
    edge = cKDTree(c.V[c.boundary_verts()])
    far_from_edge = edge.query(P[cand])[0] > border
    ids = np.sort(body_ids[cand][near & far_from_edge])
    runs: list[list[int]] = []
    for i in ids:
        if runs and runs[-1][1] == i:
            runs[-1][1] = int(i) + 1
        else:
            runs.append([int(i), int(i) + 1])
    return runs


def garment_parts(ctx) -> list[Part]:
    suit = Suit(ctx)
    table: dict[str, tuple[Cloth, dict]] = {}
    for group in (_base, _tops, _bottoms, _dresses_and_coats, _shoes):
        table.update(group(suit))
    parts = []
    for name, (c, meta) in table.items():
        c = c.compact()
        is_base = meta["slot"] == "base"
        tint = c.attrs.get("tint")
        parts.append(Part(
            name=f"G_{name}", positions=c.V, tris=c.T, uvs=planar_uv(c),
            colors=None if tint is None else np.repeat(tint[:, None], 3, axis=1),
            material=Material("BaseLayer" if is_base else "Cloth",
                              color=(0.80, 0.78, 0.75, 1) if is_base else (0.55, 0.57, 0.62, 1),
                              roughness=0.85, double_sided=True, role="base" if is_base else "cloth"),
            kind="base" if is_base else "garment", bind_surface="cloth", visible=is_base,
            # World-axis offsets: cloth that hangs centimetres off the body must
            # not swing every time the triangle under it tilts.
            meta={"id": name, **meta, "offset": "world", "hides": _hidden_body_verts(suit, c)},
        ))
    return parts

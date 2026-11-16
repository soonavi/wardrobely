"""Procedural hairstyles.

No licensed hair asset is reachable from the build, and none is needed: every
style here is generated from the head it sits on. A hairstyle is a handful of
swept surfaces in head-centred polar coordinates -

* a **cap** that hugs the scalp from the crown down to a hairline,
* **curtains** that leave the head and hang (bob, long, wavy, curly),
* a **fringe** over the forehead,
* **tubes** and **blobs** for tails, buns and braids -

shaded with per-vertex streaks so a single flat hair colour still reads as
strands. Because the surfaces are built from the scalp's measured radius in
every direction, the hairline, ear clearance and volume are all real distances
on this head, and binding them back to the head means they follow face-shape
and feature targets.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import gaussian_filter

from . import geom
from .parts import Material, Part

DEG = np.pi / 180.0


def _dir(theta, phi):
    """Unit direction for azimuth theta (0 = front, +90deg = character's left)
    and elevation phi."""
    return np.stack([np.cos(phi) * np.sin(theta), np.sin(phi), np.cos(phi) * np.cos(theta)], axis=-1)


def _smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


class Head:
    """Polar model of the neutral head: scalp radius in every direction."""

    N_TH, N_PH = 180, 91

    def __init__(self, ctx):
        self.ctx = ctx
        mesh = ctx.surface("head")
        hv = np.unique(mesh.tris)
        H = mesh.P[hv]
        self.top = float(H[:, 1].max())
        self.C = np.array([0.0, self.top - 0.105, 0.5 * (H[:, 2].min() + H[:, 2].max()) - 0.005])
        th = np.arange(self.N_TH) * 2 * np.pi / self.N_TH
        ph = np.linspace(-90, 90, self.N_PH) * DEG
        TH, PH = np.meshgrid(th, ph, indexing="ij")
        first, last = geom.radial_table(mesh, self.C, _dir(TH, PH).reshape(-1, 3))
        self.first = self._clean(first.reshape(self.N_TH, self.N_PH))
        # "Over the ears": the silhouette including the ear, but capped and
        # blurred into a soft bulge - the raw ear outline makes horns.
        raw_last = np.where(np.isnan(last), first, last).reshape(self.N_TH, self.N_PH)
        raw_first = np.where(np.isnan(first), 0.075, first).reshape(self.N_TH, self.N_PH)
        cover = np.maximum(raw_first, np.minimum(np.where(np.isnan(raw_last), raw_first, raw_last), raw_first + 0.02))
        self.last = np.maximum(gaussian_filter(cover, sigma=(4.0, 3.0), mode=("wrap", "nearest")), self.first)
        self.jaw_y = self.top - 0.215
        # Where hair leaves the head it must clear the neck, shoulders and back.
        self.body = geom.TriMesh(ctx.P0, np.concatenate([ctx.group_tris("helper-tights"), ctx.head_tris()]))
        self.axis_z = float(ctx.joint("neck_01")[2])

    @staticmethod
    def _clean(tbl):
        """Fill misses (rays out through the open neck) and take the facets off."""
        bad = np.isnan(tbl)
        tbl = np.where(bad, 0.075, tbl)
        return gaussian_filter(tbl, sigma=(1.6, 1.2), mode=("wrap", "nearest"))

    def radius(self, theta, phi, last=False):
        tbl = self.last if last else self.first
        t = (np.asarray(theta) % (2 * np.pi)) / (2 * np.pi) * self.N_TH
        p = (np.clip(np.asarray(phi), -90 * DEG, 90 * DEG) / DEG + 90) / 180 * (self.N_PH - 1)
        t0 = np.floor(t).astype(int)
        p0 = np.clip(np.floor(p).astype(int), 0, self.N_PH - 2)
        ft, fp = t - t0, p - p0
        t0, t1 = t0 % self.N_TH, (t0 + 1) % self.N_TH
        return ((1 - ft) * (1 - fp) * tbl[t0, p0] + ft * (1 - fp) * tbl[t1, p0]
                + (1 - ft) * fp * tbl[t0, p0 + 1] + ft * fp * tbl[t1, p0 + 1])

    def point(self, theta, phi, r):
        return self.C + np.asarray(r)[..., None] * _dir(np.asarray(theta), np.asarray(phi))

    def envelope(self, theta, y):
        """Horizontal distance from the neck/torso axis to the body surface at
        height y in direction theta (first wall met from inside)."""
        theta, y = np.atleast_1d(theta), np.atleast_1d(y)
        out = np.zeros(len(theta))
        for i, (t, yy) in enumerate(zip(theta, y)):
            d = np.array([[np.sin(t), 0.0, np.cos(t)]])
            f, _ = geom.radial_table(self.body, np.array([0.0, yy, self.axis_z]), d)
            out[i] = 0.05 if np.isnan(f[0]) else f[0]
        return out


# Hairline: elevation (deg) of the edge of the scalp as seen from the head
# centre, against |azimuth| (deg). Front is high on the forehead; it drops at
# the temple, dips into a sideburn in front of the ear, lifts over the ear and
# falls to the nape.
_HAIRLINE = PchipInterpolator(
    [0, 22, 40, 55, 68, 78, 92, 108, 128, 150, 180],
    [47, 46, 40, 27, 6, -4, 10, -4, -22, -31, -35],
)


def hairline(theta):
    a = np.abs(((np.asarray(theta) + np.pi) % (2 * np.pi)) - np.pi) / DEG
    return _HAIRLINE(a) * DEG


def _streaks(theta, seed, strength=0.16):
    """Soft light/dark bands running root to tip, so flat colour reads as strands."""
    rng = np.random.default_rng(seed)
    out = np.zeros_like(np.asarray(theta, dtype=float))
    for k, amp in ((9, 0.5), (17, 0.3), (31, 0.2), (53, 0.15)):
        out += amp * np.sin(k * theta + rng.uniform(0, 2 * np.pi))
    return 1.0 + strength * out


@dataclass
class Sheet:
    V: np.ndarray
    T: np.ndarray
    lum: np.ndarray


def _grid_tris(n_u, n_v, wrap_u, base=0, flip=False):
    tris = []
    for i in range(n_u if wrap_u else n_u - 1):
        i1 = (i + 1) % n_u
        for j in range(n_v - 1):
            a, b = base + i * n_v + j, base + i * n_v + j + 1
            c, d = base + i1 * n_v + j, base + i1 * n_v + j + 1
            tris += [(a, c, b), (b, c, d)] if flip else [(a, b, c), (b, d, c)]
    return np.asarray(tris, dtype=np.int64)


def cap(h: Head, thick, n_th=132, n_s=28, over_ears=False, drop=0.0, seed=1, bumps=None) -> Sheet:
    """Scalp-hugging shell from the crown to the hairline.

    `thick(theta, s)` is hair depth in metres (s: 0 crown .. 1 hairline);
    `drop` lowers the hairline by that many radians (styles that cover the
    nape or the ears); `bumps(theta, phi)` adds a radial texture (curls).
    """
    th = np.arange(n_th) * 2 * np.pi / n_th
    s = np.linspace(0.0, 1.0, n_s)
    TH, S = np.meshgrid(th, s, indexing="ij")
    end = hairline(TH) - drop
    PH = 90 * DEG - S * (90 * DEG - end)
    r = h.radius(TH, PH, last=over_ears)
    t = thick(TH, S) * _smooth((1.0 - S) / 0.16) + 0.0012
    if bumps is not None:
        t = t + bumps(TH, PH) * _smooth((1.0 - S) / 0.3)
    V = h.point(TH, PH, r + t).reshape(-1, 3)
    lum = (_streaks(TH, seed) * (0.9 + 0.14 * S)).reshape(-1)
    return Sheet(V, _grid_tris(n_th, n_s, True, flip=True), lum)


def curtain(h: Head, th0, th1, y_end, start_thick, n_th=64, n_y=26, steer=None, clearance=0.012,
            wave=None, taper=0.0, tuck=0.0, seed=2, over_ears=True) -> Sheet:
    """Hair that leaves the head between azimuths th0..th1 and hangs to y_end.

    Each column starts inside the cap and falls under gravity, held off the
    body by `clearance`. `steer(theta)` gives the azimuth a column drifts
    toward as it falls (side hair sliding in front of or behind the shoulder).
    `tuck` curls the ends inward (a bob); `taper` thins the hem.
    """
    th = np.linspace(th0, th1, n_th)
    k = np.linspace(0.0, 1.0, n_y)
    V = np.zeros((n_th, n_y, 3))
    lum = np.zeros((n_th, n_y))
    y_end = np.broadcast_to(np.asarray(y_end, dtype=float), th.shape)
    for i, t in enumerate(th):
        phi0 = hairline(t) + 16 * DEG
        p0 = h.point(t, phi0, h.radius(t, phi0, last=over_ears) + start_thick)
        y = p0[1] + (y_end[i] - p0[1]) * k ** 1.15
        target = steer(t) if steer is not None else t
        fall = _smooth((h.jaw_y - y) / 0.09)              # drift only once clear of the jaw
        t_eff = t + (target - t) * fall
        rho0 = np.hypot(p0[0], p0[2] - h.axis_z)
        env = h.envelope(t_eff, y) + clearance
        rho = np.maximum(rho0 * (1 - 0.25 * fall), env)
        rho = rho0 + (rho - rho0) * _smooth((p0[1] - y) / 0.035)
        if tuck:
            rho = rho - tuck * _smooth((k - 0.72) / 0.28) ** 2
        if wave is not None:
            rho = rho + wave(t, p0[1] - y)
        # running relaxation: hair cannot kink sharply, so limit the slope
        for j in range(1, n_y):
            rho[j] = np.clip(rho[j], rho[j - 1] - 0.012, rho[j - 1] + 0.016)
        V[i, :, 0] = rho * np.sin(t_eff)
        V[i, :, 1] = y
        V[i, :, 2] = h.axis_z + rho * np.cos(t_eff)
        lum[i] = _streaks(np.full(n_y, t), seed) * (0.98 + 0.12 * k) * (1.0 - taper * k ** 3)
    return Sheet(V.reshape(-1, 3), _grid_tris(n_th, n_y, False, flip=(th1 > th0)), lum.reshape(-1))


def fringe(h: Head, width_deg, length_deg, lift=0.007, n_th=40, n_s=12, sweep=0.0, seed=3) -> Sheet:
    """Bangs: a sheet from above the hairline down the forehead."""
    th = np.linspace(-width_deg, width_deg, n_th) * DEG
    s = np.linspace(0.0, 1.0, n_s)
    TH, S = np.meshgrid(th, s, indexing="ij")
    top = hairline(TH) + 14 * DEG
    edge = 1.0 - 0.45 * (np.abs(TH) / (width_deg * DEG)) ** 2
    PH = top - S * (14 * DEG + length_deg * DEG * edge)
    r = h.radius(TH + sweep * S, PH) + lift * (1 - 0.35 * S)
    V = h.point(TH + sweep * S, PH, r).reshape(-1, 3)
    lum = (_streaks(TH, seed) * (0.95 + 0.1 * S)).reshape(-1)
    return Sheet(V, _grid_tris(n_th, n_s, False, flip=True), lum)


def tube(path, radii, n_seg=14, twist=0.0, seed=4, bump=0.0) -> Sheet:
    """A swept tube along `path` (K, 3) with per-point `radii` (K,)."""
    path = np.asarray(path, dtype=float)
    radii = np.broadcast_to(np.asarray(radii, dtype=float), (len(path),))
    tang = geom.unit(np.gradient(path, axis=0))
    ref = np.array([0.0, 0.0, 1.0])
    V, lum = [], []
    for i, (p, t, r) in enumerate(zip(path, tang, radii)):
        n1 = geom.unit(np.cross(t, ref) if abs(t @ ref) < 0.95 else np.cross(t, np.array([1.0, 0, 0])))
        n2 = np.cross(t, n1)
        a = np.arange(n_seg) * 2 * np.pi / n_seg + twist * i
        rr = r * (1.0 + bump * np.sin(3 * a + 1.9 * i))
        V.append(p + rr[:, None] * (np.cos(a)[:, None] * n1 + np.sin(a)[:, None] * n2))
        lum.append(_streaks(a * 0.5 + i * 0.35, seed, 0.2))
    V = np.concatenate(V)
    T = _grid_tris(len(path), n_seg, False).reshape(-1, 3)
    # rings run around the short axis here, so wrap the seam explicitly
    seam = []
    for i in range(len(path) - 1):
        a, b = i * n_seg + n_seg - 1, i * n_seg
        c, d = (i + 1) * n_seg + n_seg - 1, (i + 1) * n_seg
        seam += [(a, b, c), (b, d, c)]
    T = np.concatenate([T, np.asarray(seam, dtype=np.int64)])
    # close the tip
    tip = len(V)
    V = np.concatenate([V, path[-1:]])
    last = (len(path) - 1) * n_seg
    T = np.concatenate([T, np.asarray([(last + j, last + (j + 1) % n_seg, tip) for j in range(n_seg)])])
    return Sheet(V, T, np.concatenate(lum + [np.array([1.0])]))


def blob(center, radii, n_th=28, n_ph=16, seed=5, bump=0.06) -> Sheet:
    th = np.arange(n_th) * 2 * np.pi / n_th
    ph = np.linspace(-90, 90, n_ph) * DEG
    TH, PH = np.meshgrid(th, ph, indexing="ij")
    d = _dir(TH, PH)
    swirl = 1.0 + bump * np.sin(5 * TH + 4 * PH)
    V = (np.asarray(center) + d * np.asarray(radii) * swirl[..., None]).reshape(-1, 3)
    return Sheet(V, _grid_tris(n_th, n_ph, True, flip=True), (_streaks(TH + PH, seed, 0.2)).reshape(-1))


# --------------------------------------------------------------------------
# the twelve styles the character creator offers (minus "bald", which is no mesh)
# --------------------------------------------------------------------------
def _top_heavy(top, side):
    """Depth that is `top` over the crown and `side` round the hairline."""
    return lambda TH, S: side + (top - side) * (1 - _smooth((S - 0.25) / 0.6))


def _forward_target(t, lead=38):
    """Azimuth a side strand slides to as it falls in front of the shoulder."""
    return lead * DEG if np.sin(t) > 0 else 2 * np.pi - lead * DEG


def _split_curtains(h, y_side, y_back, start, front_open=58, drift=True, **kw):
    """Left, back and right sheets: side hair falls in front of the shoulder,
    back hair behind it, so nothing has to drape over the shoulder itself."""
    a, split = front_open * DEG, 104 * DEG

    def fwd(t):
        # map the sheet's own span onto a span in front of the shoulder, so it
        # arrives as a panel of hair rather than collapsing to a rope
        left = np.sin(t) > 0
        u = ((t if left else 2 * np.pi - t) - a) / (split - a)
        tgt = (30 + 24 * u) * DEG
        return tgt if left else 2 * np.pi - tgt

    back = lambda t: np.pi + (t - np.pi) * 0.82
    # a rounded hem: longest at the centre of the back
    th_back = np.linspace(split, 2 * np.pi - split, 58)
    y_back = y_back + 0.03 * (1 - np.cos(th_back - np.pi)) / (1 - np.cos(split - np.pi))
    return [
        curtain(h, a, split, y_side, start, n_th=26, steer=fwd if drift else None, seed=11, **kw),
        curtain(h, split, 2 * np.pi - split, y_back, start, n_th=58, steer=back, seed=12, **kw),
        curtain(h, 2 * np.pi - split, 2 * np.pi - a, y_side, start, n_th=26, steer=fwd if drift else None, seed=13, **kw),
    ]


def style_buzz(h):
    return [cap(h, lambda TH, S: 0.0028 + 0 * TH, seed=21)]


def style_short(h):
    return [cap(h, _top_heavy(0.022, 0.007), seed=22), fringe(h, 34, 9, lift=0.012, seed=23)]


def style_side_part(h):
    def thick(TH, S):
        lean = 1.0 + 0.45 * np.sin(TH)           # volume swept to the character's left
        return (0.008 + 0.022 * (1 - _smooth((S - 0.2) / 0.6))) * lean
    return [cap(h, thick, seed=24), fringe(h, 40, 16, lift=0.014, sweep=0.5, seed=25)]


def style_bob(h):
    chin = h.top - 0.235
    sheets = [cap(h, _top_heavy(0.02, 0.013), drop=10 * DEG, seed=26)]
    sheets += _split_curtains(h, chin, chin - 0.012, 0.014, front_open=52, tuck=0.012, clearance=0.018, drift=False)
    sheets.append(fringe(h, 36, 20, lift=0.012, seed=27))
    return sheets


def style_long_straight(h):
    sheets = [cap(h, _top_heavy(0.017, 0.012), drop=10 * DEG, seed=28)]
    sheets += _split_curtains(h, h.top - 0.40, h.top - 0.50, 0.013, taper=0.25)
    return sheets


def style_wavy(h):
    rng = np.random.default_rng(7)
    ph = rng.uniform(0, 2 * np.pi, 8)
    wave = lambda t, d: 0.011 * _smooth(d / 0.08) * np.sin(d / 0.058 * 2 * np.pi + 2.5 * np.sin(3 * t + ph[0]))
    sheets = [cap(h, _top_heavy(0.021, 0.015), drop=10 * DEG, seed=29)]
    sheets += _split_curtains(h, h.top - 0.36, h.top - 0.43, 0.016, wave=wave, clearance=0.018, taper=0.2)
    return sheets


def _curl_bumps(amp, f_th, f_ph, seed):
    rng = np.random.default_rng(seed)
    p = rng.uniform(0, 2 * np.pi, 6)
    def bumps(TH, PH):
        return amp * (0.5 * np.sin(f_th * TH + p[0]) * np.sin(f_ph * PH + p[1])
                      + 0.3 * np.sin(1.7 * f_th * TH + p[2]) * np.sin(1.3 * f_ph * PH + p[3])
                      + 0.2 * np.sin(2.6 * f_th * TH + p[4] + 2 * PH))
    return bumps


def style_curly(h):
    wave = lambda t, d: 0.008 * _smooth(d / 0.05) * np.sin(d / 0.04 * 2 * np.pi + 3 * np.sin(4 * t))
    sheets = [cap(h, _top_heavy(0.034, 0.026), drop=12 * DEG, seed=30,
                  bumps=_curl_bumps(0.0075, 11, 12, 31))]
    sheets += _split_curtains(h, h.top - 0.30, h.top - 0.33, 0.026, wave=wave, clearance=0.026)
    return sheets


def style_afro(h):
    def thick(TH, S):
        return 0.062 + 0.02 * (1 - _smooth((S - 0.3) / 0.7)) - 0.012 * np.cos(TH) * _smooth((S - 0.5) / 0.5)
    return [cap(h, thick, n_th=150, n_s=40, over_ears=True, drop=4 * DEG, seed=32,
                bumps=_curl_bumps(0.007, 23, 26, 33))]


def _tail_path(h, length, out=0.055, n=18):
    root = h.point(np.pi, 34 * DEG, h.radius(np.pi, 34 * DEG) + 0.012)
    k = np.linspace(0, 1, n)
    path = np.zeros((n, 3))
    path[:, 0] = 0.0
    path[:, 2] = root[2] - out * np.sin(np.pi * np.minimum(k * 2.2, 1.0) * 0.5) - 0.02 * k
    path[:, 1] = root[1] + 0.02 * np.sin(np.pi * np.minimum(k * 4, 1.0)) - length * k ** 1.3
    return root, path, k


def style_ponytail(h):
    _, path, k = _tail_path(h, 0.30)
    radii = 0.021 * (0.75 + 0.5 * np.sin(np.pi * np.minimum(k * 3, 1.0) * 0.5)) * (1 - 0.72 * k ** 2.2)
    return [cap(h, lambda TH, S: 0.0065 + 0 * TH, drop=2 * DEG, seed=34), tube(path, radii, n_seg=18, seed=35)]


def style_bun(h):
    c = h.point(np.pi, 48 * DEG, h.radius(np.pi, 48 * DEG) + 0.028)
    return [cap(h, lambda TH, S: 0.0065 + 0 * TH, drop=2 * DEG, seed=36), blob(c, (0.043, 0.039, 0.041), seed=37)]


def style_braids(h):
    sheets = [cap(h, lambda TH, S: 0.009 + 0 * TH, drop=8 * DEG, seed=38,
                  bumps=lambda TH, PH: 0.0022 * np.sin(22 * TH))]
    n_braids = 18
    for b in range(n_braids):
        t = (64 + (360 - 128) * b / (n_braids - 1)) * DEG
        phi0 = hairline(t) + 10 * DEG
        root = h.point(t, phi0, h.radius(t, phi0, last=True) + 0.009)
        front = abs(((t + np.pi) % (2 * np.pi)) - np.pi) < 104 * DEG
        target = _forward_target(t, 36) if front else np.pi + (t - np.pi) * 0.8
        k = np.linspace(0, 1, 16)
        y = root[1] - (0.36 + 0.03 * np.sin(b * 2.4)) * k ** 1.1
        fall = _smooth((root[1] - y) / 0.10)
        t_eff = t + (target - t) * fall
        rho0 = np.hypot(root[0], root[2] - h.axis_z)
        rho = np.maximum(rho0 * (1 - 0.2 * fall), h.envelope(t_eff, y) + 0.014)
        rho = rho0 + (rho - rho0) * _smooth((root[1] - y) / 0.035)
        for j in range(1, len(k)):
            rho[j] = np.clip(rho[j], rho[j - 1] - 0.012, rho[j - 1] + 0.016)
        path = np.stack([rho * np.sin(t_eff), y, h.axis_z + rho * np.cos(t_eff)], axis=1)
        sheets.append(tube(path, 0.0062 * (1 - 0.35 * k ** 3), n_seg=8, twist=0.9, bump=0.18, seed=40 + b))
    return sheets


STYLES = {
    "buzz": style_buzz,
    "short": style_short,
    "sidePart": style_side_part,
    "bob": style_bob,
    "longStraight": style_long_straight,
    "wavy": style_wavy,
    "curly": style_curly,
    "afro": style_afro,
    "ponytail": style_ponytail,
    "bun": style_bun,
    "braids": style_braids,
}


def hair_parts(ctx, only: tuple[str, ...] | None = None) -> list[Part]:
    h = Head(ctx)
    out = []
    for name, fn in STYLES.items():
        if only and name not in only:
            continue
        sheets = fn(h)
        V, T, L, base = [], [], [], 0
        for s in sheets:
            V.append(s.V)
            T.append(s.T + base)
            L.append(s.lum)
            base += len(s.V)
        V, T, L = np.concatenate(V), np.concatenate(T), np.clip(np.concatenate(L), 0.55, 1.35)
        out.append(Part(
            name=f"Hair_{name}", positions=V, tris=T, colors=np.repeat(L[:, None], 3, axis=1),
            material=Material("Hair", color=(0.23, 0.16, 0.12, 1), roughness=0.42, double_sided=True, role="hair"),
            kind="hair", bind_surface="hair", visible=False, meta={"id": name, "offset": "world"},
        ))
    return out

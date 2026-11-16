"""The shape basis: one neutral body plus the named morph targets Selv drives.

MakeHuman's macro model is multilinear (a heavy woman and a heavy man are
different targets). glTF morph targets are linear. The bridge is a small set of
cross terms: each gendered axis ships an averaged target plus an `X_*` target
holding half the male-minus-female difference, and the runtime weights the
cross term by `frame * axis`. That reproduces MakeHuman's bilinear blend of
(gender, axis) exactly with two targets per pole instead of a corner per
combination.

Every target is calibrated here to a physical unit, so a weight is a
measurement, not a slider position:

    Tall / Short            +-12 cm of stature per unit weight
    Heavy / Thin            +-7 BMI points per unit weight
    ChestLarge / ChestSmall +-9 cm of chest girth
    WaistWide / WaistNarrow +-9 cm of waist girth
    HipWide / HipNarrow     +-9 cm of hip girth

Those are the same units `measurementsToShapeParams` in the app already uses
(`app/src/features/avatar3d/bodyModel.ts`), so a user's real height and weight
map straight onto the mesh.

Target NAMES are a contract with the app. The eight original names
(Short/Tall, Thin/Heavy, ChestSmall/ChestLarge, HipNarrow/HipWide) are pinned by
`morphContract.test.ts`; every other name is chosen to contain none of the
substrings that test's fuzzy matcher looks for, and the build asserts it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import geom
from .macro import detail_delta, macro_delta
from .mhdata import MHData

BODY_DENSITY = 1010.0   # kg / m^3, whole-body average
UNIT_STATURE_M = 0.12
UNIT_BMI = 7.0
UNIT_GIRTH_M = 0.09

# Substrings the app's legacy fuzzy matcher treats as an axis name. No
# non-contract target may contain one (see bodyModel.ts MORPH_TARGET_NAME_CANDIDATES).
RESERVED_SUBSTRINGS = (
    "height", "stature", "tall", "short", "volume", "weight", "mass", "bmi", "bodyfat",
    "heavy", "chubby", "fat", "overweight", "obese", "thin", "slim", "skinny", "lean",
    "underweight", "chest", "bust", "pecs", "flatchest", "hip", "hips", "glute", "buttock",
)
CONTRACT_NAMES = ("Short", "Tall", "Thin", "Heavy", "ChestSmall", "ChestLarge", "HipNarrow", "HipWide")


@dataclass
class Metrics:
    stature: float
    bmi: float
    chest: float
    waist: float
    hip: float

    def as_dict(self) -> dict:
        return {k: round(float(v), 5) for k, v in self.__dict__.items()}


@dataclass
class ShapeBasis:
    base: np.ndarray                      # (N, 3) neutral body, feet on y = 0
    targets: dict[str, np.ndarray] = field(default_factory=dict)
    metrics: Metrics | None = None
    target_metrics: dict[str, dict] = field(default_factory=dict)
    ground_offset: float = 0.0


class Measurer:
    """Measures a body the way a tape and a scale would."""

    def __init__(self, mh: MHData, dominant_bone: np.ndarray, bone_names: list[str]):
        b = mh.base
        self.body_verts = b.group_verts("body")
        body_faces = b.group_faces("body")
        self.tris = geom.quads_to_tris(b.face_v[body_faces])
        torso_bones = {i for i, n in enumerate(bone_names)
                       if n in ("pelvis", "spine_01", "spine_02", "spine_03", "clavicle_l", "clavicle_r",
                                "neck_01", "thigh_l", "thigh_r", "Root")}
        dom = dominant_bone[self.tris]
        self.torso_tris = self.tris[np.isin(dom, list(torso_bones)).all(axis=1)]

    def measure(self, P: np.ndarray) -> Metrics:
        ys = P[self.body_verts, 1]
        foot, top = ys.min(), ys.max()
        h = top - foot
        vol = abs(geom.signed_volume(P, self.tris))
        bmi = vol * BODY_DENSITY / (h * h)

        def scan(lo, hi, pick):
            vals = [geom.girth(P, self.torso_tris, foot + f * h) for f in np.linspace(lo, hi, 19)]
            return float(pick(vals))

        return Metrics(
            stature=float(h),
            bmi=float(bmi),
            chest=scan(0.70, 0.76, max),
            waist=scan(0.59, 0.66, min),
            hip=scan(0.47, 0.55, max),
        )


def _relax_delta(mh: MHData, delta: np.ndarray, iterations: int = 12, lam: float = 0.5) -> np.ndarray:
    """Laplacian-smooth a target's *displacement field* over the mesh.

    MakeHuman's heaviest body carries sculpted folds. At its own weight they
    are detail; pushed past it - and real people are routinely heavier than
    MakeHuman's maximum - linear extrapolation turns every fold into a ridge.
    Smoothing the displacement (not the surface) keeps where the volume goes
    and drops the creases, so a weight of 2.0 is a bigger body, not a lumpier
    one. Joint-marker cubes are left alone: they define the skeleton.
    """
    b = mh.base
    keep = np.array([not g.startswith("joint-") for g in b.groups])
    quads = b.face_v[keep[b.face_group]]
    e = np.concatenate([quads[:, [0, 1]], quads[:, [1, 2]], quads[:, [2, 3]], quads[:, [3, 0]]])
    e = np.unique(np.sort(e, axis=1), axis=0)
    deg = np.zeros(b.n)
    np.add.at(deg, e[:, 0], 1)
    np.add.at(deg, e[:, 1], 1)
    on = deg > 0
    d = delta.copy()
    for _ in range(iterations):
        acc = np.zeros_like(d)
        np.add.at(acc, e[:, 0], d[e[:, 1]])
        np.add.at(acc, e[:, 1], d[e[:, 0]])
        d[on] += lam * (acc[on] / deg[on][:, None] - d[on])
    return d


def _sym(mh: MHData, name: str) -> np.ndarray:
    """Sum of the left and right halves of a per-side detail target."""
    return detail_delta(mh, name.replace("{s}", "l")) + detail_delta(mh, name.replace("{s}", "r"))


def build_shape_basis(mh: MHData, measurer_factory) -> ShapeBasis:
    b = mh.base

    def mac(**kw) -> np.ndarray:
        return macro_delta(mh, **kw)

    neutral = mac()
    P0 = b.verts + neutral
    ground = -float(P0[b.group_verts("body"), 1].min())
    P0 = P0 + np.array([0.0, ground, 0.0])
    measurer: Measurer = measurer_factory()
    m0 = measurer.measure(P0)

    raw: dict[str, np.ndarray] = {}

    # -- frame (feminine <-> masculine), bidirectional: weight = frame in [-1, 1]
    raw["Masculine"] = (mac(gender=1.0) - mac(gender=0.0)) / 2.0

    # -- gendered macro axes: averaged target + cross term ----------------
    def gendered(kw: dict) -> tuple[np.ndarray, np.ndarray]:
        f = mac(gender=0.0, **kw) - mac(gender=0.0)
        m = mac(gender=1.0, **kw) - mac(gender=1.0)
        return (f + m) / 2.0, (m - f) / 2.0

    heavy, heavy_x = (_relax_delta(mh, d) for d in gendered({"weight": 1.0}))
    thin, thin_x = gendered({"weight": 0.0})
    toned, toned_x = gendered({"muscle": 1.0})
    soft, soft_x = gendered({"muscle": 0.0})
    tall, tall_x = gendered({"height": 1.0})
    short, short_x = gendered({"height": 0.0})

    def calibrate(delta: np.ndarray, attr: str, unit: float) -> float:
        got = getattr(measurer.measure(P0 + delta), attr) - getattr(m0, attr)
        if abs(got) < 1e-6:
            raise RuntimeError(f"target does not move {attr}; cannot calibrate")
        return unit / got

    k = calibrate(heavy, "bmi", UNIT_BMI)
    raw["Heavy"], raw["X_Gain"] = heavy * k, heavy_x * k
    k = calibrate(thin, "bmi", -UNIT_BMI)
    raw["Thin"], raw["X_Loss"] = thin * k, thin_x * k
    k = calibrate(tall, "stature", UNIT_STATURE_M)
    raw["Tall"], raw["X_Up"] = tall * k, tall_x * k
    k = calibrate(short, "stature", -UNIT_STATURE_M)
    raw["Short"], raw["X_Down"] = short * k, short_x * k
    raw["Toned"], raw["X_Tone"] = toned, toned_x
    raw["Soft"], raw["X_Soft"] = soft, soft_x

    # -- regional girths (gender-neutral MakeHuman "measure" targets) -----
    def girth_pair(pos_name, neg_name, incr, decr, attr):
        d = detail_delta(mh, incr)
        raw[pos_name] = d * calibrate(d, attr, UNIT_GIRTH_M)
        d = detail_delta(mh, decr)
        raw[neg_name] = d * calibrate(d, attr, -UNIT_GIRTH_M)

    girth_pair("ChestLarge", "ChestSmall", "torso/measure-bust-circ-incr", "torso/measure-bust-circ-decr", "chest")
    girth_pair("WaistWide", "WaistNarrow", "torso/measure-waist-circ-incr", "torso/measure-waist-circ-decr", "waist")
    girth_pair("HipWide", "HipNarrow", "torso/measure-hips-circ-incr", "torso/measure-hips-circ-decr", "hip")
    raw["ShouldersBroad"] = detail_delta(mh, "torso/measure-shoulder-dist-incr")
    raw["ShouldersNarrow"] = detail_delta(mh, "torso/measure-shoulder-dist-decr")

    # -- cup (feminine frames only; runtime scales by femininity) ---------
    raw["CupLarge"] = mac(gender=0.0, cup=1.0) - mac(gender=0.0)
    raw["CupSmall"] = mac(gender=0.0, cup=0.0) - mac(gender=0.0)

    # -- face shape -------------------------------------------------------
    raw["FaceRound"] = detail_delta(mh, "head/head-round")
    raw["FaceOval"] = detail_delta(mh, "head/head-oval")
    raw["FaceSquare"] = detail_delta(mh, "head/head-square")
    raw["FaceHeart"] = detail_delta(mh, "head/head-invertedtriangular")
    raw["FaceLong"] = detail_delta(mh, "head/head-rectangular")

    # -- eye shape --------------------------------------------------------
    raw["EyesRound"] = 0.9 * _sym(mh, "eyes/{s}-eye-height2-incr") + 0.35 * _sym(mh, "eyes/{s}-eye-scale-incr")
    raw["EyesHooded"] = 1.0 * _sym(mh, "eyes/{s}-eye-eyefold-down") + 0.5 * _sym(mh, "eyes/{s}-eye-height2-decr")
    raw["EyesUpturned"] = 1.0 * _sym(mh, "eyes/{s}-eye-corner2-up") + 0.4 * _sym(mh, "eyes/{s}-eye-corner1-down")

    # -- facial feature families (MakeHuman's three macro face/body bases,
    #    as offsets from their even blend) ---------------------------------
    for label, mix in (("FeatA", (1, 0, 0)), ("FeatB", (0, 1, 0)), ("FeatC", (0, 0, 1))):
        raw[label] = mac(ethnic=mix) - neutral

    # A cross term that turns out to be all zeros (stature is the same target for
    # both genders) is dead weight in the file and a slot in every shader.
    raw = {name: d for name, d in raw.items() if np.abs(d).max() > 1e-7}

    for name in raw:
        if name in CONTRACT_NAMES:
            continue
        low = "".join(ch for ch in name.lower() if ch.isalnum())
        hit = [s for s in RESERVED_SUBSTRINGS if s in low]
        if hit:
            raise RuntimeError(f"target name {name!r} contains reserved substring(s) {hit}")

    basis = ShapeBasis(base=P0, targets=raw, metrics=m0, ground_offset=ground)
    for name, d in raw.items():
        m = measurer.measure(P0 + d)
        basis.target_metrics[name] = {
            k2: round(float(getattr(m, k2) - getattr(m0, k2)), 5)
            for k2 in ("stature", "bmi", "chest", "waist", "hip")
        }
    return basis

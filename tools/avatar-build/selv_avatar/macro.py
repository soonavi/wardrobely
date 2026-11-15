"""MakeHuman's macro shape model, reimplemented from its target naming scheme.

A MakeHuman body is the base mesh plus a multilinear blend of "macro" targets:
for every combination of the categorical corners of (gender, age, muscle,
weight, ...) there is one target file, and its weight is the product of the
per-axis weights. This module reproduces that arithmetic so the build can ask
for "the female, heavy, tall adult" and get the same vertices MakeHuman or MPFB
would produce - without Blender, MakeHuman or PyTorch.

Age is fixed at "young" (MakeHuman's 25-year-old adult). Selv is 13+, renders
clothed adults, and has no use for the baby/child/old corners.
"""
from __future__ import annotations

import numpy as np

from .mhdata import MHData

AGE = "young"
ETHNICS = ("african", "asian", "caucasian")


def _tri(v: float, lo: str, mid: str, hi: str) -> dict[str, float]:
    """Three-corner axis at 0 / 0.5 / 1, linear in between."""
    v = float(np.clip(v, 0.0, 1.0))
    if v < 0.5:
        return {lo: 1.0 - 2.0 * v, mid: 2.0 * v}
    return {mid: 2.0 - 2.0 * v, hi: 2.0 * v - 1.0}


def _two(v: float, lo: str, hi: str) -> dict[str, float]:
    """Two-ended axis whose midpoint is "no target at all"."""
    v = float(np.clip(v, 0.0, 1.0))
    if v < 0.5:
        return {lo: 1.0 - 2.0 * v}
    return {hi: 2.0 * v - 1.0}


def macro_delta(
    mh: MHData,
    gender: float = 0.5,
    muscle: float = 0.5,
    weight: float = 0.5,
    height: float = 0.5,
    proportions: float = 0.5,
    cup: float = 0.5,
    firmness: float = 0.5,
    ethnic: tuple[float, float, float] = (1 / 3, 1 / 3, 1 / 3),
) -> np.ndarray:
    """Dense (N, 3) offset from the raw base mesh for the given macro settings.

    `gender` runs 0 (female) .. 1 (male); every other axis is 0..1 with 0.5 as
    MakeHuman's average.
    """
    g = {"female": 1.0 - float(gender), "male": float(gender)}
    m = _tri(muscle, "minmuscle", "averagemuscle", "maxmuscle")
    w = _tri(weight, "minweight", "averageweight", "maxweight")
    h = _two(height, "minheight", "maxheight")
    p = _two(proportions, "uncommonproportions", "idealproportions")
    c = _tri(cup, "mincup", "averagecup", "maxcup")
    f = _tri(firmness, "minfirmness", "averagefirmness", "maxfirmness")

    out = np.zeros((mh.base.n, 3), dtype=np.float64)

    def add(rel: str, wt: float) -> None:
        if wt <= 1e-9:
            return
        t = mh.target(rel)
        if t is not None:
            out.__iadd__(t * wt)

    for gk, gv in g.items():
        for ek, ev in zip(ETHNICS, ethnic):
            add(f"macrodetails/{ek}-{gk}-{AGE}", gv * ev)
        for mk, mv in m.items():
            for wk, wv in w.items():
                gmw = gv * mv * wv
                add(f"macrodetails/universal-{gk}-{AGE}-{mk}-{wk}", gmw)
                for hk, hv in h.items():
                    add(f"macrodetails/height/{gk}-{AGE}-{mk}-{wk}-{hk}", gmw * hv)
                for pk, pv in p.items():
                    add(f"macrodetails/proportions/{gk}-{AGE}-{mk}-{wk}-{pk}", gmw * pv)
                if gk == "female":
                    for ck, cv in c.items():
                        for fk, fv in f.items():
                            add(f"breast/female-{AGE}-{mk}-{wk}-{ck}-{fk}", gmw * cv * fv)
    return out


def detail_delta(mh: MHData, name: str) -> np.ndarray:
    """A single named detail target, e.g. `head/head-round`. Raises if absent,
    because a silently missing detail target is a silently missing feature."""
    t = mh.target(name)
    if t is None:
        raise FileNotFoundError(f"target not found: {name}")
    return t

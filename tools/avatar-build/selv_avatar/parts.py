"""Part: one renderable mesh of the avatar, and how it follows the body.

Two ways a part can follow body shape:

* **direct**   - its vertices ARE MakeHuman vertices (`mhid`). It ships the
                 shape targets itself. Body, lashes and the hidden guide mesh.
* **surface**  - its vertices are bound to triangles of a MakeHuman surface
                 (`bind_ids` + `bind_w`), like MakeHuman's own clothes proxies.
                 The runtime rebuilds them from the reshaped body, so a garment
                 or a hairstyle needs no morph targets of its own and follows
                 every combination of sliders exactly.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Material:
    name: str
    color: tuple = (1.0, 1.0, 1.0, 1.0)
    roughness: float = 0.6
    metallic: float = 0.0
    double_sided: bool = False
    role: str = ""          # skin | hair | iris | sclera | lash | brow | cloth | base | accessory


@dataclass
class Part:
    name: str
    positions: np.ndarray                 # (n, 3) in the neutral body's space
    tris: np.ndarray                      # (m, 3)
    material: Material
    kind: str                             # body | guide | eyes | lashes | brows | hair | garment | base | accessory
    uvs: np.ndarray | None = None
    colors: np.ndarray | None = None      # (n, 3|4) linear, multiplies the material colour
    mhid: np.ndarray | None = None        # direct parts: MH vertex index per vertex
    bind_surface: str | None = None       # surface parts: which guide surface to bind to
    weld: np.ndarray | None = None        # vertices sharing an id share a normal
    skinned: bool = True
    visible: bool = True
    meta: dict = field(default_factory=dict)   # id, slot, label ... -> node extras

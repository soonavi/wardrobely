"""Optional part generators (hair, garments, accessories) appended to the core."""
from __future__ import annotations

from .extras import accessory_parts, beard_parts
from .garments import garment_parts
from .hair import hair_parts

PART_GENERATORS: list = [hair_parts, beard_parts, accessory_parts, garment_parts]

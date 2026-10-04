# `tools/avatar-export/`

Turns [Anny](https://github.com/naver/anny) into `base-human.glb`: the rigged
human base mesh that replaces Selv's ~50-primitive avatar.

## ⚠️ Licensing — read first

Anny's licensing is **mixed**, not uniformly Apache 2.0 (see
`AVATAR_MESH_SHORTLIST.md`):

| Component | Licence |
|---|---|
| Python code | Apache 2.0 |
| **MakeHuman assets (`mpfb2`) — the mesh and blendshapes we ship** | **CC0 1.0** |
| SOMA topology | Apache 2.0 |
| **SMPL-X topology** | **NON-COMMERCIAL ONLY** |

Selv is commercial, so **the SMPL-X topology cannot be used.**
`assert_topology_is_licensed()` refuses to run on it rather than leaving that to
whoever invokes the script — getting it wrong is only discovered after avatars
are saved against a topology's blendshape names, which is far too late.

Confirm the licence files at source before spending build time. The summary
above was read at a distance and is not legal advice.

## Status

**The full export has never run.** Anny is not installed here and no GLB has
been produced. What *is* verified:

- **The naming contract**, from both sides. `app/.../humanBase/morphContract.json`
  declares the eight morph target names; `morphContract.test.ts` feeds every one
  through the **production matcher** and asserts it binds to the intended axis in
  the intended mode (15 tests). `--self-check` re-validates it from Python.
- **The validator itself**, against five deliberately-broken contracts — a
  dropped axis, a duplicate name, a non-pair mode, an out-of-range value, a
  missing phenotype. All five are caught.

Treat the Anny API calls and the glTF assembly as unproven. They are written to
fail loudly, naming what they actually found, rather than exporting a mesh with
axes silently flat.

## Running it

```bash
# Validate the contract. No Anny, no torch, no network.
python3 export_anny_glb.py --self-check

# Full export.
pip install -r requirements.txt     # numpy + pygltflib
# plus Anny from source: https://github.com/naver/anny  (pulls torch)
python3 export_anny_glb.py --out ../../app/assets/avatar/base-human.glb
```

Then in the app:

1. Point `HUMAN_BASE_SOURCE` at the file in `humanBaseAsset.ts`.
2. **Run `inspectHumanBase()` on it** and fix anything reported `blocking`.
3. Confirm `onShapeApplied` reports `usedMorphTargets: true`. `false` means the
   asset loaded and is being whole-mesh scaled — i.e. doing exactly what the
   primitives already did.

## Why the design is the way it is

**Pairs, not one slider per axis.** A glTF morph target interpolates from the
base mesh (influence 0) toward the target (influence 1). A single bidirectional
slider resting at 0.5 therefore needs the *base mesh* to be one extreme — the
short, thin body — so anything rendering at all-zero influences (a failed shape
pass, a frame before the effect runs, a tool opening the GLB cold) shows that
extreme instead of a person. With pairs the base is neutral and all-zero *is*
the rest pose. Costs 8 morph targets rather than 4, against the 60
`inspectHumanBase` starts warning at and the 564 Anny ships.

**Only four axes, not Anny's 564.** Every morph target is a full vertex-delta
set held in memory. A face rig's worth of expressions costs real megabytes for
shapes this app never drives. Needing an export step is what lets us ship only
what we use — the pipeline is an advantage, not a tax.

**`mesh.extras.targetNames` is load-bearing.** glTF morph targets are
positional; the names live in that array, and three.js builds
`morphTargetDictionary` from it. Omit it and three.js names them `"0"`, `"1"`,
…, the name matching finds nothing, `applyShapeToObject` falls back to axis
scaling, and the avatar still responds to every slider by stretching geometry.
**It looks like it works.** Everything here is arranged around that one array
being right.

## Known gaps

- **No skeleton or skin weights are written yet.** `inspectHumanBase` will
  report requirement 4 as *blocking*, which is correct and deliberate: better a
  loud failure than a mesh that works until a garment is attached. Morph targets
  deform only the mesh they are authored on, so garments must be skinned to the
  asset's skeleton rather than parented under it. This is the expensive part and
  it is still ahead.
- **The `annyPhenotype` names are unverified.** `height` and `weight` are
  documented Anny phenotypes; `bust` and `hip` are guesses.
  `resolve_phenotype()` matches case-insensitively and, on a miss, raises
  listing every phenotype the model actually has — because a silent fallback
  would export zero-delta morph targets that load, pass a glance, satisfy the
  name checks, and leave two sliders doing nothing.

## Files

| File | Role |
|---|---|
| `export_anny_glb.py` | The pipeline. `--self-check` validates without Anny. |
| `requirements.txt` | numpy + pygltflib. Anny installed separately — it pulls torch. |
| `app/src/features/avatar3d/humanBase/morphContract.json` | The shared contract. Lives in `app/` so `tsc`, the bundler and the test can all see it. |

# Human base mesh — licensing shortlist

**Researched:** 2026-10-04. **Re-evaluated:** 2026-10-06.
**Status:** recommendation, not a decision.

> **2026-10-06 — the recommendation below is contested.** MPFB2 was re-examined
> and looks like the better first candidate, mainly because Anny's documented
> export is PLY, which carries neither a skeleton nor morph targets, and
> requirement 4 is the skeleton. The Anny section is kept intact; read it with
> [Alternative: MakeHuman / MPFB2](#alternative-makehuman--mpfb2) before
> acting on it. Nothing here is settled until one candidate is exported and put
> through `inspectHumanBase()`.

The avatar is ~50 three.js primitives and will never read as human. The code
path for a rigged mesh is built and tested (`app/src/features/avatar3d/humanBase/`);
the only thing missing is a licensed asset. This is the shortlist for that
choice.

Judge every candidate against the six requirements in
`app/src/features/avatar3d/humanBase/humanBaseAsset.ts`. The two that eliminate
options are:

- **Req 2 — blendshapes for height, volume, chest, hip.** Without them
  `applyShapeToObject` falls back to whole-mesh axis scaling, which is what the
  primitives already do. An asset that fails this looks like an upgrade and is
  not one.
- **Req 4 — a skeleton garments can skin to.** Morph targets deform only the
  mesh they are authored on, so garments cannot follow a morph-driven body by
  being parented to it. This is the requirement most likely to be discovered
  late and be expensive.

`inspectHumanBase()` checks all six in code. Run it on a candidate before
wiring anything up.

---

## Recommendation: Anny (NAVER LABS Europe)

<https://github.com/naver/anny> · <https://europe.naverlabs.com/blog/anny-a-free-to-use-3d-human-parametric-model-for-all-ages/>

An open-source parametric human body model, built on MakeHuman's asset legacy
and calibrated against WHO population statistics.

**Why it fits better than anything else found:**

| Requirement | Anny |
|---|---|
| 2 — shape blendshapes | **564 blendshapes on semantic phenotype axes** — explicitly including height, weight and muscle. Semantic rather than learned principal components, so the axes are nameable and map onto ours directly instead of needing a fitting step. |
| 3 — slider convention | Phenotype axes are interpretable, so the convention is inspectable rather than guessed. `applyShapeToObject` now handles bidirectional, opposing-pair and unipolar rigs, so any of the three works. |
| 4 — skeleton | **104-bone "anny" rig** (default, compact — body/hand/head articulation, facial and zero-weight bones pruned), or the full 163-bone MakeHuman rig. |
| 6 — budget | **13,718 vertices / 13,710 quad faces** (~27k triangles triangulated). Comfortably inside the 50k soft budget. |

### ⚠️ The licensing is MIXED — verified against the actual files

**Updated 2026-10-04**, after reading `LICENSE`, `src/anny/data/mpfb2/LICENSE.md`
and the README's licensing section directly. Two things changed from the
first-pass research, one reassuring and one not.

Quoting the README verbatim:

| Component | Licence (verbatim) |
|---|---|
| Code | "licensed under the Apache License, Version 2.0" |
| **`data/mpfb2` — the mesh and blendshapes we ship** | "MakeHuman assets adapted from MPFB2 that are licensed under the **CC0 1.0 Universal** License" |
| `data/faceunits01` | "Face Units asset pack by Mika Suominen, licensed under the CC0 1.0 Universal License" |
| `data/soma` | "a 'soma' topology adapted from SOMA-X which is licenced under the Apache 2.0 license" |
| **`smplx`** | "A 'smplx' topology **can be downloaded** for **non-commercial use only**" |

`src/anny/data/mpfb2/LICENSE.md` is confirmed CC0 1.0 Universal: no attribution
requirement, commercial use unrestricted, all copyright and related rights
waived. That is the most permissive licence available and it covers exactly the
part Selv ships.

**Better than first thought: the SMPL-X assets are not in the repository.** They
live behind a separate download at
`download.europe.naverlabs.com/humans/Anny/noncommercial.zip`. So the earlier
characterisation — that a topology flag could silently move you from CC0 to
non-commercial — was wrong: the assets have to be fetched, from a URL named
`noncommercial.zip`.

**Worse than first thought, and this is the real hazard.** The README's install
instructions carry this line:

> `pip install anny # Minimal install.`
> `# Note that the free install may download non-commercial only assets when needed.`

So the boundary is *not* a deliberate human decision to go and fetch a zip. The
package may pull non-commercial assets on demand. That is the thing to pin down
before shipping: whether a build that only ever requests the `anny` topology can
end up with non-commercial data on disk or in the bundle.

**Also: there are two SMPL retopologies, not one.** The README lists `smplx`,
`smpl` and `soma`. `soma` is Apache 2.0 and fine; `smpl` is the same Max Planck
lineage as `smplx`. `assert_topology_is_licensed()` in the export pipeline
blocks both — an earlier version of that guard listed only the `smplx`
spellings, so `topology="smpl"` passed straight through it, which was precisely
the hole it exists to close.

**What this means in practice:** stay on the default `anny` topology (or
`anny-quads` / `anny-full` / `makehuman`, all MakeHuman-derived) and the licence
position is CC0 for the mesh and Apache 2.0 for the code. Never request `smpl`
or `smplx`, and verify no non-commercial assets arrived at install time.

A useful incidental: the default `anny` topology is already **triangulated**
("triangular faces", "unattached vertices removed"), so no quad conversion is
needed unless you deliberately pick `anny-quads` or `makehuman`.

### The work it needs

Anny is a PyTorch model, not a shipped `.glb`. Its examples export **PLY**; no
GLB export or Blender add-on is documented. So there is a one-off pipeline
step: generate the base mesh, bake the axes we drive as morph targets, export
GLB.

**That step is an advantage, not a tax.** We would export *four* blendshapes
(or eight, as opposing pairs) rather than 564 — sidestepping
`inspectHumanBase`'s morph-count warning entirely, since each morph target is a
full vertex-delta set held in memory and a face rig's worth of expressions
costs real megabytes for shapes this app never drives.

---

## Alternative: MakeHuman / MPFB2

**Re-evaluated 2026-10-06.** The original entry here judged *MakeHuman the
desktop app*, concluded "a plain export is a baked mesh … failing requirement 2
outright", and filed it as a fallback. That conclusion is correct about the
desktop app and wrong about the toolchain, because it did not separate the
desktop app from **MPFB2**, the Blender-native plugin that supersedes
MHBlenderTools. Evaluated properly, MPFB2 is a stronger candidate than Anny on
the two things that actually cost time here — requirement 4 and the export
path — and is at worst equal on licensing.

<https://static.makehumancommunity.org/mpfb/docs/index.html> ·
<https://github.com/makehumancommunity/mpfb2> ·
<https://extensions.blender.org/add-ons/mpfb/>

### Against the six requirements

| Req | MPFB2 | vs Anny |
|---|---|---|
| 1 — `.glb` | Blender's glTF exporter, which emits morph targets and skinning natively. | **Better.** Anny's documented export is PLY, which carries neither. |
| 2 — blendshapes for height/volume/chest/hip | Targets *are* shape keys: "a target is conceptually a blend shape (a.k.a shape key)". Macrodetails (height, weight, muscle) materialise as shape keys on the basemesh; detail targets load from `.target` files. | **Equal in reach, worse in shape.** See the hazard below. |
| 3 — slider convention | Macro shape keys arrive **encoded as combination targets**, not one clean axis per slider. Needs a bake either way. | **Worse as shipped**, equal after baking. |
| 4 — skeleton garments skin to | Several built-in rigs plus Rigify, **and a clothes asset library already fitted to the basemesh**. | **Clearly better.** This is the requirement the slot file calls "most likely to be discovered late and be expensive". |
| 5 — orientation | Blender export, Y-up conversion is a checkbox. | Equal. |
| 6 — budget | HM08 is **13,380 verts / 14,766 quads** (~29.5k tris). Proxymeshes (alternative topologies) exist if that is too heavy on a mid-range device. | **Equal, with an escape hatch** Anny does not document. |

### Why this beats Anny on the expensive requirement

Requirement 4 is a skeleton garments can be skinned to. Anny offers a 104-bone
rig — but its documented export is **PLY**, a format with no concept of a
skeleton or a morph target. So reaching a skinned, morph-driven `.glb` from
Anny means writing a bespoke exporter that carries the rig and the baked axes
across by hand. The existing entry frames the export step as "an advantage, not
a tax" on the grounds that we would bake four blendshapes rather than 564. That
part is right. What it omits is that the *skeleton* has to survive the same
trip, and PLY will not carry it.

MPFB2 ends in Blender, where mesh, rig and shape keys are all first-class and
the glTF exporter writes all three. The pipeline is a file format conversion
rather than an exporter to be written and maintained.

Its clothes library is a second, less obvious win: garments already fitted to
the same basemesh are exactly the input `garmentVisual.ts` would need to move
from texture-on-body to real skinned garments — the step that currently caps
try-on realism no matter which base mesh wins.

### Licensing — unambiguous, and that is the point

All core MakeHuman/MPFB assets are **CC0**: no attribution, no copyright
notice, commercial use unrestricted. Source is GPL (MPFB) / AGPL (MakeHuman),
which does not reach a `.glb` we export and ship — the asset is the output of
the tool, not a derivative of its code.

Crucially this sidesteps the open hazard in the Anny entry entirely. There is
no `pip install` that "may download non-commercial only assets when needed",
because there is no SMPL-X topology anywhere in the MPFB2 asset set to
download. The question counsel was going to be asked — *can an anny-topology
build still end up with non-commercial data on disk?* — does not arise.

Note this is the same asset lineage either way: Anny's CC0 mesh is itself
"MakeHuman assets adapted from MPFB2". Going to MPFB2 is going to the source,
not to a different-quality mesh.

### The real hazard: macro shape keys are encoded combinations

This is the finding that matters, and it is not a licensing issue.

MakeHuman's phenotype sliders are **not** one target per axis. Height, weight
and muscle are *macrodetails* — "combinations of several targets interacting to
create a larger modification", and applying them produces "a number of encoded
shape keys" rather than one named `Height`. The underlying targets are a
simplex of combinations (`male-young-muscle-heavy` and its neighbours), blended
by weight.

So a naive export does **not** hand `applyShapeToObject` four clean 0..1 axes.
It hands it a pile of combination keys whose names mean nothing to
`MORPH_TARGET_NAME_CANDIDATES`. Requirement 2 would technically pass
(`hasMorphTargets` is true) while the rig is useless — exactly the silent
half-failure the slot file warns about.

**The fix is the bake step, and both candidates need it.** Generate the mesh at
each axis extreme, diff against the neutral mesh, and author four clean
vertex-delta morph targets named to our convention. For MPFB2 this is a Blender
Python script driving the macro sliders and snapshotting the result; for Anny it
is a PyTorch script doing the same. Neither is free; neither is large. The
difference is that after the bake, MPFB2 still has the rig and a working glTF
exporter, and Anny still needs an exporter written.

The original entry's warning that **many `.targets` files do not load correctly
in Blender** applies to hand-loading individual `.target` files. It is much less
relevant to the macro path, which MPFB2 drives itself.

### Verdict

**Promote MPFB2 from fallback to the candidate to try first**, on three
grounds, in order of weight:

1. It is the only path that reaches a **skinned, morph-driven `.glb`** without a
   bespoke exporter — requirement 4, the expensive one.
2. Its licensing is unambiguously CC0 with no install-time hazard, which
   removes an open question currently blocking a counsel review.
3. Its clothes library is the natural input for real skinned garments later.

Against: the Blender toolchain is GUI-centric and scripts against Blender's
Python API rather than a plain `pip` library, so the bake is less pleasant to
run in CI than Anny's would be. That is a real cost and it is the one reason to
keep Anny alive as the alternative.

Anny stays a legitimate second choice. Nothing found here contradicts its
technical claims — 564 semantic blendshapes genuinely are a better *parametric*
model. The point is that we do not ship a parametric model; we ship one baked
`.glb`, and that changes which strengths matter.

**Next step is unchanged and cheap:** export one candidate and run
`inspectHumanBase()` on it. That settles requirements 1-6 in seconds and is
worth more than any further desk research — including this section.

---

## Considered and rejected

### SMPL / Meshcapade — the industry standard, wrong trade here

<https://meshcapade.com/smpl/>

Technically the strongest fit: trained on hundreds of thousands of 3D/4D scans,
encodes shape, pose, soft-tissue motion and expression in ~100 parameters, and
ships blendshapes for body shape, expressions and pose correctives.

**Rejected on licensing and cost.** SMPL is **patented**, owned by the
Max-Planck-Gesellschaft, and Meshcapade holds the exclusive right to
sublicense. Commercial use is a paid licence negotiated with their sales team —
no public pricing. For a pre-launch, pre-revenue app that is the wrong trade
against a CC0 asset of adequate quality. Revisit if fit accuracy becomes the
product's core claim rather than a feature.

### Ready Player Me — the morph targets are the wrong ones

<https://docs.readyplayer.me/ready-player-me/support/terms-of-use>

Commercial use is free once registered as a developer, and GLB export with
morph targets is a documented query parameter. Two problems:

1. **The exposed morph targets are facial** — ARKit blendshapes, Oculus
   visemes, lip-sync. It is an avatar *identity* platform, not a parametric
   body model, so it does not satisfy requirement 2's body-shape axes.
2. **It is a hosted service.** Avatars come from their API, which conflicts
   directly with the standing rule in `avatar3d/gltf/index.ts`: bundle the GLB
   with `require()`, do not fetch a remote URL — remote loading on React Native
   is a known-fragile path. Avatars governed by a third party's terms also sit
   awkwardly beside a privacy posture built on everything staying in Supabase.

---

## Before committing

1. **Only if Anny wins: read the actual LICENSE files in `naver/anny`**,
   specifically whether anything we would ship traces back to the SMPL-X
   topology. The findings above come from the repository's own licensing notes
   read at a distance; the mixed-licence structure is exactly the kind of thing
   worth confirming at the source before spending build time on it. If counsel
   is already reviewing the privacy policy, this is cheap to add to that pass.
   **Going the MPFB2 route retires this item** — the CC0 position there is
   unambiguous and there is no non-commercial asset in the set to fetch, so
   there is nothing for counsel to rule on.
2. **Export one candidate GLB and run `inspectHumanBase()` on it.** That
   answers requirements 1-6 in seconds, and answers them before any screen
   depends on the asset.
3. **Measure on a real mid-range device.** `SHIP_READINESS.md` flags 3D
   performance there as untested, with no crash reporting to notice a failure.
   `selectAvatarRenderMode({ preferPrimitive: true })` is the way back if the
   mesh is too heavy.

Not legal advice. The licence summaries above are a starting point for a
decision, not a clearance.

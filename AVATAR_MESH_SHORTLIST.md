# Human base mesh — licensing shortlist

**Researched:** 2026-10-04. **Status:** recommendation, not a decision.

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

### ⚠️ The licensing is MIXED. This is the thing to get right.

The repository licenses code and assets separately, and one component is
**non-commercial**:

| Component | License |
|---|---|
| Python/PyTorch code | Apache 2.0 |
| **MakeHuman assets (`data/mpfb2`) — the mesh and blendshapes** | **CC0 1.0** |
| Facial actions (Face Units) | CC0 1.0 |
| SOMA topology | Apache 2.0 |
| **SMPL-X topology** | **NON-COMMERCIAL USE ONLY** |

So Anny is commercially usable **only on the anny/MakeHuman topology**. The
SMPL-X interoperability path is off-limits for Selv and must not be used —
which matters because it would be expensive to discover after avatars are
saved against a topology's blendshape names.

The parts we actually need — base mesh and body blendshapes — are **CC0**, the
most permissive license available: no attribution, no restriction, commercial
fine.

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

## Alternative: MakeHuman directly

<http://www.makehumancommunity.org/content/license.html> · [FAQ: can I sell models made with MakeHuman?](http://www.makehumancommunity.org/wiki/FAQ:Can_I_sell_models_created_with_MakeHuman%3F)

**Licensing is the best of any option and is unambiguous.** Software is
AGPLv3; **bundled base meshes and exported characters are CC0**. Explicitly:
usable in a closed-source commercial app, no attribution, no separate
commercial license needed. Still current — v1.3.0, July 2026.

**Why it is the alternative and not the recommendation:** a plain MakeHuman
export is a *baked* mesh at one fixed body shape. The shape targets are applied
at export, so you get no blendshapes — failing requirement 2 outright.

Getting shape keys requires the Blender route: load targets as shape keys via
MHBlenderTools' "Load shapes from targets", then export glTF (Blender's
exporter emits morph targets automatically). Reports from that workflow note
**many `.targets` files do not load correctly in Blender**, so it is fiddlier
than Anny, which already has the phenotype system solved in code.

Pick this if the Anny pipeline stalls — the licence is cleaner and the asset
lineage is the same.

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

1. **Read the actual LICENSE files in `naver/anny`**, specifically whether
   anything we would ship traces back to the SMPL-X topology. The findings
   above come from the repository's own licensing notes read at a distance;
   the mixed-licence structure is exactly the kind of thing worth confirming
   at the source before spending build time on it. If counsel is already
   reviewing the privacy policy, this is cheap to add to that pass.
2. **Export one candidate GLB and run `inspectHumanBase()` on it.** That
   answers requirements 1-6 in seconds, and answers them before any screen
   depends on the asset.
3. **Measure on a real mid-range device.** `SHIP_READINESS.md` flags 3D
   performance there as untested, with no crash reporting to notice a failure.
   `selectAvatarRenderMode({ preferPrimitive: true })` is the way back if the
   mesh is too heavy.

Not legal advice. The licence summaries above are a starting point for a
decision, not a clearance.

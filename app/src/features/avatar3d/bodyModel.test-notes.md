# bodyModel calibration — worked examples

Hand-worked input -> output traces for `measurementsToShapeParams` in
`bodyModel.ts`, so the calibration constants can be sanity-checked without
a test runner (there is no unit test harness wired up in this repo yet —
this doc is the substitute). Recompute these by hand against the current
constants if you ever change them; if the numbers below stop matching the
code, the code is right and this doc is stale.

Formulas used (see `bodyModel.ts` for full commentary):

```
bmi          = weightKg / (heightCm/100)^2
height       = clamp((heightCm - 168) / 12, -1, 1)
volume       = clamp((bmi - 22) / 7, -1, 1)
expectedChest = heightCm * 0.52 + (bmi - 22) * 1.1
expectedHip   = heightCm * 0.56 + (bmi - 22) * 1.3
chest        = chestCm === undefined ? 0 : clamp((chestCm - expectedChest) / 9, -1, 1)
hip          = hipCm   === undefined ? 0 : clamp((hipCm   - expectedHip)   / 9, -1, 1)
```

## Example 1 — "population average," no tape measurements

Input: `{ heightCm: 168, weightKg: 62 }`

- `bmi = 62 / 1.68^2 = 62 / 2.8224 = 21.97`
- `height = (168 - 168) / 12 = 0.00`
- `volume = (21.97 - 22) / 7 = -0.03 / 7 ≈ -0.00`
- chest/hip omitted -> `0`, `0`

**Expected ShapeParams: `{ height: 0.00, volume: -0.00, chest: 0, hip: 0 }`**

Sanity check: someone at exactly the reference height and a BMI of ~22
should land almost exactly at the neutral/average shape — confirms 168cm
+ BMI 22 is genuinely the "zero point," not just documented as one.

## Example 2 — tall + heavier, with tape measurements diverging from the BMI prediction

Input: `{ heightCm: 190, weightKg: 100, chestCm: 112, hipCm: 108 }`

- `bmi = 100 / 1.9^2 = 100 / 3.61 = 27.70`
- `height = (190 - 168) / 12 = 22/12 = 1.83 -> clamp -> 1.00`
- `volume = (27.70 - 22) / 7 = 5.70/7 = 0.81`
- `expectedChest = 190*0.52 + (27.70-22)*1.1 = 98.80 + 6.27 = 105.07`
  `chest = (112 - 105.07) / 9 = 6.93/9 = 0.77`
- `expectedHip = 190*0.56 + (27.70-22)*1.3 = 106.40 + 7.41 = 113.81`
  `hip = (108 - 113.81) / 9 = -5.81/9 = -0.65`

**Expected ShapeParams: `{ height: 1.00, volume: 0.81, chest: 0.77, hip: -0.65 }`**

Sanity check: demonstrates height clamping at the +1 edge (raw value was
1.83), and shows chest/hip moving in *opposite* directions even though
both are relative to the same overall size — this person measures fuller
through the chest than their height+BMI predicts, but leaner through the
hips. That's the entire point of the chest/hip axes: they carry
information beyond height+BMI, not a restatement of it.

## Example 3 — short + light, no tape measurements

Input: `{ heightCm: 150, weightKg: 45 }`

- `bmi = 45 / 1.5^2 = 45 / 2.25 = 20.00`
- `height = (150 - 168) / 12 = -18/12 = -1.50 -> clamp -> -1.00`
- `volume = (20.00 - 22) / 7 = -2/7 = -0.29`
- chest/hip omitted -> `0`, `0`

**Expected ShapeParams: `{ height: -1.00, volume: -0.29, chest: 0, hip: 0 }`**

Sanity check: height clamps at the -1 edge (raw -1.50); volume is
negative but nowhere near clamping, since BMI 20 is well inside the
"normal" bracket, just below the 22 midpoint — correctly a mild, not
extreme, effect.

## Example 4 — average-ish size, one tape measurement supplied, showing hip moving independently

Input: `{ heightCm: 160, weightKg: 58, hipCm: 100 }` (chest omitted)

- `bmi = 58 / 1.6^2 = 58 / 2.56 = 22.66`
- `height = (160 - 168) / 12 = -8/12 = -0.67`
- `volume = (22.66 - 22) / 7 = 0.66/7 = 0.09`
- chest omitted -> `chest = 0`
- `expectedHip = 160*0.56 + (22.66-22)*1.3 = 89.60 + 0.86 = 90.46`
  `hip = (100 - 90.46) / 9 = 9.54/9 = 1.06 -> clamp -> 1.00`

**Expected ShapeParams: `{ height: -0.67, volume: 0.09, chest: 0, hip: 1.00 }`**

Sanity check: overall volume is barely above neutral (BMI 22.66 is close
to the 22 midpoint), yet hip clamps all the way to +1 because the actual
hip measurement (100cm) is far larger than what this person's modest
height+BMI would predict (90.46cm) — proves the hip axis can swing to an
extreme independently of the overall volume axis, which is the reason it
exists as a separate axis at all rather than being folded into `volume`.

## What these examples don't cover

- `applyShapeToObject`'s morph-target path is untested here since the
  current spike GLB has no morph targets to exercise it against (see
  bodyModel.ts's file header) — that seam should be re-verified by hand
  against a real rigged GLB once one exists, not assumed correct from
  these measurement-math examples alone.
- `estimateMeasurements` (the "fill in missing chest/waist/hip/inseam"
  helper used for UI display) shares the same `expectedCircumferences`
  formulas as above, so its output for Example 1's inputs is:
  `chestCm ≈ 87.33, waistCm ≈ 78.91, hipCm ≈ 94.04, inseamCm = 75.60` —
  all plausible average-adult circumferences, which is the sanity check
  those ratio constants (0.52/0.47/0.56/0.45) were picked against.

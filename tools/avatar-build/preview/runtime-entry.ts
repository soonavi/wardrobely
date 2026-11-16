// Preview-side glue: runs the app's real avatar runtime inside the headless
// viewer. Bundled with esbuild (three stays external and comes from the
// viewer's import map), so a preview render exercises the shipped code path:
// CPU shape baking, surface-bound parts, skeleton re-seating, posing.
import { HumanRig } from "../../../app/src/features/avatar3d/human/humanRig";
import { DEFAULT_HUMAN_SHAPE, resolveShapeWeights, type HumanShape } from "../../../app/src/features/avatar3d/human/humanShape";
import { REST_POSE, STANCE_POSE } from "../../../app/src/features/avatar3d/human/humanPose";

type Shot = {
  shape?: Partial<HumanShape>;
  weights?: Record<string, number>;
  /** Part names (or kind:<kind>) to show. Default: everything the manifest marks visible. */
  show?: string[];
  hide?: string[];
  /** role -> hex, e.g. { skin: "#C68A5F", hair: "#3B2A1F", iris: "#3E6FA8" } */
  look?: Record<string, string>;
  /** part name -> hex */
  colors?: Record<string, string>;
  pose?: "rest" | "stance";
};

let rig: HumanRig | null = null;

export function init(root: any, THREE: any) {
  rig = new HumanRig(root);
  rig.isolateMaterials();
  return { targets: rig.targetNames, parts: Array.from(rig.parts.keys()) };
}

export function applyShot(_root: any, shot: Shot, THREE: any) {
  if (!rig) throw new Error("runtime not initialised");
  const r = rig;
  const kindOf = (name: string) => r.partInfo.get(name)?.kind ?? "";
  const matches = (name: string, list: string[]) =>
    list.some((s) => s === name || (s.startsWith("kind:") && kindOf(name) === s.slice(5)) || (s.endsWith("*") && name.startsWith(s.slice(0, -1))));

  for (const name of r.parts.keys()) {
    const info = r.partInfo.get(name);
    let visible = info ? info.visible !== false : true;
    if (shot.show) visible = matches(name, shot.show) || (visible && !["hair", "garment", "brows", "beard", "accessory", "base"].includes(kindOf(name)));
    if (shot.hide && matches(name, shot.hide)) visible = false;
    r.setPartVisible(name, visible);
  }

  const weights = shot.weights ?? resolveShapeWeights({ ...DEFAULT_HUMAN_SHAPE, ...(shot.shape ?? {}) }, r.manifest);
  const { unknown } = r.setShape(weights);

  for (const [role, hex] of Object.entries(shot.look ?? {})) {
    for (const m of r.materialsByRole(role)) m.color.set(hex);
  }
  for (const [name, hex] of Object.entries(shot.colors ?? {})) {
    const mesh = r.parts.get(name);
    if (mesh) (mesh.material as any).color.set(hex);
  }
  r.setPose(shot.pose === "rest" ? REST_POSE : STANCE_POSE);
  return { statureCm: Math.round(r.statureMetres * 1000) / 10, unknown, weights };
}

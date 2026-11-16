/**
 * Poses for the human avatar.
 *
 * The asset's rest pose is MakeHuman's A-pose (arms about 45 degrees out) —
 * right for skinning, wrong for looking at clothes. Every bone rests with
 * identity rotation and world-aligned axes, so a pose is just "rotate this
 * bone about that world axis": +Z swings in the frontal plane, +X pitches
 * forward/back, +Y twists.
 */
import type { HumanRig, Pose } from "./humanRig";

/** A relaxed fashion-figure stance: arms lowered clear of the body, slight ease. */
export const STANCE_POSE: Pose = {
  clavicle_l: [0, 0, -0.06],
  clavicle_r: [0, 0, 0.06],
  upperarm_l: [0.05, 0, -0.44],
  upperarm_r: [0.05, 0, 0.44],
  lowerarm_l: [-0.12, 0, -0.1],
  lowerarm_r: [-0.12, 0, 0.1],
  hand_l: [0, 0, -0.05],
  hand_r: [0, 0, 0.05],
  thigh_l: [0, 0, -0.075],
  thigh_r: [0, 0, 0.075],
  foot_l: [0, 0, 0.075],
  foot_r: [0, 0, -0.075],
};

/** The asset's own A-pose. */
export const REST_POSE: Pose = {};

/**
 * Idle motion layered on top of a base pose: breathing and a slow weight
 * shift. Small on purpose — it should read as "alive", never as animation.
 */
export function applyIdle(rig: HumanRig, base: Pose, timeSeconds: number, amount = 1): void {
  rig.setPose(base);
  if (amount <= 0) return;
  const breathe = Math.sin(timeSeconds * 1.25) * 0.012 * amount;
  const sway = Math.sin(timeSeconds * 0.45) * 0.014 * amount;
  const add = (name: string, x: number, y: number, z: number) => {
    const bone = rig.bone(name);
    if (!bone) return;
    bone.rotation.x += x;
    bone.rotation.y += y;
    bone.rotation.z += z;
  };
  add("spine_02", -breathe, 0, sway * 0.5);
  add("spine_03", -breathe * 0.8, 0, sway * 0.5);
  add("clavicle_l", 0, 0, breathe * 0.6);
  add("clavicle_r", 0, 0, -breathe * 0.6);
  add("neck_01", breathe * 0.5, sway * 0.6, -sway * 0.4);
  add("head", breathe * 0.4, sway * 0.5, -sway * 0.3);
  add("upperarm_l", 0, 0, -breathe * 0.5);
  add("upperarm_r", 0, 0, breathe * 0.5);
}

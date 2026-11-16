/**
 * Test helper: load the real bundled avatar the way the app does - through
 * three's GLTFLoader - so tests exercise the asset that ships, not a fixture
 * shaped like it.
 */
import fs from "fs";
import path from "path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

export const AVATAR_PATH = path.resolve(__dirname, "../../../../../assets/avatar/selv-human.glb");

export type GltfJson = {
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  images?: unknown[];
  textures?: unknown[];
  meshes: { name: string; primitives: { attributes: Record<string, number>; targets?: unknown[] }[]; extras?: { targetNames?: string[] } }[];
  nodes: { name: string; mesh?: number; skin?: number; extras?: Record<string, unknown> }[];
  scenes: { extras?: { selv?: unknown } }[];
};

/** The JSON chunk of the .glb, without going through any loader. */
export function readGltfJson(): { json: GltfJson; bytes: number } {
  const buf = fs.readFileSync(AVATAR_PATH);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a glb");
  const jsonLength = buf.readUInt32LE(12);
  return { json: JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8")), bytes: buf.length };
}

let cached: Promise<THREE.Group> | null = null;

/** A fresh, private copy of the avatar scene (the parse itself is shared). */
export async function loadAvatarScene(): Promise<THREE.Object3D> {
  if (!cached) {
    const data = fs.readFileSync(AVATAR_PATH);
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    cached = new Promise((resolve, reject) => {
      new GLTFLoader().parse(arrayBuffer as ArrayBuffer, "", (gltf) => resolve(gltf.scene), reject);
    });
  }
  return cloneSkinned(await cached);
}

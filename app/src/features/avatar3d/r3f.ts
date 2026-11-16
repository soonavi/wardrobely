/**
 * react-three-fiber, native build.
 *
 * The 3D screens import Canvas and the hooks from here, never from
 * "@react-three/fiber/native" directly, because the web build needs the DOM
 * renderer instead (see r3f.web.ts). Canvas and hooks must come from the same
 * module instance or the hooks cannot find the store the Canvas created.
 */
export { Canvas, useFrame, useThree } from "@react-three/fiber/native";

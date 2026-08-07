// Type shims for the react-three-fiber native rendering stack.
//
// 1. R3F v9 does not auto-register its intrinsic JSX elements (<mesh>,
//    <meshStandardMaterial>, <capsuleGeometry>, <circleGeometry>, ...) into
//    the ambient JSX namespace when only the /native entrypoint is imported.
//    We augment both the global JSX namespace and React's JSX namespace
//    (React 19 resolves intrinsics via React.JSX) with R3F's ThreeElements.
// 2. `@react-three/drei/native` ships no bundled type declarations; we point
//    it at the package's main types so useGLTF/useProgress/etc. are typed.

import type { ThreeElements } from "@react-three/fiber";

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

declare module "@react-three/drei/native" {
  export * from "@react-three/drei";
}

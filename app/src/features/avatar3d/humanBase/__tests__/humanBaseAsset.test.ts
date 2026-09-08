import {
  isHumanBaseAvailable,
  selectAvatarRenderMode,
} from "../humanBaseAsset";

describe("isHumanBaseAvailable", () => {
  it("reports false while no mesh is licensed", () => {
    // This is the honest current state, and it is asserted so that dropping an
    // asset in without reading humanBaseAsset.ts fails here loudly rather than
    // silently changing which renderer every screen uses.
    expect(isHumanBaseAvailable()).toBe(false);
  });
});

describe("selectAvatarRenderMode", () => {
  it("falls back to the primitive avatar when no mesh is bundled", () => {
    expect(selectAvatarRenderMode({ humanBaseAvailable: false })).toBe("primitive");
  });

  it("uses the mesh when one is bundled", () => {
    expect(selectAvatarRenderMode({ humanBaseAvailable: true })).toBe("human-mesh");
  });

  it("honours preferPrimitive even when a mesh is available", () => {
    // The escape hatch. 3D performance on mid-range devices is untested and
    // there is no crash reporting, so a way back to the known-cheap renderer
    // has to work regardless of what is bundled.
    expect(
      selectAvatarRenderMode({ humanBaseAvailable: true, preferPrimitive: true }),
    ).toBe("primitive");
  });

  it("stays on the primitive avatar when both signals point that way", () => {
    expect(
      selectAvatarRenderMode({ humanBaseAvailable: false, preferPrimitive: true }),
    ).toBe("primitive");
  });

  it("defaults to the real availability check when given no options", () => {
    expect(selectAvatarRenderMode()).toBe("primitive");
    expect(selectAvatarRenderMode({})).toBe("primitive");
  });
});

/**
 * The Try On tab — the 3D character try-on.
 *
 * Try-on is a 3D product: the tab renders CharacterTryOnScreen, which puts
 * garments and shop products onto the user's own stylized 3D character. It
 * also owns the `?productId=` deep link the Shop pushes here (see
 * ProductDetailScreen's handleTryOn), so Shop -> try it on -> buy runs
 * entirely in 3D.
 *
 * The former 2D collage studio has been deleted. It survived only because the
 * character had no accessory slot, so `mapCategoryToSlot` returned null for
 * `accessory` and the flat compositor was the one surface that could style
 * them; once the 3D character grew that slot, the studio had no remaining
 * reason to exist. There is no 2D fallback and no `/tryon-2d` route.
 */
export { default } from "../../src/features/avatar3d/CharacterTryOnScreen";

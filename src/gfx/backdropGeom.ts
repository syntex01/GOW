/**
 * Backdrop geometry — the one place the parallax layers are measured.
 *
 * Every layer is a TileSprite, and a TileSprite tiles in *both* axes. If the
 * art is shorter than the band it fills, the band repeats it vertically and the
 * same ridge crest appears twice up the screen; if it is narrower than the
 * viewport, a hard vertical seam runs down the picture where the tile wraps.
 * Both happened, because the sizes were chosen independently in the texture
 * factory and in the background, and did not agree.
 *
 * So they live here, and both sides import them:
 *
 *  - each band's art is authored at *exactly* the height of its sprite, so
 *    nothing ever repeats vertically;
 *  - every layer is authored wider than any camera plus the furthest it can
 *    scroll, so the horizontal wrap is never on screen either.
 *
 * These are world pixels. The art is generated at half this size and drawn back
 * at a tile scale of two, which is what keeps the backdrop on the same pixel
 * grid as the sprites in front of it.
 */

/**
 * Height of each ridge band, far to near.
 *
 * The far band is the tallest because it reaches highest up the sky; the near
 * bands are progressively shorter, which is what stacks them into depth.
 */
export const RIDGE_HEIGHTS = [472, 380, 288] as const

/** Distance from the ground line down to the foot of every ridge band. */
export const RIDGE_FOOT = 8

/** The battlefield floor. Taller than any viewport shows, so it cannot repeat. */
export const GROUND_HEIGHT = 260

/** The near silhouette bank that frames the battlefield from below. */
export const FOREGROUND_HEIGHT = 150

/** How far above the ground line the foreground bank's bottom edge sits. */
export const FOREGROUND_DROP = 72

/**
 * Authored width of every layer.
 *
 * Has to cover the widest viewport plus the furthest any layer's tile position
 * travels. The fastest layer is the foreground at 1.35x the camera, and the
 * camera can only travel `worldWidth - viewportWidth`, so this has a large
 * margin over anything the game actually asks for.
 */
export const LAYER_WIDTH = 1664

/** Height of the haze band that sits above the ground line. */
export const FOG_BAND_HEIGHT = 96

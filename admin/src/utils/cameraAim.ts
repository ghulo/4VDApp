/** The aim box, as a share of the picture's width and height (staff.css .camera-view__aim draws the same). */
const AIM_WIDTH = 0.84;
const AIM_HEIGHT = 0.56;

/**
 * The part of the camera picture inside the aim box. The video fills its box
 * (object-fit: cover), so first the part of the frame that is on screen, then
 * the aim box's share of that.
 */
export function aimArea(frame: { width: number; height: number }, shown: { width: number; height: number }) {
  const shownAspect = shown.width / shown.height;
  const visibleWidth = frame.width / frame.height > shownAspect ? frame.height * shownAspect : frame.width;
  const visibleHeight = visibleWidth / shownAspect;
  const width = Math.round(visibleWidth * AIM_WIDTH);
  const height = Math.round(visibleHeight * AIM_HEIGHT);
  return { x: Math.round((frame.width - width) / 2), y: Math.round((frame.height - height) / 2), width, height };
}

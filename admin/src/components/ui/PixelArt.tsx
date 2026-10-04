import { PIXEL_GRID, PIXEL_ART, type PixelArtName } from './pixelDrawings';

/** One path per drawing, made once: each filled block is a 1 × 1 square. */
const PATHS = Object.fromEntries(
  Object.entries(PIXEL_ART).map(([name, rows]) => [
    name,
    rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === '#' ? [`M${x} ${y}h1v1h-1z`] : []))).join(''),
  ]),
) as Record<PixelArtName, string>;

/** A job's blocky pictogram (receipt, clipboard, coins…), drawn in ink. Decoration only. */
export function PixelArt({ name, className }: { name: PixelArtName; className?: string }) {
  return (
    <svg className={className ?? 'pixel-art'} viewBox={`0 0 ${PIXEL_GRID} ${PIXEL_GRID}`} aria-hidden="true" shapeRendering="crispEdges">
      <path d={PATHS[name]} fill="currentColor" />
    </svg>
  );
}

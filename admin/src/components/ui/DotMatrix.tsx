/** Distance between dot centres, in drawing units. */
const STEP = 8;
/** Printed blocks: full-size when lit, small and faint when not. */
const LIT = 4.4;
const UNLIT = 2.4;

/**
 * Values drawn as a dot-matrix, 4VD's signature: one column per value (a
 * day), lit dots up to its height and faint dots for the room above. The
 * picture is for the eye; `label` says what it shows for screen readers.
 */
export function DotMatrix({ values, rows = 7, label }: { values: number[]; rows?: number; label: string }) {
  const max = Math.max(...values, 0);
  return (
    <svg className="dot-matrix" viewBox={`0 0 ${values.length * STEP} ${rows * STEP}`} role="img" aria-label={label}>
      {values.map((value, column) => {
        // Any sale at all lights at least one block, so quiet days still show.
        const lit = value > 0 && max > 0 ? Math.max(1, Math.round((value / max) * rows)) : 0;
        return Array.from({ length: rows }, (_, row) => {
          const isLit = rows - row <= lit;
          return (
            <rect
              key={`${column}-${row}`}
              className={isLit ? 'dot-matrix__lit' : 'dot-matrix__unlit'}
              x={column * STEP + (STEP - (isLit ? LIT : UNLIT)) / 2}
              y={row * STEP + (STEP - (isLit ? LIT : UNLIT)) / 2}
              width={isLit ? LIT : UNLIT}
              height={isLit ? LIT : UNLIT}
            />
          );
        });
      })}
    </svg>
  );
}

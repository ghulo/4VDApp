/** Distance between dot centres, in drawing units. */
const STEP = 8;

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
        // Any sale at all lights at least one dot, so quiet days still show.
        const lit = value > 0 && max > 0 ? Math.max(1, Math.round((value / max) * rows)) : 0;
        return Array.from({ length: rows }, (_, row) => {
          const isLit = rows - row <= lit;
          return (
            <circle
              key={`${column}-${row}`}
              className={isLit ? 'dot-matrix__lit' : 'dot-matrix__unlit'}
              cx={column * STEP + STEP / 2}
              cy={row * STEP + STEP / 2}
              r={isLit ? 2.4 : 1.3}
            />
          );
        });
      })}
    </svg>
  );
}

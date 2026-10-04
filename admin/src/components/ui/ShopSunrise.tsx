import { shopSunrise, type Run } from './dither';

const SIZE = { columns: 100, rows: 40 };
const RUNS = shopSunrise(SIZE.columns, SIZE.rows);

const rects = (prefix: string, className: string, runs: Run[]) =>
  runs.map((run) => (
    <rect key={`${prefix}${run.x}-${run.y}`} x={run.x} y={run.y} width={run.length} height={1.02} className={className} />
  ));

/** The shop at sunrise, dithered like the team app's Today panel: ink building, clay sun, ground across. */
export function ShopSunrise() {
  return (
    <svg className="shop-sunrise" viewBox={`0 0 ${SIZE.columns} ${SIZE.rows}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {rects('s', 'shop-sunrise__sun', RUNS.sun)}
      {rects('b', 'shop-sunrise__shop', RUNS.shop)}
    </svg>
  );
}

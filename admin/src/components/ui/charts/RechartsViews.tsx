import { useId, useState } from 'react';
import {
  Area,
  AreaChart as RAreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartColumn } from '../ColumnChart';
import { scaleTop } from '../sparkline';

/*
 * The bigger charts, drawn by Recharts and dressed in 4VD's own look: amber
 * steps for data (--data-*), hairline grid like the tables, 4VD's font and
 * small type on the axes, and our ink tooltip. Loaded only by pages that show
 * one (see the lazy wrappers beside this folder), so other screens stay light.
 * Colours go in `style`, not SVG attributes, so the tokens follow the theme.
 */

/** Under reduced motion the charts appear at once instead of growing in. */
const calm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const ANIMATE = { isAnimationActive: !calm, animationDuration: 280, animationEasing: 'ease-out' as const };

const AXIS_TICK = { fill: 'var(--ink-muted)', fontSize: 12, fontFamily: 'var(--font-body)' };

/** The figure under the pointer, in the same ink label as every 4VD tooltip. */
function Tip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: { description?: string } }> }) {
  const text = payload?.[0]?.payload?.description;
  if (!active || !text) return null;
  return <div className="chart-tip">{text}</div>;
}

/** 1,240 → "1.2k": short labels on the value axis, so they never crowd. */
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

export function AreaView({ points, height, formatValue }: { points: ChartColumn[]; height: number; formatValue?: (value: number) => string }) {
  const fillId = useId();
  const { top, outlier } = scaleTop(points.map((point) => point.value));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RAreaChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--data-line)', stopOpacity: 0.28 }} />
            <stop offset="100%" style={{ stopColor: 'var(--data-line)', stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} style={{ stroke: 'var(--line)' }} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ style: { stroke: 'var(--line-strong)' } }} interval="preserveStartEnd" minTickGap={32} tickMargin={8} />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={44}
          tickCount={4}
          // Round steps (0, 500, 1k…); one huge day runs off the top instead of flattening the rest (DESIGN.md, charts).
          domain={[0, outlier === null || !top ? 'auto' : top]}
          allowDataOverflow={outlier !== null}
          tickFormatter={(value: number) => (formatValue ? formatValue(value) : compact.format(value))}
        />
        <Tooltip content={<Tip />} cursor={{ style: { stroke: 'var(--line-strong)' } }} isAnimationActive={false} />
        <Area
          type="monotone"
          dataKey="value"
          style={{ stroke: 'var(--data-line)', fill: `url(#${fillId})` }}
          strokeWidth={2}
          activeDot={{ r: 5, style: { fill: 'var(--data-line)', stroke: 'var(--surface)', strokeWidth: 2 } }}
          {...ANIMATE}
        />
      </RAreaChart>
    </ResponsiveContainer>
  );
}

export function ColumnView({ columns, height }: { columns: ChartColumn[]; height: number }) {
  const [active, setActive] = useState<number | null>(null);
  const values = columns.map((column) => column.value);
  const busiest = Math.max(...values, 0);
  const { top, outlier } = scaleTop(values);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={columns}
        margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
        barCategoryGap="22%"
        onMouseMove={(state) => setActive(state?.activeTooltipIndex == null ? null : Number(state.activeTooltipIndex))}
        onMouseLeave={() => setActive(null)}
      >
        <CartesianGrid vertical={false} style={{ stroke: 'var(--line)' }} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ style: { stroke: 'var(--line-strong)' } }} interval="preserveStartEnd" tickMargin={6} />
        <YAxis hide domain={[0, outlier === null || !top ? 'auto' : top]} allowDataOverflow={outlier !== null} />
        <Tooltip content={<Tip />} cursor={false} isAnimationActive={false} />
        <Bar dataKey="value" maxBarSize={40} radius={[3, 3, 0, 0]} shape={ColumnShape(outlier)} {...ANIMATE}>
          {columns.map((column, index) => (
            <Cell
              key={column.key}
              style={{
                fill: (busiest > 0 && column.value === busiest) || active === index ? 'var(--chart-strong)' : 'var(--chart-series)',
                // Pointing at one column lets the others step back.
                opacity: active === null || active === index ? 1 : 0.45,
                transition: 'opacity var(--fast) var(--ease), fill var(--fast) var(--ease)',
              }}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

interface ShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  style?: React.CSSProperties;
}

/** A column with rounded top corners; the one far taller than the rest gets a break near its top. */
function ColumnShape(outlier: number | null) {
  return function Shape({ x = 0, y = 0, width = 0, height = 0, index, style }: ShapeProps) {
    if (height <= 0) return <g />;
    const r = Math.min(3, width / 2, height);
    const path = `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`;
    return (
      <g>
        <path d={path} style={style} />
        {index === outlier && <rect x={x - 1} y={y + 8} width={width + 2} height={2} style={{ fill: 'var(--surface)' }} />}
      </g>
    );
  };
}

export interface RingSlice {
  key: string | number;
  label: string;
  value: number;
  display: string;
}

export function RingView({ slices, shades, active, onActive }: { slices: RingSlice[]; shades: string[]; active: string | number | null; onActive: (key: string | number | null) => void }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={slices.length ? slices : [{ key: 'none', label: '', value: 1, display: '' }]}
          dataKey="value"
          nameKey="label"
          innerRadius="76%"
          outerRadius="100%"
          startAngle={90}
          endAngle={-270}
          paddingAngle={slices.length > 1 ? 2 : 0}
          cornerRadius={3}
          stroke="none"
          onMouseEnter={(_, index) => onActive(slices[index]?.key ?? null)}
          onMouseLeave={() => onActive(null)}
          {...ANIMATE}
        >
          {(slices.length ? slices : [{ key: 'none' }]).map((slice, index) => (
            <Cell
              key={slice.key}
              style={{
                fill: slices.length ? shades[index] : 'var(--surface-sunk)',
                opacity: active === null || active === slice.key ? 1 : 0.25,
                transition: 'opacity var(--fast) var(--ease)',
                outline: 'none',
              }}
            />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

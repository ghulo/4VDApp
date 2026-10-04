import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import { fonts, spacing, useThemeColors } from '../theme';
import { PIXEL_GRID, pixelCells, type PixelArtName } from './pixelDrawings';

/**
 * The team app's printed look (DESIGN.md, "Printed paper"): blocky pictograms,
 * halftone fields, a meter made of blocks and newspaper rules. All drawing is
 * decoration, hidden from screen readers; the words beside it say the same.
 */

const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };

/** A job's pictogram drawn in square blocks. */
export function PixelArt({ name, size = 36, color }: { name: PixelArtName; size?: number; color?: string }) {
  const colors = useThemeColors();
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${PIXEL_GRID} ${PIXEL_GRID}`} style={styles.inert} {...hidden}>
      {pixelCells(name).map(({ x, y }) => (
        // A hair of overlap so the blocks print as one solid shape.
        <Rect key={`${x}-${y}`} x={x} y={y} width={1.04} height={1.04} fill={color ?? colors.ink} />
      ))}
    </Svg>
  );
}

const FIELD_WIDTH = 360;
const FIELD_STEP = 8;

function fieldDots(height: number) {
  const dots: Array<{ x: number; y: number; r: number }> = [];
  for (let y = FIELD_STEP / 2; y < height; y += FIELD_STEP) {
    // Dots swell towards the bottom edge, like ink pooling on a press.
    const r = 3.4 * (y / height) ** 1.4;
    if (r < 0.4) continue;
    for (let x = FIELD_STEP / 2; x < FIELD_WIDTH; x += FIELD_STEP) dots.push({ x, y, r });
  }
  return dots;
}

const FIELDS = new Map<number, ReturnType<typeof fieldDots>>();

/** A halftone gradient across the bottom of a panel. Fills its parent's width. */
export function HalftoneField({ height = 72, color }: { height?: number; color?: string }) {
  const colors = useThemeColors();
  let dots = FIELDS.get(height);
  if (!dots) FIELDS.set(height, (dots = fieldDots(height)));
  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 ${FIELD_WIDTH} ${height}`}
      preserveAspectRatio="xMidYMax slice"
      style={styles.field}
      {...hidden}
    >
      {dots.map((dot) => (
        <Circle key={`${dot.x}-${dot.y}`} cx={dot.x} cy={dot.y} r={dot.r} fill={color ?? colors.lineStrong} />
      ))}
    </Svg>
  );
}

const METER_BLOCKS = 20;

/** Progress as a row of printed blocks; the label next to it carries the meaning. */
export function BlockMeter({ share, done }: { share: number; done?: boolean }) {
  const colors = useThemeColors();
  const lit = Math.round(Math.min(Math.max(share, 0), 1) * METER_BLOCKS);
  return (
    <View style={styles.meter} {...hidden}>
      {Array.from({ length: METER_BLOCKS }, (_, index) => (
        <View
          key={index}
          style={[styles.block, { backgroundColor: index < lit ? (done ? colors.ok : colors.ink) : colors.fill }]}
        />
      ))}
    </View>
  );
}

/** The newspaper double rule: a heavy line over a hairline. */
export function DoubleRule() {
  const colors = useThemeColors();
  return (
    <View {...hidden}>
      <View style={[styles.ruleHeavy, { backgroundColor: colors.ink }]} />
      <View style={[styles.ruleThin, { backgroundColor: colors.ink }]} />
    </View>
  );
}

/** A section of a page as in print: a rule, a serif heading, then the rows. */
export function PrintSection({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <View style={[styles.section, { borderTopColor: colors.ink }]}>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, { color: colors.ink }]} accessibilityRole="header">
          {title}
        </Text>
        {aside ? <Text style={[styles.sectionAside, { color: colors.inkMuted }]}>{aside}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  inert: { pointerEvents: 'none' },
  field: { position: 'absolute', left: 0, right: 0, bottom: 0, pointerEvents: 'none' },
  meter: { flexDirection: 'row', gap: 3 },
  block: { flex: 1, height: 10 },
  ruleHeavy: { height: 3 },
  ruleThin: { height: 1, marginTop: 2 },
  section: { borderTopWidth: 2, paddingTop: spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.xs },
  sectionTitle: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 28 },
  sectionAside: { fontFamily: fonts.body, fontSize: 14, fontVariant: ['tabular-nums'] },
});

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import type { Receipt } from 'phosphor-react-native/src/icons/Receipt';
import { shopSunrise } from './dither';

/**
 * The team app's printed touches (DESIGN.md, "Printed paper"): the dithered
 * shop, an icon chip, a meter made of blocks, kickers and rules. All drawing is
 * decoration, hidden from screen readers; the words beside it say the same.
 */

const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };

type IconComponent = typeof Receipt;

/** A job's line icon in a soft rounded chip. Decoration: the words beside it say the job. */
export function IconChip({ icon: Icon, background }: { icon: IconComponent; background?: string }) {
  const colors = useThemeColors();
  return (
    <View style={[styles.chip, { backgroundColor: background ?? colors.fill }]} {...hidden}>
      <Icon size={22} color={colors.ink} />
    </View>
  );
}

const SUNRISE = { columns: 100, rows: 40 };
const SUNRISE_RUNS = shopSunrise(SUNRISE.columns, SUNRISE.rows);

/** The shop at sunrise, dithered: the building in ink against a clay sun. Fills its parent's width. */
export function ShopSunrise() {
  const colors = useThemeColors();
  return (
    <Svg
      width="100%"
      viewBox={`0 0 ${SUNRISE.columns} ${SUNRISE.rows}`}
      style={[styles.inert, { aspectRatio: SUNRISE.columns / SUNRISE.rows }]}
      {...hidden}
    >
      {SUNRISE_RUNS.sun.map((run) => (
        <Rect key={`s${run.x}-${run.y}`} x={run.x} y={run.y} width={run.length} height={1.02} fill={colors.accent} />
      ))}
      {SUNRISE_RUNS.shop.map((run) => (
        <Rect key={`b${run.x}-${run.y}`} x={run.x} y={run.y} width={run.length} height={1.02} fill={colors.ink} />
      ))}
    </Svg>
  );
}

/** A small capital label over a figure or a block, in monospace. */
export function Kicker({ children }: { children: string }) {
  const colors = useThemeColors();
  return <Text style={[styles.kicker, { color: colors.inkMuted }]}>{children.toLocaleUpperCase()}</Text>;
}

const METER_BLOCKS = 20;

/** Progress as a row of printed blocks; the label next to it carries the meaning. */
export function BlockMeter({ share, done, track }: { share: number; done?: boolean; track?: string }) {
  const colors = useThemeColors();
  const lit = Math.round(Math.min(Math.max(share, 0), 1) * METER_BLOCKS);
  return (
    <View style={styles.meter} {...hidden}>
      {Array.from({ length: METER_BLOCKS }, (_, index) => (
        <View
          key={index}
          style={[styles.block, { backgroundColor: index < lit ? (done ? colors.ok : colors.ink) : (track ?? colors.fill) }]}
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
    <View style={[styles.section, { borderTopColor: colors.lineStrong }]}>
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
  meter: { flexDirection: 'row', gap: 3 },
  block: { flex: 1, height: 10 },
  chip: { width: 44, height: 44, borderRadius: radius.small + 4, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: fonts.mono, fontSize: 12, letterSpacing: 0.8 },
  ruleHeavy: { height: 3 },
  ruleThin: { height: 1, marginTop: 2 },
  section: { borderTopWidth: 1, paddingTop: spacing.md },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.xs },
  sectionTitle: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 28 },
  sectionAside: { fontFamily: fonts.body, fontSize: 14, fontVariant: ['tabular-nums'] },
});

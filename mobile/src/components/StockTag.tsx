import { StyleSheet, Text, View } from 'react-native';
import { fonts, radius, spacing, useThemeColors, type } from '../theme';
import { useT } from '../i18n/useT';

type StockLevel = 'out' | 'low' | 'ok';

function stockLevel(quantity: number, reorderLevel: number): StockLevel {
  if (quantity === 0) return 'out';
  if (quantity <= reorderLevel) return 'low';
  return 'ok';
}

interface StockTagProps {
  quantity: number;
  reorderLevel: number;
  size?: 'regular' | 'large';
}

/**
 * The shelf count over an inset bar, as on the dashboard (DESIGN.md 10.8): full
 * at four times the reorder level, so the alert point sits a quarter along, and
 * coloured fine, low or out. Only low and out are said in words; fine stays quiet.
 */
export function StockTag({ quantity, reorderLevel, size = 'regular' }: StockTagProps) {
  const colors = useThemeColors();
  const t = useT();
  const level = stockLevel(quantity, reorderLevel);
  const filled = Math.min(quantity / Math.max(reorderLevel * 4, 1), 1);
  const barColor = { out: colors.signalOut, low: colors.signalLow, ok: colors.stockOk }[level];
  const isLarge = size === 'large';

  return (
    <View
      style={[styles.container, isLarge && styles.containerLarge]}
      accessible
      accessibilityLabel={t.stockTag.label(quantity, t.stockTag[level])}
    >
      <Text style={[styles.count, isLarge && styles.countLarge, { color: level === 'out' ? colors.signalOut : colors.ink }]}>{quantity}</Text>
      <View style={[styles.track, isLarge && styles.trackLarge, { backgroundColor: colors.fill, boxShadow: colors.inset }]}>
        <View style={[styles.fill, { width: `${filled * 100}%`, backgroundColor: barColor }]} />
      </View>
      {level !== 'ok' && <Text style={[styles.label, { color: barColor }]}>{t.stockTag[level].toLocaleUpperCase()}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { minWidth: 64, gap: spacing.xs },
  containerLarge: { minWidth: 160, gap: spacing.md },
  count: { fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 20, fontVariant: ['tabular-nums'] },
  countLarge: { fontSize: type.hero, lineHeight: 66 },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  trackLarge: { height: 8 },
  fill: { height: '100%', borderRadius: radius.pill },
  label: { fontFamily: fonts.mono, fontSize: type.caption, letterSpacing: 0.6 },
});

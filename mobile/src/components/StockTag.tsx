import { StyleSheet, Text, View } from 'react-native';
import { fonts, useThemeColors } from '../theme';
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
 * Shelf-tag style stock count, matching the admin dashboard. The bar is full
 * at twice the reorder level, so the notch in the middle marks "reorder now".
 */
export function StockTag({ quantity, reorderLevel, size = 'regular' }: StockTagProps) {
  const colors = useThemeColors();
  const t = useT();
  const level = stockLevel(quantity, reorderLevel);
  const fill = Math.min(quantity / Math.max(reorderLevel * 2, 1), 1);
  const barColor = { out: colors.signalOut, low: colors.signalLow, ok: colors.stockOk }[level];
  const isLarge = size === 'large';

  return (
    <View
      style={[styles.container, isLarge && styles.containerLarge]}
      accessible
      accessibilityLabel={t.stockTag.label(quantity, t.stockTag[level])}
    >
      <Text
        style={[
          styles.count,
          isLarge && styles.countLarge,
          { color: level === 'out' ? colors.signalOut : colors.ink },
        ]}
      >
        {quantity}
      </Text>
      <View style={[styles.gauge, isLarge && styles.gaugeLarge, { backgroundColor: colors.line }]}>
        <View style={[styles.fill, { width: `${fill * 100}%`, backgroundColor: barColor }]} />
        <View style={[styles.notch, { backgroundColor: colors.surface }]} />
      </View>
      <Text style={[styles.label, { color: colors.steel }]}>{t.stockTag[level]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { minWidth: 64, gap: 3 },
  containerLarge: { minWidth: 160, gap: 6 },
  count: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 26, fontVariant: ['tabular-nums'] },
  countLarge: { fontSize: 64, lineHeight: 66 },
  gauge: { height: 4, borderRadius: 2, overflow: 'hidden' },
  gaugeLarge: { height: 8, borderRadius: 3 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  notch: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2 },
  label: { fontFamily: fonts.body, fontSize: 12 },
});

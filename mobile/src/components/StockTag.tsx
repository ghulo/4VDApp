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

const BLOCKS = 10;

/**
 * Shelf-tag style stock count, matching the admin dashboard: a row of printed
 * blocks, full at twice the reorder level, with a wider gap after the fifth
 * block marking "reorder now".
 */
export function StockTag({ quantity, reorderLevel, size = 'regular' }: StockTagProps) {
  const colors = useThemeColors();
  const t = useT();
  const level = stockLevel(quantity, reorderLevel);
  const lit = Math.round(Math.min(quantity / Math.max(reorderLevel * 2, 1), 1) * BLOCKS);
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
      <View style={[styles.gauge, isLarge && styles.gaugeLarge]}>
        {Array.from({ length: BLOCKS }, (_, index) => (
          <View
            key={index}
            style={[styles.block, index === BLOCKS / 2 && styles.reorderGap, { backgroundColor: index < lit ? barColor : colors.lineStrong }]}
          />
        ))}
      </View>
      <Text style={[styles.label, { color: barColor === colors.stockOk ? colors.steel : barColor }]}>
        {t.stockTag[level].toLocaleUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { minWidth: 64, gap: 3 },
  containerLarge: { minWidth: 160, gap: 6 },
  count: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 26, fontVariant: ['tabular-nums'] },
  countLarge: { fontSize: 64, lineHeight: 66 },
  gauge: { flexDirection: 'row', gap: 2, height: 6 },
  gaugeLarge: { gap: 3, height: 10 },
  block: { flex: 1 },
  // The reorder point: a wider gap after the fifth block.
  reorderGap: { marginLeft: 2 },
  label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.6 },
});

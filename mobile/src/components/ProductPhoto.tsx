import { Image } from 'expo-image';
import { Package } from 'phosphor-react-native/src/icons/Package';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { mediaSrc } from '../services/apiClient';
import { radius, useThemeColors } from '../theme';

/**
 * A product's photo, square (DESIGN.md 10.9), with the same box drawing as the
 * dashboard when there is none or it fails to load. `size` in points, or
 * "fill" to take the width it is given. The name always sits beside it, so
 * the picture is hidden from screen readers.
 */
export function ProductPhoto({ uri, size }: { uri: string | null; size: number | 'fill' }) {
  const colors = useThemeColors();
  const [broken, setBroken] = useState<string | null>(null);
  const box = size === 'fill' ? styles.fill : { width: size, height: size };
  const corner = size !== 'fill' && size >= 112 ? radius.panel : radius.small;
  const iconSize = size === 'fill' ? 28 : size >= 112 ? 32 : 18;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.photo, box, { borderRadius: corner, backgroundColor: colors.surfaceSunk, boxShadow: `inset 0 0 0 1px ${colors.line}` }]}
    >
      {uri && uri !== broken ? (
        <Image source={mediaSrc(uri)} style={StyleSheet.absoluteFill} contentFit="cover" onError={() => setBroken(uri)} accessibilityIgnoresInvertColors />
      ) : (
        <Package size={iconSize} color={colors.inkMuted} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fill: { width: '100%', aspectRatio: 1 },
});

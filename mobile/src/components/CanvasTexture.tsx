import { useId, type ReactElement } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { ClipPath, Defs, G, LinearGradient, Pattern, Rect, Circle, Stop } from 'react-native-svg';
import { texture, useTheme } from '../theme';

const PILLARS = [0, 3.5, 7, 10.5];

/**
 * The page behind every screen, as on the dashboard: the mark's four pillars
 * woven across it, and its sunrise rising faintly from the bottom corner.
 * Screens leave their own background clear so this shows through.
 */
export function CanvasTexture() {
  const { colors, scheme } = useTheme();
  const { width } = useWindowDimensions();
  const alpha = texture[scheme];
  // Every screen draws its own copy, and on the web the ids share one page.
  const id = useId().replace(/:/g, '');
  const sunWidth = Math.min(560, width * 0.9);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={`weave${id}`} width={56} height={56} patternUnits="userSpaceOnUse">
            {[[6, 9], [34, 37]].flatMap(([x, y]) =>
              PILLARS.map((dx) => (
                <Rect key={`${x}-${dx}`} x={x! + dx} y={y} width={1.5} height={10} rx={0.75} fill={colors.ink} fillOpacity={alpha.weave} />
              )),
            )}
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#weave${id})`} />
      </Svg>
      <Svg style={styles.sunrise} width={sunWidth} height={sunWidth * 0.65} viewBox="0 0 400 260">
        <Defs>
          {/* The sun's two stripes, as in the mark. */}
          <ClipPath id={`sun${id}`}>
            <Rect width={400} height={168} />
            <Rect y={179} width={400} height={21} />
            <Rect y={215} width={400} height={34} />
          </ClipPath>
          <LinearGradient id={`horizon${id}`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.ink} stopOpacity={0} />
            <Stop offset="0.35" stopColor={colors.ink} stopOpacity={alpha.sun} />
          </LinearGradient>
        </Defs>
        <G clipPath={`url(#sun${id})`}>
          <Circle cx={230} cy={160} r={150} fill={colors.cta} fillOpacity={alpha.sun} />
        </G>
        <Rect y={252} width={400} height={2.5} fill={`url(#horizon${id})`} />
      </Svg>
    </View>
  );
}

/** A screen on the textured canvas: used as each navigator's screenLayout. */
export function CanvasPage({ children }: { children: ReactElement }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <CanvasTexture />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  clip: { overflow: 'hidden' },
  sunrise: { position: 'absolute', right: -32, bottom: 0 },
});

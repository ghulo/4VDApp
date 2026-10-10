import { useId, type ReactElement } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from 'react-native-svg';
import { texture, useTheme } from '../theme';

const PILLARS = [18, 25.67, 33.33, 41];

/**
 * The page behind every screen, as on the dashboard: the 4VD mark (its striped
 * sun, roof, four pillars and ground) as one faint watermark in the bottom corner.
 */
export function CanvasTexture() {
  const { colors, scheme } = useTheme();
  const { width } = useWindowDimensions();
  const alpha = texture[scheme];
  // Every screen draws its own copy, and on the web the ids share one page.
  const clipId = `sun${useId().replace(/:/g, '')}`;
  const markWidth = Math.min(520, width * 0.8);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg style={styles.mark} width={markWidth} height={(markWidth * 37) / 64} viewBox="0 12 64 37">
        <Defs>
          {/* The sun's two stripes, as in the mark. */}
          <ClipPath id={clipId}>
            <Rect y={12} width={64} height={24} />
            <Rect y={37.4} width={64} height={2.6} />
            <Rect y={41.8} width={64} height={4.2} />
          </ClipPath>
        </Defs>
        <G clipPath={`url(#${clipId})`}>
          <Circle cx={32} cy={35} r={21} fill={colors.cta} fillOpacity={alpha.sun} />
        </G>
        <Path
          d="M16 27 32 16l16 11"
          fill="none"
          stroke={colors.ink}
          strokeOpacity={alpha.ink}
          strokeWidth={4.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <G fill={colors.ink} fillOpacity={alpha.ink}>
          {PILLARS.map((x) => (
            <Rect key={x} x={x} y={29} width={5} height={14} rx={1} />
          ))}
          <Rect x={15} y={42.5} width={34} height={3.5} rx={1} />
          <Rect x={7} y={46} width={50} height={2.6} rx={1.3} />
        </G>
      </Svg>
    </View>
  );
}

/** A screen on the canvas: used as each navigator's screenLayout. */
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
  mark: { position: 'absolute', right: 16, bottom: 0 },
});

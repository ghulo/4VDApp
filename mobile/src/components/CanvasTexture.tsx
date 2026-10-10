import { useId, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { texture, useTheme } from '../theme';

const PILLARS = [0, 3.5, 7, 10.5];
const TILE = 72;

/**
 * The page behind every screen, as on the dashboard: the 4VD mark's four
 * pillars, woven very faintly across it.
 */
export function CanvasTexture() {
  const { colors, scheme } = useTheme();
  // Every screen draws its own copy, and on the web the ids share one page.
  const patternId = `weave${useId().replace(/:/g, '')}`;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={patternId} width={TILE} height={TILE} patternUnits="userSpaceOnUse">
            {[[8, 12], [44, 48]].flatMap(([x, y]) =>
              PILLARS.map((dx) => (
                <Rect
                  key={`${x}-${dx}`}
                  x={x! + dx}
                  y={y}
                  width={1.5}
                  height={10}
                  rx={0.75}
                  fill={colors.ink}
                  fillOpacity={texture[scheme]}
                />
              )),
            )}
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${patternId})`} />
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
});

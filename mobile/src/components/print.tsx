import { type ReactNode, useEffect, useId, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Mask,
  Path,
  Rect,
} from "react-native-svg";
import { fonts, radius, spacing, useThemeColors } from "../theme";
import type { Receipt } from "phosphor-react-native/src/icons/Receipt";

/**
 * The team app's printed touches (DESIGN.md, "Printed paper"): the shop at
 * sunrise, an icon chip, a meter made of blocks, kickers and rules. All drawing is
 * decoration, hidden from screen readers; the words beside it say the same.
 */

const hidden = {
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants" as const,
};

type IconComponent = typeof Receipt;

/** A job's line icon in a soft rounded chip. Decoration: the words beside it say the job. */
export function IconChip({
  icon: Icon,
  background,
}: {
  icon: IconComponent;
  background?: string;
}) {
  const colors = useThemeColors();
  return (
    <View
      style={[styles.chip, { backgroundColor: background ?? colors.fill }]}
      {...hidden}
    >
      <Icon size={22} color={colors.ink} />
    </View>
  );
}

/** The 4VD mark's four equal pillars, spread across the shop front. */
const PILLARS = [84, 104.33, 124.67, 145];

/**
 * The shop at sunrise, the same drawing as the dashboard's
 * (admin/src/components/ui/ShopSunrise.tsx): one roof, four equal pillars, a clay
 * sun rising behind them with printed-sunset stripes. The sun comes up once when
 * it appears, unless the phone asks for less motion. Fills its parent's width.
 */
export function ShopSunrise() {
  const colors = useThemeColors();
  const id = useId().replace(/:/g, "");
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) rise.setValue(1);
      else
        Animated.timing(rise, {
          toValue: 1,
          duration: 1200,
          easing: Easing.out(Easing.exp),
          useNativeDriver: true,
        }).start();
    });
    return () => {
      cancelled = true;
    };
  }, [rise]);

  return (
    <View style={[styles.inert, styles.sunrise]} {...hidden}>
      {/* The sun on its own layer so it can rise behind the shop. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            opacity: rise,
            transform: [
              {
                translateY: rise.interpolate({
                  inputRange: [0, 1],
                  outputRange: [14, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Svg width="100%" height="100%" viewBox="0 0 240 140">
          <Defs>
            <ClipPath id={`ground-${id}`}>
              <Rect width={240} height={120} />
            </ClipPath>
            <Mask id={`stripes-${id}`}>
              <Rect width={240} height={140} fill="#fff" />
              <Rect y={86} width={240} height={2} fill="#000" />
              <Rect y={94} width={240} height={3} fill="#000" />
              <Rect y={103} width={240} height={4} fill="#000" />
              <Rect y={112} width={240} height={5} fill="#000" />
            </Mask>
          </Defs>
          <G clipPath={`url(#ground-${id})`}>
            <Circle
              cx={120}
              cy={96}
              r={74}
              fill={colors.accent}
              opacity={0.16}
            />
            <Circle
              cx={120}
              cy={96}
              r={54}
              fill={colors.accent}
              mask={`url(#stripes-${id})`}
            />
          </G>
        </Svg>
      </Animated.View>
      {/* Its own layer after the sun's, so the shop always paints in front. */}
      <View style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%" viewBox="0 0 240 140">
          <Path
            d="M76 70 L120 42 L164 70"
            fill="none"
            stroke={colors.ink}
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {PILLARS.map((x) => (
            <Rect
              key={x}
              x={x}
              y={76}
              width={11}
              height={38}
              rx={2}
              fill={colors.ink}
            />
          ))}
          <Rect x={74} y={113} width={92} height={7} rx={2} fill={colors.ink} />
          <Rect
            x={6}
            y={120}
            width={228}
            height={3}
            rx={1.5}
            fill={colors.ink}
          />
          <Rect
            x={40}
            y={128}
            width={160}
            height={2}
            rx={1}
            fill={colors.inkMuted}
            opacity={0.45}
          />
          <Rect
            x={76}
            y={134}
            width={88}
            height={2}
            rx={1}
            fill={colors.inkMuted}
            opacity={0.25}
          />
        </Svg>
      </View>
    </View>
  );
}

/** A small capital label over a figure or a block, in monospace. */
export function Kicker({ children }: { children: string }) {
  const colors = useThemeColors();
  return (
    <Text style={[styles.kicker, { color: colors.inkMuted }]}>
      {children.toLocaleUpperCase()}
    </Text>
  );
}

const METER_BLOCKS = 20;

/** Progress as a row of printed blocks; the label next to it carries the meaning. */
export function BlockMeter({
  share,
  done,
  track,
}: {
  share: number;
  done?: boolean;
  track?: string;
}) {
  const colors = useThemeColors();
  const lit = Math.round(Math.min(Math.max(share, 0), 1) * METER_BLOCKS);
  return (
    <View style={styles.meter} {...hidden}>
      {Array.from({ length: METER_BLOCKS }, (_, index) => (
        <View
          key={index}
          style={[
            styles.block,
            {
              backgroundColor:
                index < lit
                  ? done
                    ? colors.ok
                    : colors.ink
                  : (track ?? colors.fill),
            },
          ]}
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
export function PrintSection({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <View style={[styles.section, { borderTopColor: colors.lineStrong }]}>
      <View style={styles.sectionHead}>
        <Text
          style={[styles.sectionTitle, { color: colors.ink }]}
          accessibilityRole="header"
        >
          {title}
        </Text>
        {aside ? (
          <Text style={[styles.sectionAside, { color: colors.inkMuted }]}>
            {aside}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  inert: { pointerEvents: "none" },
  sunrise: { width: "100%", aspectRatio: 240 / 140 },
  meter: { flexDirection: "row", gap: 3 },
  block: { flex: 1, height: 10 },
  chip: {
    width: 44,
    height: 44,
    borderRadius: radius.small + 4,
    alignItems: "center",
    justifyContent: "center",
  },
  kicker: { fontFamily: fonts.mono, fontSize: 12, letterSpacing: 0.8 },
  ruleHeavy: { height: 3 },
  ruleThin: { height: 1, marginTop: 2 },
  section: { borderTopWidth: 1, paddingTop: spacing.md },
  sectionHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  sectionTitle: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 28 },
  sectionAside: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
});

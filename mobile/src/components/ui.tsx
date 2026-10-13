import type { Icon } from 'phosphor-react-native';
import { WarningCircle } from 'phosphor-react-native/src/icons/WarningCircle';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { fonts, keyShadow, keyTravel, radius, spacing, useThemeColors, type } from '../theme';
import { errorMessage } from '../utils/format';
import { useT } from '../i18n/useT';
import { IconChip } from './print';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'quiet';
  /** Small keys (36px) sit in rows and lists; regular ones (48px) end a form. */
  size?: 'regular' | 'small';
  /** A line icon before the label. */
  icon?: Icon;
  /** What a screen reader says when the label alone isn't enough ("Log out iPhone"). */
  accessibilityLabel?: string;
  disabled?: boolean;
  /** While its action runs: a spinner takes the icon's place and the label stays. */
  loading?: boolean;
}

export function Button({ label, onPress, variant = 'primary', size = 'regular', icon: IconComponent, accessibilityLabel, disabled, loading }: ButtonProps) {
  const colors = useThemeColors();
  const isPrimary = variant === 'primary';
  const isSmall = size === 'small';
  // A busy key keeps its face; only a key that can't be used goes flat.
  const inactive = disabled && !loading;
  const labelColor = inactive ? colors.inkMuted : isPrimary ? colors.ctaInk : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isSmall && styles.buttonSmall,
        isPrimary
          ? { backgroundColor: colors.cta }
          : { borderColor: colors.lineStrong, borderWidth: 1, backgroundColor: pressed ? colors.surfaceSunk : colors.surface },
        // Raised like a key, pressing down into its edge. Disabled ones sit flat
        // on sunk paper with a hairline ring, never half see-through.
        !inactive && { boxShadow: keyShadow(colors, isPrimary ? 'clay' : 'paper', pressed), ...keyTravel(pressed) },
        inactive && { backgroundColor: colors.surfaceSunk, borderColor: colors.line, borderWidth: 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={labelColor} />
      ) : (
        IconComponent && <IconComponent size={isSmall ? 14 : 16} color={labelColor} weight="bold" />
      )}
      <Text style={[styles.buttonLabel, isSmall && styles.buttonLabelSmall, { color: labelColor }]}>{label}</Text>
    </Pressable>
  );
}

/** A labelled text box; `hint` under it explains, `error` (read out at once) says what's wrong. */
export function TextField({ label, hint, error, ...inputProps }: TextInputProps & { label: string; hint?: string; error?: string }) {
  const colors = useThemeColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.ink }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.steel}
        accessibilityLabel={label}
        {...inputProps}
        style={[
          styles.input,
          { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.lineStrong, boxShadow: colors.inset },
          error ? { borderColor: colors.signalOut } : null,
          inputProps.style,
        ]}
      />
      {hint && !error && <Text style={[styles.fieldNote, { color: colors.steel }]}>{hint}</Text>}
      {error && (
        <Text style={[styles.fieldNote, { color: colors.signalOut }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
    </View>
  );
}

export function Loading() {
  const colors = useThemeColors();
  const t = useT();
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.steel} accessibilityLabel={t.common.loading} />
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const colors = useThemeColors();
  const t = useT();
  return (
    <View style={styles.centered} accessibilityRole="alert">
      <IconChip icon={WarningCircle} background={colors.dangerSoft} />
      <Text style={[styles.emptyTitle, { color: colors.ink }]}>{t.common.somethingWrong}</Text>
      <Text style={[styles.stateText, { color: colors.steel }]}>{errorMessage(error)}</Text>
      {onRetry && <Button label={t.common.tryAgain} variant="quiet" onPress={onRetry} />}
    </View>
  );
}

export type StampTone = 'neutral' | 'ok' | 'warn' | 'danger';

/**
 * A status word printed like a rubber stamp, the same as the dashboard's badge
 * (DESIGN.md 10.5): monospace capitals in a squared outline, no fill. The
 * colour names the state; the word carries it.
 */
export function Stamp({ label, tone = 'neutral' }: { label: string; tone?: StampTone }) {
  const colors = useThemeColors();
  const color = { neutral: colors.inkMuted, ok: colors.ok, warn: colors.warn, danger: colors.danger }[tone];
  return (
    <View style={[styles.stamp, { borderColor: color }]}>
      <Text style={[styles.stampLabel, { color }]}>{label.toLocaleUpperCase()}</Text>
    </View>
  );
}

/** An empty screen: what would be here, with the job's icon when it has one. */
export function EmptyState({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: Parameters<typeof IconChip>[0]['icon'];
  /** A way forward, usually a Button, so an empty screen isn't a dead end. */
  action?: ReactNode;
  children?: ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <View style={styles.centered}>
      {icon && <IconChip icon={icon} />}
      <Text style={[styles.emptyTitle, { color: colors.ink }]}>{title}</Text>
      {typeof children === 'string' ? (
        <Text style={[styles.stateText, { color: colors.steel }]}>{children}</Text>
      ) : (
        children
      )}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { minHeight: 36, paddingHorizontal: spacing.md, gap: spacing.xs, alignSelf: 'flex-start' },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: type.body },
  buttonLabelSmall: { fontSize: type.label },
  field: { gap: spacing.xs, marginBottom: spacing.lg },
  fieldLabel: { fontFamily: fonts.bodyBold, fontSize: type.label },
  fieldNote: { fontFamily: fonts.body, fontSize: type.label },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.small,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.body,
    fontSize: type.input,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  stateText: { fontFamily: fonts.body, fontSize: type.body, textAlign: 'center' },
  stamp: { alignSelf: 'flex-start', height: 22, paddingHorizontal: 6, borderWidth: 1, borderRadius: radius.stamp, justifyContent: 'center' },
  stampLabel: { fontFamily: fonts.mono, fontSize: type.caption, fontWeight: '600', letterSpacing: 0.7 },
  emptyTitle: { fontFamily: fonts.display, fontSize: type.headline },
});

/**
 * A raised paper panel that holds a form's fields (DESIGN.md 8), so a form
 * never sits bare on the canvas. Fields bring their own bottom spacing.
 */
export function Panel({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  return <View style={[panelStyles.panel, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>{children}</View>;
}

const panelStyles = StyleSheet.create({
  panel: { padding: spacing.lg, paddingBottom: spacing.xs, borderRadius: radius.panel, borderWidth: 1 },
});

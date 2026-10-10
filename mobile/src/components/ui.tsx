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
  disabled?: boolean;
  loading?: boolean;
}

export function Button({ label, onPress, variant = 'primary', disabled, loading }: ButtonProps) {
  const colors = useThemeColors();
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isPrimary
          ? { backgroundColor: colors.cta }
          : { borderColor: colors.lineStrong, borderWidth: 1, backgroundColor: pressed ? colors.surfaceSunk : colors.surface },
        // Raised like a key, pressing down into its edge. Disabled ones sit flat
        // on sunk paper with a hairline ring, never half see-through.
        !(disabled || loading) && { boxShadow: keyShadow(colors, isPrimary ? 'clay' : 'paper', pressed), ...keyTravel(pressed) },
        disabled && { backgroundColor: colors.surfaceSunk, borderColor: colors.line, borderWidth: 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.ctaInk : colors.ink} />
      ) : (
        <Text style={[styles.buttonLabel, { color: disabled ? colors.inkMuted : isPrimary ? colors.ctaInk : colors.ink }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function TextField({ label, ...inputProps }: TextInputProps & { label: string }) {
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
          inputProps.style,
        ]}
      />
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
      <Text style={[styles.stateText, { color: colors.ink }]}>{errorMessage(error)}</Text>
      {onRetry && <Button label={t.common.tryAgain} variant="quiet" onPress={onRetry} />}
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
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: type.body },
  field: { gap: spacing.xs, marginBottom: spacing.lg },
  fieldLabel: { fontFamily: fonts.bodyBold, fontSize: type.label },
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
  emptyTitle: { fontFamily: fonts.display, fontSize: type.headline },
});

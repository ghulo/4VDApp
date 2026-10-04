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
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { errorMessage } from '../utils/format';
import { useT } from '../i18n/useT';
import type { PixelArtName } from './pixelDrawings';
import { PixelArt } from './print';

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
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isPrimary
          ? { backgroundColor: disabled ? colors.fill : colors.cta }
          : { borderColor: colors.lineStrong, borderWidth: 1, backgroundColor: 'transparent' },
        // A disabled main button goes neutral rather than a washed-out orange.
        disabled && !isPrimary && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.ctaInk : colors.ink} />
      ) : (
        <Text style={[styles.buttonLabel, { color: isPrimary ? (disabled ? colors.inkMuted : colors.ctaInk) : colors.ink }]}>
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
          { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.lineStrong },
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

/** An empty screen: what would be here, with the job's pictogram when it has one. */
export function EmptyState({ title, art, children }: { title: string; art?: PixelArtName; children?: ReactNode }) {
  const colors = useThemeColors();
  return (
    <View style={styles.centered}>
      {art && <PixelArt name={art} size={48} color={colors.inkMuted} />}
      <Text style={[styles.emptyTitle, { color: colors.ink }]}>{title}</Text>
      {typeof children === 'string' ? (
        <Text style={[styles.stateText, { color: colors.steel }]}>{children}</Text>
      ) : (
        children
      )}
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
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 16 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  field: { gap: spacing.xs, marginBottom: spacing.lg },
  fieldLabel: { fontFamily: fonts.bodyBold, fontSize: 14 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.small,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  stateText: { fontFamily: fonts.body, fontSize: 16, textAlign: 'center' },
  emptyTitle: { fontFamily: fonts.serif, fontSize: 24 },
});

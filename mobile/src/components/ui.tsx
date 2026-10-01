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
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isPrimary
          ? { backgroundColor: colors.ink }
          : { borderColor: colors.lineStrong, borderWidth: 1, backgroundColor: 'transparent' },
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.onInk : colors.ink} />
      ) : (
        <Text style={[styles.buttonLabel, { color: isPrimary ? colors.onInk : colors.ink }]}>{label}</Text>
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
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.steel} accessibilityLabel="Loading" />
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const colors = useThemeColors();
  return (
    <View style={styles.centered} accessibilityRole="alert">
      <Text style={[styles.stateText, { color: colors.ink }]}>{errorMessage(error)}</Text>
      {onRetry && <Button label="Try again" variant="quiet" onPress={onRetry} />}
    </View>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  const colors = useThemeColors();
  return (
    <View style={styles.centered}>
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
  emptyTitle: { fontFamily: fonts.display, fontSize: 22 },
});

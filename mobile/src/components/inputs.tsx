import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { fonts, keyShadow, keyTravel, radius, spacing, useThemeColors, type } from '../theme';

interface StepperProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  /** Large type for counting shelves. */
  size?: 'regular' | 'large';
}

/** A number field with − and + buttons, for counting without the keyboard. */
export function Stepper({ label, value, onChange, min = 0, max, size = 'regular' }: StepperProps) {
  const colors = useThemeColors();
  const current = Number(value) || 0;
  const clamp = (next: number) => Math.max(min, max === undefined ? next : Math.min(max, next));
  const isLarge = size === 'large';

  return (
    <View style={styles.stepper}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <View style={styles.row}>
        <StepButton label="−1" accessibilityLabel={`One less, ${label}`} onPress={() => onChange(String(clamp(current - 1)))} large={isLarge} />
        <TextInput
          value={value}
          onChangeText={(text) => onChange(text.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          accessibilityLabel={label}
          selectTextOnFocus
          style={[
            styles.input,
            isLarge && styles.inputLarge,
            { color: colors.ink, borderColor: colors.lineStrong, backgroundColor: colors.surface, boxShadow: colors.inset },
          ]}
        />
        <StepButton label="+1" accessibilityLabel={`One more, ${label}`} onPress={() => onChange(String(clamp(current + 1)))} large={isLarge} />
      </View>
    </View>
  );
}

function StepButton({
  label,
  accessibilityLabel,
  onPress,
  large,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  large: boolean;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.stepButton,
        large && styles.stepButtonLarge,
        { borderColor: colors.lineStrong, backgroundColor: pressed ? colors.surfaceSunk : colors.surface },
        { boxShadow: keyShadow(colors, 'paper', pressed), ...keyTravel(pressed) },
      ]}
    >
      <Text style={[styles.stepLabel, { color: colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

interface ChoiceRowProps<TValue extends string> {
  label: string;
  options: ReadonlyArray<{ value: TValue; label: string }>;
  value: TValue;
  onChange: (value: TValue) => void;
}

/** One-of-several choice as large tappable chips. */
export function ChoiceRow<TValue extends string>({ label, options, value, onChange }: ChoiceRowProps<TValue>) {
  const colors = useThemeColors();
  return (
    <View style={styles.stepper} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <View style={styles.choices}>
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: isSelected, checked: isSelected }}
              onPress={() => onChange(option.value)}
              style={[
                styles.choice,
                { borderColor: isSelected ? colors.selected : colors.lineStrong, backgroundColor: isSelected ? colors.selected : colors.surface },
              ]}
            >
              <Text style={[styles.choiceLabel, { color: isSelected ? colors.onSelected : colors.ink }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { gap: spacing.xs, marginBottom: spacing.lg },
  label: { fontFamily: fonts.bodyBold, fontSize: type.label },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    // Without this a web input keeps its default width and pushes the + button off a narrow screen.
    minWidth: 0,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.small,
    textAlign: 'center',
    fontFamily: fonts.bodyBold,
    fontSize: type.figure,
    fontVariant: ['tabular-nums'],
  },
  inputLarge: { minHeight: 96, fontSize: type.hero },
  stepButton: {
    minWidth: 56,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonLarge: { minWidth: 72, minHeight: 96 },
  stepLabel: { fontFamily: fonts.bodyBold, fontSize: type.figure },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { minHeight: 44, paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: radius.small, justifyContent: 'center' },
  choiceLabel: { fontFamily: fonts.bodyBold, fontSize: type.body },
});

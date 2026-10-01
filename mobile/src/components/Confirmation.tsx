import { ScrollView, StyleSheet, Text } from 'react-native';
import { fonts, spacing, useThemeColors } from '../theme';
import { Button } from './ui';

/** Shown after sending something, so the person knows it worked and what happens next. */
export function Confirmation({ title, message, onDone }: { title: string; message: string; onDone: () => void }) {
  const colors = useThemeColors();
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[styles.message, { color: colors.steel }]}>{message}</Text>
      <Button label="Done" onPress={onDone} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.lg },
  title: { fontFamily: fonts.displayBold, fontSize: 28 },
  message: { fontFamily: fonts.body, fontSize: 17, lineHeight: 24 },
});

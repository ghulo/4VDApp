import { ScrollView, StyleSheet, Text } from 'react-native';
import { fonts, spacing, useThemeColors, type } from '../theme';
import { Button } from './ui';
import { useT } from '../i18n/useT';

/** Shown after sending something, so the person knows it worked and what happens next. */
export function Confirmation({ title, message, onDone }: { title: string; message: string; onDone: () => void }) {
  const colors = useThemeColors();
  const t = useT();
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[styles.message, { color: colors.steel }]}>{message}</Text>
      <Button label={t.common.done} onPress={onDone} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.lg },
  title: { fontFamily: fonts.display, fontSize: type.headline },
  message: { fontFamily: fonts.body, fontSize: type.title, lineHeight: 24 },
});

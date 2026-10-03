import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { secureStorage } from '../services/secureStorage';
import type { User } from '../services/types';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { LogoMark } from './LogoMark';
import { Button } from './ui';
import { useT } from '../i18n/useT';

const storageKey = (userId: number) => `4vd.welcome.${userId}`;

/** A short tour the first time someone opens the app on this device. Skippable at every step. */
export function WelcomeTour({ user }: { user: User }) {
  const colors = useThemeColors();
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const cards = user.role === 'family' ? t.tour.family : t.tour.staff;

  useEffect(() => {
    secureStorage
      .getItem(storageKey(user.id))
      .then((seen) => setVisible(!seen))
      .catch(() => undefined); // unreadable storage: don't nag
  }, [user.id]);

  function finish() {
    setVisible(false);
    secureStorage.setItem(storageKey(user.id), 'seen').catch(() => undefined);
  }

  const card = cards[step]!;
  const isLast = step === cards.length - 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={finish}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.surface }]} accessibilityViewIsModal>
          {step === 0 && (
            <View style={styles.welcome}>
              <LogoMark size={40} />
              <Text style={[styles.hello, { color: colors.inkMuted }]}>{t.tour.welcome(user.name.split(' ')[0] ?? user.name)}</Text>
            </View>
          )}
          <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
            {card.title}
          </Text>
          <Text style={[styles.body, { color: colors.ink }]}>{card.body}</Text>

          <View style={styles.dots} accessibilityLabel={t.tour.step(step + 1, cards.length)}>
            {cards.map((_, index) => (
              <View key={index} style={[styles.dot, { backgroundColor: index === step ? colors.brand : colors.line }]} />
            ))}
          </View>

          <Button label={isLast ? t.tour.letsGo : t.tour.next} onPress={isLast ? finish : () => setStep(step + 1)} />
          {!isLast && (
            <Pressable accessibilityRole="button" onPress={finish} hitSlop={8} style={styles.skip}>
              <Text style={[styles.skipText, { color: colors.inkMuted }]}>{t.tour.skip}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', padding: spacing.md, backgroundColor: 'rgba(8, 19, 14, 0.55)' },
  card: { width: '100%', maxWidth: 480, alignSelf: 'center', padding: spacing.xl, borderRadius: radius.board, gap: spacing.md },
  welcome: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  hello: { fontFamily: fonts.bodyBold, fontSize: 15 },
  title: { fontFamily: fonts.display, fontSize: 26, letterSpacing: -0.5 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23 },
  dots: { flexDirection: 'row', gap: 6, marginVertical: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  skip: { alignSelf: 'center', paddingVertical: spacing.xs },
  skipText: { fontFamily: fonts.bodyBold, fontSize: 15 },
});

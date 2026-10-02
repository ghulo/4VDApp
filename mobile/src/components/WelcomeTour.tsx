import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { secureStorage } from '../services/secureStorage';
import type { User } from '../services/types';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { LogoMark } from './LogoMark';
import { Button } from './ui';

interface Card {
  title: string;
  body: string;
}

const STAFF_CARDS: Card[] = [
  {
    title: 'Record a sale in seconds',
    body: 'Tap "Record a sale" on Home or the Sell tab. Bulk prices and promotions apply by themselves, and stock updates straight away.',
  },
  {
    title: 'Find any product',
    body: 'Search by name or SKU to see the price and how many are left. Tap the star to keep your most-used products under Favorites.',
  },
  {
    title: 'Ask the owner',
    body: 'Returns, damaged stock and shelf counts go to the owner to approve. You will see the answer under "Your requests" on Home.',
  },
];

const FAMILY_CARDS: Card[] = [
  {
    title: 'Everything in the shop',
    body: 'Browse every product with its price and how many are left, by category or by searching.',
  },
  {
    title: 'Keep your favourites',
    body: 'Tap the star on a product to find it again quickly under Favorites.',
  },
];

const storageKey = (userId: number) => `4vd.welcome.${userId}`;

/** A short tour the first time someone opens the app on this device. Skippable at every step. */
export function WelcomeTour({ user }: { user: User }) {
  const colors = useThemeColors();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const cards = user.role === 'family' ? FAMILY_CARDS : STAFF_CARDS;

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
              <Text style={[styles.hello, { color: colors.inkMuted }]}>Welcome to 4VD, {user.name.split(' ')[0]}</Text>
            </View>
          )}
          <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
            {card.title}
          </Text>
          <Text style={[styles.body, { color: colors.ink }]}>{card.body}</Text>

          <View style={styles.dots} accessibilityLabel={`Step ${step + 1} of ${cards.length}`}>
            {cards.map((_, index) => (
              <View key={index} style={[styles.dot, { backgroundColor: index === step ? colors.brand : colors.line }]} />
            ))}
          </View>

          <Button label={isLast ? "Let's go" : 'Next'} onPress={isLast ? finish : () => setStep(step + 1)} />
          {!isLast && (
            <Pressable accessibilityRole="button" onPress={finish} hitSlop={8} style={styles.skip}>
              <Text style={[styles.skipText, { color: colors.inkMuted }]}>Skip</Text>
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

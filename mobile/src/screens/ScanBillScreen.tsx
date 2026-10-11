import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Confirmation } from '../components/Confirmation';
import { Button } from '../components/ui';
import { useT } from '../i18n/useT';
import type { RootStackParamList } from '../navigation/types';
import { billScansApi } from '../services/api';
import { fonts, radius, spacing, type, useThemeColors } from '../theme';
import { errorMessage } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'ScanBill'>;

/** Matches the server's MAX_SCAN_PAGES. */
const MAX_PAGES = 6;
/** Sharp enough for small print, small enough to send six pages over shop Wi-Fi. */
const PICK_OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, base64: true };

interface Page {
  uri: string;
  base64: string;
}

/**
 * Anyone at the counter can photograph a supplier's bill. The server reads it
 * and the owner checks and confirms it on the dashboard; nothing about costs
 * comes back here.
 */
export function ScanBillScreen({ navigation }: Props) {
  const colors = useThemeColors();
  const t = useT();
  const [pages, setPages] = useState<Page[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => billScansApi.scan(pages.map((page) => ({ mime: 'image/jpeg', data: page.base64 }))),
  });

  async function add(from: 'camera' | 'library') {
    setProblem(null);
    if (from === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return setProblem(t.scanBill.noCamera);
    }
    const result =
      from === 'camera'
        ? await ImagePicker.launchCameraAsync(PICK_OPTIONS)
        : await ImagePicker.launchImageLibraryAsync({ ...PICK_OPTIONS, allowsMultipleSelection: true, selectionLimit: MAX_PAGES - pages.length });
    if (result.canceled) return;
    const picked = result.assets.flatMap((asset) => (asset.base64 ? [{ uri: asset.uri, base64: asset.base64 }] : []));
    setPages((current) => [...current, ...picked].slice(0, MAX_PAGES));
  }

  if (send.data) {
    return (
      <Confirmation
        title={t.scanBill.sentTitle}
        message={t.scanBill.sentMessage({ supplier: send.data.supplierName, lines: send.data.lines })}
        onDone={() => navigation.goBack()}
      />
    );
  }

  const full = pages.length >= MAX_PAGES;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.intro, { color: colors.ink }]}>{t.scanBill.intro}</Text>

      {pages.length > 0 && (
        <View style={styles.pages}>
          {pages.map((page, index) => (
            <View key={page.uri} style={[styles.page, { borderColor: colors.lineStrong, backgroundColor: colors.surfaceSunk }]}>
              <Image source={{ uri: page.uri }} style={styles.photo} accessibilityLabel={t.scanBill.page(index + 1)} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.scanBill.removePage(index + 1)}
                disabled={send.isPending}
                hitSlop={8}
                onPress={() => setPages((current) => current.filter((_, at) => at !== index))}
                style={[styles.remove, { backgroundColor: colors.surface, borderColor: colors.lineStrong }]}
              >
                <Text style={[styles.removeText, { color: colors.ink }]}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <Text style={[styles.muted, { color: colors.steel }]}>{pages.length > 0 ? t.scanBill.pages(pages.length, MAX_PAGES) : t.scanBill.tip}</Text>

      <View style={styles.actions}>
        <Button variant={pages.length === 0 ? 'primary' : 'quiet'} label={t.scanBill.takePhoto} onPress={() => add('camera')} disabled={full || send.isPending} />
        <Button variant="quiet" label={t.scanBill.fromLibrary} onPress={() => add('library')} disabled={full || send.isPending} />
      </View>

      {problem && <Text style={[styles.error, { color: colors.signalOut }]}>{problem}</Text>}
      {send.isError && <Text style={[styles.error, { color: colors.signalOut }]}>{errorMessage(send.error)}</Text>}
      {send.isPending && <Text style={[styles.muted, { color: colors.steel }]}>{t.scanBill.sending}</Text>}

      {pages.length > 0 && <Button label={t.scanBill.send} onPress={() => send.mutate()} loading={send.isPending} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  intro: { fontFamily: fonts.body, fontSize: type.body },
  muted: { fontFamily: fonts.body, fontSize: type.body },
  error: { fontFamily: fonts.body, fontSize: type.body },
  pages: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  page: { width: 96, height: 128, borderWidth: 1, borderRadius: radius.small, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  remove: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 20 },
  actions: { gap: spacing.sm },
});

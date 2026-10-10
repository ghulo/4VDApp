import { useMutation } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../components/Avatar';
import { ChoiceRow } from '../components/inputs';
import { PushSettingsPanel } from '../components/PushSettingsPanel';
import { Button, TextField } from '../components/ui';
import { meApi } from '../services/api';
import { API_URL, DASHBOARD_URL } from '../services/apiClient';
import { useAuth, useCurrentUser } from '../state/useAuth';
import { fonts, radius, spacing, type ThemePreference, useTheme, useThemeColors, type } from '../theme';
import { errorMessage } from '../utils/format';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { useT } from '../i18n/useT';
import { TabBarSpacer } from '../components/TabBarSpace';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export function AccountScreen() {
  const colors = useThemeColors();
  const t = useT();
  const { preference, setPreference } = useTheme();
  const user = useCurrentUser();
  const { logout, updateUser } = useAuth();

  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [photoError, setPhotoError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => meApi.updateProfile({ name: name.trim(), phone: phone.trim() || null }),
    onSuccess: updateUser,
  });
  const upload = useMutation({ mutationFn: meApi.uploadAvatar, onSuccess: updateUser });

  async function pickPhoto() {
    setPhotoError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    const blob = await (await fetch(asset.uri)).blob();
    if (blob.size > MAX_PHOTO_BYTES) {
      setPhotoError(t.account.photoTooBig);
      return;
    }
    upload.mutate(blob);
  }

  function chooseTheme(next: ThemePreference) {
    setPreference(next);
    // Saved to the profile too, so it follows you to your other devices.
    meApi.updateProfile({ theme: next }).then(updateUser).catch(() => undefined);
  }

  const panel = [styles.panel, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }];
  const changed = name.trim() !== user.name || phone.trim() !== (user.phone ?? '');

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={panel}>
        <View style={styles.identity}>
          <Pressable accessibilityRole="button" accessibilityLabel={t.account.changePhotoLabel} onPress={pickPhoto} disabled={upload.isPending}>
            <Avatar name={user.name} url={user.avatarUrl} size={64} />
          </Pressable>
          <View style={styles.identityText}>
            <Text style={[styles.name, { color: colors.ink }]}>{user.name}</Text>
            <Text style={[styles.detail, { color: colors.inkMuted }]}>{user.email}</Text>
          </View>
        </View>
        <Text style={[styles.detail, { color: colors.ink }]}>{t.account.roles[user.role]}</Text>
        <Pressable accessibilityRole="button" onPress={pickPhoto} disabled={upload.isPending} hitSlop={8}>
          <Text style={[styles.link, { color: colors.ink }]}>
            {upload.isPending ? t.account.uploading : user.avatarUrl ? t.account.changePhoto : t.account.addPhoto}
          </Text>
        </Pressable>
        {(photoError || upload.isError) && (
          <Text style={[styles.detail, { color: colors.danger }]} accessibilityRole="alert">
            {photoError ?? errorMessage(upload.error)}
          </Text>
        )}
      </View>

      <View style={panel}>
        <TextField label={t.account.name} value={name} onChangeText={setName} autoComplete="name" maxLength={255} />
        <TextField label={t.account.phone} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" maxLength={50} />
        {save.isError && (
          <Text style={[styles.detail, { color: colors.danger }]} accessibilityRole="alert">
            {errorMessage(save.error)}
          </Text>
        )}
        {save.isSuccess && !changed && <Text style={[styles.detail, { color: colors.ok }]}>{t.account.saved}</Text>}
        <Button label={t.account.save} onPress={() => save.mutate()} disabled={!name.trim() || !changed} loading={save.isPending} />
      </View>

      <View style={panel}>
        <ChoiceRow
          label={t.account.theme}
          options={[
            { value: 'light', label: t.account.light },
            { value: 'dark', label: t.account.dark },
            { value: 'system', label: t.account.auto },
          ]}
          value={preference}
          onChange={chooseTheme}
        />
        <LanguageSwitch persist />
      </View>
      <PushSettingsPanel />

      <View style={panel}>
        <Text style={[styles.detail, { color: colors.ink }]}>
          {t.account.onWebsite}
        </Text>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${DASHBOARD_URL}/forgot-password`)} hitSlop={8}>
          <Text style={[styles.link, { color: colors.ink }]}>{t.account.resetPassword}</Text>
        </Pressable>
      </View>

      <Button label={t.account.logOut} variant="quiet" onPress={logout} />
      <Text style={[styles.footnote, { color: colors.inkMuted }]}>{t.account.connectedTo(API_URL)}</Text>
      <TabBarSpacer />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  panel: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1, gap: spacing.sm },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identityText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.display, fontSize: type.headline, letterSpacing: -0.5 },
  detail: { fontFamily: fonts.body, fontSize: type.body },
  link: { fontFamily: fonts.bodyBold, fontSize: type.body, textDecorationLine: 'underline' },
  footnote: { fontFamily: fonts.body, fontSize: type.label, textAlign: 'center' },
});

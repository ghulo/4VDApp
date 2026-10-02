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
import { fonts, radius, spacing, type ThemePreference, useTheme, useThemeColors } from '../theme';
import { errorMessage } from '../utils/format';

const ROLE_DESCRIPTION = {
  admin: 'Admin. Manage everything from the admin dashboard.',
  employee: 'Employee. You can browse products and record sales.',
  family: 'Family. You can browse products and save favorites.',
} as const;

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export function AccountScreen() {
  const colors = useThemeColors();
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
      setPhotoError('That photo is too big. Use one under 5 MB.');
      return;
    }
    upload.mutate(blob);
  }

  function chooseTheme(next: ThemePreference) {
    setPreference(next);
    // Saved to the profile too, so it follows you to your other devices.
    meApi.updateProfile({ theme: next }).then(updateUser).catch(() => undefined);
  }

  const panel = [styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }];
  const changed = name.trim() !== user.name || phone.trim() !== (user.phone ?? '');

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={panel}>
        <View style={styles.identity}>
          <Pressable accessibilityRole="button" accessibilityLabel="Change your photo" onPress={pickPhoto} disabled={upload.isPending}>
            <Avatar name={user.name} url={user.avatarUrl} size={64} />
          </Pressable>
          <View style={styles.identityText}>
            <Text style={[styles.name, { color: colors.ink }]}>{user.name}</Text>
            <Text style={[styles.detail, { color: colors.inkMuted }]}>{user.email}</Text>
          </View>
        </View>
        <Text style={[styles.detail, { color: colors.ink }]}>{ROLE_DESCRIPTION[user.role]}</Text>
        <Pressable accessibilityRole="button" onPress={pickPhoto} disabled={upload.isPending} hitSlop={8}>
          <Text style={[styles.link, { color: colors.brand }]}>
            {upload.isPending ? 'Uploading…' : user.avatarUrl ? 'Change photo' : 'Add a photo'}
          </Text>
        </Pressable>
        {(photoError || upload.isError) && (
          <Text style={[styles.detail, { color: colors.danger }]} accessibilityRole="alert">
            {photoError ?? errorMessage(upload.error)}
          </Text>
        )}
      </View>

      <View style={panel}>
        <TextField label="Name" value={name} onChangeText={setName} autoComplete="name" maxLength={255} />
        <TextField label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" maxLength={50} />
        {save.isError && (
          <Text style={[styles.detail, { color: colors.danger }]} accessibilityRole="alert">
            {errorMessage(save.error)}
          </Text>
        )}
        {save.isSuccess && !changed && <Text style={[styles.detail, { color: colors.ok }]}>Saved.</Text>}
        <Button label="Save" onPress={() => save.mutate()} disabled={!name.trim() || !changed} loading={save.isPending} />
      </View>

      <View style={panel}>
        <ChoiceRow
          label="Theme"
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'Auto' },
          ]}
          value={preference}
          onChange={chooseTheme}
        />
      </View>
      <PushSettingsPanel />

      <View style={panel}>
        <Text style={[styles.detail, { color: colors.ink }]}>
          Change your password or email, or see where you're logged in, on your profile in the 4VD website.
        </Text>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${DASHBOARD_URL}/forgot-password`)} hitSlop={8}>
          <Text style={[styles.link, { color: colors.brand }]}>Reset my password</Text>
        </Pressable>
      </View>

      <Button label="Log out" variant="quiet" onPress={logout} />
      <Text style={[styles.footnote, { color: colors.inkMuted }]}>Connected to {API_URL}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  panel: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1, gap: spacing.sm },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identityText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.display, fontSize: 26, letterSpacing: -0.5 },
  detail: { fontFamily: fonts.body, fontSize: 15 },
  link: { fontFamily: fonts.bodyBold, fontSize: 15 },
  footnote: { fontFamily: fonts.body, fontSize: 13, textAlign: 'center' },
});

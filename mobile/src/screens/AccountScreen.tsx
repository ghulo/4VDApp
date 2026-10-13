import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { type ReactNode, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../components/Avatar';
import { Segmented } from '../components/inputs';
import { PushSettingsPanel } from '../components/PushSettingsPanel';
import { Button, ErrorState, Loading, TextField } from '../components/ui';
import { meApi } from '../services/api';
import { API_URL, DASHBOARD_URL } from '../services/apiClient';
import type { Session } from '../services/types';
import { useAuth, useCurrentUser } from '../state/useAuth';
import { fonts, radius, spacing, type ThemePreference, useTheme, useThemeColors, type } from '../theme';
import { errorMessage, formatDateWith } from '../utils/format';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { useT } from '../i18n/useT';
import { TabBarSpacer } from '../components/TabBarSpace';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
// The same rule the server and the dashboard use.
const MIN_PASSWORD_LENGTH = 8;

/**
 * Your account, in the same sections as the dashboard's Profile: you, look,
 * alerts, password, and where you're logged in.
 */
export function AccountScreen() {
  const t = useT();
  const { logout } = useAuth();
  const colors = useThemeColors();

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <YouSection />
      <Section title={t.account.look}>
        <LookControls />
      </Section>
      <PushSettingsPanel />
      <PasswordSection />
      <DevicesSection />
      <Button label={t.account.logOut} variant="quiet" onPress={logout} />
      <Text style={[styles.footnote, { color: colors.inkMuted }]}>{t.account.connectedTo(API_URL)}</Text>
      <TabBarSpacer />
    </ScrollView>
  );
}

/** A raised panel with its heading, like a dashboard card. */
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
      <Text style={[styles.sectionTitle, { color: colors.ink }]} accessibilityRole="header">
        {title}
      </Text>
      {hint && <Text style={[styles.detail, { color: colors.inkMuted }]}>{hint}</Text>}
      {children}
    </View>
  );
}

function YouSection() {
  const colors = useThemeColors();
  const t = useT();
  const user = useCurrentUser();
  const { updateUser } = useAuth();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [photoError, setPhotoError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => meApi.updateProfile({ name: name.trim(), phone: phone.trim() || null }),
    onSuccess: updateUser,
  });
  const upload = useMutation({ mutationFn: meApi.uploadAvatar, onSuccess: updateUser });
  const changed = name.trim() !== user.name || phone.trim() !== (user.phone ?? '');

  async function pickPhoto() {
    setPhotoError(null);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    const blob = await (await fetch(asset.uri)).blob();
    if (blob.size > MAX_PHOTO_BYTES) {
      setPhotoError(t.account.photoTooBig);
      return;
    }
    upload.mutate(blob);
  }

  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
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
      <Pressable accessibilityRole="button" onPress={pickPhoto} disabled={upload.isPending} hitSlop={8} style={styles.linkRow}>
        <Text style={[styles.link, { color: colors.ink }]}>
          {upload.isPending ? t.account.uploading : user.avatarUrl ? t.account.changePhoto : t.account.addPhoto}
        </Text>
      </Pressable>
      {(photoError || upload.isError) && (
        <Text style={[styles.detail, { color: colors.danger }]} accessibilityRole="alert">
          {photoError ?? errorMessage(upload.error)}
        </Text>
      )}
      <View style={[styles.divider, { backgroundColor: colors.line }]} />
      <TextField label={t.account.name} value={name} onChangeText={setName} autoComplete="name" maxLength={255} />
      <TextField label={t.account.phone} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" maxLength={50} />
      {save.isError && (
        <Text style={[styles.detail, { color: colors.danger }]} accessibilityRole="alert">
          {errorMessage(save.error)}
        </Text>
      )}
      {save.isSuccess && !changed && <Text style={[styles.detail, { color: colors.ok }]}>{t.account.saved}</Text>}
      {/* Only offered once something changed, so a dead Save never sits on the screen. */}
      {changed && <Button label={t.account.save} onPress={() => save.mutate()} disabled={!name.trim()} loading={save.isPending} />}
    </View>
  );
}

function LookControls() {
  const t = useT();
  const { preference, setPreference } = useTheme();
  const { updateUser } = useAuth();

  function chooseTheme(next: ThemePreference) {
    setPreference(next);
    // Saved to the profile too, so it follows you to your other devices.
    meApi.updateProfile({ theme: next }).then(updateUser).catch(() => undefined);
  }

  return (
    <View style={styles.look}>
      <Segmented
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
  );
}

function PasswordSection() {
  const colors = useThemeColors();
  const t = useT();
  const queryClient = useQueryClient();
  const security = useQuery({ queryKey: ['me', 'security'], queryFn: meApi.security });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const change = useMutation({
    mutationFn: () => meApi.changePassword({ currentPassword: security.data?.hasPassword ? currentPassword : undefined, newPassword }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const hasPassword = security.data?.hasPassword ?? true;
  const tooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH;

  return (
    <Section title={hasPassword ? t.account.password : t.account.setPasswordTitle} hint={t.account.passwordHint(MIN_PASSWORD_LENGTH)}>
      {security.isPending && <Loading />}
      {security.isError && <ErrorState error={security.error} onRetry={() => security.refetch()} />}
      {security.data && (
        <>
          {hasPassword && (
            <TextField
              label={t.account.currentPassword}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
            />
          )}
          <TextField
            label={t.account.newPassword}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            error={tooShort ? t.account.passwordHint(MIN_PASSWORD_LENGTH) : undefined}
          />
          {change.isError && (
            <Text style={[styles.detail, { color: colors.danger }]} accessibilityRole="alert">
              {errorMessage(change.error)}
            </Text>
          )}
          {change.isSuccess && (
            <Text style={[styles.detail, { color: colors.ok }]} accessibilityLiveRegion="polite">
              {t.account.passwordChanged}
            </Text>
          )}
          <Button
            label={hasPassword ? t.account.changePassword : t.account.setPassword}
            variant="quiet"
            onPress={() => change.mutate()}
            disabled={newPassword.length < MIN_PASSWORD_LENGTH || (hasPassword && currentPassword === '')}
            loading={change.isPending}
          />
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${DASHBOARD_URL}/forgot-password`)} hitSlop={8} style={styles.linkRow}>
            <Text style={[styles.link, { color: colors.ink }]}>{t.account.forgotPassword}</Text>
          </Pressable>
        </>
      )}
    </Section>
  );
}

/** How many kinds of device show before "Show all". */
const GROUPS_SHOWN = 5;

interface DeviceGroup {
  device: string;
  current: boolean;
  sessions: Session[];
  lastUsedAt: string | null;
}

/** Logins from the same kind of device as one row, this device first, as on the dashboard. */
function groupDevices(sessions: Session[]): DeviceGroup[] {
  const groups = new Map<string, DeviceGroup>();
  for (const session of sessions) {
    const key = session.current ? `current:${session.device}` : session.device;
    const group = groups.get(key) ?? { device: session.device, sessions: [], current: session.current, lastUsedAt: null };
    group.sessions.push(session);
    const used = session.lastUsedAt ?? session.startedAt;
    if (used > (group.lastUsedAt ?? '')) group.lastUsedAt = used;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Number(b.current) - Number(a.current) || (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''));
}

function DevicesSection() {
  const colors = useThemeColors();
  const t = useT();
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const sessions = useQuery({ queryKey: ['me', 'sessions'], queryFn: meApi.sessions });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me', 'sessions'] });
  // One row can stand for several logins from the same kind of device: log them all out.
  const end = useMutation({
    mutationFn: (group: DeviceGroup) => Promise.all(group.sessions.map((session) => meApi.endSession(session.id))),
    onSettled: refresh,
  });
  const endOthers = useMutation({ mutationFn: meApi.endOtherSessions, onSuccess: refresh });
  const groups = groupDevices(sessions.data ?? []);
  const shown = showAll ? groups : groups.slice(0, GROUPS_SHOWN);
  const otherGroups = groups.filter((group) => !group.current).length;
  const deviceName = (group: DeviceGroup) => (group.device === 'Unknown device' ? t.account.unknownDevice : group.device);

  return (
    <Section title={t.account.devices} hint={t.account.devicesHint}>
      {sessions.isPending && <Loading />}
      {sessions.isError && <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />}
      {shown.map((group, index) => (
        <View
          key={`${group.current}-${group.device}`}
          style={[styles.device, index > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}
        >
          <View style={styles.identityText}>
            <Text style={[styles.deviceName, { color: colors.ink }]}>{deviceName(group)}</Text>
            <Text style={[styles.small, { color: group.current ? colors.ok : colors.inkMuted }]}>
              {group.sessions.length > 1 ? `${t.account.logins(group.sessions.length)} · ` : ''}
              {group.current
                ? t.account.thisDevice
                : t.account.lastUsed(formatDateWith(new Date(group.lastUsedAt!), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}
            </Text>
          </View>
          {!group.current && (
            <Button
              variant="quiet"
              size="small"
              label={t.account.logOut}
              accessibilityLabel={t.account.logOutDevice(deviceName(group))}
              loading={end.isPending && end.variables === group}
              disabled={end.isPending}
              onPress={() => end.mutate(group)}
            />
          )}
        </View>
      ))}
      {groups.length > GROUPS_SHOWN && (
        <Pressable aria-expanded={showAll} accessibilityRole="button" onPress={() => setShowAll(!showAll)} hitSlop={8} style={styles.linkRow}>
          <Text style={[styles.link, { color: colors.ink }]}>{showAll ? t.account.showFewerDevices : t.account.showAllDevices(groups.length)}</Text>
        </Pressable>
      )}
      {(end.isError || endOthers.isError) && (
        <Text style={[styles.detail, { color: colors.danger }]} accessibilityRole="alert">
          {errorMessage(end.error ?? endOthers.error)}
        </Text>
      )}
      {otherGroups > 1 && <Button label={t.account.logOutElsewhere} variant="quiet" onPress={() => endOthers.mutate()} loading={endOthers.isPending} />}
    </Section>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  panel: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1, gap: spacing.sm },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: type.title },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identityText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodyBold, fontSize: type.title },
  detail: { fontFamily: fonts.body, fontSize: type.body },
  small: { fontFamily: fonts.body, fontSize: type.label },
  linkRow: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  link: { fontFamily: fonts.bodyBold, fontSize: type.body, textDecorationLine: 'underline' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.sm },
  look: { gap: spacing.lg },
  device: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingVertical: spacing.sm },
  deviceName: { fontFamily: fonts.bodyMedium, fontSize: type.body },
  footnote: { fontFamily: fonts.body, fontSize: type.label, textAlign: 'center' },
});

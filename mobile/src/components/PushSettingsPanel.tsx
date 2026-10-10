import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { currentPushToken, disablePush, enablePush, pushUnavailableReason } from '../push/devicePush';
import { pushApi } from '../services/api';
import type { PushSettings, PushTopic } from '../services/types';
import { fonts, radius, spacing, useThemeColors, type } from '../theme';
import { errorMessage } from '../utils/format';
import { Button } from './ui';
import { useT } from '../i18n/useT';

const SETTINGS_KEY = ['push-settings'];

/** Alerts on this phone, and which kinds this person wants. Hidden for people who get none. */
export function PushSettingsPanel() {
  const colors = useThemeColors();
  const t = useT();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: pushApi.settings });
  const token = useQuery({ queryKey: [...SETTINGS_KEY, 'this-device'], queryFn: currentPushToken });

  const toggleDevice = useMutation({
    mutationFn: (on: boolean) => (on ? enablePush(settings.data?.webPushPublicKey ?? null) : disablePush()),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });
  const sendTest = useMutation({ mutationFn: pushApi.sendTest });
  const saveTopic = useMutation({
    mutationFn: (change: { topic: PushTopic; enabled: boolean }) => pushApi.updatePreferences({ [change.topic]: change.enabled }),
    onSuccess: (updated: PushSettings) => queryClient.setQueryData(SETTINGS_KEY, updated),
  });

  if (!settings.data || settings.data.topics.length === 0) return null;
  const unavailable = pushUnavailableReason(settings.data.webPushPublicKey);
  const isOn = Boolean(token.data);

  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
      <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
        {t.push.title}
      </Text>
      {unavailable ? (
        <Text style={[styles.detail, { color: colors.steel }]}>{unavailable}</Text>
      ) : (
        <>
          <Text style={[styles.detail, { color: colors.ink }]}>
            {isOn ? t.push.on : t.push.off}
          </Text>
          <Button
            label={isOn ? t.push.turnOff : t.push.turnOn}
            variant={isOn ? 'quiet' : 'primary'}
            loading={toggleDevice.isPending}
            onPress={() => toggleDevice.mutate(!isOn)}
          />
        </>
      )}
      {toggleDevice.isError && (
        <Text style={[styles.detail, { color: colors.signalOut }]} accessibilityRole="alert">
          {errorMessage(toggleDevice.error)}
        </Text>
      )}
      {isOn && (
        <Button label={sendTest.isSuccess ? t.push.testSent : t.push.sendTest} variant="quiet" loading={sendTest.isPending} onPress={() => sendTest.mutate()} />
      )}
      {settings.data.topics.map(({ topic, enabled }) => (
        <View key={topic} style={[styles.topic, { borderTopColor: colors.line }]}>
          <Text style={[styles.topicLabel, { color: colors.ink }]}>{t.push.topics[topic]}</Text>
          <Switch
            accessibilityLabel={t.push.topics[topic]}
            value={enabled}
            disabled={saveTopic.isPending}
            onValueChange={(value) => saveTopic.mutate({ topic, enabled: value })}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1, gap: spacing.sm },
  title: { fontFamily: fonts.bodyBold, fontSize: type.title },
  detail: { fontFamily: fonts.body, fontSize: type.body },
  topic: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  topicLabel: { flex: 1, fontFamily: fonts.body, fontSize: type.body },
});

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currentSubscription, disablePush, enablePush, isPushSupported } from '../push/browserPush';
import { pushApi } from '../services/api';
import type { PushSettings, PushTopic } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ErrorNotice, Loading } from './Feedback';
import { Button, Card, SettingRow } from './ui';
import { useT } from '../i18n/useT';

const SETTINGS_KEY = ['push-settings'];

/** Alerts on this computer, and which kinds this person wants anywhere. */
export function PushSettingsPanel() {
  const queryClient = useQueryClient();
  const t = useT();
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: pushApi.settings });
  const thisBrowser = useQuery({ queryKey: [...SETTINGS_KEY, 'this-browser'], queryFn: currentSubscription });

  const refresh = () => queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
  const toggleBrowser = useMutation({
    mutationFn: (on: boolean) => (on ? enablePush(settings.data!.webPushPublicKey!) : disablePush()),
    onSettled: refresh,
  });
  const sendTest = useMutation({ mutationFn: pushApi.sendTest });
  const saveTopic = useMutation({
    mutationFn: (change: { topic: PushTopic; enabled: boolean }) => pushApi.updatePreferences({ [change.topic]: change.enabled }),
    onSuccess: (updated: PushSettings) => queryClient.setQueryData(SETTINGS_KEY, updated),
  });

  return (
    <Card title={t.push.title} description={t.push.description}>
      {settings.isPending && <Loading />}
      {settings.isError && <ErrorNotice error={settings.error} onRetry={() => settings.refetch()} />}
      {settings.data && (
        <>
          <SettingRow
            title={t.push.thisComputer}
            description={
              toggleBrowser.isError ? (
                <span className="form-error" role="alert">
                  {errorMessage(toggleBrowser.error)}
                </span>
              ) : (
                <BrowserStatus settings={settings.data} isOn={Boolean(thisBrowser.data)} />
              )
            }
          >
            {isPushSupported() && settings.data.webPushPublicKey && (
              <Button
                variant={thisBrowser.data ? 'secondary' : 'primary'}
                disabled={toggleBrowser.isPending || thisBrowser.isPending}
                onClick={() => toggleBrowser.mutate(!thisBrowser.data)}
              >
                {toggleBrowser.isPending ? t.push.working : thisBrowser.data ? t.push.turnOff : t.push.turnOn}
              </Button>
            )}
          </SettingRow>

          {settings.data.deviceCount > 0 && (
            <SettingRow
              title={t.push.test}
              description={
                sendTest.isSuccess ? (
                  t.push.testSent
                ) : sendTest.isError ? (
                  <span className="form-error">{errorMessage(sendTest.error)}</span>
                ) : (
                  t.push.testHint
                )
              }
            >
              <Button disabled={sendTest.isPending} onClick={() => sendTest.mutate()}>
                {t.push.sendTest}
              </Button>
            </SettingRow>
          )}

          {settings.data.topics.map(({ topic, enabled }) => (
            <SettingRow key={topic} title={t.push.topics[topic].label} description={t.push.topics[topic].hint}>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                aria-label={t.push.alertsFor(t.push.topics[topic].label)}
                checked={enabled}
                disabled={saveTopic.isPending}
                onChange={(event) => saveTopic.mutate({ topic, enabled: event.target.checked })}
              />
            </SettingRow>
          ))}
          {saveTopic.isError && (
            <p className="form-error" role="alert">
              {errorMessage(saveTopic.error)}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function BrowserStatus({ settings, isOn }: { settings: PushSettings; isOn: boolean }) {
  const t = useT();
  const devices = t.push.devices(settings.deviceCount);
  let text: string;
  if (!isPushSupported()) text = t.push.unsupported;
  else if (!settings.webPushPublicKey) text = t.push.noKeys;
  else if (isOn) text = t.push.on;
  else text = t.push.off;
  return (
    <>
      {text} {devices}
    </>
  );
}

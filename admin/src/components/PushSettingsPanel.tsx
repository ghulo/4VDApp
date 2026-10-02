import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currentSubscription, disablePush, enablePush, isPushSupported } from '../push/browserPush';
import { pushApi } from '../services/api';
import type { PushSettings, PushTopic } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ErrorNotice, Loading } from './Feedback';
import { Button, Card, SettingRow } from './ui';

const TOPIC_TEXT: Record<PushTopic, { label: string; hint: string }> = {
  stock: { label: 'Stock running low or out', hint: 'When a sale or loss takes a product to its reorder level or to zero.' },
  approvals: { label: 'Requests waiting for you', hint: 'Returns, damage reports and count differences from employees.' },
  decisions: { label: 'Decisions on my requests', hint: 'When the owner approves or rejects something you sent.' },
  summary: { label: 'Daily summary', hint: "Each evening: the day's sales and anything that needs your attention." },
};

const SETTINGS_KEY = ['push-settings'];

/** Alerts on this computer, and which kinds this person wants anywhere. */
export function PushSettingsPanel() {
  const queryClient = useQueryClient();
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
    <Card title="Alerts" description="Alerts reach this computer and the 4VD app on your phone, even when they're closed.">
      {settings.isPending && <Loading />}
      {settings.isError && <ErrorNotice error={settings.error} onRetry={() => settings.refetch()} />}
      {settings.data && (
        <>
          <SettingRow
            title="This computer"
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
                {toggleBrowser.isPending ? 'Working…' : thisBrowser.data ? 'Turn off' : 'Turn on'}
              </Button>
            )}
          </SettingRow>

          {settings.data.deviceCount > 0 && (
            <SettingRow
              title="Test"
              description={
                sendTest.isSuccess ? (
                  'Sent to all your devices. It arrives within a few seconds.'
                ) : sendTest.isError ? (
                  <span className="form-error">{errorMessage(sendTest.error)}</span>
                ) : (
                  'Check that alerts reach your devices.'
                )
              }
            >
              <Button disabled={sendTest.isPending} onClick={() => sendTest.mutate()}>
                Send a test alert
              </Button>
            </SettingRow>
          )}

          {settings.data.topics.map(({ topic, enabled }) => (
            <SettingRow key={topic} title={TOPIC_TEXT[topic].label} description={TOPIC_TEXT[topic].hint}>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                aria-label={`Alerts for ${TOPIC_TEXT[topic].label.toLowerCase()}`}
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
  const devices = `${settings.deviceCount} ${settings.deviceCount === 1 ? 'device gets' : 'devices get'} your alerts.`;
  let text: string;
  if (!isPushSupported()) text = "This browser can't show alerts when the dashboard is closed.";
  else if (!settings.webPushPublicKey) text = 'Computer alerts are switched off on the server (no Web Push keys set).';
  else if (isOn) text = 'On for this computer, even when the dashboard is closed.';
  else text = 'Off for this computer.';
  return (
    <>
      {text} {devices}
    </>
  );
}

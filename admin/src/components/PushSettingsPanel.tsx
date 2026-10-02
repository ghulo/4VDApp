import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currentSubscription, disablePush, enablePush, isPushSupported } from '../push/browserPush';
import { pushApi } from '../services/api';
import type { PushSettings, PushTopic } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ErrorNotice, Loading } from './Feedback';

const TOPIC_TEXT: Record<PushTopic, { label: string; hint: string }> = {
  stock: { label: 'Stock running low or out', hint: 'When a sale or loss takes a product to its reorder level or to zero.' },
  approvals: { label: 'Requests waiting for you', hint: 'Returns, damage reports and count differences from employees.' },
  decisions: { label: 'Decisions on my requests', hint: 'When the owner approves or rejects something you sent.' },
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
  const saveTopic = useMutation({
    mutationFn: (change: { topic: PushTopic; enabled: boolean }) => pushApi.updatePreferences({ [change.topic]: change.enabled }),
    onSuccess: (updated: PushSettings) => queryClient.setQueryData(SETTINGS_KEY, updated),
  });

  return (
    <section className="panel" aria-labelledby="push-heading">
      <h2 id="push-heading" className="panel__title">
        Alerts
      </h2>
      {settings.isPending && <Loading />}
      {settings.isError && <ErrorNotice error={settings.error} onRetry={() => settings.refetch()} />}
      {settings.data && (
        <div className="settings-form">
          <div className="push-device">
            <BrowserStatus settings={settings.data} isOn={Boolean(thisBrowser.data)} />
            {isPushSupported() && settings.data.webPushPublicKey && (
              <button
                type="button"
                className={thisBrowser.data ? 'button button--quiet' : 'button button--primary'}
                disabled={toggleBrowser.isPending || thisBrowser.isPending}
                onClick={() => toggleBrowser.mutate(!thisBrowser.data)}
              >
                {toggleBrowser.isPending ? 'Working…' : thisBrowser.data ? 'Turn off on this computer' : 'Turn on for this computer'}
              </button>
            )}
          </div>
          {toggleBrowser.isError && (
            <p className="form-error" role="alert">
              {errorMessage(toggleBrowser.error)}
            </p>
          )}

          <fieldset className="push-topics">
            <legend className="field__label">Send me alerts for</legend>
            {settings.data.topics.map(({ topic, enabled }) => (
              <label key={topic} className="push-topic">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={saveTopic.isPending}
                  onChange={(event) => saveTopic.mutate({ topic, enabled: event.target.checked })}
                />
                <span>
                  <span className="push-topic__label">{TOPIC_TEXT[topic].label}</span>
                  <span className="field-hint">{TOPIC_TEXT[topic].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {saveTopic.isError && (
            <p className="form-error" role="alert">
              {errorMessage(saveTopic.error)}
            </p>
          )}
        </div>
      )}
    </section>
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
    <p className="push-device__status">
      {text} <span className="field-hint">{devices}</span>
    </p>
  );
}

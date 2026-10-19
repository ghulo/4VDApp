import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useT } from '../i18n/useT';
import { counterApi } from '../services/api';
import type { CounterSettings } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ErrorNotice, Loading } from './Feedback';
import { Button, Card, SettingRow } from './ui';

const RATES = ['18', '8', '16', '0'] as const;

/** Settings, Counter: the receipt's last line, the fiscal printer and its tax groups, and the drawer key. */
export function CounterSettingsPanel() {
  const settings = useQuery({ queryKey: ['counter', 'settings'], queryFn: counterApi.settings });
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorNotice error={settings.error} onRetry={() => settings.refetch()} />;
  return <CounterSettingsForm initial={settings.data} />;
}

function CounterSettingsForm({ initial }: { initial: CounterSettings }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => counterApi.updateSettings(draft),
    onSuccess: (updated) => {
      queryClient.setQueryData(['counter', 'settings'], updated);
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
      setSaved(true);
    },
  });
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(initial);
  const change = (next: CounterSettings) => {
    setDraft(next);
    setSaved(false);
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit}>
      <Card
        title={t.counterSettings.title}
        description={t.counterSettings.description}
        footer={
          <>
            {save.isError && (
              <span className="form-error" role="alert">
                {errorMessage(save.error)}
              </span>
            )}
            {saved && !save.isError && (
              <span className="form-success" role="status">
                {t.counterSettings.saved}
              </span>
            )}
            <Button type="submit" variant={hasChanges ? 'primary' : 'secondary'} disabled={!hasChanges || save.isPending} loading={save.isPending}>
              {t.settings.saveChanges}
            </Button>
          </>
        }
      >
        <SettingRow title={t.counterSettings.printer} description={t.counterSettings.printerHint}>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            aria-label={t.counterSettings.printer}
            checked={draft.printer.enabled}
            onChange={(event) => change({ ...draft, printer: { ...draft.printer, enabled: event.target.checked } })}
          />
        </SettingRow>
        <SettingRow title={t.counterSettings.footer} description={t.counterSettings.footerHint}>
          <input
            aria-label={t.counterSettings.footer}
            maxLength={80}
            value={draft.receiptFooter}
            onChange={(event) => change({ ...draft, receiptFooter: event.target.value })}
          />
        </SettingRow>
        <SettingRow title={t.counterSettings.taxGroups} description={t.counterSettings.taxGroupsHint}>
          <div className="counter-groups">
            {RATES.map((rate) => (
              <label key={rate} className="counter-groups__row">
                <span>{t.counterSettings.vatRate(Number(rate))}</span>
                <select
                  value={draft.printer.taxGroups[rate] ?? ''}
                  onChange={(event) =>
                    change({
                      ...draft,
                      printer: { ...draft.printer, taxGroups: { ...draft.printer.taxGroups, [rate]: event.target.value === '' ? null : Number(event.target.value) } },
                    })
                  }
                >
                  <option value="">{t.counterSettings.notSet}</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((group) => (
                    <option key={group} value={group}>
                      {t.counterSettings.group(group)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </SettingRow>
        <SettingRow title={t.counterSettings.drawer} description={t.counterSettings.drawerHint}>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            aria-label={t.counterSettings.drawer}
            checked={draft.drawerConnected}
            onChange={(event) => change({ ...draft, drawerConnected: event.target.checked })}
          />
        </SettingRow>
        <SettingRow title={t.counterSettings.sounds} description={t.counterSettings.soundsHint}>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            aria-label={t.counterSettings.sounds}
            checked={draft.scanSounds}
            onChange={(event) => change({ ...draft, scanSounds: event.target.checked })}
          />
        </SettingRow>
      </Card>
    </form>
  );
}

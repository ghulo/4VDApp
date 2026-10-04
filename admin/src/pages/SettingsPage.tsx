import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { BusinessPanel } from '../components/BusinessPanel';
import { LaunchChecklist } from '../components/LaunchChecklist';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Button, Card, PageHeader, SettingRow } from '../components/ui';
import { settingsApi } from '../services/api';
import type { AppSettings } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ManagersOnly } from '../components/ManagersOnly';
import { useT } from '../i18n/useT';

export function SettingsPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  return (
    <>
      <PageHeader
        title={t.settings.title}
        description={t.settings.description}
      />
      {role === 'developer' && <LaunchChecklist />}
      <ManagersOnly note={t.settings.managersOnly}>
        <BusinessPanel />
        {settings.isPending && <Loading />}
        {settings.isError && <ErrorNotice error={settings.error} onRetry={() => settings.refetch()} />}
        {settings.data && <SettingsForm initial={settings.data} />}
      </ManagersOnly>
    </>
  );
}

function SettingsForm({ initial }: { initial: AppSettings }) {
  const queryClient = useQueryClient();
  const t = useT();
  const [limit, setLimit] = useState(String(initial.refundApprovalLimit));
  const [windowDays, setWindowDays] = useState(String(initial.returnWindowDays));
  const [minimumMargin, setMinimumMargin] = useState(String(initial.minimumMarginPercent));
  const [summaryHour, setSummaryHour] = useState(initial.dailySummaryHour);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      settingsApi.update({
        refundApprovalLimit: Number(limit),
        returnWindowDays: Number(windowDays),
        minimumMarginPercent: Number(minimumMargin),
        dailySummaryHour: summaryHour,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings'], updated);
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setSaved(true);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    save.mutate();
  }

  const isValid =
    limit !== '' &&
    Number(limit) >= 0 &&
    windowDays !== '' &&
    Number.isInteger(Number(windowDays)) &&
    Number(windowDays) >= 0 &&
    minimumMargin !== '' &&
    Number(minimumMargin) >= 0;
  // Save only turns orange once there's something to save, so one card at a time asks for action.
  const hasChanges =
    Number(limit) !== initial.refundApprovalLimit ||
    Number(windowDays) !== initial.returnWindowDays ||
    Number(minimumMargin) !== initial.minimumMarginPercent ||
    summaryHour !== initial.dailySummaryHour;

  return (
    <form onSubmit={handleSubmit}>
      <Card
        title={t.settings.approvals}
        description={t.settings.approvalsHint}
        footer={
          <>
            {save.isError && (
              <span className="form-error" role="alert">
                {errorMessage(save.error)}
              </span>
            )}
            {saved && !save.isError && (
              <span className="form-success" role="status">
                {t.settings.saved}
              </span>
            )}
            <Button type="submit" variant={hasChanges ? 'primary' : 'secondary'} disabled={!isValid || save.isPending}>
              {save.isPending ? t.settings.saving : t.settings.saveChanges}
            </Button>
          </>
        }
      >
        <SettingRow
          title={t.settings.refundLimit}
          description={t.settings.refundLimitHint}
        >
          <span className="unit-input">
            <span aria-hidden="true">€</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              aria-label={t.settings.refundLimitLabel}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </span>
        </SettingRow>
        <SettingRow
          title={t.settings.window}
          description={t.settings.windowHint}
        >
          <span className="unit-input">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              aria-label={t.settings.windowLabel}
              value={windowDays}
              onChange={(event) => setWindowDays(event.target.value)}
            />
            <span aria-hidden="true">{t.settings.days}</span>
          </span>
        </SettingRow>
        <SettingRow
          title={t.settings.margin}
          description={t.settings.marginHint}
        >
          <span className="unit-input">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              aria-label={t.settings.marginLabel}
              value={minimumMargin}
              onChange={(event) => setMinimumMargin(event.target.value)}
            />
            <span aria-hidden="true">%</span>
          </span>
        </SettingRow>
        <SettingRow
          title={t.settings.summary}
          description={t.settings.summaryHint}
        >
          <select
            aria-label={t.settings.summaryLabel}
            className="setting-select"
            value={summaryHour}
            onChange={(event) => setSummaryHour(Number(event.target.value))}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </SettingRow>
      </Card>
    </form>
  );
}

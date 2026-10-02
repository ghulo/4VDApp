import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { BusinessPanel } from '../components/BusinessPanel';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Button, Card, PageHeader, SettingRow } from '../components/ui';
import { settingsApi } from '../services/api';
import type { AppSettings } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ManagersOnly } from '../components/ManagersOnly';

export function SettingsPage() {
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your shop's details, when a return has to wait for you, and how low a promotion may take a price."
      />
      <ManagersOnly note="Only the developer or an admin can change the shop's settings.">
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

  return (
    <form onSubmit={handleSubmit}>
      <Card
        title="Approvals and prices"
        description="Damaged stock, write-offs and count differences always wait for you. Your own returns go straight through."
        footer={
          <>
            {save.isError && (
              <span className="form-error" role="alert">
                {errorMessage(save.error)}
              </span>
            )}
            {saved && !save.isError && (
              <span className="form-success" role="status">
                Saved.
              </span>
            )}
            <Button type="submit" variant="primary" disabled={!isValid || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        <SettingRow
          title="Refunds that need your approval"
          description="Refunds above this amount wait for you. Smaller ones go through straight away, so the customer isn't kept waiting."
        >
          <span className="unit-input">
            <span aria-hidden="true">€</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              aria-label="Refunds above this need your approval, in euros"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </span>
        </SettingRow>
        <SettingRow
          title="Returns of older sales"
          description="Returns of sales older than this many days wait for you."
        >
          <span className="unit-input">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              aria-label="Days after a sale before its return needs your approval"
              value={windowDays}
              onChange={(event) => setWindowDays(event.target.value)}
            />
            <span aria-hidden="true">days</span>
          </span>
        </SettingRow>
        <SettingRow
          title="Minimum margin on promotions"
          description="A promotion can't take a price below cost plus this much. 0 means never below cost; 10 means cost + 10%."
        >
          <span className="unit-input">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              aria-label="Minimum margin on promotions, in percent"
              value={minimumMargin}
              onChange={(event) => setMinimumMargin(event.target.value)}
            />
            <span aria-hidden="true">%</span>
          </span>
        </SettingRow>
        <SettingRow
          title="Daily summary"
          description="Shop time. The day's sales and anything that needs you, sent as an alert. Turn it off under Alerts on your Profile page."
        >
          <select
            aria-label="Send my daily summary at"
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

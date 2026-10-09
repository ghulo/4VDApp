import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { useT } from '../i18n/useT';
import { fullReportsApi } from '../services/api';
import { REPORT_SECTIONS, type ReportKind, type ReportSettings } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ErrorNotice, Loading } from './Feedback';
import { Button, Card, SettingRow } from './ui';

const KEY = ['report-settings'];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** This person's own daily and weekly report: when, what's in it, by email or not, and a test send. */
export function ReportSettingsPanel() {
  const settings = useQuery({ queryKey: KEY, queryFn: fullReportsApi.settings });
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorNotice error={settings.error} onRetry={() => settings.refetch()} />;
  return <ReportSettingsForm initial={settings.data} key={JSON.stringify(settings.data)} />;
}

function ReportSettingsForm({ initial }: { initial: ReportSettings }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const save = useMutation({
    mutationFn: () => fullReportsApi.saveSettings(draft),
    onSuccess: (saved) => queryClient.setQueryData(KEY, saved),
  });
  const test = useMutation({
    mutationFn: (kind: ReportKind) => fullReportsApi.sendTest(kind),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  const hourSelect = (label: string, value: number, onChange: (hour: number) => void, disabled: boolean) => (
    <select className="setting-select" aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}>
      {HOURS.map((hour) => (
        <option key={hour} value={hour}>
          {String(hour).padStart(2, '0')}:00
        </option>
      ))}
    </select>
  );

  return (
    <form onSubmit={handleSubmit}>
      <Card
        title={t.reportSettings.title}
        description={
          <>
            {t.reportSettings.description} <Link to="/report">{t.reportSettings.open}</Link>
          </>
        }
        footer={
          <>
            {save.isError && (
              <span className="form-error" role="alert">
                {errorMessage(save.error)}
              </span>
            )}
            {save.isSuccess && !changed && (
              <span className="form-success" role="status">
                {t.reportSettings.saved}
              </span>
            )}
            <Button type="submit" variant={changed ? 'primary' : 'secondary'} disabled={!changed || draft.sections.length === 0 || save.isPending}>
              {save.isPending ? t.reportSettings.saving : t.common.save}
            </Button>
          </>
        }
      >
        <SettingRow title={t.reportSettings.daily} description={t.reportSettings.dailyHint}>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            aria-label={t.reportSettings.daily}
            checked={draft.daily.enabled}
            onChange={(event) => setDraft({ ...draft, daily: { ...draft.daily, enabled: event.target.checked } })}
          />
          {hourSelect(t.reportSettings.dailyAt, draft.daily.hour, (hour) => setDraft({ ...draft, daily: { ...draft.daily, hour } }), !draft.daily.enabled)}
        </SettingRow>
        <SettingRow title={t.reportSettings.weekly} description={t.reportSettings.weeklyHint}>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            aria-label={t.reportSettings.weekly}
            checked={draft.weekly.enabled}
            onChange={(event) => setDraft({ ...draft, weekly: { ...draft.weekly, enabled: event.target.checked } })}
          />
          <select
            className="setting-select"
            aria-label={t.reportSettings.weeklyDay}
            value={draft.weekly.day}
            disabled={!draft.weekly.enabled}
            onChange={(event) => setDraft({ ...draft, weekly: { ...draft.weekly, day: Number(event.target.value) } })}
          >
            {t.reportSettings.weekdays.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
          {hourSelect(t.reportSettings.weeklyAt, draft.weekly.hour, (hour) => setDraft({ ...draft, weekly: { ...draft.weekly, hour } }), !draft.weekly.enabled)}
        </SettingRow>
        <SettingRow title={t.reportSettings.email} description={t.reportSettings.emailHint}>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            aria-label={t.reportSettings.email}
            checked={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.checked })}
          />
        </SettingRow>
        <fieldset className="setting-row report-sections">
          <legend className="setting-row__title">{t.reportSettings.sections}</legend>
          <p className="setting-row__description">
            {draft.sections.length === 0 ? <span className="form-error">{t.reportSettings.pickOne}</span> : t.reportSettings.sectionsHint}
          </p>
          <div className="report-sections__grid">
            {REPORT_SECTIONS.map((section) => (
              <label key={section} className="toggle">
                <input
                  type="checkbox"
                  checked={draft.sections.includes(section)}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      sections: event.target.checked
                        ? REPORT_SECTIONS.filter((name) => name === section || draft.sections.includes(name))
                        : draft.sections.filter((name) => name !== section),
                    })
                  }
                />
                {t.report.sections[section]}
              </label>
            ))}
          </div>
        </fieldset>
        <SettingRow
          title={t.reportSettings.test}
          description={
            test.isSuccess ? (
              <span role="status">{t.reportSettings.testSent}</span>
            ) : test.isError ? (
              <span className="form-error" role="alert">
                {errorMessage(test.error)}
              </span>
            ) : (
              t.reportSettings.testHint
            )
          }
        >
          <Button disabled={test.isPending} onClick={() => test.mutate('daily')}>
            {t.reportSettings.sendDaily}
          </Button>
          <Button disabled={test.isPending} onClick={() => test.mutate('weekly')}>
            {t.reportSettings.sendWeekly}
          </Button>
        </SettingRow>
      </Card>
    </form>
  );
}

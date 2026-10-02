import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ErrorNotice, Loading } from '../components/Feedback';
import { settingsApi } from '../services/api';
import type { AppSettings } from '../services/types';
import { errorMessage } from '../utils/errors';

export function SettingsPage() {
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-intro">
          When an employee's return has to wait for you, and how low a promotion may take a price.
        </p>
      </header>
      <section className="panel">
        {settings.isPending && <Loading />}
        {settings.isError && <ErrorNotice error={settings.error} onRetry={() => settings.refetch()} />}
        {settings.data && <SettingsForm initial={settings.data} />}
      </section>
    </>
  );
}

function SettingsForm({ initial }: { initial: AppSettings }) {
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(String(initial.refundApprovalLimit));
  const [windowDays, setWindowDays] = useState(String(initial.returnWindowDays));
  const [minimumMargin, setMinimumMargin] = useState(String(initial.minimumMarginPercent));
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      settingsApi.update({
        refundApprovalLimit: Number(limit),
        returnWindowDays: Number(windowDays),
        minimumMarginPercent: Number(minimumMargin),
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
    <form className="settings-form" onSubmit={handleSubmit}>
      <label className="field field--narrow">
        <span className="field__label">Refunds above this need your approval (€)</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={1}
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
        />
        <span className="field-hint">
          Smaller refunds go through straight away, so the customer isn't kept waiting.
        </span>
      </label>
      <label className="field field--narrow">
        <span className="field__label">Returns of sales older than this many days need your approval</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={windowDays}
          onChange={(event) => setWindowDays(event.target.value)}
        />
      </label>
      <p className="field-hint">
        Damaged stock, write-offs and count differences always wait for you. Your own returns go straight through.
      </p>
      <label className="field field--narrow">
        <span className="field__label">Minimum margin on promotions (%)</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={1}
          value={minimumMargin}
          onChange={(event) => setMinimumMargin(event.target.value)}
        />
        <span className="field-hint">
          A promotion can't take a price below cost plus this much. 0 means never below cost; 10 means cost + 10%.
        </span>
      </label>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      {saved && (
        <p className="form-success" role="status">
          Saved.
        </p>
      )}
      <button type="submit" className="button button--primary" disabled={!isValid || save.isPending}>
        {save.isPending ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

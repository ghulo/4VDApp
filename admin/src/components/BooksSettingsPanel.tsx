import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useT } from '../i18n/useT';
import { booksApi } from '../services/api';
import { ACCOUNT_CLASSES, ACCOUNT_LINK_KEYS, type AccountLinkKey, type BooksSettings, type LedgerAccount } from '../services/types';
import { errorMessage } from '../utils/errors';
import { linkLabel } from './BooksParts';
import { ErrorNotice, Loading, SavedToast } from './Feedback';
import { Button, Card, DateField, Field } from './ui';

/** When the books start, and which account each kind of movement goes to. */
export function BooksSettingsPanel() {
  const settings = useQuery({ queryKey: ['books', 'settings'], queryFn: booksApi.settings });
  const accounts = useQuery({ queryKey: ['books', 'accounts'], queryFn: booksApi.accounts });
  if (settings.isPending || accounts.isPending) return <Loading />;
  if (settings.isError) return <ErrorNotice error={settings.error} onRetry={() => settings.refetch()} />;
  if (accounts.isError) return <ErrorNotice error={accounts.error} onRetry={() => accounts.refetch()} />;
  return <BooksSettingsForm initial={settings.data} accounts={accounts.data} />;
}

const linksOf = (settings: BooksSettings) => Object.fromEntries(settings.links.map((link) => [link.key, String(link.accountId)])) as Partial<Record<AccountLinkKey, string>>;

function BooksSettingsForm({ initial, accounts }: { initial: BooksSettings; accounts: LedgerAccount[] }) {
  const t = useT();
  const s = t.books.settings;
  const queryClient = useQueryClient();
  const [startDay, setStartDay] = useState(initial.startDay ?? '');
  const [links, setLinks] = useState(() => linksOf(initial));
  const before = linksOf(initial);
  const changedLinks = ACCOUNT_LINK_KEYS.filter((key) => links[key] && links[key] !== before[key]);
  const startChanged = startDay !== '' && startDay !== (initial.startDay ?? '');

  const save = useMutation({
    mutationFn: () =>
      booksApi.updateSettings({
        ...(startChanged ? { startDay } : {}),
        ...(changedLinks.length > 0 ? { links: Object.fromEntries(changedLinks.map((key) => [key, Number(links[key])])) } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });

  const usable = accounts.filter((account) => !account.archived);
  const byClass = ACCOUNT_CLASSES.map((accountClass) => ({ accountClass, accounts: usable.filter((account) => account.accountClass === accountClass) })).filter(
    (group) => group.accounts.length > 0,
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card
        title={s.title}
        description={s.description}
        footer={
          <>
            {save.isError && (
              <p className="form-error" role="alert">
                {errorMessage(save.error)}
              </p>
            )}
            {save.isSuccess && (
              <SavedToast message={s.saved} />
            )}
            <Button type="submit" variant="primary" disabled={(!startChanged && changedLinks.length === 0) || save.isPending} loading={save.isPending}>
              {s.save}
            </Button>
          </>
        }
      >
        <div className="settings-form">
          <Field label={s.startDay} hint={s.startHint}>
            <DateField
              required
              value={startDay}
              onChange={(value) => {
                save.reset();
                setStartDay(value);
              }}
            />
          </Field>
          {startChanged && (
            <p className="notice notice--warn" role="status">
              {s.startWarning}
            </p>
          )}
          <h3 className="books-settings__heading">{s.links}</h3>
          <p className="field-hint">{s.linksHint}</p>
          <div className="books-links-grid">
            {ACCOUNT_LINK_KEYS.map((key) => (
              <Field key={key} label={linkLabel(t, key)}>
                <select
                  value={links[key] ?? ''}
                  onChange={(event) => {
                    save.reset();
                    setLinks((current) => ({ ...current, [key]: event.target.value }));
                  }}
                >
                  {byClass.map((group) => (
                    <optgroup key={group.accountClass} label={t.books.classes[group.accountClass]}>
                      {group.accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.number} {account.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        </div>
      </Card>
    </form>
  );
}

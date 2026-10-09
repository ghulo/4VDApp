import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useT } from '../i18n/useT';
import { settingsApi } from '../services/api';
import { errorMessage } from '../utils/errors';
import { ErrorNotice, Loading } from './Feedback';
import { Button, Card, Field } from './ui';

/** Typed to confirm, same as the server and the wipe script. */
const WIPE_PHRASE = 'wipe 4vd.app';
/** Rows worth naming; everything else is counted as "other records". */
const NAMED = ['users', 'products', 'categories', 'sales', 'customers', 'suppliers', 'purchase_orders', 'expenses', 'carwash_days', 'cash_counts', 'activity_log'] as const;

/** Developer only: clears the test data before launch. Kept: developer accounts, the shop details, settings, carwashes. */
export function WipeDataPanel() {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const preview = useQuery({ queryKey: ['settings', 'wipe-preview'], queryFn: settingsApi.wipePreview, enabled: open, gcTime: 0 });
  const wipe = useMutation({
    mutationFn: () => settingsApi.wipe(WIPE_PHRASE),
    onSuccess: () => {
      // Everything on screen was test data; the launch step ticks off too.
      queryClient.invalidateQueries();
      setOpen(false);
      setTyped('');
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    wipe.mutate();
  }

  const named = preview.data ? NAMED.filter((key) => (preview.data.deleted[key] ?? 0) > 0) : [];
  const other = preview.data
    ? Object.entries(preview.data.deleted).reduce((sum, [key, n]) => sum + ((NAMED as readonly string[]).includes(key) ? 0 : n), 0)
    : 0;

  return (
    <Card id="wipe-data" title={t.wipe.title} description={t.wipe.description}>
      {wipe.isSuccess && !open && (
        <p className="form-success" role="status">
          {t.wipe.done}
        </p>
      )}
      {!open ? (
        <div className="form-actions">
          <Button variant="danger" onClick={() => setOpen(true)}>
            {t.wipe.open}
          </Button>
        </div>
      ) : (
        <form className="settings-form" onSubmit={handleSubmit}>
          {preview.isPending && <Loading />}
          {preview.isError && <ErrorNotice error={preview.error} onRetry={() => preview.refetch()} />}
          {preview.data && (
            <>
              <p>{named.length === 0 && other === 0 ? t.wipe.nothing : t.wipe.willDelete}</p>
              <ul className="plain-list">
                {named.map((key) => (
                  <li key={key}>
                    {preview.data.deleted[key]} {t.wipe.items[key]}
                  </li>
                ))}
                {other > 0 && (
                  <li>
                    {other} {t.wipe.other}
                  </li>
                )}
              </ul>
              <p className="field-hint">{t.wipe.kept(preview.data.keptDevelopers.join(', '))}</p>
            </>
          )}
          <Field label={t.wipe.typeToConfirm(WIPE_PHRASE)}>
            <input autoComplete="off" spellCheck={false} value={typed} onChange={(event) => setTyped(event.target.value)} />
          </Field>
          {wipe.isError && (
            <p className="form-error" role="alert">
              {errorMessage(wipe.error)}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" variant="danger" disabled={typed !== WIPE_PHRASE || !preview.data || wipe.isPending}>
              {wipe.isPending ? t.wipe.wiping : t.wipe.confirm}
            </Button>
            <Button
              variant="ghost"
              disabled={wipe.isPending}
              onClick={() => {
                setOpen(false);
                setTyped('');
              }}
            >
              {t.wipe.cancel}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useT } from '../i18n/useT';
import { settingsApi } from '../services/api';
import type { NumberedKind, NumberFormat, ShopRules } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ErrorNotice, Loading, SavedToast } from './Feedback';
import { Button, Card, SettingRow } from './ui';

const KINDS: NumberedKind[] = ['invoice', 'credit_note', 'offer'];
const DIGITS = [3, 4, 5, 6, 7, 8];

/** "FSM-26-000001", as the next number of that kind will read. */
export function sampleNumber(format: NumberFormat, year = new Date().getFullYear()): string {
  const y = format.year === 'yy' ? String(year % 100).padStart(2, '0') : String(year);
  return `${format.prefix || '?'}-${y}-${'1'.padStart(format.digits, '0')}`;
}

const cleanPrefix = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

/** Settings → Numbers and stock: how documents are numbered, and whether the till sells past stock. */
export function ShopRulesPanel() {
  const rules = useQuery({ queryKey: ['settings', 'rules'], queryFn: settingsApi.rules });
  if (rules.isPending) return <Loading />;
  if (rules.isError) return <ErrorNotice error={rules.error} onRetry={() => rules.refetch()} />;
  return <ShopRulesForm initial={rules.data} />;
}

function ShopRulesForm({ initial }: { initial: ShopRules }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => settingsApi.updateRules(draft),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings', 'rules'], updated);
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
      setDraft(updated);
      setSaved(true);
    },
  });
  const change = (next: ShopRules) => {
    setDraft(next);
    setSaved(false);
  };
  const setFormat = (kind: NumberedKind, patch: Partial<NumberFormat>) => change({ ...draft, numbering: { ...draft.numbering, [kind]: { ...draft.numbering[kind], ...patch } } });
  const prefixes = KINDS.map((kind) => draft.numbering[kind].prefix);
  const clash = KINDS.find((kind, index) => prefixes.indexOf(draft.numbering[kind].prefix) !== index);
  const empty = prefixes.some((prefix) => prefix === '');
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(initial);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit}>
      <Card
        title={t.rules.title}
        description={t.rules.description}
        footer={
          <>
            {save.isError && (
              <span className="form-error" role="alert">
                {errorMessage(save.error)}
              </span>
            )}
            {saved && !save.isError && <SavedToast message={t.settings.saved} />}
            <Button type="submit" variant={hasChanges ? 'primary' : 'secondary'} disabled={!hasChanges || Boolean(clash) || empty || save.isPending} loading={save.isPending}>
              {t.settings.saveChanges}
            </Button>
          </>
        }
      >
        {KINDS.map((kind) => {
          const format = draft.numbering[kind];
          const label = t.rules.kinds[kind];
          return (
            <SettingRow
              key={kind}
              title={label}
              description={
                clash === kind ? (
                  <span className="form-error" role="alert">
                    {t.rules.clash(format.prefix)}
                  </span>
                ) : (
                  <>
                    {t.rules.next} <span className="rules-sample">{sampleNumber(format)}</span>
                  </>
                )
              }
            >
              <div className="rules-format">
                <label className="rules-format__part">
                  <span>{t.rules.prefix}</span>
                  <input
                    className="rules-format__prefix"
                    aria-label={t.rules.prefixOf(label)}
                    value={format.prefix}
                    maxLength={6}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    aria-invalid={clash === kind || format.prefix === ''}
                    onChange={(event) => setFormat(kind, { prefix: cleanPrefix(event.target.value) })}
                  />
                </label>
                <label className="rules-format__part">
                  <span>{t.rules.year}</span>
                  <select aria-label={t.rules.yearOf(label)} value={format.year} onChange={(event) => setFormat(kind, { year: event.target.value as NumberFormat['year'] })}>
                    <option value="yyyy">{new Date().getFullYear()}</option>
                    <option value="yy">{String(new Date().getFullYear() % 100)}</option>
                  </select>
                </label>
                <label className="rules-format__part">
                  <span>{t.rules.digits}</span>
                  <select aria-label={t.rules.digitsOf(label)} value={format.digits} onChange={(event) => setFormat(kind, { digits: Number(event.target.value) })}>
                    {DIGITS.map((digits) => (
                      <option key={digits} value={digits}>
                        {digits}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </SettingRow>
          );
        })}
        <p className="field-hint rules-note">{t.rules.onlyNext}</p>
        <SettingRow title={t.rules.noStock} description={draft.noStockSales === 'allow' ? t.rules.noStockAllow : t.rules.noStockBlock}>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            aria-label={t.rules.noStock}
            checked={draft.noStockSales === 'allow'}
            onChange={(event) => change({ ...draft, noStockSales: event.target.checked ? 'allow' : 'block' })}
          />
        </SettingRow>
      </Card>
    </form>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useT } from '../i18n/useT';
import { billsApi } from '../services/api';
import type { SupplierBill } from '../services/types';
import { type DraftLine, isLineDone, lineFromBill, lineGross, todayIso, toLineInput } from '../utils/bills';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { BillLines, Segmented } from './BillLines';
import { Button, DateField, Field } from './ui';

/** A return or credit against a bill, filled in from its lines: keep what it covers, change what differs. */
export function CreditForm({ bill, onDone }: { bill: SupplierBill; onDone: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const hasProducts = bill.lines.some((line) => line.kind === 'product');
  const [returnsStock, setReturnsStock] = useState(hasProducts);
  // Transport spread onto an import's goods isn't a line of its own to give back.
  const [lines, setLines] = useState<DraftLine[]>(() => bill.lines.filter((line) => !line.spread).map((line) => lineFromBill(line, bill.pricesIncludeVat)));
  const [number, setNumber] = useState('');
  const [issuedOn, setIssuedOn] = useState(todayIso());
  const [note, setNote] = useState('');

  const kept = lines.filter((line) => line.include);
  const ready = kept.length > 0 && kept.every(isLineDone);
  const amount = Math.round(kept.reduce((sum, line) => sum + lineGross(line, bill.pricesIncludeVat), 0) * 100) / 100;
  const units = kept.filter((line) => line.kind === 'product').reduce((sum, line) => sum + Number(line.quantity), 0);
  const returning = hasProducts && returnsStock;

  const save = useMutation({
    mutationFn: () =>
      billsApi.credit(bill.id, {
        returnsStock: returning,
        number: number.trim() || null,
        issuedOn,
        note: note.trim() || null,
        pricesIncludeVat: bill.pricesIncludeVat,
        lines: kept.map(toLineInput),
      }),
    onSuccess: () => {
      for (const key of ['bills', 'attention', 'expenses', 'inventory', 'products', 'activity', 'reports', 'books', 'suppliers']) queryClient.invalidateQueries({ queryKey: [key] });
      onDone();
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (ready) save.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit} noValidate>
      {hasProducts && (
        <div className="field">
          <span className="field__label">{t.creditForm.what}</span>
          <Segmented
            label={t.creditForm.what}
            value={returnsStock ? 'return' : 'credit'}
            options={[
              { value: 'return', label: t.creditForm.returnGoods },
              { value: 'credit', label: t.creditForm.creditOnly },
            ]}
            onChange={(value) => setReturnsStock(value === 'return')}
          />
          <span className="field__hint">{returnsStock ? t.creditForm.returnHint : t.creditForm.creditHint}</span>
        </div>
      )}
      <div className="field-row">
        <Field label={t.creditForm.number}>
          <input maxLength={60} autoComplete="off" value={number} onChange={(event) => setNumber(event.target.value)} />
        </Field>
        <Field label={t.creditForm.date}>
          <DateField required min={bill.issuedOn} max={todayIso()} value={issuedOn} onChange={(value) => setIssuedOn(value)} />
        </Field>
      </div>
      <BillLines lines={lines} onChange={setLines} abroad={bill.abroad} fromBill lockPrices={returning} />
      <Field label={t.bills.note}>
        <input maxLength={500} autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <p className="bill-sentence" role="status" aria-live="polite">
        {kept.length === 0 ? t.creditForm.nothing : returning && units > 0 ? t.creditForm.sentenceReturn(units, formatMoney(amount)) : t.creditForm.sentenceCredit(formatMoney(amount))}
      </p>
      {amount > bill.left && kept.length > 0 && <p className="field-hint">{t.creditForm.beyond(formatMoney(Math.round((amount - bill.left) * 100) / 100))}</p>}
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={!ready || save.isPending} loading={save.isPending}>
          {t.creditForm.save}
        </Button>
      </div>
    </form>
  );
}

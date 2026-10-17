import { useT } from '../i18n/useT';
import type { SupplierBill } from '../services/types';
import { addDaysIso, type BillDraft, isVatValid, todayIso, vatInside } from '../utils/bills';
import { formatDate, formatMoney } from '../utils/format';
import { Badge, Button, DateField, Field } from './ui';

/** When a bill is due, as a badge: late, due soon, or just the date. */
export function DueBadge({ bill }: { bill: SupplierBill }) {
  const t = useT();
  if (!bill.dueOn) return <span className="table__secondary">{t.bills.noDue}</span>;
  if (bill.daysLeft === null) return <span>{formatDate(bill.dueOn)}</span>;
  if (bill.overdue) return <Badge tone="danger">{t.bills.late(-bill.daysLeft)}</Badge>;
  if (bill.daysLeft <= 7) return <Badge tone="warn">{t.bills.dueIn(bill.daysLeft)}</Badge>;
  return <span>{formatDate(bill.dueOn)}</span>;
}

/**
 * Number, dates, amount and note: the fields a bill has, for adding one or fixing a typo.
 * `lockAmount`: a bill worked out from its lines keeps the amount its lines give.
 * `hideDue`: a credit or a bill paid on the spot has nothing to pay later, so no due date.
 */
export function BillFields({
  draft,
  onChange,
  lockAmount,
  hideDue,
}: {
  draft: BillDraft;
  onChange: (draft: BillDraft) => void;
  lockAmount?: boolean;
  hideDue?: boolean;
}) {
  const t = useT();
  const set = (patch: Partial<BillDraft>) => onChange({ ...draft, ...patch });
  return (
    <>
      <div className="field-row">
        <Field label={t.bills.number}>
          <input maxLength={60} autoComplete="off" value={draft.number} onChange={(event) => set({ number: event.target.value })} />
        </Field>
        {!lockAmount && (
          <Field label={t.bills.amountEuro}>
            <input
              required
              type="number"
              inputMode="decimal"
              autoComplete="off"
              min={0.01}
              step={0.01}
              value={draft.amount}
              onChange={(event) => set({ amount: event.target.value })}
            />
          </Field>
        )}
      </div>
      {!lockAmount && (
        <>
          <Field label={t.bills.vat} hint={t.bills.vatHint} error={isVatValid(draft) ? undefined : t.bills.vatTooBig}>
            <input
              type="number"
              inputMode="decimal"
              autoComplete="off"
              min={0}
              step={0.01}
              value={draft.vat}
              aria-invalid={!isVatValid(draft)}
              onChange={(event) => set({ vat: event.target.value })}
            />
          </Field>
          <div className="quick-due" role="group" aria-label={t.bills.vatQuick}>
            {[18, 8].map((rate) => (
              <Button
                key={rate}
                size="sm"
                variant="ghost"
                disabled={!(Number(draft.amount) > 0)}
                onClick={() => set({ vat: String(vatInside(Number(draft.amount), rate)) })}
              >
                {t.bills.vatAt(rate)}
              </Button>
            ))}
            <Button size="sm" variant="ghost" disabled={draft.vat === ''} onClick={() => set({ vat: '' })}>
              {t.bills.vatNone}
            </Button>
          </div>
          {Number(draft.amount) > 0 && isVatValid(draft) && (
            <p className="field-hint" role="status">
              {draft.vat.trim() === ''
                ? t.bills.booksPreviewNoVat(formatMoney(Number(draft.amount)))
                : t.bills.booksPreview(formatMoney(Number(draft.amount) - Number(draft.vat)), formatMoney(Number(draft.vat)))}
            </p>
          )}
        </>
      )}
      <div className="field-row">
        <Field label={t.bills.issuedOn}>
          <DateField required max={todayIso()} value={draft.issuedOn} onChange={(value) => set({ issuedOn: value })} />
        </Field>
        {!hideDue && (
          <Field label={t.bills.due} hint={t.bills.dueHint}>
            <DateField min={draft.issuedOn} value={draft.dueOn} onChange={(value) => set({ dueOn: value })} />
          </Field>
        )}
      </div>
      {!hideDue && (
        <div className="quick-due" role="group" aria-label={t.bills.quickDue}>
          {[0, 15, 30, 60].map((days) => (
            <Button key={days} size="sm" variant="ghost" onClick={() => set({ dueOn: addDaysIso(draft.issuedOn || todayIso(), days) })}>
              {days === 0 ? t.bills.dueNow : t.bills.inDays(days)}
            </Button>
          ))}
        </div>
      )}
      <Field label={t.bills.note}>
        <input maxLength={500} autoComplete="off" value={draft.note} onChange={(event) => set({ note: event.target.value })} />
      </Field>
    </>
  );
}

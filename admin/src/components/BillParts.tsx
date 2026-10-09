import { useT } from '../i18n/useT';
import type { SupplierBill } from '../services/types';
import { addDaysIso, type BillDraft, todayIso } from '../utils/bills';
import { formatDate } from '../utils/format';
import { Badge, Button, Field } from './ui';

/** When a bill is due, as a badge: late, due soon, or just the date. */
export function DueBadge({ bill }: { bill: SupplierBill }) {
  const t = useT();
  if (!bill.dueOn) return <span className="table__secondary">{t.bills.noDue}</span>;
  if (bill.daysLeft === null) return <span>{formatDate(bill.dueOn)}</span>;
  if (bill.overdue) return <Badge tone="danger">{t.bills.late(-bill.daysLeft)}</Badge>;
  if (bill.daysLeft <= 7) return <Badge tone="warn">{t.bills.dueIn(bill.daysLeft)}</Badge>;
  return <span>{formatDate(bill.dueOn)}</span>;
}

/** Number, dates, amount and note: the fields a bill has, for adding one or fixing a typo. */
export function BillFields({ draft, onChange }: { draft: BillDraft; onChange: (draft: BillDraft) => void }) {
  const t = useT();
  const set = (patch: Partial<BillDraft>) => onChange({ ...draft, ...patch });
  return (
    <>
      <div className="field-row">
        <Field label={t.bills.number}>
          <input maxLength={60} autoComplete="off" value={draft.number} onChange={(event) => set({ number: event.target.value })} />
        </Field>
        <Field label={t.bills.amountEuro}>
          <input required type="number" inputMode="decimal" autoComplete="off" min={0.01} step={0.01} value={draft.amount} onChange={(event) => set({ amount: event.target.value })} />
        </Field>
      </div>
      <div className="field-row">
        <Field label={t.bills.issuedOn}>
          <input required type="date" max={todayIso()} value={draft.issuedOn} onChange={(event) => set({ issuedOn: event.target.value })} />
        </Field>
        <Field label={t.bills.due} hint={t.bills.dueHint}>
          <input type="date" min={draft.issuedOn} value={draft.dueOn} onChange={(event) => set({ dueOn: event.target.value })} />
        </Field>
      </div>
      <div className="quick-due" role="group" aria-label={t.bills.quickDue}>
        {[0, 15, 30, 60].map((days) => (
          <Button key={days} size="sm" variant="ghost" onClick={() => set({ dueOn: addDaysIso(draft.issuedOn || todayIso(), days) })}>
            {days === 0 ? t.bills.dueNow : t.bills.inDays(days)}
          </Button>
        ))}
      </div>
      <Field label={t.bills.note}>
        <input maxLength={500} autoComplete="off" value={draft.note} onChange={(event) => set({ note: event.target.value })} />
      </Field>
    </>
  );
}

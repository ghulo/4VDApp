import { DateField, Field } from './ui';
import { Segmented } from './BillLines';
import { useT } from '../i18n/useT';
import type { CustomsCandidate } from '../services/types';
import type { CustomsDraft } from '../utils/customs';
import { todayIso } from '../utils/bills';
import { formatDate, formatMoney } from '../utils/format';

/** A customs paper's fields: number and date, VAT, duty, excise, and how it was paid at the border. */
export function CustomsFields({ draft, onChange, dutyLocked = false, dutyHint }: { draft: CustomsDraft; onChange: (draft: CustomsDraft) => void; dutyLocked?: boolean; dutyHint?: string }) {
  const t = useT();
  const w = t.bills.customsCard;
  const set = (patch: Partial<CustomsDraft>) => onChange({ ...draft, ...patch });
  return (
    <>
      <div className="field-row">
        <Field label={w.number}>
          <input maxLength={60} autoComplete="off" value={draft.number} onChange={(event) => set({ number: event.target.value })} />
        </Field>
        <Field label={w.date}>
          <DateField required max={todayIso()} value={draft.issuedOn} onChange={(value) => set({ issuedOn: value })} />
        </Field>
      </div>
      <div className="field-row">
        <Field label={w.vat}>
          <input type="number" inputMode="decimal" min={0} step={0.01} value={draft.vat} onChange={(event) => set({ vat: event.target.value })} />
        </Field>
        <Field label={w.duty} hint={dutyHint}>
          <input type="number" inputMode="decimal" min={0} step={0.01} disabled={dutyLocked} value={draft.duty} onChange={(event) => set({ duty: event.target.value })} />
        </Field>
        <Field label={w.excise}>
          <input type="number" inputMode="decimal" min={0} step={0.01} disabled={dutyLocked} value={draft.excise} onChange={(event) => set({ excise: event.target.value })} />
        </Field>
      </div>
      <div className="field">
        <span className="field__label">{w.method}</span>
        <Segmented
          label={w.method}
          value={draft.method}
          options={(['bank', 'cash'] as const).map((method) => ({ value: method, label: t.billForm.customsMethods[method] }))}
          onChange={(method) => set({ method })}
        />
      </div>
    </>
  );
}

/** The import bill a customs paper goes on: the ones it names first; '' keeps it waiting for its bill. */
export function CustomsBillPicker({ bills, value, onChange, allowWaiting }: { bills: CustomsCandidate[]; value: string; onChange: (value: string) => void; allowWaiting: boolean }) {
  const t = useT();
  const w = t.customsPaper;
  const chosen = bills.find((bill) => String(bill.id) === value);
  const hint = chosen ? (chosen.by ? w.by[chosen.by] : undefined) : bills.length === 0 ? w.noBills : allowWaiting ? w.waitHint : undefined;
  return (
    <Field label={w.bill} hint={hint}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {allowWaiting ? <option value="">{w.waitOption}</option> : <option value="">{w.chooseBill}</option>}
        {bills.map((bill) => (
          <option key={bill.id} value={bill.id}>
            {[bill.supplier ?? w.noSupplier, bill.number ? w.billNo(bill.number) : null, formatDate(bill.issuedOn), formatMoney(bill.amount)].filter(Boolean).join(' · ')}
            {bill.by ? ` (${w.byShort[bill.by]})` : ''}
          </option>
        ))}
      </select>
    </Field>
  );
}

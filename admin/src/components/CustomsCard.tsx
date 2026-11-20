import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { Button, Card, DateField, Field, RemoveButton } from './ui';
import { Segmented } from './BillLines';
import { useT } from '../i18n/useT';
import { billsApi } from '../services/api';
import type { CustomsPaidMethod, SupplierBill } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';
import { formatMonth } from '../utils/vat';
import { todayIso } from '../utils/bills';

interface Draft {
  number: string;
  issuedOn: string;
  vat: string;
  duty: string;
  excise: string;
  method: CustomsPaidMethod;
}

const toDraft = (bill: SupplierBill): Draft =>
  bill.customs
    ? {
        number: bill.customs.number ?? '',
        issuedOn: bill.customs.issuedOn,
        vat: String(bill.customs.vat),
        duty: String(bill.customs.duty),
        excise: bill.customs.excise > 0 ? String(bill.customs.excise) : '',
        method: bill.customs.method,
      }
    : { number: '', issuedOn: todayIso(), vat: '', duty: '', excise: '', method: 'bank' };

const amount = (value: string) => (value.trim() === '' ? 0 : Number(value));

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * An import bill's customs paper (Dogana e Kosovës' declaration): add it,
 * change it or take it off; or say this import had none, so 4VD stops asking.
 * Opened from the To do list at #customs.
 */
export function CustomsCard({ bill, writes }: { bill: SupplierBill; writes: boolean }) {
  const t = useT();
  const w = t.bills.customsCard;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(bill));
  const onSaved = (updated: SupplierBill) => {
    queryClient.setQueryData(['bills', updated.id], updated);
    for (const key of ['bills', 'cash', 'activity', 'attention', 'vat', 'books']) queryClient.invalidateQueries({ queryKey: [key] });
    setEditing(false);
    setDraft(toDraft(updated));
  };
  const save = useMutation({
    mutationFn: () =>
      billsApi.setCustoms(bill.id, {
        number: draft.number.trim() || null,
        issuedOn: draft.issuedOn,
        vat: amount(draft.vat),
        duty: amount(draft.duty),
        excise: amount(draft.excise),
        method: draft.method,
      }),
    onSuccess: onSaved,
  });
  const remove = useMutation({ mutationFn: () => billsApi.removeCustoms(bill.id), onSuccess: onSaved });
  const none = useMutation({ mutationFn: (value: boolean) => billsApi.setNoCustoms(bill.id, value), onSuccess: onSaved });

  // Opened from "Customs missing" in To do: straight to the form.
  useEffect(() => {
    if (window.location.hash !== '#customs') return;
    const card = document.getElementById('customs');
    card?.scrollIntoView({ block: 'start' });
    card?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, []);

  const c = bill.customs;
  const hasEquipment = bill.lines.some((line) => line.kind === 'equipment');
  const numbers = [draft.vat, draft.duty, draft.excise].map(amount);
  const valid = draft.issuedOn !== '' && draft.issuedOn <= todayIso() && numbers.every((value) => Number.isFinite(value) && value >= 0) && numbers.some((value) => value > 0);
  const showForm = writes && (editing || (!c && !bill.noCustoms));
  const error = save.error ?? remove.error ?? none.error;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (valid) save.mutate();
  }

  return (
    <Card
      id="customs"
      title={w.title}
      description={c || showForm ? w.hint : undefined}
      actions={
        writes &&
        c &&
        !editing && (
          <>
            <Button size="sm" onClick={() => setEditing(true)}>
              {w.change}
            </Button>
            <RemoveButton confirm={w.confirmRemove} pending={remove.isPending} onConfirm={() => remove.mutate()}>
              {w.remove}
            </RemoveButton>
          </>
        )
      }
    >
      {c && !editing && (
        <>
          <dl className="partner-facts">
            <Fact label={w.paperNo}>{c.number ?? w.noNumber}</Fact>
            <Fact label={w.paperDate}>{formatDate(c.issuedOn)}</Fact>
            <Fact label={w.paperVat}>{formatMoney(c.vat)}</Fact>
            <Fact label={w.paperDuty}>{formatMoney(c.duty)}</Fact>
            {c.excise > 0 && <Fact label={w.paperExcise}>{formatMoney(c.excise)}</Fact>}
            <Fact label={w.paidTotal}>
              {formatMoney(Math.round((c.vat + c.duty + c.excise) * 100) / 100)} · {t.billForm.customsMethods[c.method]}
            </Fact>
          </dl>
          {c.vatMonth && <p className="field-hint">{w.countsIn(formatMonth(c.vatMonth))}</p>}
        </>
      )}

      {!c && bill.noCustoms && !editing && (
        <div className="setting-row">
          <p className="field-hint">{w.noneSet}</p>
          {writes && (
            <Button size="sm" variant="ghost" disabled={none.isPending} loading={none.isPending} onClick={() => none.mutate(false)}>
              {w.noneUndo}
            </Button>
          )}
        </div>
      )}

      {!c && !bill.noCustoms && !writes && <p className="field-hint">{w.missing}</p>}

      {showForm && (
        <form className="settings-form" onSubmit={handleSubmit} noValidate>
          {!c && <p className="field-hint">{w.missing}</p>}
          <div className="field-row">
            <Field label={w.number}>
              <input maxLength={60} autoComplete="off" value={draft.number} onChange={(event) => setDraft({ ...draft, number: event.target.value })} />
            </Field>
            <Field label={w.date}>
              <DateField required max={todayIso()} value={draft.issuedOn} onChange={(value) => setDraft({ ...draft, issuedOn: value })} />
            </Field>
          </div>
          <div className="field-row">
            <Field label={w.vat}>
              <input type="number" inputMode="decimal" min={0} step={0.01} value={draft.vat} onChange={(event) => setDraft({ ...draft, vat: event.target.value })} />
            </Field>
            <Field label={w.duty} hint={hasEquipment ? w.equipmentHint : undefined}>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                disabled={hasEquipment && Boolean(c)}
                value={draft.duty}
                onChange={(event) => setDraft({ ...draft, duty: event.target.value })}
              />
            </Field>
            <Field label={w.excise}>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                disabled={hasEquipment && Boolean(c)}
                value={draft.excise}
                onChange={(event) => setDraft({ ...draft, excise: event.target.value })}
              />
            </Field>
          </div>
          <div className="field">
            <span className="field__label">{w.method}</span>
            <Segmented
              label={w.method}
              value={draft.method}
              options={(['bank', 'cash'] as const).map((method) => ({ value: method, label: t.billForm.customsMethods[method] }))}
              onChange={(method) => setDraft({ ...draft, method })}
            />
          </div>
          {error && (
            <p className="form-error" role="alert">
              {errorMessage(error)}
            </p>
          )}
          <div className="form-actions">
            {editing && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setDraft(toDraft(bill));
                }}
              >
                {t.common.cancel}
              </Button>
            )}
            {!c && !editing && (
              <Button variant="ghost" disabled={none.isPending} loading={none.isPending} onClick={() => none.mutate(true)} title={w.noneHint}>
                {w.none}
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={!valid || save.isPending} loading={save.isPending}>
              {c ? w.save : w.add}
            </Button>
          </div>
          {!c && !editing && <p className="field-hint">{w.noneHint}</p>}
        </form>
      )}
      {!showForm && error && (
        <p className="form-error" role="alert">
          {errorMessage(error)}
        </p>
      )}
    </Card>
  );
}

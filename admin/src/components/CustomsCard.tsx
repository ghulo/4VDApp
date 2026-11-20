import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { Button, Card, RemoveButton } from './ui';
import { CustomsFields } from './CustomsFields';
import { useT } from '../i18n/useT';
import { billsApi } from '../services/api';
import type { SupplierBill } from '../services/types';
import { type CustomsDraft, customsDraftValid, customsInput, emptyCustomsDraft } from '../utils/customs';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';
import { formatMonth } from '../utils/vat';

const toDraft = (bill: SupplierBill): CustomsDraft =>
  bill.customs
    ? {
        number: bill.customs.number ?? '',
        issuedOn: bill.customs.issuedOn,
        vat: String(bill.customs.vat),
        duty: String(bill.customs.duty),
        excise: bill.customs.excise > 0 ? String(bill.customs.excise) : '',
        method: bill.customs.method,
      }
    : emptyCustomsDraft();

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
  const [draft, setDraft] = useState<CustomsDraft>(() => toDraft(bill));
  const onSaved = (updated: SupplierBill) => {
    queryClient.setQueryData(['bills', updated.id], updated);
    for (const key of ['bills', 'cash', 'activity', 'attention', 'vat', 'books']) queryClient.invalidateQueries({ queryKey: [key] });
    setEditing(false);
    setDraft(toDraft(updated));
  };
  const save = useMutation({
    mutationFn: () => billsApi.setCustoms(bill.id, customsInput(draft)),
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
  const valid = customsDraftValid(draft);
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
          <CustomsFields draft={draft} onChange={setDraft} dutyLocked={hasEquipment && Boolean(c)} dutyHint={hasEquipment ? w.equipmentHint : undefined} />
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
            <Button type="submit" variant="primary" disabled={!valid || save.isPending} aria-describedby={valid ? undefined : 'customs-needs'} loading={save.isPending}>
              {c ? w.save : w.add}
            </Button>
          </div>
          {!valid && (
            <p id="customs-needs" className="field-hint">
              {w.needsAmount}
            </p>
          )}
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

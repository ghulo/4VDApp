import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useT } from '../i18n/useT';
import { suppliersApi } from '../services/api';
import { type Supplier, WITHHOLDING_RATES, WITHHOLDING_TYPES, type WithholdingType } from '../services/types';
import { errorMessage } from '../utils/errors';
import { cleanNui, isNui, NuiInput } from './NuiInput';
import { Button, Field } from './ui';

/** Adds a supplier, or with `supplier` changes one. The NUI is required, unless the supplier is abroad. */
export function SupplierForm({ supplier, onDone }: { supplier: Supplier | null; onDone: (saved?: Supplier) => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState(supplier?.name ?? '');
  const [nui, setNui] = useState(supplier?.nui ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const [abroad, setAbroad] = useState(supplier?.abroad ?? false);
  const [withholding, setWithholding] = useState<WithholdingType | ''>(supplier?.withholdingType ?? '');
  const nuiOk = isNui(nui) || (abroad && nui.trim() === '');
  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        nui: nui.trim() === '' ? null : cleanNui(nui),
        phone: phone.trim() || null,
        email: email.trim() || null,
        abroad,
        withholdingType: withholding || null,
      };
      return supplier ? suppliersApi.update(supplier.id, input) : suppliersApi.add(input);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setName('');
      setNui('');
      setPhone('');
      setEmail('');
      setAbroad(false);
      setWithholding('');
      onDone(saved);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form
      className="settings-form form-actions--spaced"
      onSubmit={handleSubmit}
      aria-label={supplier ? t.orders.editLabel(supplier.name) : t.orders.addSupplier}
    >
      <div className="field-row">
        <Field label={t.orders.supplierName}>
          <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={abroad ? t.suppliers.nuiOptional : t.nui.label} hint={abroad ? t.suppliers.abroadHint : t.nui.hint}>
          <NuiInput required={!abroad} value={nui} onChange={(event) => setNui(event.target.value)} />
        </Field>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={abroad} onChange={(event) => setAbroad(event.target.checked)} />
        {t.suppliers.abroad}
      </label>
      <div className="field-row">
        <Field label={t.orders.phone}>
          <input type="tel" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} />
        </Field>
        <Field label={t.orders.email}>
          <input type="email" maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
      </div>
      <Field label={t.suppliers.withholding} hint={t.suppliers.withholdingHint}>
        <select value={withholding} onChange={(event) => setWithholding(event.target.value as WithholdingType | '')}>
          <option value="">{t.billForm.withholdingNone}</option>
          {WITHHOLDING_TYPES.map((type) => (
            <option key={type} value={type}>
              {t.billForm.withholdingOption(t.bills.withholdingTypes[type], WITHHOLDING_RATES[type])}
            </option>
          ))}
        </select>
      </Field>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" disabled={name.trim() === '' || !nuiOk || save.isPending}>
          {supplier ? t.orders.saveSupplier : t.orders.add}
        </Button>
        {supplier && (
          <Button variant="ghost" onClick={() => onDone()}>
            {t.orders.cancelEdit}
          </Button>
        )}
      </div>
    </form>
  );
}

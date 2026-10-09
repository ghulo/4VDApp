import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useT } from '../i18n/useT';
import { suppliersApi } from '../services/api';
import type { Supplier } from '../services/types';
import { errorMessage } from '../utils/errors';
import { cleanNui, isNui, NuiInput } from './NuiInput';
import { Button, Field } from './ui';

/** Adds a supplier, or with `supplier` changes one. The NUI is required either way. */
export function SupplierForm({ supplier, onDone }: { supplier: Supplier | null; onDone: (saved?: Supplier) => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState(supplier?.name ?? '');
  const [nui, setNui] = useState(supplier?.nui ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const save = useMutation({
    mutationFn: () => {
      const input = { name: name.trim(), nui: cleanNui(nui), phone: phone.trim() || null, email: email.trim() || null };
      return supplier ? suppliersApi.update(supplier.id, input) : suppliersApi.add(input);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setName('');
      setNui('');
      setPhone('');
      setEmail('');
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
        <Field label={t.nui.label} hint={t.nui.hint}>
          <NuiInput required value={nui} onChange={(event) => setNui(event.target.value)} />
        </Field>
      </div>
      <div className="field-row">
        <Field label={t.orders.phone}>
          <input type="tel" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} />
        </Field>
        <Field label={t.orders.email}>
          <input type="email" maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
      </div>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" disabled={name.trim() === '' || !isNui(nui) || save.isPending}>
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

import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useSwitchBusiness } from '../auth/useBusinessPicker';
import { useT } from '../i18n/useT';
import { businessesApi } from '../services/api';
import type { AddedBusiness } from '../services/types';
import { errorMessage } from '../utils/errors';
import { billAddressFor, SHORT_NAME_PATTERN, toShortName } from '../utils/shortName';
import { cleanNui, isNui, NuiInput } from './NuiInput';
import { Button, Field, Sheet } from './ui';

/** 4VD's developer adds a business for a customer, from the account menu. */
export function AddBusinessSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} title={t.addBusiness.title} description={t.addBusiness.description}>
      {open && <AddBusinessForm onClose={onClose} />}
    </Sheet>
  );
}

function AddBusinessForm({ onClose }: { onClose: () => void }) {
  const t = useT();
  const switchTo = useSwitchBusiness();
  const [name, setName] = useState('');
  // Follows the name until it is typed in by hand.
  const [shortName, setShortName] = useState<string | null>(null);
  const [nui, setNui] = useState('');
  const [legalForm, setLegalForm] = useState<'company' | 'individual'>('company');
  const [email, setEmail] = useState('');
  const short = shortName ?? toShortName(name);
  const shortOk = SHORT_NAME_PATTERN.test(short);
  const nuiOk = nui.trim() === '' || isNui(nui);

  const add = useMutation({
    mutationFn: () =>
      businessesApi.add({ name: name.trim(), shortName: short, nui: nui.trim() ? cleanNui(nui) : null, legalForm, mainAdminEmail: email.trim() || null }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    add.mutate();
  }

  if (add.data) return <Added business={add.data} onOpen={() => void switchTo(add.data.id)} onClose={onClose} />;

  return (
    <form onSubmit={submit}>
      <Field label={t.addBusiness.name}>
        <input required maxLength={255} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label={t.addBusiness.shortName} hint={t.addBusiness.shortNameHint(billAddressFor(short))} error={short && !shortOk ? t.addBusiness.shortNameBad : undefined}>
        <input
          required
          maxLength={30}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          value={short}
          aria-invalid={short !== '' && !shortOk}
          onChange={(event) => setShortName(event.target.value.toLowerCase())}
        />
      </Field>
      <div className="field-row">
        <Field label={t.nui.label} hint={t.addBusiness.nuiHint} error={nuiOk ? undefined : t.nui.hint}>
          <NuiInput value={nui} aria-invalid={!nuiOk} onChange={(event) => setNui(event.target.value)} />
        </Field>
        <Field label={t.business.legalForm}>
          <select value={legalForm} onChange={(event) => setLegalForm(event.target.value as 'company' | 'individual')}>
            <option value="company">{t.business.legalForms.company}</option>
            <option value="individual">{t.business.legalForms.individual}</option>
          </select>
        </Field>
      </div>
      <Field label={t.addBusiness.mainAdmin} hint={t.addBusiness.mainAdminHint}>
        <input type="email" autoComplete="off" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} />
      </Field>
      {add.isError && (
        <p className="form-error" role="alert">
          {errorMessage(add.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!name.trim() || !shortOk || !nuiOk || add.isPending} loading={add.isPending}>
          {t.addBusiness.add}
        </Button>
      </div>
    </form>
  );
}

function Added({ business, onOpen, onClose }: { business: AddedBusiness; onOpen: () => void; onClose: () => void }) {
  const t = useT();
  return (
    <div className="added-business" role="status">
      <p className="added-business__title">{t.addBusiness.ready(business.name)}</p>
      <p>{t.addBusiness.billsGoTo}</p>
      <p className="added-business__address" translate="no">
        {business.billAddress}
      </p>
      <p>{business.invited ? t.addBusiness.invited(business.invited) : t.addBusiness.noInvite}</p>
      <div className="form-actions">
        <Button variant="primary" onClick={onOpen}>
          {t.addBusiness.openNow}
        </Button>
        <Button onClick={onClose}>{t.addBusiness.later}</Button>
      </div>
    </div>
  );
}

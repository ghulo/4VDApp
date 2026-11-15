import { ArrowsLeftRight, MapPin, PencilSimple, Plus } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { partnersApi } from '../services/api';
import type { PartnerAddress } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';
import { Button, ButtonLink, Card, Field, RemoveButton, useToast } from './ui';

const asDay = (day: string) => formatDate(`${day}T12:00:00`);

/**
 * A firm that is a customer and a supplier under the same NUI: what each side
 * owes, and an offset (kompensim) that clears the smaller against the larger.
 * Shows nothing when the firm is on one list only.
 */
export function PartnerLinkCard(from: { customerId: number } | { supplierId: number }) {
  const t = useT();
  const { role } = useCurrentUser();
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ['partners', 'link', from] as const;
  const link = useQuery({ queryKey: key, queryFn: () => partnersApi.link(from) });
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const offset = useMutation({
    mutationFn: () => partnersApi.offset(link.data!.customer!.id, { amount: amount.trim() ? Number(amount.replace(',', '.')) : null, note: note.trim() || null }),
    onSuccess: (next) => {
      queryClient.setQueryData(key, next);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['partners', 'link'] });
      setAmount('');
      setNote('');
      toast({ title: t.partner.offsetDone });
    },
  });
  if (!link.data?.customer || !link.data.supplier) return null;
  const data = link.data;
  const other = 'customerId' in from ? { to: `/suppliers/${data.supplier!.id}`, label: t.partner.alsoSupplier } : { to: `/customers/${data.customer!.id}`, label: t.partner.alsoCustomer };
  const typed = amount.trim() ? Number(amount.replace(',', '.')) : data.canOffset;
  const amountOk = Number.isFinite(typed) && typed > 0 && typed <= data.canOffset;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    offset.mutate();
  }

  return (
    <Card
      title={other.label}
      description={t.partner.linkHint}
      actions={
        <ButtonLink size="sm" variant="ghost" to={other.to}>
          {t.partner.openOther}
        </ButtonLink>
      }
    >
      <dl className="partner-sides">
        <div>
          <dt>{t.partner.owesYou}</dt>
          <dd>{formatMoney(data.owesYou)}</dd>
        </div>
        <div>
          <dt>{t.partner.youOwe}</dt>
          <dd>{formatMoney(data.youOwe)}</dd>
        </div>
      </dl>
      {data.canOffset > 0 && canManage(role) && (
        <form className="partner-offset" onSubmit={handleSubmit} aria-label={t.partner.offsetTitle}>
          <p className="field-hint">{t.partner.offsetHint(formatMoney(data.canOffset))}</p>
          <div className="field-row">
            <Field label={t.partner.offsetAmount} hint={t.partner.offsetMax(formatMoney(data.canOffset))}>
              <input
                type="number"
                min={0.01}
                max={data.canOffset}
                step="0.01"
                inputMode="decimal"
                placeholder={data.canOffset.toFixed(2)}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            <Field label={t.partner.offsetNote}>
              <input maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </div>
          {offset.isError && (
            <p className="form-error" role="alert">
              {errorMessage(offset.error)}
            </p>
          )}
          <Button type="submit" variant="primary" icon={ArrowsLeftRight} disabled={!amountOk || offset.isPending} loading={offset.isPending}>
            {t.partner.offsetButton(formatMoney(amountOk ? typed : data.canOffset))}
          </Button>
        </form>
      )}
      {data.offsets.length > 0 && (
        <ul className="partner-offsets" aria-label={t.partner.offsetsLabel}>
          {data.offsets.map((row) => (
            <li key={row.id}>
              <span>{[asDay(row.day), row.by, row.note].filter(Boolean).join(' · ')}</span>
              <span className="partner-figure">{formatMoney(row.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** More addresses for a customer or supplier: a site, a warehouse, a branch. */
export function AddressesCard({ owner }: { owner: { side: 'customers' | 'suppliers'; id: number } }) {
  const t = useT();
  const { role } = useCurrentUser();
  const addresses = useQuery({ queryKey: ['partners', 'addresses', owner], queryFn: () => partnersApi.addresses(owner) });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const list = addresses.data ?? [];

  return (
    <Card
      title={t.partner.addresses}
      description={list.length === 0 ? t.partner.addressesHint : undefined}
      actions={
        !adding && (
          <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>
            {t.partner.addAddress}
          </Button>
        )
      }
    >
      {list.length > 0 && (
        <ul className="partner-addresses">
          {list.map((address) =>
            editing === address.id ? (
              <li key={address.id}>
                <AddressForm owner={owner} address={address} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={address.id}>
                <MapPin size={16} weight="bold" aria-hidden="true" />
                <span>
                  <strong>{address.label}</strong>
                  <span className="table__secondary">{[address.address, address.city, address.note].filter(Boolean).join(' · ')}</span>
                </span>
                {canManage(role) && (
                  <Button size="sm" variant="ghost" icon={PencilSimple} aria-label={t.partner.editAddress(address.label)} onClick={() => setEditing(address.id)} />
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {adding && <AddressForm owner={owner} address={null} onDone={() => setAdding(false)} />}
    </Card>
  );
}

function AddressForm({ owner, address, onDone }: { owner: { side: 'customers' | 'suppliers'; id: number }; address: PartnerAddress | null; onDone: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(address?.label ?? '');
  const [street, setStreet] = useState(address?.address ?? '');
  const [city, setCity] = useState(address?.city ?? '');
  const [note, setNote] = useState(address?.note ?? '');
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['partners', 'addresses'] });
    onDone();
  };
  const save = useMutation({
    mutationFn: () => {
      const input = { label: label.trim(), address: street.trim(), city: city.trim() || null, note: note.trim() || null };
      return address ? partnersApi.updateAddress(address.id, input) : partnersApi.addAddress(owner, input);
    },
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => partnersApi.removeAddress(address!.id), onSuccess: done });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form className="settings-form partner-address-form" onSubmit={handleSubmit} aria-label={address ? t.partner.editAddress(address.label) : t.partner.addAddress}>
      <div className="field-row">
        <Field label={t.partner.addressLabel} hint={t.partner.addressLabelHint}>
          <input required maxLength={60} value={label} onChange={(event) => setLabel(event.target.value)} autoFocus />
        </Field>
        <Field label={t.partner.city}>
          <input maxLength={100} value={city} onChange={(event) => setCity(event.target.value)} />
        </Field>
      </div>
      <Field label={t.partner.address}>
        <input required maxLength={300} value={street} onChange={(event) => setStreet(event.target.value)} />
      </Field>
      <Field label={t.partner.addressNote}>
        <input maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {(save.isError || remove.isError) && (
        <p className="form-error" role="alert">
          {errorMessage(save.error ?? remove.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={label.trim() === '' || street.trim() === '' || save.isPending} loading={save.isPending}>
          {t.partner.saveAddress}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
        {address && (
          <RemoveButton confirm={t.partner.removeAddressConfirm} onConfirm={() => remove.mutate()} pending={remove.isPending}>
            {t.partner.removeAddress}
          </RemoveButton>
        )}
      </div>
    </form>
  );
}

/** A customer's yearly bonus: what each year earned, and Pay out as a credit on their tab. */
export function BonusCard({ customerId }: { customerId: number }) {
  const t = useT();
  const { role } = useCurrentUser();
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ['partners', 'bonus', customerId] as const;
  const bonus = useQuery({ queryKey: key, queryFn: () => partnersApi.bonus(customerId) });
  const pay = useMutation({
    mutationFn: (year: number) => partnersApi.payBonus(customerId, year),
    onSuccess: (next, year) => {
      queryClient.setQueryData(key, next);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast({ title: t.partner.bonusPaidToast(year) });
    },
  });
  const data = bonus.data;
  if (!data || (data.percent === null && data.years.every((year) => !year.paid))) return null;

  return (
    <Card title={t.partner.bonusTitle} description={data.percent !== null ? t.partner.bonusRate(data.percent) : undefined}>
      <ul className="partner-bonus">
        {data.years.map((year) => (
          <li key={year.year}>
            <span>
              <strong>{year.year}</strong>
              <span className="table__secondary">{t.partner.bonusBought(formatMoney(year.bought))}</span>
            </span>
            <span className="partner-figure">{formatMoney(year.earned)}</span>
            {year.paid ? (
              <span className="table__secondary">{t.partner.bonusPaidOn(asDay(year.paid.day))}</span>
            ) : year.canPay && canManage(role) ? (
              <PayOut label={t.partner.bonusConfirm(formatMoney(year.earned), year.year)} pending={pay.isPending && pay.variables === year.year} onYes={() => pay.mutate(year.year)} />
            ) : (
              <span className="table__secondary">{t.partner.bonusNothing}</span>
            )}
          </li>
        ))}
      </ul>
      {pay.isError && (
        <p className="form-error" role="alert">
          {errorMessage(pay.error)}
        </p>
      )}
    </Card>
  );
}

/** Pay out, then a second press to be sure: money leaves the shop's side, so it asks once. */
function PayOut({ label, pending, onYes }: { label: string; pending: boolean; onYes: () => void }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button size="sm" onClick={() => setAsking(true)}>
        {t.partner.bonusPay}
      </Button>
    );
  }
  return (
    <span className="inline-confirm" onKeyDown={(event) => event.key === 'Escape' && setAsking(false)}>
      <Button size="sm" variant="primary" loading={pending} onClick={onYes} autoFocus>
        {label}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
        {t.common.cancel}
      </Button>
    </span>
  );
}

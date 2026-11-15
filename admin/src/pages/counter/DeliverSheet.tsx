import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Segmented } from '../../components/BillLines';
import { Button, DateField, Field, Sheet } from '../../components/ui';
import { useT } from '../../i18n/useT';
import { deliveriesApi, partnersApi } from '../../services/api';
import type { Customer, DeliveryInput } from '../../services/types';
import { todayIso } from '../../utils/bills';
import { formatMoney } from '../../utils/format';
import { parseAmount } from './CounterSheets';

interface DeliverProps {
  total: number;
  customer: Customer | null;
  current: DeliveryInput | null;
  onSave: (delivery: DeliveryInput | null) => void;
}

/**
 * "Deliver it": where and when to take this sale, and whether the money is all
 * paid now or the rest collected at the door. Filled from the customer and the
 * address they last had things brought to.
 */
export function DeliverSheet({ open, onClose, ...form }: DeliverProps & { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} title={t.counter.deliverTitle} description={t.counter.deliverHint} placement="center" wide>
      <DeliverForm key={`${form.customer?.id ?? 0}-${form.current ? 1 : 0}`} {...form} />
    </Sheet>
  );
}

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function DeliverForm({ total, customer, current, onSave }: DeliverProps) {
  const t = useT();
  const last = useQuery({
    queryKey: ['deliveries', 'last-address', customer?.id],
    queryFn: () => deliveriesApi.lastAddress(customer!.id),
    enabled: Boolean(customer) && !current,
  });
  // Their other addresses (a site, a warehouse) as one-press picks.
  const saved = useQuery({
    queryKey: ['partners', 'addresses', { side: 'customers', id: customer?.id }],
    queryFn: () => partnersApi.addresses({ side: 'customers', id: customer!.id }),
    enabled: Boolean(customer),
  });
  const picks = [
    ...(customer?.address ? [{ key: 'main', label: t.counter.deliverMainAddress, address: [customer.address, customer.city].filter(Boolean).join(', ') }] : []),
    ...(saved.data ?? []).map((one) => ({ key: String(one.id), label: one.label, address: [one.address, one.city].filter(Boolean).join(', ') })),
  ];
  const [name, setName] = useState(current?.name ?? customer?.name ?? '');
  const [phone, setPhone] = useState(current?.phone ?? customer?.phone ?? '');
  const [address, setAddress] = useState(current?.address ?? customer?.address ?? '');
  const [day, setDay] = useState(current?.day ?? todayIso());
  const [from, setFrom] = useState(current?.timeFrom ?? '');
  const [to, setTo] = useState(current?.timeTo ?? '');
  const [note, setNote] = useState(current?.note ?? '');
  const [payment, setPayment] = useState<DeliveryInput['payment']>(current?.payment ?? 'shop');
  const [paidNow, setPaidNow] = useState(current?.paidNow ? String(current.paidNow) : '0');
  const [tried, setTried] = useState(false);
  // The address they had things brought to last time fills in once it arrives, unless something was typed.
  const [filled, setFilled] = useState(false);
  if (last.data && !filled) {
    setFilled(true);
    if (!address) setAddress(last.data.address);
    if (!phone && last.data.phone) setPhone(last.data.phone);
  }

  const now = parseAmount(paidNow || '0');
  const errors = {
    name: !name.trim() ? t.counter.deliverNeedName : null,
    address: !address.trim() ? t.counter.deliverNeedAddress : null,
    day: !day || day < todayIso() ? t.counter.deliverNeedDay : null,
    window:
      (from && !TIME.test(from)) || (to && !TIME.test(to)) || (from && to && to <= from) ? t.counter.deliverWindowWrong : null,
    paidNow: payment === 'door' && (!Number.isFinite(now) || now < 0 || now >= total) ? t.counter.deliverPaidNowWrong(formatMoney(total)) : null,
  };
  const wrong = Object.values(errors).some(Boolean);
  const show = (error: string | null) => (tried ? (error ?? undefined) : undefined);

  function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (wrong) return;
    onSave({
      name: name.trim(),
      phone: phone.trim() || null,
      address: address.trim(),
      day,
      timeFrom: from || null,
      timeTo: to || null,
      note: note.trim() || null,
      payment,
      ...(payment === 'door' && { paidNow: Math.round(now * 100) / 100 }),
    });
  }

  return (
    <form className="counter-form counter-deliver" onSubmit={submit} noValidate>
      <div className="field-row">
        <Field label={t.counter.deliverName} error={show(errors.name)}>
          <input name="deliver-name" autoComplete="off" autoFocus={!name} maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t.counter.deliverPhone}>
          <input name="deliver-phone" type="tel" autoComplete="off" inputMode="tel" maxLength={50} value={phone} onChange={(event) => setPhone(event.target.value)} />
        </Field>
      </div>
      <Field label={t.counter.deliverAddress} error={show(errors.address)}>
        <input name="deliver-address" autoComplete="off" autoFocus={Boolean(name) && !address} maxLength={300} value={address} onChange={(event) => setAddress(event.target.value)} />
      </Field>
      {picks.length > 0 && (
        <div className="chip-row" role="group" aria-label={t.counter.deliverSaved}>
          {picks.map((pick) => (
            <button key={pick.key} type="button" className="chip" aria-pressed={address === pick.address} title={pick.address} onClick={() => setAddress(pick.address)}>
              {pick.label}
            </button>
          ))}
        </div>
      )}
      <div className="field-row">
        <Field label={t.counter.deliverDay} error={show(errors.day)}>
          <DateField value={day} min={todayIso()} onChange={(value) => setDay(value ?? '')} />
        </Field>
        <Field label={t.counter.deliverFrom} error={show(errors.window)}>
          <input name="deliver-from" type="time" step={900} value={from} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label={t.counter.deliverTo}>
          <input name="deliver-to" type="time" step={900} value={to} onChange={(event) => setTo(event.target.value)} />
        </Field>
      </div>
      <Field label={t.counter.deliverNote}>
        <input name="deliver-note" autoComplete="off" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <Segmented
        label={t.counter.deliverPayment}
        value={payment}
        onChange={setPayment}
        options={[
          { value: 'shop', label: t.counter.deliverPayShop },
          { value: 'door', label: t.counter.deliverPayDoor },
        ]}
      />
      {payment === 'door' && (
        <Field
          label={t.counter.deliverPaidNow}
          hint={errors.paidNow ? undefined : t.counter.deliverRest(formatMoney(Math.max(0, total - (Number.isFinite(now) ? now : 0))))}
          error={show(errors.paidNow)}
        >
          <input className="counter-number" name="deliver-paid-now" inputMode="decimal" autoComplete="off" value={paidNow} onChange={(event) => setPaidNow(event.target.value)} />
        </Field>
      )}
      <div className="form-actions">
        {current && (
          <Button variant="ghost" onClick={() => onSave(null)}>
            {t.counter.deliverRemove}
          </Button>
        )}
        <Button variant="primary" type="submit">
          {t.counter.deliverSave}
        </Button>
      </div>
    </form>
  );
}

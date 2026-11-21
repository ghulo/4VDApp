import { MapPin, MapPinLine, Phone } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading, SavedToast } from '../components/Feedback';
import { Badge, Button, DateField, EmptyState, Field, PageHeader } from '../components/ui';
import { buttonClass } from '../components/ui/buttonClass';
import { useT } from '../i18n/useT';
import { deliveriesApi, TO_DELIVER_KEY } from '../services/api';
import type { Delivery } from '../services/types';
import { todayIso } from '../utils/bills';
import { errorMessage } from '../utils/errors';
import { formatDate, formatDateTime, formatMoney } from '../utils/format';
import { mapsLink, telLink } from '../utils/whatsapp';


const dayLabel = (day: string) => formatDate(`${day}T12:00:00`);
const parseAmount = (text: string) => Number(text.replace(',', '.'));

/**
 * Sales taken to the customer's door, sorted by when: late ones first, then
 * today, then later days, then what was delivered in the last two days.
 * Phone first: call, open the map, take it, mark it delivered with what was collected.
 */
export function ToDeliverPage() {
  const t = useT();
  const deliveries = useQuery({ queryKey: TO_DELIVER_KEY, queryFn: deliveriesApi.list, refetchInterval: 60_000 });
  const [done, setDone] = useState<string | null>(null);
  const today = todayIso();
  const all = deliveries.data ?? [];
  const open = all.filter((delivery) => delivery.status !== 'delivered');
  const groups: Array<{ key: string; title: string; rows: Delivery[] }> = [
    { key: 'late', title: t.toDeliver.late, rows: open.filter((delivery) => delivery.late) },
    { key: 'today', title: t.toDeliver.today, rows: open.filter((delivery) => !delivery.late && delivery.day === today) },
    { key: 'later', title: t.toDeliver.later, rows: open.filter((delivery) => !delivery.late && delivery.day > today) },
    { key: 'done', title: t.toDeliver.delivered, rows: all.filter((delivery) => delivery.status === 'delivered') },
  ];

  return (
    <>
      <PageHeader title={t.toDeliver.title} description={open.length > 0 ? t.toDeliver.count(open.length) : undefined} />
      <div className="staff-page to-deliver">
        {done && <SavedToast message={done} />}
        {deliveries.isPending && <Loading />}
        {deliveries.isError && <ErrorNotice error={deliveries.error} onRetry={() => deliveries.refetch()} />}
        {deliveries.data && all.length === 0 && (
          <EmptyState icon={MapPinLine} title={t.toDeliver.none}>
            {t.toDeliver.noneHint}
          </EmptyState>
        )}
        {groups
          .filter((group) => group.rows.length > 0)
          .map((group) => (
            <section key={group.key} className="staff-section" aria-labelledby={`deliver-${group.key}`}>
              <h2 id={`deliver-${group.key}`} className="staff-section__title">
                {group.title}
              </h2>
              <ul className="to-deliver__list">
                {group.rows.map((delivery) => (
                  <li key={delivery.id}>
                    <DeliveryCard delivery={delivery} onDone={setDone} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </>
  );
}

function DeliveryCard({ delivery, onDone }: { delivery: Delivery; onDone: (message: string) => void }) {
  const t = useT();
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'none' | 'delivered' | 'missed'>('none');
  const refresh = (updated: Delivery) => {
    queryClient.setQueryData<Delivery[]>(TO_DELIVER_KEY, (rows) => rows?.map((row) => (row.id === updated.id ? updated : row)));
    for (const key of ['customers', 'cash', 'money', 'activity']) void queryClient.invalidateQueries({ queryKey: [key] });
  };
  const take = useMutation({ mutationFn: () => deliveriesApi.take(delivery.id), onSuccess: refresh });
  const mine = delivery.takenBy?.id === me.id;
  const slot = delivery.timeFrom || delivery.timeTo ? [delivery.timeFrom, delivery.timeTo].filter(Boolean).join('–') : null;
  const finished = delivery.status === 'delivered';

  return (
    <article className={['to-deliver__card', delivery.late && 'to-deliver__card--late', finished && 'to-deliver__card--done'].filter(Boolean).join(' ')} aria-label={delivery.name}>
      <header className="to-deliver__head">
        <div>
          <h3 className="to-deliver__name">{delivery.name}</h3>
          <p className="staff-muted">{[dayLabel(delivery.day), slot].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="to-deliver__badges">
          {delivery.late && <Badge tone="danger">{t.toDeliver.lateBadge}</Badge>}
          {delivery.status === 'on_the_way' && <Badge tone="info">{mine ? t.toDeliver.withYou : t.toDeliver.withSomeone(delivery.takenBy?.name ?? '—')}</Badge>}
          {finished && <Badge tone="ok">{t.toDeliver.deliveredBadge}</Badge>}
        </div>
      </header>

      <p className="to-deliver__address">{delivery.address}</p>
      {delivery.lines.length > 0 && (
        <p className="staff-muted">{delivery.lines.map((line) => `${line.quantity} × ${line.productName}`).join(', ')}</p>
      )}
      {delivery.note && <p className="to-deliver__note">{delivery.note}</p>}
      {delivery.lastFailure && !finished && <p className="to-deliver__failure">{t.toDeliver.lastTry(delivery.lastFailure, delivery.failures)}</p>}

      <p className={delivery.toCollect > 0 && !finished ? 'to-deliver__money to-deliver__money--collect' : 'to-deliver__money'}>
        {finished
          ? t.toDeliver.doneLine(delivery.deliveredBy ?? '—', delivery.deliveredAt ? formatDateTime(delivery.deliveredAt) : '', delivery.collected ? formatMoney(delivery.collected) : null)
          : delivery.toCollect > 0
            ? t.toDeliver.collect(formatMoney(delivery.toCollect))
            : t.toDeliver.paid}
        <span className="staff-muted">
          {' · '}
          {delivery.invoice.number}
        </span>
      </p>

      {!finished && (
        <div className="to-deliver__actions">
          {delivery.phone && (
            <a className={buttonClass({ size: 'sm' })} href={telLink(delivery.phone)}>
              <Phone aria-hidden="true" />
              {t.toDeliver.call}
            </a>
          )}
          <a className={buttonClass({ size: 'sm' })} href={mapsLink(delivery.address)} target="_blank" rel="noreferrer">
            <MapPin aria-hidden="true" />
            {t.toDeliver.map}
          </a>
          {!mine && (
            <Button size="sm" onClick={() => take.mutate()} loading={take.isPending} disabled={delivery.status === 'on_the_way'}>
              {t.toDeliver.take}
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => setStep('delivered')} aria-expanded={step === 'delivered'} aria-controls={`deliver-form-${delivery.id}`}>
            {t.toDeliver.markDelivered}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setStep('missed')} aria-expanded={step === 'missed'} aria-controls={`deliver-form-${delivery.id}`}>
            {t.toDeliver.notDelivered}
          </Button>
        </div>
      )}
      {take.isError && (
        <p className="form-error" role="alert">
          {errorMessage(take.error)}
        </p>
      )}
      {step === 'delivered' && !finished && (
        <DeliveredForm
          delivery={delivery}
          onCancel={() => setStep('none')}
          onDone={(updated) => {
            refresh(updated);
            setStep('none');
            onDone(t.toDeliver.doneToast(updated.name));
          }}
        />
      )}
      {step === 'missed' && !finished && (
        <MissedForm
          delivery={delivery}
          onCancel={() => setStep('none')}
          onDone={(updated) => {
            refresh(updated);
            setStep('none');
            onDone(t.toDeliver.backToast(updated.name));
          }}
        />
      )}
    </article>
  );
}

function DeliveredForm({ delivery, onDone, onCancel }: { delivery: Delivery; onDone: (updated: Delivery) => void; onCancel: () => void }) {
  const t = useT();
  const [collected, setCollected] = useState(delivery.toCollect > 0 ? delivery.toCollect.toFixed(2) : '0');
  const amount = parseAmount(collected);
  const wrong = !Number.isFinite(amount) || amount < 0 ? t.toDeliver.amountWrong : amount > delivery.toCollect ? t.toDeliver.amountTooMuch(formatMoney(delivery.toCollect)) : null;
  const save = useMutation({ mutationFn: () => deliveriesApi.delivered(delivery.id, Math.round(amount * 100) / 100), onSuccess: onDone });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!wrong) save.mutate();
  }

  return (
    <form id={`deliver-form-${delivery.id}`} className="to-deliver__form" onSubmit={submit}>
      {delivery.toCollect > 0 && (
        <Field label={t.toDeliver.collected} hint={amount < delivery.toCollect && !wrong ? t.toDeliver.restOnTab(formatMoney(delivery.toCollect - amount)) : t.toDeliver.collectedHint} error={wrong ?? undefined}>
          <input name="collected" inputMode="decimal" autoComplete="off" autoFocus aria-invalid={wrong ? true : undefined} value={collected} onChange={(event) => setCollected(event.target.value)} />
        </Field>
      )}
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button variant="ghost" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending} disabled={Boolean(wrong)}>
          {delivery.toCollect > 0 && !wrong && amount > 0 ? t.toDeliver.saveCollected(formatMoney(amount)) : t.toDeliver.saveDelivered}
        </Button>
      </div>
    </form>
  );
}

function MissedForm({ delivery, onDone, onCancel }: { delivery: Delivery; onDone: (updated: Delivery) => void; onCancel: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [day, setDay] = useState('');
  const [tried, setTried] = useState(false);
  const save = useMutation({ mutationFn: () => deliveriesApi.missed(delivery.id, { reason: reason.trim(), day: day || null }), onSuccess: onDone });

  function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (reason.trim()) save.mutate();
  }

  return (
    <form id={`deliver-form-${delivery.id}`} className="to-deliver__form" onSubmit={submit}>
      <div className="chip-row" role="group" aria-label={t.toDeliver.why}>
        {t.toDeliver.reasons.map((text) => (
          <button key={text} type="button" className="chip" aria-pressed={reason === text} onClick={() => setReason(text)}>
            {text}
          </button>
        ))}
      </div>
      <Field label={t.toDeliver.why} error={tried && !reason.trim() ? t.toDeliver.needWhy : undefined}>
        <input name="reason" autoComplete="off" autoFocus maxLength={300} aria-invalid={tried && !reason.trim() ? true : undefined} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <Field label={t.toDeliver.newDay} hint={t.toDeliver.newDayHint}>
        <DateField value={day} min={todayIso()} onChange={(value) => setDay(value ?? '')} />
      </Field>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button variant="ghost" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {t.toDeliver.saveMissed}
        </Button>
      </div>
    </form>
  );
}

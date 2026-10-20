import { Truck } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ErrorNotice, Loading, SavedToast } from '../../components/Feedback';
import { Button, Card, DateField, EmptyState, PageHeader } from '../../components/ui';
import { useT } from '../../i18n/useT';
import { DELIVERIES_KEY, type Delivery, teamApi } from '../../services/teamApi';
import { errorMessage } from '../../utils/errors';
import { formatDate } from '../../utils/format';

/**
 * Supplier orders on their way, as the counter sees them (no costs): check
 * what came against the order and put it into stock, with expiry dates.
 */
export function DeliveriesPage() {
  const t = useT();
  const deliveries = useQuery({ queryKey: DELIVERIES_KEY, queryFn: teamApi.deliveries });
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const orders = deliveries.data ?? [];
  const order = orders.find((entry) => entry.id === pickedId) ?? orders[0];

  return (
    <>
      <PageHeader title={t.staff.deliveries.title} crumbs={[{ label: t.staff.nav.home, to: '/' }]} />
      <div className="staff-page">
        {done && (
          <SavedToast message={done} />
        )}
        {deliveries.isPending && <Loading />}
        {deliveries.isError && <ErrorNotice error={deliveries.error} onRetry={() => deliveries.refetch()} />}
        {deliveries.data && !order && (
          <EmptyState icon={Truck} title={t.staff.deliveries.none}>
            {t.staff.deliveries.noneDetail}
          </EmptyState>
        )}
        {orders.length > 1 && (
          <div className="chip-row" role="radiogroup" aria-label={t.staff.deliveries.which}>
            {orders.map((entry) => (
              <button key={entry.id} type="button" role="radio" className="chip" aria-checked={entry.id === order?.id} onClick={() => setPickedId(entry.id)}>
                {entry.supplierName}
              </button>
            ))}
          </div>
        )}
        {order && (
          <ReceiveForm
            key={order.id}
            order={order}
            onDone={(message) => {
              setDone(message);
              setPickedId(null);
            }}
          />
        )}
      </div>
    </>
  );
}

function ReceiveForm({ order, onDone }: { order: Delivery; onDone: (message: string) => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [came, setCame] = useState<Record<number, string>>(() => Object.fromEntries(order.lines.map((line) => [line.id, String(line.quantity)])));
  const [expires, setExpires] = useState<Record<number, string>>({});
  const amounts = order.lines.map((line) => Number(came[line.id] ?? ''));
  const valid = amounts.every((amount) => Number.isInteger(amount) && amount >= 0);

  const receive = useMutation({
    mutationFn: () =>
      teamApi.receive(
        order.id,
        order.lines.map((line, index) => ({ lineId: line.id, receivedQuantity: amounts[index]!, expiresOn: expires[line.id] || null })),
      ),
    onSuccess: () => {
      for (const key of ['orders', 'inventory', 'products', 'expiry', 'activity', 'attention']) queryClient.invalidateQueries({ queryKey: [key] });
      onDone(t.staff.deliveries.done(amounts.reduce((sum, amount) => sum + amount, 0), order.supplierName));
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    receive.mutate();
  }

  return (
    <Card title={t.staff.deliveries.from(order.supplierName, formatDate(order.createdAt))} description={t.staff.deliveries.intro}>
      {order.note && <p className="staff-muted">{order.note}</p>}
      <form className="settings-form" onSubmit={submit}>
        {order.lines.map((line) => (
          <fieldset key={line.id} className="staff-receive-line">
            <legend className="staff-row__title">{line.productName}</legend>
            <div className="field-row">
              <label className="field">
                <span className="field__label">{t.staff.deliveries.came}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={came[line.id] ?? ''}
                  onChange={(event) => setCame((current) => ({ ...current, [line.id]: event.target.value }))}
                />
                <span className="field-hint">{t.staff.deliveries.ordered(line.quantity)}</span>
              </label>
              <label className="field">
                <span className="field__label">{t.staff.deliveries.expiresOn}</span>
                <DateField value={expires[line.id] ?? ''} onChange={(value) => setExpires((current) => ({ ...current, [line.id]: value ?? '' }))} />
              </label>
            </div>
          </fieldset>
        ))}
        {receive.isError && (
          <p className="form-error" role="alert">
            {errorMessage(receive.error)}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={!valid} loading={receive.isPending}>
          {t.staff.deliveries.save}
        </Button>
      </form>
    </Card>
  );
}

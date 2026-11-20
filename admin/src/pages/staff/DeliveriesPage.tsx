import { Truck } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '../../auth/useAuth';
import { ErrorNotice, Loading, SavedToast } from '../../components/Feedback';
import { Button, Card, DateField, EmptyState, Field, PageHeader } from '../../components/ui';
import { useT } from '../../i18n/useT';
import { DELIVERIES_KEY, type Delivery, teamApi } from '../../services/teamApi';
import { type DeliveryDraft, keepListed, loadDrafts, parseReceived, saveDrafts } from '../../utils/deliveryDraft';
import { errorMessage } from '../../utils/errors';
import { formatDate, formatQuantity } from '../../utils/format';
import { allowsParts } from '../../utils/units';

/**
 * Supplier orders on their way, as the counter sees them (no costs): check
 * what came against the order and put it into stock, with expiry dates.
 * What is typed for each order is kept while switching between orders and
 * over a reload in this tab, until it goes into stock.
 */
export function DeliveriesPage() {
  const t = useT();
  const { businessId } = useCurrentUser();
  const deliveries = useQuery({ queryKey: DELIVERIES_KEY, queryFn: teamApi.deliveries });
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, DeliveryDraft>>(() => loadDrafts(businessId));
  const orders = deliveries.data ?? [];
  const order = orders.find((entry) => entry.id === pickedId) ?? orders[0];

  // Kept in the tab, without orders put into stock or cancelled elsewhere meanwhile.
  const listed = deliveries.data?.map((entry) => entry.id).join(',');
  useEffect(() => {
    if (listed === undefined) return;
    saveDrafts(businessId, keepListed(drafts, listed === '' ? [] : listed.split(',').map(Number)));
  }, [businessId, drafts, listed]);

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
            draft={drafts[order.id]}
            onDraft={(draft) => setDrafts((current) => ({ ...current, [order.id]: draft }))}
            onDone={(message) => {
              setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => Number(id) !== order.id)));
              setDone(message);
              setPickedId(null);
            }}
          />
        )}
      </div>
    </>
  );
}

function ReceiveForm({
  order,
  draft,
  onDraft,
  onDone,
}: {
  order: Delivery;
  draft: DeliveryDraft | undefined;
  onDraft: (draft: DeliveryDraft) => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const form = useRef<HTMLFormElement>(null);
  // A line not typed in yet starts at what was ordered.
  const came: Record<number, string> = { ...Object.fromEntries(order.lines.map((line) => [line.id, String(line.quantity)])), ...draft?.came };
  const expires = draft?.expires ?? {};
  const readings = order.lines.map((line) => parseReceived(came[line.id] ?? '', line.unit));
  const amounts = readings.map((reading) => (reading.kind === 'number' ? reading.value : null));
  // Problems show once Save was pressed, not while someone is still typing.
  const [tried, setTried] = useState(false);

  const receive = useMutation({
    mutationFn: () =>
      teamApi.receive(
        order.id,
        order.lines.map((line, index) => ({ lineId: line.id, receivedQuantity: amounts[index]!, expiresOn: expires[line.id] || null })),
      ),
    onSuccess: () => {
      for (const key of ['orders', 'inventory', 'products', 'expiry', 'activity', 'attention']) queryClient.invalidateQueries({ queryKey: [key] });
      onDone(t.staff.deliveries.done(amounts.filter((amount) => amount !== null && amount > 0).length, order.supplierName));
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    const wrong = amounts.findIndex((amount) => amount === null);
    if (wrong >= 0) {
      form.current?.querySelectorAll<HTMLInputElement>('input[data-came]')[wrong]?.focus();
      return;
    }
    receive.mutate();
  }

  return (
    <Card title={t.staff.deliveries.from(order.supplierName, formatDate(order.createdAt))} description={t.staff.deliveries.intro}>
      {order.note && <p className="staff-muted">{order.note}</p>}
      <form ref={form} className="settings-form" onSubmit={submit} noValidate>
        {order.lines.map((line, index) => {
          const reading = readings[index]!;
          const parts = allowsParts(line.unit);
          const problem =
            !tried || reading.kind === 'number'
              ? undefined
              : reading.kind === 'blank'
                ? t.staff.deliveries.typeCame
                : parts
                  ? t.staff.deliveries.notAmount
                  : t.staff.deliveries.wholeOnly;
          return (
            <fieldset key={line.id} className="staff-receive-line">
              <legend className="staff-row__title">{line.productName}</legend>
              <div className="field-row">
                <Field label={t.staff.deliveries.came} hint={t.staff.deliveries.ordered(formatQuantity(line.quantity, line.unit ?? 'piece'))} error={problem}>
                  <input
                    type="text"
                    inputMode={parts ? 'decimal' : 'numeric'}
                    autoComplete="off"
                    data-came=""
                    value={came[line.id] ?? ''}
                    onChange={(event) => onDraft({ came: { ...draft?.came, [line.id]: event.target.value }, expires })}
                  />
                </Field>
                <label className="field">
                  <span className="field__label">{t.staff.deliveries.expiresOn}</span>
                  <DateField value={expires[line.id] ?? ''} onChange={(value) => onDraft({ came: draft?.came ?? {}, expires: { ...expires, [line.id]: value ?? '' } })} />
                </label>
              </div>
            </fieldset>
          );
        })}
        {receive.isError && (
          <p className="form-error" role="alert">
            {errorMessage(receive.error)}
          </p>
        )}
        <Button type="submit" variant="primary" loading={receive.isPending}>
          {t.staff.deliveries.save}
        </Button>
      </form>
    </Card>
  );
}

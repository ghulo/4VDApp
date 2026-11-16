import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { canOversee } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading } from '../components/Feedback';
import { SerialEntry } from '../components/SerialEntry';
import { Badge, Button, Card, DataTable, EmptyState, Field, useToast } from '../components/ui';
import { useT } from '../i18n/useT';
import { serialsApi } from '../services/api';
import type { Serial } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateWith } from '../utils/format';

/** "4 Oct 2026" for a "2026-10-04" day, without any time zone moving it. */
export const formatSerialDay = (day: string) => formatDateWith(new Date(`${day.slice(0, 10)}T00:00:00Z`), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Where a serial came from: its bill, its stock-in, or typed at the sale. */
export function SerialOrigin({ serial }: { serial: Serial }) {
  const t = useT();
  if (serial.bill) return <Link to={`/bills/${serial.bill.id}`}>{t.serials.fromBill(serial.bill.supplier ?? t.serials.noSupplier)}</Link>;
  if (serial.stockDocument) return <Link to={`/stock-documents/${serial.stockDocument.id}`}>{serial.stockDocument.number}</Link>;
  if (!serial.cameOn) return <span className="table__secondary">{t.serials.typedAtSale}</span>;
  return <>{formatSerialDay(serial.cameOn)}</>;
}

/** In stock, Sold (with the warranty), or Returned. */
export function SerialStatus({ serial }: { serial: Serial }) {
  const t = useT();
  if (serial.status === 'in_stock') return <Badge tone={serial.returnedAt ? 'info' : 'ok'}>{serial.returnedAt ? t.serials.returned : t.serials.inStock}</Badge>;
  return <Badge tone="neutral">{t.serials.sold}</Badge>;
}

/** Until when, and whether it still runs. */
export function SerialWarranty({ serial }: { serial: Serial }) {
  const t = useT();
  if (!serial.warrantyEnds) return <>–</>;
  return (
    <>
      {formatSerialDay(serial.warrantyEnds)}
      <span className="table__secondary">{serial.underWarranty ? t.serials.underWarranty : t.serials.ended}</span>
    </>
  );
}

/** Serial numbers: whether this product has them, its warranty, and the list with where each one went. */
export function ProductSerialsTab() {
  const productId = Number(useParams().id);
  const products = useQuery({ queryKey: ['serials', 'products'], queryFn: serialsApi.products });
  if (products.isPending) return <Loading />;
  if (products.isError) return <ErrorNotice error={products.error} onRetry={() => products.refetch()} />;
  const mine = products.data.find((product) => product.productId === productId) ?? null;
  return (
    <>
      <SerialSettings key={mine ? `${mine.warrantyMonths}` : 'off'} productId={productId} has={mine !== null} warrantyMonths={mine?.warrantyMonths ?? null} />
      {mine && <SerialList productId={productId} name={mine.name} />}
    </>
  );
}

function SerialSettings({ productId, has, warrantyMonths }: { productId: number; has: boolean; warrantyMonths: number | null }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();
  const editable = canOversee(role);
  const [on, setOn] = useState(has);
  const [months, setMonths] = useState(warrantyMonths ? String(warrantyMonths) : '');
  const monthsNumber = months === '' ? null : Number(months);
  const monthsError = monthsNumber !== null && !(Number.isInteger(monthsNumber) && monthsNumber >= 0 && monthsNumber <= 120) ? t.serials.warrantyHint : undefined;
  const changed = on !== has || (on && monthsNumber !== warrantyMonths);

  const save = useMutation({
    mutationFn: () => serialsApi.setProduct(productId, { hasSerials: on, warrantyMonths: on ? monthsNumber || null : null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serials'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      toast({ title: t.serials.productSaved });
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (changed && !monthsError) save.mutate();
  }

  return (
    <Card title={t.serials.productTitle}>
      <form className="settings-form" onSubmit={handleSubmit}>
        <label className="toggle">
          <input type="checkbox" checked={on} disabled={!editable} onChange={(event) => setOn(event.target.checked)} />
          <span>
            {t.serials.has}
            <span className="field-hint">{t.serials.hasHint}</span>
          </span>
        </label>
        {on && (
          <Field label={t.serials.warrantyMonths} hint={monthsError ? undefined : t.serials.warrantyHint} error={monthsError} narrow>
            <input type="number" inputMode="numeric" min={0} max={120} step={1} disabled={!editable} value={months} onChange={(event) => setMonths(event.target.value)} />
          </Field>
        )}
        {save.isError && (
          <p className="form-error" role="alert">
            {errorMessage(save.error)}
          </p>
        )}
        {editable && (
          <div className="form-actions">
            <Button type="submit" variant="primary" disabled={!changed || Boolean(monthsError) || save.isPending} loading={save.isPending}>
              {t.serials.saveProduct}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function SerialList({ productId, name }: { productId: number; name: string }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();
  const serials = useQuery({ queryKey: ['serials', 'product', productId], queryFn: () => serialsApi.forProduct(productId) });
  const remove = useMutation({
    mutationFn: (id: number) => serialsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serials'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
    onError: (error) => toast({ title: errorMessage(error), tone: 'danger' }),
  });

  return (
    <Card title={t.serials.add} description={t.serials.addHint}>
      <SerialEntry productId={productId} />
      {serials.isPending && <Loading />}
      {serials.isError && <ErrorNotice error={serials.error} onRetry={() => serials.refetch()} />}
      {serials.data && (
        <DataTable
          caption={t.serials.listCaption(name)}
          rows={serials.data}
          rowKey={(row) => row.id}
          empty={<EmptyState title={t.serials.noSerials}>{t.serials.noSerialsHint}</EmptyState>}
          columns={[
            { header: t.serials.serial, title: true, cell: (row) => <span className="serial-code">{row.serial}</span> },
            { header: t.serials.status, cell: (row) => <SerialStatus serial={row} /> },
            { header: t.serials.came, cell: (row) => <SerialOrigin serial={row} />, className: 'table__phone-hide' },
            {
              header: t.serials.soldOn,
              cell: (row) =>
                row.invoice ? (
                  <>
                    <Link to={`/documents/${row.invoice.id}`}>{row.invoice.number}</Link>
                    {row.customer && <span className="table__secondary">{row.customer.name}</span>}
                  </>
                ) : (
                  '–'
                ),
            },
            { header: t.serials.warranty, cell: (row) => <SerialWarranty serial={row} />, className: 'table__phone-hide' },
            {
              header: <span className="visually-hidden">{t.serials.actions}</span>,
              align: 'end',
              cell: (row) =>
                canOversee(role) && row.status === 'in_stock' && !row.soldAt ? (
                  <Button size="sm" variant="danger-text" aria-label={t.serials.removeLabel(row.serial)} disabled={remove.isPending} onClick={() => remove.mutate(row.id)}>
                    {t.serials.removeShort}
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
    </Card>
  );
}

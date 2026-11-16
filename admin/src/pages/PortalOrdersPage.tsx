import { Check, X } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Badge, Button, ButtonLink, Card, DataTable, EmptyState, Field, PageHeader, Sheet, type Tone, useToast } from '../components/ui';
import { useT } from '../i18n/useT';
import { portalAdminApi, type ShopPortalOrder, type ShopPortalOrderStatus } from '../services/portalAdminApi';
import type { ProductUnit } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateTime, formatMoney, formatQuantity } from '../utils/format';

const TONE: Record<ShopPortalOrderStatus, Tone> = { sent: 'warn', seen: 'info', accepted: 'ok', declined: 'danger', cancelled: 'neutral' };

/**
 * Step 15: orders business customers sent from the portal. Opening one marks
 * it seen (the customer sees that); accepting makes an offer at the prices
 * they saw, which is then sold or delivered the usual way.
 */
export function PortalOrdersPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const openId = Number(params.get('open')) || null;
  const orders = useQuery({ queryKey: ['portal-orders'], queryFn: () => portalAdminApi.orders() });
  const open = (id: number | null) => setParams(id ? { open: String(id) } : {}, { replace: true });

  return (
    <>
      <PageHeader title={t.portalOrders.title} description={t.portalOrders.description} />
      {orders.isPending ? (
        <Loading />
      ) : orders.isError ? (
        <ErrorNotice error={orders.error} onRetry={() => orders.refetch()} />
      ) : (
        <Card flush>
          <DataTable<ShopPortalOrder>
            caption={t.portalOrders.caption}
            rows={orders.data}
            rowKey={(row) => row.id}
            onRowClick={(row) => open(row.id)}
            empty={<EmptyState title={t.portalOrders.empty}>{t.portalOrders.emptyHint}</EmptyState>}
            columns={[
              {
                header: t.portalOrders.customer,
                title: true,
                cell: (row) => (
                  <button type="button" className="link-button" onClick={() => open(row.id)}>
                    {t.portalOrders.number(row.id)} · {row.customer.name}
                  </button>
                ),
              },
              { header: t.portalOrders.sentAt, cell: (row) => formatDateTime(row.at) },
              { header: t.portalOrders.lines, align: 'end', cell: (row) => row.lineCount },
              { header: t.portalOrders.total, align: 'end', cell: (row) => formatMoney(row.total) },
              { header: t.portalOrders.state, cell: (row) => <Badge tone={TONE[row.status]}>{t.portalOrders.status[row.status]}</Badge> },
            ]}
          />
        </Card>
      )}
      <Sheet open={openId !== null} onClose={() => open(null)} title={openId ? t.portalOrders.number(openId) : ''} wide>
        {openId !== null && <OrderSheet id={openId} />}
      </Sheet>
    </>
  );
}

function OrderSheet({ id }: { id: number }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const order = useQuery({ queryKey: ['portal-orders', id], queryFn: () => portalAdminApi.order(id) });
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['portal-orders'] });
    queryClient.invalidateQueries({ queryKey: ['attention'] });
  };
  const accept = useMutation({
    mutationFn: () => portalAdminApi.accept(id),
    onSuccess: (result) => {
      queryClient.setQueryData(['portal-orders', id], result.order);
      refresh();
      toast({ title: t.portalOrders.accepted(result.offer.number), tone: 'ok' });
    },
  });
  const decline = useMutation({
    mutationFn: () => portalAdminApi.decline(id, reason.trim() || null),
    onSuccess: (fresh) => {
      queryClient.setQueryData(['portal-orders', id], fresh);
      setDeclining(false);
      refresh();
      toast({ title: t.portalOrders.declined });
    },
  });

  if (order.isPending) return <Loading />;
  if (order.isError) return <ErrorNotice error={order.error} onRetry={() => order.refetch()} />;
  const data = order.data;
  const answerable = data.status === 'sent' || data.status === 'seen';

  return (
    <div className="form-stack">
      <p>
        <Link to={`/customers/${data.customer.id}`}>{data.customer.name}</Link> · {formatDateTime(data.at)}
        {data.by && ` · ${t.portalOrders.by(data.by)}`} · <Badge tone={TONE[data.status]}>{t.portalOrders.status[data.status]}</Badge>
      </p>
      {data.note && (
        <p className="notice notice--info">
          <strong>{t.portalOrders.note}:</strong> {data.note}
        </p>
      )}
      <ul className="portal-basket__lines">
        {data.lines.map((line) => (
          <li key={line.productId} className="portal-basket__line">
            <span className="portal-basket__name">
              <Link to={`/products/${line.productId}`}>{line.name}</Link>
              {!line.inStock && <Badge tone="warn">{t.portalOrders.outOfStock}</Badge>}
            </span>
            <span className="portal-muted">
              {formatQuantity(line.quantity, line.unit as ProductUnit)} × {formatMoney(line.unitPrice)}
            </span>
            <span className="portal-basket__total">{formatMoney(line.total)}</span>
          </li>
        ))}
      </ul>
      <dl className="portal-totals">
        <div className="portal-totals__grand">
          <dt>{t.portalOrders.total}</dt>
          <dd>{formatMoney(data.total)}</dd>
        </div>
      </dl>
      {data.offerId && (
        <ButtonLink to={`/offers/${data.offerId}`} variant="primary">
          {t.portalOrders.openOffer}
        </ButtonLink>
      )}
      {answerable && !declining && (
        <div className="portal-admin__people-actions">
          <Button variant="primary" icon={Check} onClick={() => accept.mutate()} loading={accept.isPending}>
            {t.portalOrders.accept}
          </Button>
          <Button icon={X} onClick={() => setDeclining(true)}>
            {t.portalOrders.decline}
          </Button>
        </div>
      )}
      {answerable && declining && (
        <>
          <Field label={t.portalOrders.declineReason}>
            <textarea rows={2} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <div className="portal-admin__people-actions">
            <Button variant="danger" onClick={() => decline.mutate()} loading={decline.isPending}>
              {t.portalOrders.declineConfirm}
            </Button>
            <Button variant="ghost" onClick={() => setDeclining(false)}>
              {t.portalShop.cancel}
            </Button>
          </div>
        </>
      )}
      {(accept.isError || decline.isError) && (
        <p className="notice notice--error" role="alert">
          {errorMessage(accept.error ?? decline.error)}
        </p>
      )}
    </div>
  );
}

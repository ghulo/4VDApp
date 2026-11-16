import { Check, PencilSimple, Plus, Trash, WhatsappLogo, X } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { SearchInput } from '../components/SearchInput';
import { Badge, Button, ButtonLink, buttonClass, Card, DataTable, EmptyState, Field, PageHeader, Sheet, type Tone, useToast } from '../components/ui';
import { useT } from '../i18n/useT';
import { productsApi } from '../services/api';
import { portalAdminApi, type ShopPortalOrder, type ShopPortalOrderDetail, type ShopPortalOrderStatus } from '../services/portalAdminApi';
import { OrderChangeList } from './portal/OrderChange';
import { whatsappLink } from '../utils/whatsapp';
import { errorMessage } from '../utils/errors';
import { formatDateTime, formatMoney } from '../utils/format';

const TONE: Record<ShopPortalOrderStatus, Tone> = { sent: 'warn', seen: 'info', changed: 'warn', accepted: 'ok', declined: 'danger', cancelled: 'neutral' };

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
  const [changing, setChanging] = useState(false);
  const [justChanged, setJustChanged] = useState(false);
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
  const changeable = answerable || data.status === 'changed';

  if (changing) {
    return (
      <ChangeOrder
        order={data}
        onDone={(fresh) => {
          queryClient.setQueryData(['portal-orders', id], fresh);
          refresh();
          setChanging(false);
          setJustChanged(true);
          toast({ title: t.portalOrders.changeSent, tone: 'ok' });
        }}
        onCancel={() => setChanging(false)}
      />
    );
  }

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
      {data.change && (data.status === 'changed' || data.change.agreed) && (
        <p className={`notice ${data.status === 'changed' ? 'notice--warn' : 'notice--ok'}`}>
          {data.status === 'changed' ? t.portalOrders.waiting(data.change.reason) : t.portalOrders.agreedNote(data.change.reason)}
        </p>
      )}
      {data.status === 'changed' && <TellOnWhatsApp order={data} highlight={justChanged} />}
      <OrderChangeList lines={data.lines} previous={data.status === 'changed' ? (data.change?.previous ?? null) : null} />
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
      {changeable && !declining && (
        <div className="portal-admin__people-actions">
          {answerable && (
            <Button variant="primary" icon={Check} onClick={() => accept.mutate()} loading={accept.isPending}>
              {t.portalOrders.accept}
            </Button>
          )}
          <Button icon={PencilSimple} onClick={() => setChanging(true)}>
            {t.portalOrders.change}
          </Button>
          <Button icon={X} onClick={() => setDeclining(true)}>
            {t.portalOrders.decline}
          </Button>
        </div>
      )}
      {changeable && declining && (
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

/** WhatsApp buttons for the firm's people with a phone, with the change written out and the link to it. */
function TellOnWhatsApp({ order, highlight }: { order: ShopPortalOrderDetail; highlight: boolean }) {
  const t = useT();
  const people = useQuery({ queryKey: ['portal-admin', order.customer.id], queryFn: () => portalAdminApi.settings(order.customer.id) });
  const link = `${window.location.origin}/portal/orders/${order.id}`;
  const text = t.portalOrders.whatsapp({ id: order.id, reason: order.change?.reason ?? '', link });
  const reachable = (people.data?.people ?? []).flatMap((person) => {
    const chat = person.phone ? whatsappLink(person.phone, text) : null;
    return chat ? [{ id: person.id, name: person.name, chat }] : [];
  });
  if (reachable.length === 0) return null;
  return (
    <div className="portal-admin__people-actions">
      {reachable.map((person) => (
        <a key={person.id} href={person.chat} target="_blank" rel="noreferrer" className={buttonClass({ variant: highlight ? 'primary' : 'secondary', size: 'sm' })}>
          <WhatsappLogo aria-hidden="true" />
          {t.portalOrders.tell(person.name)}
        </a>
      ))}
    </div>
  );
}

/**
 * The shop's change: other quantities, lines taken out, products added. The
 * server prices it at the customer's own level; the reason goes to them.
 */
function ChangeOrder({ order, onDone, onCancel }: { order: ShopPortalOrderDetail; onDone: (fresh: ShopPortalOrderDetail) => void; onCancel: () => void }) {
  const t = useT();
  const [lines, setLines] = useState(() => order.lines.map((line) => ({ productId: line.productId, name: line.name, unit: line.unit, quantity: String(line.quantity) })));
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim());
  const found = useQuery({ queryKey: ['products', 'portal-change', query], queryFn: () => productsApi.list({ page: 1, limit: 8, search: query }), enabled: query.length > 1 });
  const parsed = lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity.replace(',', '.')) }));
  const invalid = parsed.some((line) => !(line.quantity > 0));
  const save = useMutation({ mutationFn: () => portalAdminApi.change(order.id, { lines: parsed, reason: reason.trim() }), onSuccess: onDone });
  const set = (productId: number, quantity: string) => setLines((current) => current.map((line) => (line.productId === productId ? { ...line, quantity } : line)));

  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h3 className="portal-admin__subtitle">{t.portalOrders.changeTitle(order.id)}</h3>
      <p className="field-hint">{t.portalOrders.changeHint}</p>
      <ul className="portal-change-edit">
        {lines.map((line) => (
          <li key={line.productId} className="portal-change-edit__line">
            <span className="portal-basket__name">{line.name}</span>
            <input
              className="portal-stepper__input"
              inputMode={line.unit === 'piece' ? 'numeric' : 'decimal'}
              autoComplete="off"
              aria-label={t.portalOrders.quantity(line.name)}
              aria-invalid={!(Number(line.quantity.replace(',', '.')) > 0) || undefined}
              value={line.quantity}
              onChange={(event) => set(line.productId, event.target.value)}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={Trash}
              aria-label={t.portalOrders.removeLine(line.name)}
              onClick={() => setLines((current) => current.filter((other) => other.productId !== line.productId))}
            />
          </li>
        ))}
      </ul>
      {lines.length === 0 && <p className="notice notice--info">{t.portalOrders.keepOne}</p>}
      <SearchInput value={search} onChange={setSearch} label={t.portalOrders.addProduct} />
      {query.length > 1 && found.data && (
        found.data.items.length === 0 ? (
          <p className="portal-muted">{t.portalOrders.noMatches}</p>
        ) : (
          <ul className="portal-change-edit">
            {found.data.items
              .filter((product) => !lines.some((line) => line.productId === product.id))
              .map((product) => (
                <li key={product.id} className="portal-change-edit__line">
                  <span className="portal-basket__name">{product.name}</span>
                  <span className="portal-muted">{formatMoney(product.price)}</span>
                  <Button
                    size="sm"
                    icon={Plus}
                    aria-label={t.portalOrders.add(product.name)}
                    onClick={() => {
                      setLines((current) => [...current, { productId: product.id, name: product.name, unit: product.unit, quantity: '1' }]);
                      setSearch('');
                    }}
                  />
                </li>
              ))}
          </ul>
        )
      )}
      <Field label={t.portalOrders.changeReason}>
        <textarea rows={2} maxLength={300} required value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {save.isError && (
        <p className="notice notice--error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="portal-admin__people-actions">
        <Button type="submit" variant="primary" loading={save.isPending} disabled={lines.length === 0 || invalid || reason.trim() === ''}>
          {t.portalOrders.changeSend}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t.portalShop.cancel}
        </Button>
      </div>
    </form>
  );
}

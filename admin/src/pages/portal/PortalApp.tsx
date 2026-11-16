import { ArrowCounterClockwise, Basket as BasketIcon, DownloadSimple, FilePdf, Minus, Package, Plus, Printer, Receipt, SignOut, Storefront, Trash, Wallet } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, Suspense, useDeferredValue, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { Loading } from '../../components/Feedback';
import { LogoMark } from '../../components/LogoMark';
import { ProductPhoto } from '../../components/ProductPhoto';
import { SearchInput } from '../../components/SearchInput';
import { MAIN_ID, SkipLink, useFocusOnRouteChange } from '../../components/SkipLink';
import { Badge, Button, ButtonLink, Card, EmptyState, Field, PageHeader, useToast } from '../../components/ui';
import { useLanguage, useT } from '../../i18n/useT';
import { ApiError } from '../../services/apiClient';
import { type PortalProduct, portalApi } from '../../services/portalApi';
import type { ProductUnit } from '../../services/types';
import { ThemeSwitch } from '../../theme/ThemeSwitch';
import { formatDate, formatMoney, formatQuantity } from '../../utils/format';
import { BasketProvider, OrderStateBadge, PortalLanguagePick, PortalPrice, useBasket, usePortalMe, useQuote } from './PortalParts';

const TABS = [
  { to: '/portal/order', key: 'order', icon: Storefront },
  { to: '/portal/orders', key: 'orders', icon: Package },
  { to: '/portal/invoices', key: 'invoices', icon: Receipt },
  { to: '/portal/account', key: 'account', icon: Wallet },
] as const;

const day = (iso: string) => formatDate(`${iso}T12:00:00`);
const partsAllowed = (unit: ProductUnit) => unit !== 'piece';

function portalError(error: unknown, t: ReturnType<typeof useT>): string {
  if (error instanceof ApiError && error.code === 'NETWORK') return t.portal.errors.offline;
  return t.portal.errors.generic;
}

/** The customer's frame: their firm's name on top, four tabs (along the bottom on a phone). */
export function PortalLayout() {
  const t = useT();
  const me = usePortalMe();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setLanguage, language } = useLanguage();
  useFocusOnRouteChange();
  const { count } = useBasket();

  // Their saved language wins the first time this phone opens the portal.
  const saved = me.data?.person.language;
  useEffect(() => {
    if (saved && saved !== language && !sessionStorage.getItem('4vd.portal.languageSet')) {
      sessionStorage.setItem('4vd.portal.languageSet', '1');
      setLanguage(saved);
    }
  }, [saved, language, setLanguage]);

  if (me.isPending) return <Loading />;
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/portal" replace />;
    return (
      <main className="portal-auth">
        <p className="notice notice--error" role="alert">
          {portalError(me.error, t)}
        </p>
      </main>
    );
  }

  async function signOut() {
    await portalApi.signOut().catch(() => undefined);
    queryClient.removeQueries({ queryKey: ['portal'] });
    navigate('/portal', { replace: true });
  }

  const tabs = (
    <nav className="staff-tabs" aria-label={t.portal.tabBar}>
      {TABS.map((tab) => {
        const TabIcon = tab.icon;
        const active = location.pathname.startsWith(tab.to);
        return (
          <Link key={tab.to} to={tab.to} className={active ? 'staff-tabs__tab active' : 'staff-tabs__tab'} aria-current={active ? 'page' : undefined}>
            <TabIcon size={22} weight={active ? 'fill' : 'regular'} aria-hidden="true" />
            <span>
              {t.portal.nav[tab.key]}
              {tab.key === 'order' && count > 0 && <span className="portal-count"> {count}</span>}
            </span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="staff-app portal-app">
      <SkipLink />
      <header className="topbar staff-app__top">
        <Link to="/portal/order" className="topbar__brand portal-app__brand" aria-label={me.data.shop.name}>
          <LogoMark size={32} />
          <span className="portal-app__who">
            <span className="portal-app__firm">{me.data.customer.name}</span>
            <span className="portal-app__shop">{me.data.shop.name}</span>
          </span>
        </Link>
        <div className="staff-app__wide-tabs">{tabs}</div>
        <div className="topbar__end">
          <PortalLanguagePick signedIn />
          <ThemeSwitch persist compact />
          <Button variant="ghost" icon={SignOut} onClick={signOut} aria-label={t.portal.signOut} title={t.portal.signOut} />
        </div>
      </header>
      <main className="main staff-app__main" id={MAIN_ID} tabIndex={-1}>
        <div className="main__frame">
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
      <div className="staff-app__bottom-tabs">{tabs}</div>
    </div>
  );
}

/** Wraps the signed-in pages so the basket survives moving between tabs. */
export function PortalShell() {
  return (
    <BasketProvider>
      <PortalLayout />
    </BasketProvider>
  );
}

// ——— Order ———

function QuantityStepper({ product, quantity }: { product: Pick<PortalProduct, 'id' | 'name' | 'unit'>; quantity: number }) {
  const t = useT();
  const { set } = useBasket();
  const step = partsAllowed(product.unit) ? 0.5 : 1;
  const [draft, setDraft] = useState(String(quantity));
  // The basket changed from elsewhere (the − / + buttons): show the new number.
  const [shown, setShown] = useState(quantity);
  if (shown !== quantity) {
    setShown(quantity);
    setDraft(String(quantity));
  }
  function commit(value: string) {
    const parsed = Number(value.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) return setDraft(String(quantity));
    set(product.id, partsAllowed(product.unit) ? parsed : Math.round(parsed));
  }
  return (
    <div className="portal-stepper">
      <Button size="sm" icon={quantity <= step ? Trash : Minus} aria-label={quantity <= step ? t.portal.order.remove(product.name) : t.portal.order.less(product.name)} onClick={() => set(product.id, Math.max(0, quantity - step))} />
      <input
        className="portal-stepper__input"
        autoComplete="off"
        inputMode={partsAllowed(product.unit) ? 'decimal' : 'numeric'}
        aria-label={t.portal.order.quantity(product.name)}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit((event.target as HTMLInputElement).value);
        }}
      />
      <Button size="sm" icon={Plus} aria-label={t.portal.order.more(product.name)} onClick={() => set(product.id, quantity + step)} />
    </div>
  );
}

export function PortalOrderPage() {
  const t = useT();
  const me = usePortalMe();
  const { basket, set } = useBasket();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const deferred = useDeferredValue(search.trim());
  const products = useQuery({
    queryKey: ['portal', 'products', deferred, categoryId],
    queryFn: () => portalApi.products({ search: deferred || undefined, categoryId }),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader title={t.portal.order.title} description={me.data && !me.data.canOrder ? t.portal.order.orderingOff : undefined} />
      <BasketCard />
      <div className="portal-filters">
        <SearchInput value={search} onChange={setSearch} label={t.portal.order.search} />
        {products.data && products.data.categories.length > 1 && (
          <div className="portal-chips" role="radiogroup" aria-label={t.portal.order.categories}>
            {[{ id: undefined as number | undefined, name: t.portal.order.allCategories }, ...products.data.categories].map((category) => (
              <button key={category.id ?? 'all'} type="button" role="radio" aria-checked={categoryId === category.id} className="portal-chip" onClick={() => setCategoryId(category.id)}>
                {category.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {products.isPending ? (
        <Loading />
      ) : products.isError ? (
        <p className="notice notice--error" role="alert">
          {portalError(products.error, t)}
        </p>
      ) : products.data.products.length === 0 ? (
        <EmptyState title={t.portal.order.empty}>{t.portal.order.emptyHint}</EmptyState>
      ) : (
        <ul className="portal-products" aria-busy={products.isFetching || undefined}>
          {products.data.products.map((product) => {
            const quantity = basket[product.id] ?? 0;
            return (
              <li key={product.id} className="portal-product">
                <ProductPhoto src={product.imageUrl} />
                <div className="portal-product__main">
                  <span className="portal-product__name">{product.name}</span>
                  <span className={product.inStock ? 'portal-product__stock' : 'portal-product__stock portal-product__stock--out'}>{product.inStock ? t.portal.order.inStock : t.portal.order.outOfStock}</span>
                </div>
                <PortalPrice gross={product.price} net={product.net} />
                {me.data?.canOrder !== false &&
                  (quantity > 0 ? (
                    <QuantityStepper product={product} quantity={quantity} />
                  ) : (
                    <Button size="sm" icon={Plus} aria-label={t.portal.order.add(product.name)} onClick={() => set(product.id, 1)} />
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function BasketCard() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = usePortalMe();
  const { count, clear } = useBasket();
  const quote = useQuote();
  const [note, setNote] = useState('');
  const send = useMutation({
    mutationFn: () => portalApi.send({ lines: (quote.data?.lines ?? []).map((line) => ({ productId: line.productId, quantity: line.quantity })), note: note.trim() || null }),
    onSuccess: (order) => {
      clear();
      setNote('');
      toast({ title: t.portal.order.sent, tone: 'ok' });
      queryClient.invalidateQueries({ queryKey: ['portal', 'orders'] });
      navigate(`/portal/orders/${order.id}`);
    },
  });

  if (count === 0 || me.data?.canOrder === false) return null;
  const data = quote.data;
  const minOrder = me.data?.minOrder ?? null;
  const short = data && minOrder !== null && data.total < minOrder ? minOrder - data.total : 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    send.mutate();
  }

  return (
    <Card title={`${t.portal.order.basket} · ${t.portal.order.basketCount(count)}`} actions={<Button variant="ghost" size="sm" onClick={clear}>{t.portal.order.clear}</Button>} className="portal-basket">
      {quote.isPending ? (
        <Loading label={t.portal.order.pricing} />
      ) : quote.isError ? (
        <p className="notice notice--error" role="alert">
          {portalError(quote.error, t)}
        </p>
      ) : data ? (
        <form onSubmit={submit} className="portal-basket__form">
          <ul className="portal-basket__lines">
            {data.lines.map((line) => (
              <li key={line.productId} className="portal-basket__line">
                <span className="portal-basket__name">
                  {line.name}
                  {!line.inStock && <Badge tone="warn">{t.portal.order.outOfStock}</Badge>}
                </span>
                <QuantityStepper product={{ id: line.productId, name: line.name, unit: line.unit }} quantity={line.quantity} />
                <span className="portal-basket__total">{formatMoney(line.total)}</span>
              </li>
            ))}
          </ul>
          {data.missing.length > 0 && <p className="notice notice--warn">{t.portal.order.gone(data.missing.length)}</p>}
          <dl className="portal-totals">
            <div>
              <dt>{t.portal.net}</dt>
              <dd>{formatMoney(data.net)}</dd>
            </div>
            <div>
              <dt>{t.portal.vat}</dt>
              <dd>{formatMoney(data.vat)}</dd>
            </div>
            <div className="portal-totals__grand">
              <dt>{t.portal.total}</dt>
              <dd>{formatMoney(data.total)}</dd>
            </div>
          </dl>
          {data.lines.some((line) => !line.inStock) && <p className="portal-muted">{t.portal.order.outNote}</p>}
          <Field label={t.portal.order.note}>
            <textarea rows={2} maxLength={500} value={note} placeholder={t.portal.order.notePlaceholder} onChange={(event) => setNote(event.target.value)} />
          </Field>
          {short > 0 && <p className="notice notice--info">{t.portal.order.belowMin(formatMoney(short))}</p>}
          {send.isError && (
            <p className="notice notice--error" role="alert">
              {send.error instanceof ApiError && send.error.status === 400 && minOrder !== null ? t.portal.order.minOrder(formatMoney(minOrder)) : portalError(send.error, t)}
            </p>
          )}
          <Button type="submit" variant="primary" wide loading={send.isPending} disabled={short > 0 || data.lines.length === 0 || quote.isFetching}>
            {t.portal.order.send} · {formatMoney(data.total)}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

// ——— Orders ———

export function PortalOrdersPage() {
  const t = useT();
  const orders = useQuery({ queryKey: ['portal', 'orders'], queryFn: portalApi.orders });
  return (
    <>
      <PageHeader title={t.portal.orders.title} />
      {orders.isPending ? (
        <Loading />
      ) : orders.isError ? (
        <p className="notice notice--error" role="alert">
          {portalError(orders.error, t)}
        </p>
      ) : orders.data.length === 0 ? (
        <EmptyState title={t.portal.orders.empty} icon={BasketIcon} action={<ButtonLink to="/portal/order" variant="primary">{t.portal.nav.order}</ButtonLink>}>
          {t.portal.orders.emptyHint}
        </EmptyState>
      ) : (
        <ul className="portal-list">
          {orders.data.map((order) => (
            <li key={order.id}>
              <Link to={`/portal/orders/${order.id}`} className="portal-row">
                <span className="portal-row__main">
                  <span className="portal-row__title">{t.portal.orders.number(order.id)}</span>
                  <span className="portal-row__meta">
                    {formatDate(order.at)} · {t.portal.orders.lines(order.lineCount)}
                  </span>
                </span>
                <span className="portal-row__end">
                  <span className="portal-row__amount">{formatMoney(order.offer?.total ?? order.total)}</span>
                  <OrderStateBadge state={order.state} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function PortalOrderDetailPage() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { language } = useLanguage();
  const { replace } = useBasket();
  const id = Number(useParams().id);
  const order = useQuery({ queryKey: ['portal', 'orders', id], queryFn: () => portalApi.order(id) });
  const again = useMutation({
    mutationFn: () => portalApi.again(id),
    onSuccess: (quote) => {
      replace(quote.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })));
      toast({ title: t.portal.orders.againDone, detail: quote.missing.length > 0 ? t.portal.order.gone(quote.missing.length) : undefined });
      navigate('/portal/order');
    },
  });
  const cancel = useMutation({
    mutationFn: () => portalApi.cancel(id),
    onSuccess: (fresh) => {
      queryClient.setQueryData(['portal', 'orders', id], fresh);
      queryClient.invalidateQueries({ queryKey: ['portal', 'orders'], exact: true });
      toast({ title: t.portal.orders.cancelled });
    },
  });

  if (order.isPending) return <Loading />;
  if (order.isError) {
    return (
      <p className="notice notice--error" role="alert">
        {portalError(order.error, t)}
      </p>
    );
  }
  const data = order.data;
  return (
    <>
      <PageHeader
        title={t.portal.orders.number(data.id)}
        description={[formatDate(data.at), data.by && t.portal.orders.by(data.by)].filter(Boolean).join(' · ')}
        crumbs={[{ label: t.portal.orders.back, to: '/portal/orders' }]}
        actions={
          <Button icon={ArrowCounterClockwise} onClick={() => again.mutate()} loading={again.isPending}>
            {t.portal.orders.again}
          </Button>
        }
      />
      <Card>
        <div className="portal-state">
          <OrderStateBadge state={data.state} />
          <p>{t.portal.orders.stateHint[data.state]}</p>
          {data.declineReason && <p>{t.portal.orders.reason(data.declineReason)}</p>}
          {data.offer && <p>{t.portal.orders.offer(data.offer.number, formatMoney(data.offer.total))}</p>}
          {data.deliverOn && <p>{t.portal.orders.deliverOn(day(data.deliverOn))}</p>}
          {data.invoice && (
            <a className="button button--secondary button--sm" href={portalApi.invoiceUrl(data.invoice.id, language)} target="_blank" rel="noreferrer">
              <FilePdf aria-hidden="true" /> {t.portal.orders.invoice} {data.invoice.number}
            </a>
          )}
        </div>
      </Card>
      <Card title={t.portal.order.basketCount(data.lines.length)} description={t.portal.orders.priceNote}>
        <ul className="portal-basket__lines">
          {data.lines.map((line) => (
            <li key={line.productId} className="portal-basket__line">
              <span className="portal-basket__name">
                {line.name}
                {!line.inStock && <Badge tone="warn">{t.portal.order.outOfStock}</Badge>}
              </span>
              <span className="portal-muted">
                {formatQuantity(line.quantity, line.unit as ProductUnit)} × {formatMoney(line.unitPrice)}
              </span>
              <span className="portal-basket__total">{formatMoney(line.total)}</span>
            </li>
          ))}
        </ul>
        <dl className="portal-totals">
          <div>
            <dt>{t.portal.net}</dt>
            <dd>{formatMoney(data.net)}</dd>
          </div>
          <div>
            <dt>{t.portal.vat}</dt>
            <dd>{formatMoney(data.vat)}</dd>
          </div>
          <div className="portal-totals__grand">
            <dt>{t.portal.total}</dt>
            <dd>{formatMoney(data.total)}</dd>
          </div>
        </dl>
        {data.note && <p className="portal-muted">{data.note}</p>}
      </Card>
      {data.canCancel && (
        <Button variant="danger-text" onClick={() => cancel.mutate()} loading={cancel.isPending}>
          {t.portal.orders.cancel}
        </Button>
      )}
      {(again.isError || cancel.isError) && (
        <p className="notice notice--error" role="alert">
          {portalError(again.error ?? cancel.error, t)}
        </p>
      )}
    </>
  );
}

// ——— Invoices ———

export function PortalInvoicesPage() {
  const t = useT();
  const { language } = useLanguage();
  const invoices = useQuery({ queryKey: ['portal', 'invoices'], queryFn: portalApi.invoices });
  return (
    <>
      <PageHeader title={t.portal.invoices.title} />
      {invoices.isPending ? (
        <Loading />
      ) : invoices.isError ? (
        <p className="notice notice--error" role="alert">
          {portalError(invoices.error, t)}
        </p>
      ) : invoices.data.length === 0 ? (
        <EmptyState title={t.portal.invoices.empty} icon={Receipt}>
          {t.portal.invoices.emptyHint}
        </EmptyState>
      ) : (
        <ul className="portal-list">
          {invoices.data.map((doc) => (
            <li key={doc.id} className="portal-row">
              <span className="portal-row__main">
                <span className="portal-row__title">
                  {doc.number} {doc.kind === 'credit_note' && <Badge tone="info">{t.portal.invoices.creditNote}</Badge>}
                </span>
                <span className="portal-row__meta">
                  {[formatDate(doc.issuedAt), doc.corrects && t.portal.invoices.corrects(doc.corrects), doc.kind === 'invoice' && (doc.onAccount ? doc.dueDate && t.portal.invoices.due(day(doc.dueDate)) : t.portal.invoices.paidAtTill)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="portal-row__end">
                <PortalPrice gross={doc.kind === 'credit_note' ? -doc.total : doc.total} net={doc.kind === 'credit_note' ? -doc.net : doc.net} />
                <a className="button button--secondary button--sm" href={portalApi.invoiceUrl(doc.id, language)} target="_blank" rel="noreferrer" aria-label={t.portal.invoices.openLabel(doc.number)}>
                  <FilePdf aria-hidden="true" /> {t.portal.invoices.open}
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ——— Account and statement ———

const isoDay = (date: Date) => date.toLocaleDateString('en-CA');

export function PortalAccountPage() {
  const t = useT();
  const account = useQuery({ queryKey: ['portal', 'account'], queryFn: portalApi.account });
  const [from, setFrom] = useState(() => isoDay(new Date(new Date().getFullYear(), 0, 1)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const valid = from <= to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
  const statement = useQuery({ queryKey: ['portal', 'statement', from, to], queryFn: () => portalApi.statement(from, to), enabled: valid });

  if (account.isPending) return <Loading />;
  if (account.isError) {
    return (
      <p className="notice notice--error" role="alert">
        {portalError(account.error, t)}
      </p>
    );
  }
  const data = account.data;

  function downloadCsv() {
    if (!statement.data) return;
    const s = statement.data;
    const words = t.portal.account;
    const rows = [
      [words.date, words.what, words.debit, words.creditCol, words.balance],
      [s.from, words.opening, '', '', s.opening.toFixed(2)],
      ...s.lines.map((line) => [line.date, [words.kinds[line.kind], line.number].filter(Boolean).join(' '), line.debit ? line.debit.toFixed(2) : '', line.credit ? line.credit.toFixed(2) : '', line.balance.toFixed(2)]),
      [s.to, words.closing, '', '', s.closing.toFixed(2)],
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${words.csvFile}-${s.from}-${s.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const sheet = statement.data && (
    <article className="statement">
      <header className="statement__head">
        <div>
          <p className="statement__shop">{statement.data.shop.name}</p>
          <p className="statement__muted">{statement.data.customer.name}</p>
        </div>
        <div className="statement__title">
          <h2>{t.portal.account.statementTitle}</h2>
          <p className="statement__muted">{t.portal.account.period(day(statement.data.from), day(statement.data.to))}</p>
        </div>
      </header>
      <table className="statement__table">
        <caption className="visually-hidden">{t.portal.account.statementTitle}</caption>
        <thead>
          <tr>
            <th scope="col">{t.portal.account.date}</th>
            <th scope="col">{t.portal.account.what}</th>
            <th scope="col" className="statement__number">
              {t.portal.account.debit}
            </th>
            <th scope="col" className="statement__number">
              {t.portal.account.creditCol}
            </th>
            <th scope="col" className="statement__number">
              {t.portal.account.balance}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{day(statement.data.from)}</td>
            <td>{t.portal.account.opening}</td>
            <td />
            <td />
            <td className="statement__number">{formatMoney(statement.data.opening)}</td>
          </tr>
          {statement.data.lines.map((line, index) => (
            <tr key={index}>
              <td>{day(line.date)}</td>
              <td>{[t.portal.account.kinds[line.kind], line.number].filter(Boolean).join(' ')}</td>
              <td className="statement__number">{line.debit ? formatMoney(line.debit) : ''}</td>
              <td className="statement__number">{line.credit ? formatMoney(line.credit) : ''}</td>
              <td className="statement__number">{formatMoney(line.balance)}</td>
            </tr>
          ))}
          <tr>
            <td>{day(statement.data.to)}</td>
            <td>
              <strong>{t.portal.account.closing}</strong>
            </td>
            <td />
            <td />
            <td className="statement__number">
              <strong>{formatMoney(statement.data.closing)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
      {statement.data.lines.length === 0 && <p className="statement__muted">{t.portal.account.noLines}</p>}
    </article>
  );

  return (
    <>
      <PageHeader title={t.portal.account.title} />
      <Card>
        <div className="portal-balance">
          <span className="portal-balance__label">{t.portal.account.owe}</span>
          <span className="portal-balance__value">{data.balance > 0 ? formatMoney(data.balance) : data.balance < 0 ? t.portal.account.credit(formatMoney(-data.balance)) : t.portal.account.settled}</span>
          {data.lateAmount > 0 && data.lateSince && <p className="notice notice--warn">{t.portal.account.late(formatMoney(data.lateAmount), day(data.lateSince))}</p>}
          <p className="portal-muted">
            {[data.creditLimit !== null && t.portal.account.limit(formatMoney(data.creditLimit)), data.lastPaymentAt && t.portal.account.lastPayment(formatDate(data.lastPaymentAt))].filter(Boolean).join(' · ')}
          </p>
          {data.shop.iban && (
            <p className="portal-muted">
              {t.portal.account.payTo}: {data.shop.name} · {data.shop.bankName} · <span translate="no">{data.shop.iban}</span>
            </p>
          )}
        </div>
      </Card>
      <Card title={t.portal.account.open} flush>
        {data.openItems.length === 0 ? (
          <p className="portal-muted portal-pad">{t.portal.account.openEmpty}</p>
        ) : (
          <ul className="portal-list portal-list--flush">
            {data.openItems.map((item, index) => (
              <li key={item.documentId ?? `tab-${index}`} className="portal-row">
                <span className="portal-row__main">
                  <span className="portal-row__title">
                    {item.number ?? t.portal.account.onTab} {item.late && <Badge tone="warn">{t.portal.account.lateBadge}</Badge>}
                  </span>
                  <span className="portal-row__meta">{[day(item.date), item.dueDate && t.portal.account.dueOn(day(item.dueDate))].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="portal-row__end">
                  <span className="portal-row__amount">{t.portal.account.left(formatMoney(item.left))}</span>
                  <span className="portal-muted">{formatMoney(item.total)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title={t.portal.account.statement}
        description={t.portal.account.statementHint}
        actions={
          <>
            <Button size="sm" icon={DownloadSimple} onClick={downloadCsv} disabled={!statement.data}>
              {t.portal.account.csv}
            </Button>
            <Button size="sm" icon={Printer} onClick={() => window.print()} disabled={!statement.data}>
              {t.portal.account.print}
            </Button>
          </>
        }
      >
        <div className="portal-period">
          <Field label={t.portal.account.from} narrow>
            <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label={t.portal.account.to} narrow>
            <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>
        {statement.isPending && valid ? <Loading /> : statement.isError ? <p className="notice notice--error" role="alert">{portalError(statement.error, t)}</p> : sheet}
      </Card>
      {sheet &&
        createPortal(
          <div className="print-root" aria-hidden="true">
            {sheet}
          </div>,
          document.body,
        )}
    </>
  );
}

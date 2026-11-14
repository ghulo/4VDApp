import { CashRegister, FileText, Plus, Printer, WhatsappLogo, X } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { canOversee } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { TrefinTag } from '../components/TrefinParts';
import { Badge, Button, ButtonLink, Card, Combobox, DataTable, DateField, EmptyState, Field, PageHeader, StatGrid, StatTile, type Tone } from '../components/ui';
import { buttonClass } from '../components/ui/buttonClass';
import { useT } from '../i18n/useT';
import { businessApi, counterApi, customersApi, offersApi } from '../services/api';
import type { Offer, OfferDetail, OfferStatus, TrefinOffer, TrefinOfferDetail } from '../services/types';
import { todayIso } from '../utils/bills';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';
import { useWarnBeforeLeaving } from '../utils/useWarnBeforeLeaving';
import { whatsappLink } from '../utils/whatsapp';

const dayLabel = (day: string) => formatDate(`${day}T12:00:00`);
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const parseNumber = (text: string) => Number(text.replace(',', '.'));

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const STATUS_TONE: Record<OfferStatus | 'expired', Tone> = { open: 'info', sold: 'ok', declined: 'neutral', expired: 'warn' };

function OfferStatusBadge({ offer }: { offer: Offer }) {
  const t = useT();
  const key = offer.expired ? 'expired' : offer.status;
  return <Badge tone={STATUS_TONE[key]}>{t.offers.statuses[key]}</Badge>;
}

function useListParams() {
  const [params, setParams] = useSearchParams();
  const update = useCallback(
    (changes: Record<string, string>) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (!('page' in changes)) next.delete('page');
        return next;
      }),
    [setParams],
  );
  return { params, update };
}

const STATUSES: Array<OfferStatus | ''> = ['', 'open', 'sold', 'declined'];

/** Offers: price quotes for a customer before they buy, made in a minute and sold at the Counter with one tap. */
export function OffersPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const { params, update } = useListParams();
  const page = Number(params.get('page') ?? 1);
  const search = params.get('q') ?? '';
  const status = (params.get('status') ?? '') as OfferStatus | '';
  const offers = useQuery({
    queryKey: ['offers', { page, search, status }],
    queryFn: () => offersApi.list({ page, search: search || undefined, status: status || undefined }),
    placeholderData: keepPreviousData,
  });
  const onSearch = useCallback((value: string) => update({ q: value }), [update]);

  return (
    <>
      <PageHeader
        title={t.nav.items.sales}
        actions={
          <>
            <ButtonLink to="/offers/history" variant="ghost">
              {t.offers.fromTrefin}
            </ButtonLink>
            {canOversee(role) && (
              <ButtonLink to="/offers/new" variant="primary" icon={Plus}>
                {t.offers.new}
              </ButtonLink>
            )}
          </>
        }
      />
      {offers.isPending && <Loading />}
      {offers.isError && <ErrorNotice error={offers.error} onRetry={() => offers.refetch()} />}
      {offers.data && (
        <DataTable<Offer>
          caption={t.offers.title}
          rows={offers.data.items}
          rowKey={(offer) => offer.id}
          toolbar={
            <div className="toolbar">
              <SearchInput value={search} onChange={onSearch} label={t.offers.search} />
              <div className="chip-row" role="group" aria-label={t.offers.status}>
                {STATUSES.map((value) => (
                  <button key={value || 'all'} type="button" className="chip" aria-pressed={status === value} onClick={() => update({ status: value })}>
                    {value ? t.offers.statuses[value] : t.offers.all}
                  </button>
                ))}
              </div>
            </div>
          }
          columns={[
            {
              header: t.offers.number,
              title: true,
              cell: (offer) => (
                <Link to={`/offers/${offer.id}`} className="table__primary-link">
                  {offer.number}
                </Link>
              ),
            },
            { header: t.offers.customer, cell: (offer) => offer.name },
            { header: t.offers.made, className: 'table__nowrap table__phone-hide', cell: (offer) => formatDate(offer.at) },
            { header: t.offers.status, cell: (offer) => <OfferStatusBadge offer={offer} /> },
            { header: t.offers.total, align: 'end', cell: (offer) => formatMoney(offer.total) },
          ]}
          empty={
            <EmptyState icon={FileText} title={search || status ? t.offers.noneMatch : t.offers.noneYet}>
              {search || status ? undefined : t.offers.noneYetHint}
            </EmptyState>
          }
          footer={<Pagination meta={offers.data.meta} itemLabel={t.offers.items} onPageChange={(next) => update({ page: String(next) })} />}
        />
      )}
    </>
  );
}

interface DraftLine {
  productId: number;
  name: string;
  shelfPrice: number;
  quantity: string;
  price: string;
}

/** A new offer: who it is for, the products at the price agreed, a note; under a minute. */
export function NewOfferPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list });
  const products = useQuery({ queryKey: ['counter', 'shelf'], queryFn: counterApi.products, staleTime: 60_000 });
  const [customerId, setCustomerId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partyPhone, setPartyPhone] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [note, setNote] = useState('');
  const [validUntil, setValidUntil] = useState(() => addDays(todayIso(), 14));
  const [tried, setTried] = useState(false);

  const priced = lines.map((line) => {
    const quantity = parseNumber(line.quantity);
    const price = parseNumber(line.price);
    const ok = Number.isFinite(quantity) && quantity > 0 && Number.isFinite(price) && price >= 0;
    return { ...line, quantity, price, ok, total: ok ? roundMoney(quantity * price) : 0 };
  });
  const total = roundMoney(priced.reduce((sum, line) => sum + line.total, 0));
  const saving = roundMoney(priced.reduce((sum, line) => sum + (line.ok ? Math.max(0, line.shelfPrice - line.price) * line.quantity : 0), 0));
  const whoMissing = customerId === '' && partyName.trim() === '';
  const problem = whoMissing ? t.offers.needWho : lines.length === 0 ? t.offers.needLines : priced.some((line) => !line.ok) ? t.offers.badLine : null;

  const create = useMutation({
    mutationFn: () =>
      offersApi.create({
        customerId: customerId ? Number(customerId) : null,
        partyName: customerId ? null : partyName.trim(),
        partyPhone: customerId ? null : partyPhone.trim() || null,
        note: note.trim() || null,
        validUntil,
        lines: priced.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPrice: line.price })),
      }),
    onSuccess: (offer) => {
      for (const key of ['offers', 'activity']) void queryClient.invalidateQueries({ queryKey: [key] });
      navigate(`/offers/${offer.id}`);
    },
  });
  useWarnBeforeLeaving((lines.length > 0 || partyName !== '' || note !== '') && !create.isPending && !create.isSuccess);

  function addProduct(value: string) {
    const product = products.data?.find((item) => item.id === Number(value));
    if (!product || lines.some((line) => line.productId === product.id)) return;
    setLines((current) => [...current, { productId: product.id, name: product.name, shelfPrice: product.price, quantity: '1', price: product.price.toFixed(2) }]);
  }
  const change = (productId: number, patch: Partial<DraftLine>) => setLines((current) => current.map((line) => (line.productId === productId ? { ...line, ...patch } : line)));

  function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (!problem) create.mutate();
  }

  return (
    <>
      <PageHeader title={t.offers.new} crumbs={[{ label: t.offers.title, to: '/offers' }]} />
      <form className="settings-form offer-form" onSubmit={submit} noValidate>
        <Card title={t.offers.who}>
          {customers.isError && <ErrorNotice error={customers.error} onRetry={() => customers.refetch()} />}
          <Combobox
            label={t.offers.customer}
            placeholder={t.offers.pickCustomer}
            hint={t.offers.orType}
            value={customerId}
            onChange={setCustomerId}
            options={(customers.data ?? []).filter((row) => !row.archived).map((row) => ({ value: String(row.id), label: row.name, hint: row.phone ?? undefined }))}
          />
          {customerId === '' && (
            <div className="field-row">
              <Field label={t.offers.partyName} error={tried && whoMissing ? t.offers.needWho : undefined}>
                <input name="party-name" autoComplete="off" maxLength={200} value={partyName} onChange={(event) => setPartyName(event.target.value)} />
              </Field>
              <Field label={t.offers.partyPhone}>
                <input name="party-phone" type="tel" autoComplete="off" inputMode="tel" maxLength={40} value={partyPhone} onChange={(event) => setPartyPhone(event.target.value)} />
              </Field>
            </div>
          )}
        </Card>

        <Card title={t.offers.lines} description={t.offers.linesHint} flush>
          {products.isError && <ErrorNotice error={products.error} onRetry={() => products.refetch()} />}
          {priced.length > 0 && (
            <DataTable
              caption={t.offers.lines}
              rows={priced}
              rowKey={(line) => line.productId}
              columns={[
                {
                  header: t.offers.product,
                  title: true,
                  cell: (line) => (
                    <>
                      {line.name}
                      <span className="table__secondary">{t.offers.shelf(formatMoney(line.shelfPrice))}</span>
                    </>
                  ),
                },
                {
                  header: t.offers.quantity,
                  align: 'end',
                  cell: (line) => (
                    <input
                      className="input--compact"
                      inputMode="decimal"
                      aria-label={`${t.offers.quantity}: ${line.name}`}
                      aria-invalid={tried && !line.ok ? true : undefined}
                      value={lines.find((row) => row.productId === line.productId)!.quantity}
                      onChange={(event) => change(line.productId, { quantity: event.target.value })}
                    />
                  ),
                },
                {
                  header: t.offers.price,
                  align: 'end',
                  cell: (line) => (
                    <input
                      className="input--compact"
                      inputMode="decimal"
                      aria-label={`${t.offers.price}: ${line.name}`}
                      aria-invalid={tried && !line.ok ? true : undefined}
                      value={lines.find((row) => row.productId === line.productId)!.price}
                      onChange={(event) => change(line.productId, { price: event.target.value })}
                    />
                  ),
                },
                { header: t.offers.total, align: 'end', cell: (line) => (line.ok ? formatMoney(line.total) : '–') },
                {
                  header: <span className="visually-hidden">{t.offers.remove}</span>,
                  align: 'end',
                  cell: (line) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={X}
                      aria-label={t.offers.removeLine(line.name)}
                      onClick={() => setLines((current) => current.filter((row) => row.productId !== line.productId))}
                    />
                  ),
                },
              ]}
              totals={[t.offers.total, '', '', formatMoney(total), '']}
            />
          )}
          <div className="buy-add-line">
            <Combobox
              label={t.offers.addProduct}
              placeholder={products.isPending ? t.common.loading : t.offers.chooseProduct}
              disabled={products.isPending}
              value=""
              resetAfterPick
              error={tried && lines.length === 0 ? t.offers.needLines : undefined}
              onChange={(id) => id && addProduct(id)}
              options={(products.data ?? [])
                .filter((product) => !lines.some((line) => line.productId === product.id))
                .map((product) => ({ value: String(product.id), label: product.name, hint: [formatMoney(product.price), product.barcode].filter(Boolean).join(' · ') }))}
            />
          </div>
        </Card>

        <Card title={t.offers.rest}>
          <div className="field-row">
            <Field label={t.offers.validUntil} hint={t.offers.validHint}>
              <DateField value={validUntil} min={todayIso()} onChange={(value) => setValidUntil(value ?? addDays(todayIso(), 14))} />
            </Field>
          </div>
          <Field label={t.offers.note} hint={t.offers.noteHint}>
            <textarea name="note" rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          {saving > 0 && <p className="field-hint">{t.offers.savingLine(formatMoney(saving))}</p>}
          {create.isError && (
            <p className="form-error" role="alert">
              {errorMessage(create.error)}
            </p>
          )}
          {tried && problem && !create.isError && (
            <p className="form-error" role="alert">
              {problem}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={create.isPending}>
              {lines.length > 0 ? t.offers.make(formatMoney(total)) : t.offers.makeEmpty}
            </Button>
          </div>
        </Card>
      </form>
    </>
  );
}

/** One offer: what it quotes, then print it, send it on WhatsApp, or sell it at the Counter. */
export function OfferDetailPage() {
  const t = useT();
  const id = Number(useParams().id);
  const { role } = useCurrentUser();
  const queryClient = useQueryClient();
  const offer = useQuery({ queryKey: ['offers', id], queryFn: () => offersApi.get(id) });
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });
  const [asProforma, setAsProforma] = useState(false);
  const decline = useMutation({
    mutationFn: () => offersApi.decline(id),
    onSuccess: (data) => {
      queryClient.setQueryData(['offers', id], data);
      void queryClient.invalidateQueries({ queryKey: ['offers'] });
    },
  });

  if (offer.isPending) return <Loading />;
  if (offer.isError) return <ErrorNotice error={offer.error} onRetry={() => offer.refetch()} />;
  const data = offer.data;
  const shop = business.data;
  const open = data.status === 'open';
  const message = shop
    ? t.offers.whatsappText({
        number: data.number,
        shop: shop.name,
        lines: data.lines.map((line) => `${line.quantity} × ${line.productName}: ${formatMoney(line.unitPrice)} = ${formatMoney(line.total)}`),
        total: formatMoney(data.total),
        until: dayLabel(data.validUntil),
        note: data.note,
      })
    : null;
  const chat = data.phone && message ? whatsappLink(data.phone, message) : null;
  const print = (proforma: boolean) => {
    setAsProforma(proforma);
    // Let the sheet change its title before the browser takes the page.
    window.setTimeout(() => window.print(), 50);
  };

  const sheet = shop && (
    <article className="statement">
      <header className="statement__head">
        <div>
          <p className="statement__shop">{shop.name}</p>
          <p className="statement__muted">{[shop.address, shop.phone, shop.nui && t.nui.short(shop.nui)].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="statement__title">
          <h2>{asProforma ? t.offers.proforma : t.offers.titleOf(data.number)}</h2>
          <p className="statement__muted">{[asProforma && data.number, formatDate(data.at)].filter(Boolean).join(' · ')}</p>
        </div>
      </header>
      <p className="statement__to">
        <span className="statement__muted">{t.statement.to}</span> <strong>{data.name}</strong>
        {data.phone && ` · ${data.phone}`}
      </p>
      <table className="statement__table">
        <caption className="visually-hidden">{t.offers.lines}</caption>
        <thead>
          <tr>
            <th scope="col">{t.offers.product}</th>
            <th scope="col" className="statement__number">
              {t.offers.quantity}
            </th>
            <th scope="col" className="statement__number">
              {t.offers.price}
            </th>
            <th scope="col" className="statement__number">
              {t.offers.total}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line) => (
            <tr key={line.productId}>
              <td>{line.productName}</td>
              <td className="statement__number">{line.quantity}</td>
              <td className="statement__number">{formatMoney(line.unitPrice)}</td>
              <td className="statement__number">{formatMoney(line.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="statement__total">
        <span>{t.offers.totalVat}</span>
        <strong>{formatMoney(data.total)}</strong>
      </p>
      {data.note && <p>{data.note}</p>}
      <p className="statement__muted">{t.offers.validLine(dayLabel(data.validUntil))}</p>
      {shop.iban && <p className="statement__muted">{[shop.bankName, shop.iban].filter(Boolean).join(' · ')}</p>}
    </article>
  );

  return (
    <>
      <PageHeader
        title={t.offers.titleOf(data.number)}
        crumbs={[{ label: t.offers.title, to: '/offers' }]}
        meta={<OfferStatusBadge offer={data} />}
        description={[formatDate(data.at), data.by].filter(Boolean).join(' · ')}
        actions={
          <>
            {chat && (
              <a href={chat} target="_blank" rel="noreferrer" className={buttonClass()}>
                <WhatsappLogo aria-hidden="true" />
                {t.offers.send}
              </a>
            )}
            <Button icon={Printer} onClick={() => print(false)} disabled={!shop}>
              {t.offers.print}
            </Button>
            <Button variant="ghost" onClick={() => print(true)} disabled={!shop}>
              {t.offers.printProforma}
            </Button>
            {open && canOversee(role) && (
              <Button variant="ghost" icon={X} onClick={() => decline.mutate()} loading={decline.isPending}>
                {t.offers.decline}
              </Button>
            )}
            {open && (
              <ButtonLink to={`/counter?offer=${data.id}`} variant="primary" icon={CashRegister}>
                {t.offers.sell}
              </ButtonLink>
            )}
          </>
        }
      />
      {decline.isError && (
        <p className="form-error" role="alert">
          {errorMessage(decline.error)}
        </p>
      )}
      {data.sale && (
        <p className="callout document-note">
          {t.offers.soldAs} <Link to={`/documents/${data.sale.id}`}>{data.sale.number}</Link>
        </p>
      )}
      {open && <p className="field-hint">{t.offers.sellHint}</p>}
      <StatGrid>
        <StatTile label={t.offers.customer} value={data.customer ? <Link to={`/customers/${data.customer.id}`}>{data.name}</Link> : data.name} hint={data.phone ?? undefined} />
        <StatTile label={t.offers.total} value={formatMoney(data.total)} hint={data.saving > 0 ? t.offers.savingShort(formatMoney(data.saving)) : undefined} />
        <StatTile label={t.offers.validUntil} value={dayLabel(data.validUntil)} tone={data.expired ? 'warn' : 'default'} />
      </StatGrid>
      <Card title={t.offers.lines} flush>
        <DataTable<OfferDetail['lines'][number]>
          caption={t.offers.lines}
          rows={data.lines}
          rowKey={(line) => line.productId}
          columns={[
            {
              header: t.offers.product,
              title: true,
              cell: (line) => (
                <Link to={`/products/${line.productId}`} className="table__primary-link">
                  {line.productName}
                </Link>
              ),
            },
            { header: t.offers.quantity, align: 'end', cell: (line) => line.quantity },
            {
              header: t.offers.price,
              align: 'end',
              cell: (line) => (
                <>
                  {formatMoney(line.unitPrice)}
                  {line.unitPrice < line.shelfPrice && <span className="table__secondary">{t.offers.shelf(formatMoney(line.shelfPrice))}</span>}
                </>
              ),
            },
            { header: t.offers.total, align: 'end', cell: (line) => formatMoney(line.total) },
          ]}
          totals={[t.offers.total, '', '', formatMoney(data.total)]}
        />
      </Card>
      {data.note && (
        <Card title={t.offers.note}>
          <p>{data.note}</p>
        </Card>
      )}
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

/** TREFIN's offers, to look at. */
export function TrefinOffersPage() {
  const t = useT();
  const { params, update } = useListParams();
  const page = Number(params.get('page') ?? 1);
  const search = params.get('q') ?? '';
  const offers = useQuery({
    queryKey: ['offers', 'history', { page, search }],
    queryFn: () => offersApi.history({ page, search: search || undefined }),
    placeholderData: keepPreviousData,
  });
  const onSearch = useCallback((value: string) => update({ q: value }), [update]);

  return (
    <>
      <PageHeader title={t.offers.fromTrefin} description={t.offers.description} crumbs={[{ label: t.offers.title, to: '/offers' }]} />
      {offers.isPending && <Loading />}
      {offers.isError && <ErrorNotice error={offers.error} onRetry={() => offers.refetch()} />}
      {offers.data && (
        <DataTable<TrefinOffer>
          caption={t.offers.fromTrefin}
          rows={offers.data.items}
          rowKey={(offer) => offer.id}
          toolbar={
            <div className="toolbar">
              <SearchInput value={search} onChange={onSearch} label={t.offers.search} />
            </div>
          }
          columns={[
            {
              header: t.offers.number,
              title: true,
              cell: (offer) => (
                <>
                  <Link to={`/offers/history/${offer.id}`} className="table__primary-link">
                    {offer.number ?? t.offers.noNumber}
                  </Link>{' '}
                  <TrefinTag />
                </>
              ),
            },
            { header: t.offers.day, className: 'table__nowrap', cell: (offer) => dayLabel(offer.day) },
            { header: t.offers.customer, cell: (offer) => offer.customer?.name ?? offer.partyName ?? t.documents.walkIn },
            { header: t.offers.lines, align: 'end', className: 'table__phone-hide', cell: (offer) => offer.lineCount },
            { header: t.offers.total, align: 'end', cell: (offer) => formatMoney(offer.total) },
          ]}
          empty={
            <EmptyState icon={FileText} title={search ? t.offers.noneMatch : t.offers.none}>
              {search ? undefined : t.offers.noneHint}
            </EmptyState>
          }
          footer={<Pagination meta={offers.data.meta} itemLabel={t.offers.items} onPageChange={(next) => update({ page: String(next) })} />}
        />
      )}
    </>
  );
}

type TrefinLine = TrefinOfferDetail['lines'][number];

/** One of TREFIN's offers and what it quoted. */
export function TrefinOfferDetailPage() {
  const t = useT();
  const id = Number(useParams().id);
  const offer = useQuery({ queryKey: ['offers', 'history', id], queryFn: () => offersApi.historyGet(id) });

  if (offer.isPending) return <Loading />;
  if (offer.isError) return <ErrorNotice error={offer.error} onRetry={() => offer.refetch()} />;
  const data = offer.data;
  const customer = data.customer ? <Link to={`/customers/${data.customer.id}`}>{data.customer.name}</Link> : (data.partyName ?? t.documents.walkIn);

  return (
    <>
      <PageHeader
        title={t.offers.titleOf(data.number ?? t.offers.noNumber)}
        crumbs={[
          { label: t.offers.title, to: '/offers' },
          { label: t.offers.fromTrefin, to: '/offers/history' },
        ]}
        meta={<TrefinTag />}
        description={`${dayLabel(data.day)} · ${t.fromTrefin.databases[data.source] ?? data.source}`}
      />
      <p className="callout document-note">{t.offers.trefinNote}</p>
      <StatGrid>
        <StatTile label={t.offers.customer} value={customer} />
        <StatTile label={t.offers.total} value={formatMoney(data.total)} />
      </StatGrid>
      <Card title={t.offers.lines} flush>
        <DataTable<TrefinLine>
          caption={t.offers.lines}
          rows={data.lines}
          rowKey={(line) => `${line.productId ?? line.productName}-${line.quantity}-${line.total}`}
          columns={[
            {
              header: t.sales.product,
              title: true,
              cell: (line) =>
                line.productId ? (
                  <Link to={`/products/${line.productId}`} className="table__primary-link">
                    {line.productName}
                  </Link>
                ) : (
                  <>
                    {line.productName}
                    <span className="table__secondary">{t.fromTrefin.noProduct}</span>
                  </>
                ),
            },
            { header: t.offers.quantity, align: 'end', cell: (line) => line.quantity },
            { header: t.offers.price, align: 'end', cell: (line) => formatMoney(line.unitPrice) },
            { header: t.offers.total, align: 'end', cell: (line) => formatMoney(line.total) },
          ]}
          totals={[t.offers.total, '', '', formatMoney(data.total)]}
        />
      </Card>
    </>
  );
}

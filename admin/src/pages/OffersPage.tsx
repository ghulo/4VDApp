import { FileText } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { TrefinTag } from '../components/TrefinParts';
import { Card, DataTable, EmptyState, PageHeader, StatGrid, StatTile } from '../components/ui';
import { useT } from '../i18n/useT';
import { offersApi } from '../services/api';
import type { Offer, OfferDetail } from '../services/types';
import { formatDate, formatMoney } from '../utils/format';

const dayLabel = (day: string) => formatDate(`${day}T12:00:00`);

/** Offers: price quotes printed for a customer before they buy. So far TREFIN's, to look at. */
export function OffersPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const search = params.get('q') ?? '';
  const offers = useQuery({
    queryKey: ['offers', { page, search }],
    queryFn: () => offersApi.list({ page, search: search || undefined }),
    placeholderData: keepPreviousData,
  });

  const updateParams = useCallback(
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
  const onSearch = useCallback((value: string) => updateParams({ q: value }), [updateParams]);

  return (
    <>
      <PageHeader wide title={t.nav.items.sales} description={t.offers.description} />
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
            </div>
          }
          columns={[
            {
              header: t.offers.number,
              title: true,
              cell: (offer) => (
                <>
                  <Link to={`/offers/${offer.id}`} className="table__primary-link">
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
          footer={<Pagination meta={offers.data.meta} itemLabel={t.offers.items} onPageChange={(next) => updateParams({ page: String(next) })} />}
        />
      )}
    </>
  );
}

type Line = OfferDetail['lines'][number];

/** One offer and what it quoted. */
export function OfferDetailPage() {
  const t = useT();
  const id = Number(useParams().id);
  const offer = useQuery({ queryKey: ['offers', id], queryFn: () => offersApi.get(id) });

  if (offer.isPending) return <Loading />;
  if (offer.isError) return <ErrorNotice error={offer.error} onRetry={() => offer.refetch()} />;
  const data = offer.data;
  const customer = data.customer ? (
    <Link to={`/customers/${data.customer.id}`}>{data.customer.name}</Link>
  ) : (
    (data.partyName ?? t.documents.walkIn)
  );

  return (
    <>
      <PageHeader
        title={t.offers.titleOf(data.number ?? t.offers.noNumber)}
        crumbs={[{ label: t.offers.title, to: '/offers' }]}
        meta={<TrefinTag />}
        description={`${dayLabel(data.day)} · ${t.fromTrefin.databases[data.source] ?? data.source}`}
      />
      <p className="callout document-note">{t.offers.trefinNote}</p>
      <StatGrid>
        <StatTile label={t.offers.customer} value={customer} />
        <StatTile label={t.offers.total} value={formatMoney(data.total)} />
      </StatGrid>
      <Card title={t.offers.lines} flush>
        <DataTable<Line>
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

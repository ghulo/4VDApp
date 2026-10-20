import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { StatusPill } from '../components/Decision';
import { ErrorNotice, Loading } from '../components/Feedback';
import { categoriesApi, stockCountsApi } from '../services/api';
import type { RecordSource, StockCountListItem, TrefinStockDocument } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatDateTime, formatMoney } from '../utils/format';
import { Button, Card, DataTable, EmptyState, PageHeader } from '../components/ui';
import { ArrowRight, ClipboardText } from '@phosphor-icons/react';
import { useT } from '../i18n/useT';
import { SourceFilter, TrefinTag } from '../components/TrefinParts';

/** A finished count of 4VD's, or one of TREFIN's starting stocks, corrections and counts. */
type FinishedRow = { key: string; day: string; count: StockCountListItem; trefin?: never } | { key: string; day: string; trefin: TrefinStockDocument; count?: never };

/**
 * Counts in two parts: the ones still going (being counted, or waiting for
 * you) as cards with their progress, then the finished ones with what they found.
 */
export function StockCountsPage() {
  const t = useT();
  const counts = useQuery({ queryKey: ['stock-counts'], queryFn: stockCountsApi.list });
  const trefin = useQuery({ queryKey: ['stock-counts', 'trefin'], queryFn: stockCountsApi.trefinList });
  const [source, setSource] = useState<RecordSource | undefined>();
  const active = counts.data?.filter((count) => count.status === 'open' || count.status === 'submitted') ?? [];
  const finished: FinishedRow[] = [
    ...(source === 'trefin' ? [] : (counts.data ?? []))
      .filter((count) => count.status === 'closed' || count.status === 'cancelled')
      .map((count) => ({ key: `c${count.id}`, day: count.closedAt ?? count.startedAt, count })),
    ...(source === '4vd' ? [] : (trefin.data ?? [])).map((document) => ({ key: `t${document.id}`, day: `${document.dated}T12:00:00`, trefin: document })),
  ].sort((a, b) => new Date(b.day).getTime() - new Date(a.day).getTime());
  const hasTrefin = (trefin.data?.length ?? 0) > 0;

  return (
    <>
      <PageHeader title={t.counts.title} description={t.counts.description} actions={<StartCountForm />} />
      {counts.isPending && <Loading />}
      {counts.isError && <ErrorNotice error={counts.error} onRetry={() => counts.refetch()} />}
      {counts.data && counts.data.length === 0 && trefin.data?.length === 0 && (
        <Card>
          <EmptyState art title={t.counts.none}>
            {t.counts.noneHint}
          </EmptyState>
        </Card>
      )}

      {active.length > 0 && (
        <section className="overview-section" aria-labelledby="counts-active">
          <div className="overview-section__head">
            <h2 id="counts-active" className="overview-section__title">
              {t.counts.inProgress}
            </h2>
          </div>
          <ul className="count-cards">
            {active.map((count) => (
              <li key={count.id}>
                <ActiveCountCard count={count} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {(finished.length > 0 || source) && (
        <section className="overview-section" aria-labelledby="counts-finished">
          <div className="overview-section__head">
            <h2 id="counts-finished" className="overview-section__title">
              {t.counts.finished}
            </h2>
            {hasTrefin && <SourceFilter value={source} onChange={setSource} />}
          </div>
          <DataTable<FinishedRow>
            caption={t.counts.finished}
            rows={finished}
            rowKey={(row) => row.key}
            // A cancelled count counted nothing: it stays listed but steps back.
            rowClassName={(row) => (row.count?.status === 'cancelled' ? 'table__row--muted' : undefined)}
            empty={<EmptyState title={t.counts.none} />}
            columns={[
              {
                header: t.counts.what,
                cell: (row) =>
                  row.trefin ? (
                    <>
                      <Link to={`/counts/trefin/${row.trefin.id}`} className="table__primary-link">
                        {t.fromTrefin.stockKinds[row.trefin.kind]}
                        <span className="table__secondary">{t.fromTrefin.databases[row.trefin.source] ?? row.trefin.source}</span>
                      </Link>{' '}
                      <TrefinTag />
                    </>
                  ) : (
                    <Link to={`/counts/${row.count.id}`} className="table__primary-link">
                      {row.count.category?.name ?? t.counts.wholeShop}
                    </Link>
                  ),
              },
              { header: t.counts.finishedOn, cell: (row) => formatDate(row.day) },
              {
                header: t.counts.counted,
                cell: (row) =>
                  row.trefin ? (
                    <span className="count-result">{t.fromTrefin.products(row.trefin.lineCount)}</span>
                  ) : (
                    <span className="count-result">{row.count.totals.counted} / {row.count.totals.products}</span>
                  ),
              },
              { header: t.counts.result, cell: (row) => (row.trefin ? <TrefinResult document={row.trefin} /> : <CountResult count={row.count} />) },
              { header: t.counts.startedBy, cell: (row) => (row.trefin ? '–' : (row.count.startedBy?.name ?? t.counts.unknown)) },
            ]}
          />
        </section>
      )}
    </>
  );
}

/** A count still going: how far the counting is, or what is left for you to review. */
function ActiveCountCard({ count }: { count: StockCountListItem }) {
  const t = useT();
  const { counted, products, pending } = count.totals;
  const waiting = count.status === 'submitted';
  return (
    <Link to={`/counts/${count.id}`} className="count-card">
      <span className="count-card__head">
        <span className="count-card__title">{count.category?.name ?? t.counts.wholeShop}</span>
        <StatusPill status={count.status} />
      </span>
      <span className="count-card__progress">
        <span>{products === 0 ? t.counts.nothingToCount : t.counts.countedOf(counted, products)}</span>
        <span className="target-bar__track" aria-hidden="true">
          <span className="target-bar__fill" style={{ inlineSize: `${products === 0 ? 0 : (counted / products) * 100}%` }} />
        </span>
      </span>
      <span className="count-card__foot">
        <span className={waiting && pending ? 'count-card__waiting' : undefined}>
          {waiting && pending !== null
            ? t.counts.toReview(pending)
            : t.counts.startedLine({ by: count.startedBy?.name ?? t.counts.unknown, when: formatDateTime(count.startedAt) })}
        </span>
        <span className="count-card__action">
          {waiting ? t.counts.review : t.counts.open}
          <ArrowRight aria-hidden="true" />
        </span>
      </span>
    </Link>
  );
}

/** What one of TREFIN's stock documents comes to at TREFIN's cost: a count's or correction's difference, or the starting stock's worth. */
function TrefinResult({ document }: { document: TrefinStockDocument }) {
  const t = useT();
  if (document.kind === 'opening') return <span className="count-result">{t.fromTrefin.worth(formatMoney(document.value))}</span>;
  if (document.value === 0) return <span className="count-result">{t.counts.differencesCount(document.lineCount)}</span>;
  return document.value < 0 ? (
    <span className="count-result count-result--missing">{t.counts.missingAmount(formatMoney(-document.value))}</span>
  ) : (
    <span className="count-result">{t.counts.extraAmount(formatMoney(document.value))}</span>
  );
}

/** What a finished count found, in money at cost where it can. */
function CountResult({ count }: { count: StockCountListItem }) {
  const t = useT();
  if (count.status === 'cancelled') return <StatusPill status="cancelled" />;
  const { differences, shortageValue } = count.totals;
  if (differences === 0) return <span className="count-result count-result--ok">{t.counts.allMatched}</span>;
  if (shortageValue === null || shortageValue === 0) {
    return differences === null ? <StatusPill status={count.status} /> : <span className="count-result">{t.counts.differencesCount(differences)}</span>;
  }
  return shortageValue > 0 ? (
    <span className="count-result count-result--missing">{t.counts.missingAmount(formatMoney(shortageValue))}</span>
  ) : (
    <span className="count-result">{t.counts.extraAmount(formatMoney(-shortageValue))}</span>
  );
}

function StartCountForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const t = useT();
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const [scope, setScope] = useState('');

  const start = useMutation({
    mutationFn: () => stockCountsApi.start(scope === '' ? null : Number(scope)),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['stock-counts'] });
      navigate(`/counts/${count.id}`);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    start.mutate();
  }

  return (
    <form className="inline-form" onSubmit={handleSubmit}>
      <label className="visually-hidden" htmlFor="count-scope">
        {t.counts.whatToCount}
      </label>
      <select id="count-scope" className="setting-select" value={scope} onChange={(event) => setScope(event.target.value)}>
          <option value="">{t.counts.theWholeShop}</option>
          {categories.data?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
      </select>
      <Button type="submit" variant="primary" icon={ClipboardText} disabled={start.isPending} loading={start.isPending}>
        {t.counts.start}
      </Button>
      {start.isError && (
        <p className="form-error" role="alert">
          {errorMessage(start.error)}
        </p>
      )}
    </form>
  );
}

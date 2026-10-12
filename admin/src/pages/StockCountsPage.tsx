import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { StatusPill } from '../components/Decision';
import { ErrorNotice, Loading } from '../components/Feedback';
import { categoriesApi, stockCountsApi } from '../services/api';
import type { StockCountListItem } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatDateTime, formatMoney } from '../utils/format';
import { Button, Card, DataTable, EmptyState, PageHeader } from '../components/ui';
import { ArrowRight, ClipboardText } from '@phosphor-icons/react';
import { useT } from '../i18n/useT';

/**
 * Counts in two parts: the ones still going (being counted, or waiting for
 * you) as cards with their progress, then the finished ones with what they found.
 */
export function StockCountsPage() {
  const t = useT();
  const counts = useQuery({ queryKey: ['stock-counts'], queryFn: stockCountsApi.list });
  const active = counts.data?.filter((count) => count.status === 'open' || count.status === 'submitted') ?? [];
  const finished = counts.data?.filter((count) => count.status === 'closed' || count.status === 'cancelled') ?? [];

  return (
    <>
      <PageHeader title={t.counts.title} description={t.counts.description} actions={<StartCountForm />} />
      {counts.isPending && <Loading />}
      {counts.isError && <ErrorNotice error={counts.error} onRetry={() => counts.refetch()} />}
      {counts.data && counts.data.length === 0 && (
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

      {finished.length > 0 && (
        <section className="overview-section" aria-labelledby="counts-finished">
          <div className="overview-section__head">
            <h2 id="counts-finished" className="overview-section__title">
              {t.counts.finished}
            </h2>
          </div>
          <DataTable
            caption={t.counts.finished}
            rows={finished}
            rowKey={(count) => count.id}
            columns={[
              {
                header: t.counts.what,
                cell: (count) => (
                  <Link to={`/counts/${count.id}`} className="table__primary-link">
                    {count.category?.name ?? t.counts.wholeShop}
                  </Link>
                ),
              },
              { header: t.counts.finishedOn, cell: (count) => formatDate(count.closedAt ?? count.startedAt) },
              { header: t.counts.counted, cell: (count) => <span className="count-result">{count.totals.counted} / {count.totals.products}</span> },
              { header: t.counts.result, cell: (count) => <CountResult count={count} /> },
              { header: t.counts.startedBy, cell: (count) => count.startedBy?.name ?? t.counts.unknown },
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
      <Button type="submit" variant="primary" icon={ClipboardText} disabled={start.isPending}>
        {start.isPending ? t.counts.starting : t.counts.start}
      </Button>
      {start.isError && (
        <p className="form-error" role="alert">
          {errorMessage(start.error)}
        </p>
      )}
    </form>
  );
}

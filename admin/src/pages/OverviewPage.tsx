import { CaretRight, Receipt } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCurrentUser } from '../auth/useAuth';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { checklistProgress, useDayChecklist } from '../utils/useDayChecklist';
import { ProductPhoto } from '../components/ProductPhoto';
import { StockTag } from '../components/StockTag';
import { SetupGuide } from '../setup/SetupGuide';
import { analyticsApi, approvalsApi, inventoryApi, reportsApi } from '../services/api';
import { formatDateWith, formatMoney, MUCH_MORE } from '../utils/format';
import { ButtonLink, Card, DayBars, PageHeader, ShopSunrise } from '../components/ui';
import { useT } from '../i18n/useT';
import { useCarwashes } from '../utils/useCarwashes';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Days in the Today card's dot strip. */
const DOT_DAYS = 30;
/** From this hour an unfinished end-of-day checklist stands out on Today. */
const CLOSING_HOUR = 18;

export function OverviewPage() {
  const t = useT();
  const user = useCurrentUser();
  const lowStock = useQuery({
    queryKey: ['inventory', { lowStock: true, page: 1, limit: 50 }],
    queryFn: () => inventoryApi.list({ page: 1, lowStock: true, limit: 50 }),
  });

  const firstName = user.name.split(' ')[0];
  const lowCount = lowStock.data?.meta.total;
  const outCount = lowStock.data?.items.filter((item) => item.quantity === 0).length;

  return (
    <>
      <PageHeader
        title={t.overview.hi(firstName ?? user.name)}
        description={
          lowCount === undefined
            ? t.overview.checkingStock
            : lowCount === 0
              ? t.overview.allAbove
              : `${t.overview.needRestock(lowCount)}${outCount ? t.overview.soldOut(outCount) : ''}.`
        }
        actions={
          user.role !== 'owner' && (
            <ButtonLink to="/sales" variant="primary" icon={Receipt}>
              {t.sales.record}
            </ButtonLink>
          )
        }
      />

      <TodayCard lowCount={lowCount} />

      <SetupGuide />

      <div className="split">
        <AttentionPanel />

        <Card
          title={t.overview.needsRestocking}
          actions={
            <Link to="/inventory?lowStock=true" className="text-link">
              {t.overview.seeAllStock}
            </Link>
          }
        >
          {lowStock.isPending && <Loading />}
          {lowStock.isError && <ErrorNotice error={lowStock.error} onRetry={() => lowStock.refetch()} />}
          {lowStock.data && lowStock.data.items.length === 0 && (
            <EmptyState title={t.overview.nothingToRestock}>{t.overview.nothingToRestockHint}</EmptyState>
          )}
          {lowStock.data && lowStock.data.items.length > 0 && (
            <ul className="restock-list">
              {lowStock.data.items.map((item) => (
                <li key={item.productId}>
                  <Link to={`/inventory/${item.productId}`} className="restock-list__row">
                    <StockTag quantity={item.quantity} reorderLevel={item.reorderLevel} />
                    <span className="restock-list__name product-cell">
                      <ProductPhoto src={item.imageUrl} />
                      {item.productName}
                    </span>
                    <span className="restock-list__meta">{t.overview.reorderAt(item.reorderLevel)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="overview__more">
        <Link to="/reports" className="text-link">
          {t.overview.seeReports}
        </Link>
      </p>
    </>
  );
}

/** Today so far, against the same hours of the same weekday last week. */
function todayRange(now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = (date: Date) => new Date(date.getTime() - 7 * MS_PER_DAY).toISOString();
  return {
    startDate: midnight.toISOString(),
    endDate: now.toISOString(),
    previousStartDate: weekAgo(midnight),
    previousEndDate: weekAgo(now),
  };
}

/**
 * The shop's day in a sentence or two: what came in so far, how that compares
 * with the same hours last week, and what's waiting. Calm on a quiet morning.
 */
function TodayCard({ lowCount }: { lowCount: number | undefined }) {
  const t = useT();
  // Fixed once per visit so the query key doesn't change on every render.
  const [range] = useState(() => todayRange());
  const { places: openCarwashes } = useCarwashes();
  // The team keeps selling while this page is open, so today's figures check again every minute.
  const today = useQuery({
    queryKey: ['reports', 'summary', 'today', range.startDate],
    queryFn: () => reportsApi.summary(range),
    refetchInterval: 60_000,
  });
  const approvals = useQuery({ queryKey: ['approvals', 'summary'], queryFn: approvalsApi.summary });
  const weekday = formatDateWith(new Date(range.endDate), { weekday: 'long' });
  const current = today.data?.current;
  const previous = today.data?.previous;
  const change = today.data?.change.revenue ?? null;
  const waiting = approvals.data?.total ?? 0;
  const lastDays = useQuery({
    queryKey: ['analytics', 'revenue', 'daily', DOT_DAYS],
    // Start of the day 29 days ago, so the strip shows exactly 30 whole days.
    queryFn: () => analyticsApi.revenue('daily', new Date(Date.now() - (DOT_DAYS - 1) * MS_PER_DAY).toISOString().slice(0, 10)),
  });

  function compare(): string | null {
    if (!current || !previous) return null;
    if (change === null) return t.overview.nothingLastWeek(weekday);
    const amount = formatMoney(previous.revenue);
    if (current.revenue === 0) return t.overview.lastWeekHad({ weekday, amount });
    if (change > MUCH_MORE) return t.overview.muchMoreThanLastWeek({ weekday, amount });
    return t.overview.comparedLastWeek({ up: change >= 0, percent: Math.abs(Math.round(change * 100)), weekday, amount });
  }

  return (
    <section className="today" aria-label={t.overview.todaySoFar} aria-busy={today.isPending}>
      <div className="today__text">
        {today.isPending && <Loading />}
        {today.isError && <ErrorNotice error={today.error} onRetry={() => today.refetch()} />}
        {current && (
          <>
            <p className="today__headline">
              {current.salesCount > 0
                ? t.overview.takenToday({ amount: formatMoney(current.revenue), count: current.salesCount })
                : t.overview.noSalesToday}
            </p>
            <p className="today__compare">
              {compare()}
              {current.salesCount > 0 && <> {t.overview.todayFacts({ items: current.unitsSold, profit: formatMoney(current.profit) })}</>}
            </p>
          </>
        )}
        <div className="today__links">
          <Link to="/inbox" className={waiting > 0 ? 'today__link today__link--due' : 'today__link'}>
            <strong>{waiting}</strong> {t.overview.waitingForYou}
            <CaretRight size={14} aria-hidden="true" />
          </Link>
          <Link to="/inventory?lowStock=true" className="today__link">
            <strong>{lowCount ?? '–'}</strong> {t.overview.toRestock}
            <CaretRight size={14} aria-hidden="true" />
          </Link>
          {today.data && (
            <Link to="/carwash" className="today__link">
              {today.data.carwash.current.days > 0 ? (
                <>
                  <strong>{formatMoney(today.data.carwash.current.total)}</strong> {t.overview.carwashToday}
                  {/* With several carwashes, say when some haven't entered their takings yet. */}
                  {openCarwashes.length > 1 && today.data.carwash.byCarwash.length < openCarwashes.length && (
                    <> · {t.overview.carwashSome(today.data.carwash.byCarwash.length, openCarwashes.length)}</>
                  )}
                </>
              ) : (
                t.overview.carwashMissing
              )}
              <CaretRight size={14} aria-hidden="true" />
            </Link>
          )}
          <DayCloseLink />
        </div>
      </div>
      <div className="today__side">
        <ShopSunrise />
        {lastDays.data && (
          <figure className="today__dots">
            <DayBars values={lastDays.data.points.map((point) => point.revenue)} label={t.overview.salesLast30Days} />
            <figcaption>{t.overview.last30Days}</figcaption>
          </figure>
        )}
      </div>
    </section>
  );
}

/** "2 / 4 end-of-day checks done", standing out once it's closing time and some are still open. */
function DayCloseLink() {
  const t = useT();
  const day = useDayChecklist();
  // Checked on each refetch (every minute), not on every render.
  const due = Boolean(day.data && !day.data.done) && new Date(day.dataUpdatedAt).getHours() >= CLOSING_HOUR;
  if (!day.data) return null;
  const { done, total } = checklistProgress(day.data);
  return (
    <Link to="/cash" className={due ? 'today__link today__link--due' : 'today__link'}>
      <strong>
        {done} / {total}
      </strong>{' '}
      {t.dayClose.overviewLink}
      <CaretRight size={14} aria-hidden="true" />
    </Link>
  );
}

/** Warnings worked out from sales, stock, counts and write-offs, most urgent first. */
function AttentionPanel() {
  const t = useT();
  const insights = useQuery({ queryKey: ['reports', 'insights'], queryFn: reportsApi.insights, refetchInterval: 60_000 });

  return (
    <Card title={t.overview.attention}>
      {insights.isPending && <Loading />}
      {insights.isError && <ErrorNotice error={insights.error} onRetry={() => insights.refetch()} />}
      {insights.data && insights.data.length === 0 && (
        <EmptyState title={t.overview.allClear}>{t.overview.allClearHint}</EmptyState>
      )}
      {insights.data && insights.data.length > 0 && (
        <ul className="restock-list">
          {insights.data.map((insight) => (
            <li key={`${insight.kind}-${insight.productId}-${insight.title}`}>
              <Link
                to={insight.customerId ? `/customers/${insight.customerId}` : `/inventory/${insight.productId}`}
                className={`attention__row attention__row--${insight.severity}`}
              >
                <span className="attention__severity">{t.overview.severity[insight.severity]}</span>
                <span>
                  <span className="restock-list__name">{insight.title}</span>
                  <span className="attention__detail">{insight.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCurrentUser } from '../auth/useAuth';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { RevenueChart } from '../components/RevenueChart';
import { StockTag } from '../components/StockTag';
import { analyticsApi, approvalsApi, inventoryApi, reportsApi } from '../services/api';
import type { Insight } from '../services/types';
import { formatMoney } from '../utils/format';

const PERIOD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function OverviewPage() {
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
      <header className="page-header">
        <h1 className="page-title">Hi {firstName}</h1>
        <p className="page-intro">
          {lowCount === undefined
            ? 'Checking stock levels…'
            : lowCount === 0
              ? 'Every product is above its reorder level.'
              : `${lowCount} ${lowCount === 1 ? 'product needs' : 'products need'} restocking${outCount ? `, ${outCount} already sold out` : ''}.`}
        </p>
      </header>

      <TodayBoard lowCount={lowCount} />

      <AttentionPanel />

      <section className="panel" aria-labelledby="restock-heading">
        <div className="panel__header">
          <h2 id="restock-heading" className="panel__title">
            Needs restocking
          </h2>
          <Link to="/inventory?lowStock=true" className="text-link">
            See all stock
          </Link>
        </div>

        {lowStock.isPending && <Loading />}
        {lowStock.isError && <ErrorNotice error={lowStock.error} onRetry={() => lowStock.refetch()} />}
        {lowStock.data && lowStock.data.items.length === 0 && (
          <EmptyState title="Nothing to restock">Every product has more than its reorder level.</EmptyState>
        )}
        {lowStock.data && lowStock.data.items.length > 0 && (
          <ul className="restock-list">
            {lowStock.data.items.map((item) => (
              <li key={item.productId}>
                <Link to={`/inventory/${item.productId}`} className="restock-list__row">
                  <StockTag quantity={item.quantity} reorderLevel={item.reorderLevel} />
                  <span className="restock-list__name">{item.productName}</span>
                  <span className="restock-list__meta">Reorder at {item.reorderLevel}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SalesSummary />
    </>
  );
}

const weekdayFormatter = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });

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

/** The shop's day on one slate board: the figure the owner checks first, and what's waiting. */
function TodayBoard({ lowCount }: { lowCount: number | undefined }) {
  // Fixed once per visit so the query key doesn't change on every render.
  const [range] = useState(() => todayRange());
  const today = useQuery({ queryKey: ['reports', 'summary', 'today', range.startDate], queryFn: () => reportsApi.summary(range) });
  const approvals = useQuery({ queryKey: ['approvals', 'summary'], queryFn: approvalsApi.summary });
  const weekday = weekdayFormatter.format(new Date());
  const current = today.data?.current;
  const previous = today.data?.previous;
  const change = today.data?.change.revenue ?? null;
  const waiting = approvals.data?.total ?? 0;

  return (
    <section className="today-board" aria-label="Today so far">
      <div className="today-board__main">
        <p className="today-board__label">Sales today</p>
        <p className="today-board__figure">{current ? formatMoney(current.revenue) : today.isError ? 'Not available' : '…'}</p>
        {current && previous && (
          <p className="today-board__compare">
            {change === null
              ? `Nothing sold by this time last ${weekday}.`
              : `${change >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(change * 100))}% against last ${weekday}, which had ${formatMoney(previous.revenue)} by this time`}
          </p>
        )}
      </div>
      <dl className="today-board__figures">
        <div>
          <dt>Sales</dt>
          <dd>{current?.salesCount ?? '–'}</dd>
        </div>
        <div>
          <dt>Profit</dt>
          <dd>{current ? formatMoney(current.profit) : '–'}</dd>
        </div>
        <div>
          <dt>Items sold</dt>
          <dd>{current?.unitsSold ?? '–'}</dd>
        </div>
      </dl>
      <div className="today-board__tags">
        <Link to="/approvals" className={`today-tag${waiting > 0 ? ' today-tag--on' : ''}`}>
          <span className="today-tag__count">{waiting}</span> waiting for you
        </Link>
        <Link to="/inventory?lowStock=true" className={`today-tag${lowCount ? ' today-tag--on' : ''}`}>
          <span className="today-tag__count">{lowCount ?? '–'}</span> to restock
        </Link>
      </div>
    </section>
  );
}

const SEVERITY_LABEL: Record<Insight['severity'], string> = { urgent: 'Urgent', warning: 'Check', info: 'Idea' };

/** Warnings worked out from sales, stock, counts and write-offs, most urgent first. */
function AttentionPanel() {
  const insights = useQuery({ queryKey: ['reports', 'insights'], queryFn: reportsApi.insights });

  return (
    <section className="panel" aria-labelledby="attention-heading">
      <div className="panel__header">
        <h2 id="attention-heading" className="panel__title">
          Needs your attention
        </h2>
      </div>
      {insights.isPending && <Loading />}
      {insights.isError && <ErrorNotice error={insights.error} onRetry={() => insights.refetch()} />}
      {insights.data && insights.data.length === 0 && (
        <EmptyState title="All clear">Nothing is running out, missing or selling oddly.</EmptyState>
      )}
      {insights.data && insights.data.length > 0 && (
        <ul className="restock-list">
          {insights.data.map((insight) => (
            <li key={`${insight.kind}-${insight.productId}-${insight.title}`}>
              <Link to={`/inventory/${insight.productId}`} className={`attention__row attention__row--${insight.severity}`}>
                <span className="attention__severity">{SEVERITY_LABEL[insight.severity]}</span>
                <span>
                  <span className="restock-list__name">{insight.title}</span>
                  <span className="attention__detail">{insight.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SalesSummary() {
  const dashboard = useQuery({
    queryKey: ['analytics', 'dashboard', PERIOD_DAYS],
    queryFn: () => analyticsApi.dashboard(PERIOD_DAYS),
  });
  const revenue = useQuery({
    queryKey: ['analytics', 'revenue', 'daily', PERIOD_DAYS],
    queryFn: () =>
      // Start of the day 29 days ago, so the chart shows exactly 30 whole days.
      analyticsApi.revenue('daily', new Date(Date.now() - (PERIOD_DAYS - 1) * MS_PER_DAY).toISOString().slice(0, 10)),
  });

  return (
    <section className="panel" aria-labelledby="sales-heading">
      <div className="panel__header">
        <h2 id="sales-heading" className="panel__title">
          Last {PERIOD_DAYS} days
        </h2>
        <Link to="/sales" className="text-link">
          See all sales
        </Link>
      </div>

      {dashboard.isPending && <Loading />}
      {dashboard.isError && <ErrorNotice error={dashboard.error} onRetry={() => dashboard.refetch()} />}
      {dashboard.data && (
        <>
          <div className="summary">
            <div className="summary__hero">
              <span className="summary__hero-value">{formatMoney(dashboard.data.totalRevenue)}</span>
              <span className="summary__label">in sales</span>
            </div>
            <dl className="summary__figures">
              <div>
                <dt>Profit</dt>
                <dd>{formatMoney(dashboard.data.totalProfit)}</dd>
              </div>
              <div>
                <dt>Units sold</dt>
                <dd>{dashboard.data.unitsSold}</dd>
              </div>
              <div>
                <dt>Stock on hand is worth</dt>
                <dd>{formatMoney(dashboard.data.inventoryValue)}</dd>
              </div>
            </dl>
          </div>

          {revenue.data && <RevenueChart points={revenue.data.points} title="Sales per day" />}

          {dashboard.data.topProducts.length > 0 ? (
            <>
              <h3 className="subheading">Best sellers</h3>
              <ol className="top-products">
                {dashboard.data.topProducts.map((product) => (
                  <li key={product.productId}>
                    <Link to={`/products/${product.productId}`} className="table__primary-link">
                      {product.productName}
                    </Link>
                    <span className="top-products__figures">
                      {formatMoney(product.revenue)}, {product.unitsSold} sold
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="field-hint">No sales yet in this period. Record one on the Sales page.</p>
          )}
        </>
      )}
    </section>
  );
}

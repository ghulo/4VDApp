import { Coins, Drop, MoonStars, Package, Receipt } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCurrentUser } from '../auth/useAuth';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { useDayChecklist } from '../utils/useDayChecklist';
import { ProductPhoto } from '../components/ProductPhoto';
import { StockTag } from '../components/StockTag';
import { SetupGuide } from '../setup/SetupGuide';
import { analyticsApi, inventoryApi, reportsApi } from '../services/api';
import { TodoList } from '../components/TodoList';
import { useAttention } from '../utils/useAttention';
import { formatDateWith, formatHeadlineMoney, formatMoney, formatTimes, MUCH_MORE } from '../utils/format';
import { ButtonLink, Card, DayBars, ShopSunrise, StatGrid, StatTile } from '../components/ui';
import { useT } from '../i18n/useT';
import { useCarwashes } from '../utils/useCarwashes';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Days in the Today card's dot strip. */
const DOT_DAYS = 30;
/** From this hour an unfinished end-of-day checklist stands out on Today. */
const CLOSING_HOUR = 18;
/** To do items shown here; the Inbox has the rest. */
const TODO_ON_OVERVIEW = 6;
/** Products in the restock list; the Stock page has the rest. */
const RESTOCK_ON_OVERVIEW = 5;

export function OverviewPage() {
  const t = useT();
  const lowStock = useQuery({
    queryKey: ['inventory', { lowStock: true, page: 1, limit: RESTOCK_ON_OVERVIEW }],
    queryFn: () => inventoryApi.list({ page: 1, lowStock: true, limit: RESTOCK_ON_OVERVIEW }),
  });

  const lowCount = lowStock.data?.meta.total;

  // The morning page (DESIGN.md 3.8): what needs you first and largest, then
  // the day in a slim strip, setup while unfinished, restocking, Reports.
  return (
    <>
      <OverviewHero />

      <AttentionPanel />

      {/* The day as one panel: the sentence and the last 30 days, then the figures under a hairline. */}
      <section className="today-panel" aria-label={t.overview.todaySoFar}>
        <TodayCard />
        <TodayFigures lowCount={lowCount} />
      </section>

      <SetupGuide />

      {/* Nothing to restock already says so on its tile above, so the list only shows when it has rows. */}
      {(lowStock.isPending || lowStock.isError || (lowCount ?? 0) > 0) && (
        <Card
          title={t.overview.needsRestocking}
          actions={
            <Link to="/inventory?status=low" className="text-link">
              {lowCount !== undefined && lowCount > RESTOCK_ON_OVERVIEW ? t.overview.seeAllRestock(lowCount) : t.overview.seeAllStock}
            </Link>
          }
        >
          {lowStock.isPending && <Loading />}
          {lowStock.isError && <ErrorNotice error={lowStock.error} onRetry={() => lowStock.refetch()} />}
          {lowStock.data && lowStock.data.items.length > 0 && (
            <ul className="restock-list">
              {lowStock.data.items.map((item) => (
                <li key={item.productId}>
                  <Link to={`/products/${item.productId}`} className="restock-list__row">
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
      )}

      <p className="overview__more">
        <Link to="/reports" className="text-link">
          {t.overview.seeReports}
        </Link>
      </p>
    </>
  );
}

/** The greeting for the hour: morning until noon, afternoon until six. */
function greeting(t: ReturnType<typeof useT>, hour: number): string {
  if (hour < 12) return t.overview.morning;
  if (hour < 18) return t.overview.afternoon;
  return t.overview.evening;
}

/**
 * The top of the morning page: the date, a greeting and the day's main action,
 * with the shop at sunrise (the 4VD mark's scene) standing on the page's rule.
 */
function OverviewHero() {
  const t = useT();
  const user = useCurrentUser();
  const [now] = useState(() => new Date());
  const firstName = user.name.split(' ')[0] || user.name;
  return (
    <header className="overview-hero">
      <div className="overview-hero__art">
        <ShopSunrise />
      </div>
      <div className="overview-hero__text">
        <p className="overview-hero__kicker">
          {t.nav.items.overview} · {formatDateWith(now, { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="overview-hero__title">{t.overview.greeting(greeting(t, now.getHours()), firstName)}</h1>
      </div>
      {user.role !== 'owner' && (
        <div className="overview-hero__actions">
          <ButtonLink to="/sales?new=1" variant="primary" icon={Receipt}>
            {t.sales.record}
          </ButtonLink>
        </div>
      )}
    </header>
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
 * with the same hours last week, and the last 30 days. Calm on a quiet morning.
 */
function TodayCard() {
  const t = useT();
  // Fixed once per visit so the query key doesn't change on every render.
  const [range] = useState(() => todayRange());
  // The team keeps selling while this page is open, so today's figures check again every minute.
  const today = useQuery({
    queryKey: ['reports', 'summary', 'today', range.startDate],
    queryFn: () => reportsApi.summary(range),
    refetchInterval: 60_000,
  });
  const weekday = formatDateWith(new Date(range.endDate), { weekday: 'long' });
  const current = today.data?.current;
  const previous = today.data?.previous;
  const change = today.data?.change.revenue ?? null;
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
    if (change > MUCH_MORE) return t.overview.timesLastWeek({ times: formatTimes(change), weekday, amount });
    return t.overview.comparedLastWeek({ up: change >= 0, percent: Math.abs(Math.round(change * 100)), weekday, amount });
  }

  return (
    <div className="today" aria-busy={today.isPending}>
      <div className="today__text">
        {today.isPending && <Loading />}
        {today.isError && <ErrorNotice error={today.error} onRetry={() => today.refetch()} />}
        {current && (
          <>
            <p className="today__headline">
              {current.salesCount > 0
                ? t.overview.takenToday({ amount: formatHeadlineMoney(current.revenue), count: current.salesCount })
                : t.overview.noSalesToday}
            </p>
            <p className="today__compare">{compare()}</p>
          </>
        )}
      </div>
      {lastDays.data && (
        <figure className="today__dots">
          <DayBars values={lastDays.data.points.map((point) => point.revenue)} label={t.overview.salesLast30Days} />
          <figcaption>{t.overview.last30Days}</figcaption>
        </figure>
      )}
    </div>
  );
}

/**
 * The rest of the day as figures you can open: profit, the carwash, what to
 * restock and how far the closing checks are. Each tile goes to its page.
 */
function TodayFigures({ lowCount }: { lowCount: number | undefined }) {
  const t = useT();
  const [range] = useState(() => todayRange());
  const { places: openCarwashes } = useCarwashes();
  // Same query as the Today strip, so this costs no extra request.
  const today = useQuery({
    queryKey: ['reports', 'summary', 'today', range.startDate],
    queryFn: () => reportsApi.summary(range),
    refetchInterval: 60_000,
  });
  const day = useDayChecklist();
  // Checked on each refetch (every minute), not on every render.
  const closingDue = Boolean(day.data && !day.data.allDone) && new Date(day.dataUpdatedAt).getHours() >= CLOSING_HOUR;
  if (!today.data) return null;
  const { current, carwash } = today.data;
  const carwashEntered = carwash.current.days > 0;
  // Only worth saying once some are in: "Not entered" already covers none.
  const someCarwashesMissing = carwashEntered && openCarwashes.length > 1 && carwash.byCarwash.length < openCarwashes.length;

  return (
    <StatGrid>
      <StatTile
        icon={Coins}
        label={t.overview.profitToday}
        value={formatHeadlineMoney(current.profit)}
        hint={t.overview.itemsSold(current.unitsSold)}
        to="/sales"
      />
      <StatTile
        icon={Drop}
        label={t.overview.carwashTile}
        value={formatHeadlineMoney(carwash.current.total)}
        words={!carwashEntered && t.overview.notEntered}
        hint={someCarwashesMissing ? t.overview.carwashSome(carwash.byCarwash.length, openCarwashes.length) : undefined}
        to="/carwash"
      />
      <StatTile
        icon={Package}
        label={t.overview.restockTile}
        value={lowCount ?? '–'}
        words={lowCount === 0 && t.overview.restockNone}
        hint={t.overview.restockHint}
        tone={lowCount ? 'warn' : 'default'}
        to="/inventory?status=low"
      />
      {day.data && (
        <StatTile
          icon={MoonStars}
          label={t.overview.closingTile}
          value={`${day.data.done} / ${day.data.total}`}
          hint={day.data.allDone ? t.overview.closingDone : closingDue ? t.overview.closingDue : t.overview.closingLeft(day.data.total - day.data.done)}
          tone={closingDue ? 'warn' : 'default'}
          to="/day"
        />
      )}
    </StatGrid>
  );
}


/**
 * What needs you, first and largest (DESIGN.md 3.3): the same list as the Inbox
 * and the menu badge, grouped the same way, with the most pressing few here.
 */
function AttentionPanel() {
  const t = useT();
  const attention = useAttention();
  const todo = attention.data?.todo ?? [];
  // The list comes most urgent first, so the top few are the ones that matter this morning.
  const shown = todo.slice(0, TODO_ON_OVERVIEW);

  return (
    <section className="overview-section" aria-labelledby="overview-todo">
      <div className="overview-section__head">
        <h2 id="overview-todo" className="overview-section__title">
          {t.todo.title}
        </h2>
        {todo.length > 0 && (
          <Link to="/inbox" className="text-link">
            {todo.length > shown.length ? t.overview.seeAllTodo(todo.length) : t.overview.openInbox}
          </Link>
        )}
      </div>
      {attention.isPending && <Loading />}
      {attention.isError && <ErrorNotice error={attention.error} onRetry={() => attention.refetch()} />}
      {attention.data && todo.length === 0 && (
        <Card>
          <EmptyState title={t.todo.none}>{t.todo.noneHint}</EmptyState>
        </Card>
      )}
      {/* One sheet, most urgent first; each row names its urgency, so the list needs no group headings here. */}
      {shown.length > 0 && <TodoList items={shown} />}
    </section>
  );
}

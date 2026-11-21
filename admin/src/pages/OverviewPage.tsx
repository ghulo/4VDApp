import { CashRegister, ClipboardText, FileArrowDown, Plus, Receipt } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { useCurrentUser } from '../auth/useAuth';
import { canReadBooks } from '../auth/roles';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { useDayChecklist } from '../utils/useDayChecklist';
import { ProductPhoto } from '../components/ProductPhoto';
import { StockTag } from '../components/StockTag';
import { SetupGuide } from '../setup/SetupGuide';
import { analyticsApi, billsApi, inventoryApi, reportsApi } from '../services/api';
import { TodoList } from '../components/TodoList';
import { useAttention } from '../utils/useAttention';
import { formatDateWith, formatHeadlineMoney, formatMoney, formatPercent, formatTime, formatTimes, MUCH_MORE } from '../utils/format';
import { Badge, ButtonLink, Card, ColumnChart, MenuButton, type MenuItem, PageHeader, RollingNumber, StatGrid, StatTile } from '../components/ui';
import { useT } from '../i18n/useT';
import { useCarwashes } from '../utils/useCarwashes';
import { shownTo } from '../navigation/sections';
import { dayRange, startOfDay, useNow } from '../utils/today';

/** Days in the takings chart, today included. */
const CHART_DAYS = 30;
/** From this hour an unfinished end-of-day checklist stands out. */
const CLOSING_HOUR = 18;
/** To do items shown here; the Inbox has the rest. */
const TODO_ON_OVERVIEW = 5;
/** Rows in the Restock and Bills due lists; their pages have the rest. */
const ROWS_ON_OVERVIEW = 5;
/** Margin is shown only when sales without a cost price are at most this share of the day's takings. */
const NO_COST_LIMIT = 0.1;
/** A bill shows in "Bills due this week" when it is due within this many days (or late), like the Bills summary. */
const DUE_WITHIN_DAYS = 7;

/** "2026-11-21" for a local date: the shop's own day, never UTC's. */
const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/**
 * The shop's status board (DESIGN.md 3.8): the day in one line, then what
 * needs you beside how yesterday went, the day's figures, 30 days of takings,
 * and what to restock and pay. No greeting and no picture: the figures and the
 * jobs are the point.
 */
export function OverviewPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const books = canReadBooks(role);
  return (
    <>
      <PageHeader title={t.nav.items.overview} actions={<OverviewKeys />} />
      <SetupGuide />
      <TodayStrip />
      <div className="overview-desk">
        <AttentionPanel />
        <YesterdayCard />
      </div>
      <DayFigures books={books} />
      <TakingsChart />
      <div className={books ? 'overview-pair' : 'overview-pair overview-pair--one'}>
        <RestockCard />
        {books && <BillsDueCard />}
      </div>
    </>
  );
}

/** The owner's main key, Open Counter, and everything else to start in one "New" menu, each only for those who may. */
function OverviewKeys() {
  const t = useT();
  const { role } = useCurrentUser();
  const navigate = useNavigate();
  const items: MenuItem[] = [
    shownTo(role, { to: '/sales' }) && { label: t.sales.record, icon: Receipt, onSelect: () => navigate('/sales?new=1') },
    shownTo(role, { to: '/suppliers', accountant: true }) && { label: t.overview.actionBill, icon: FileArrowDown, onSelect: () => navigate('/bills/new') },
    shownTo(role, { to: '/counts' }) && { label: t.overview.actionCount, icon: ClipboardText, onSelect: () => navigate('/counts') },
  ].filter((item) => item !== false);
  const counter = shownTo(role, { to: '/counter' });
  if (!counter && items.length === 0) return null;
  return (
    <div className="overview-keys">
      {items.length > 0 && <MenuButton label={t.overview.newMenu} icon={Plus} items={items} variant="secondary" size="md" tooltip={false} />}
      {counter && (
        <ButtonLink to="/counter" variant="primary" icon={CashRegister}>
          {t.overview.openCounter}
        </ButtonLink>
      )}
    </div>
  );
}

/**
 * Today so far against the same hours last week. The day moves on at midnight
 * (or when the page comes back into view), and each refetch counts up to the
 * moment it runs, so sales made after the page opened are in.
 */
function useTodaySummary() {
  const midnight = startOfDay(useNow());
  const day = midnight.toISOString();
  const today = useQuery({
    queryKey: ['reports', 'summary', 'today', day],
    queryFn: () => reportsApi.summary(dayRange(new Date(day))),
    // The team keeps selling while this page is open, so today's figures check again every minute.
    refetchInterval: 60_000,
  });
  return { midnight, today };
}

/** The day in one line: the date, what came in so far and from how many sales, and how that compares with last week. */
function TodayStrip() {
  const t = useT();
  const { midnight, today } = useTodaySummary();
  const weekday = formatDateWith(midnight, { weekday: 'long' });
  const current = today.data?.current;
  const previous = today.data?.previous;
  const change = today.data?.change.revenue ?? null;

  function compare(): string | null {
    if (!current || !previous) return null;
    if (change === null) return t.overview.nothingLastWeek(weekday);
    const amount = formatMoney(previous.revenue);
    if (current.revenue === 0) return t.overview.lastWeekHad({ weekday, amount });
    if (change > MUCH_MORE) return t.overview.timesLastWeek({ times: formatTimes(change), weekday, amount });
    return t.overview.comparedLastWeek({ up: change >= 0, percent: Math.abs(Math.round(change * 100)), weekday, amount });
  }

  return (
    <section className="overview-strip" aria-labelledby="overview-today" aria-busy={today.isPending}>
      <p className="overview-strip__date">{formatDateWith(midnight, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h2 id="overview-today" className="overview-strip__label">
        {t.overview.todaySoFar}
      </h2>
      {today.isPending && <Loading />}
      {today.isError && <ErrorNotice error={today.error} onRetry={() => today.refetch()} />}
      {current && (
        <>
          <p className="overview-strip__figure">
            {current.salesCount > 0 ? (
              <>
                <strong className="overview-strip__amount">
                  <RollingNumber value={formatHeadlineMoney(current.revenue)} />
                </strong>
                <span className="overview-strip__count">{t.overview.salesCount(current.salesCount)}</span>
              </>
            ) : (
              <span className="overview-strip__none">{t.overview.noSalesToday}</span>
            )}
          </p>
          <p className="overview-strip__compare">
            {compare()} <span className="overview-strip__updated">{t.overview.updatedAt(formatTime(new Date(today.dataUpdatedAt).toISOString()))}</span>
          </p>
        </>
      )}
    </section>
  );
}

/**
 * What needs you, first and largest (DESIGN.md 3.3): the same list as the Inbox
 * and the menu badge, most urgent first, the top few here.
 */
function AttentionPanel() {
  const t = useT();
  const attention = useAttention();
  const todo = attention.data?.todo ?? [];
  const shown = todo.slice(0, TODO_ON_OVERVIEW);

  return (
    <section className="overview-section overview-desk__todo" aria-labelledby="overview-todo">
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

/** Did yesterday go well and close properly, and how far today's end-of-day checks are: the morning's second question. */
function YesterdayCard() {
  const t = useT();
  const now = useNow();
  const yesterday = addDays(startOfDay(now), -1);
  const yesterdayKey = isoDay(yesterday);
  const sales = useQuery({
    queryKey: ['reports', 'summary', 'day', yesterdayKey],
    queryFn: () => reportsApi.summary(dayRange(yesterday, now)),
    staleTime: 5 * 60_000,
  });
  const closed = useDayChecklist(yesterdayKey);
  const today = useDayChecklist();
  // Checked on each refetch (every minute), not on every render.
  const closingDue = Boolean(today.data && !today.data.allDone) && new Date(today.dataUpdatedAt).getHours() >= CLOSING_HOUR;
  const current = sales.data?.current;

  return (
    <Card title={t.overview.yesterday} className="overview-desk__side">
      <div className="overview-day">
        <p className="overview-day__label">{formatDateWith(yesterday, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        {sales.isPending && <Loading />}
        {sales.isError && <ErrorNotice error={sales.error} onRetry={() => sales.refetch()} />}
        {current && (
          <p className="overview-day__figure">
            <strong>
              <RollingNumber value={formatHeadlineMoney(current.revenue)} />
            </strong>
            <span>{t.overview.salesCount(current.salesCount)}</span>
          </p>
        )}
        {closed.data && (
          <Link to={`/day?date=${yesterdayKey}`} className="overview-day__close">
            {closed.data.allDone ? (
              <Badge tone="ok">{t.overview.dayClosed}</Badge>
            ) : (
              <Badge tone="warn">{t.overview.notClosed(closed.data.total - closed.data.done)}</Badge>
            )}
          </Link>
        )}
      </div>
      {today.data && (
        <Link to="/day" className={closingDue ? 'overview-day overview-day--link overview-day--due' : 'overview-day overview-day--link'}>
          <span className="overview-day__label">{t.overview.closingTile}</span>
          <span className="overview-day__figure">
            <strong>
              <RollingNumber value={`${today.data.done} / ${today.data.total}`} />
            </strong>
            <span>
              {today.data.allDone ? t.overview.closingDone : closingDue ? t.overview.closingDue : t.overview.closingLeft(today.data.total - today.data.done)}
            </span>
          </span>
        </Link>
      )}
    </Card>
  );
}

/**
 * The day's figures you can open: margin (only when costs cover the sales),
 * the carwash where there is one, and the bills that are due. Each tile goes to its page.
 */
function DayFigures({ books }: { books: boolean }) {
  const t = useT();
  const { places: carwashes } = useCarwashes();
  const seesPrices = shownTo(useCurrentUser().role, { to: '/prices', overseersOnly: true });
  // Same query as the strip, so this costs no extra request.
  const { today } = useTodaySummary();
  const bills = useQuery({ queryKey: ['bills', 'summary'], queryFn: billsApi.summary, enabled: books });
  if (!today.data) return null;
  const { current, carwash } = today.data;
  const carwashEntered = carwash.current.days > 0;
  // Only worth saying once some are in: "Not entered" already covers none.
  const someCarwashesMissing = carwashEntered && carwashes.length > 1 && carwash.byCarwash.length < carwashes.length;

  // Margin misleads when much of what sold has no cost price (TREFIN left 2,272 products without one): then say why instead.
  const noCostShare = current.revenue > 0 ? current.revenueWithoutCost / current.revenue : 0;
  const marginKnown = current.salesCount > 0 && current.margin !== null && noCostShare <= NO_COST_LIMIT;
  const withoutCost = current.productsWithoutCost ?? 0;

  const due = bills.data ? bills.data.overdue.amount + bills.data.dueSoon.amount : null;
  const dueCount = bills.data ? bills.data.overdue.count + bills.data.dueSoon.count : 0;

  return (
    <StatGrid>
      <StatTile
        label={t.overview.marginTile}
        value={marginKnown ? formatPercent(current.margin ?? 0) : '–'}
        words={current.salesCount === 0 ? t.overview.noSalesYet : !marginKnown && t.overview.marginUnknown}
        hint={
          current.salesCount === 0
            ? undefined
            : marginKnown
              ? t.overview.marginProfit(formatMoney(current.profit))
              : t.overview.marginNoCost(withoutCost)
        }
        to={!marginKnown && seesPrices && current.salesCount > 0 ? '/prices?show=noCost' : '/sales'}
      />
      {carwashes.length > 0 && (
        <StatTile
          label={t.overview.carwashTile}
          value={formatHeadlineMoney(carwash.current.total)}
          words={!carwashEntered && t.overview.notEntered}
          hint={someCarwashesMissing ? t.overview.carwashSome(carwash.byCarwash.length, carwashes.length) : undefined}
          to="/carwash"
        />
      )}
      {books && bills.data && due !== null && (
        <StatTile
          label={t.overview.billsTile}
          value={formatHeadlineMoney(due)}
          words={dueCount === 0 && t.overview.billsNone}
          hint={
            dueCount === 0
              ? undefined
              : bills.data.overdue.count > 0
                ? t.overview.billsLate(bills.data.overdue.count, formatMoney(bills.data.overdue.amount))
                : t.overview.billsThisWeek(dueCount)
          }
          tone={bills.data.overdue.count > 0 ? 'warn' : 'default'}
          to="/bills"
        />
      )}
    </StatGrid>
  );
}

/** Takings day by day for 30 days, dated, today in the strong amber, a hairline at the usual day. */
function TakingsChart() {
  const t = useT();
  const midnight = startOfDay(useNow());
  const from = addDays(midnight, -(CHART_DAYS - 1));
  const days = useQuery({
    queryKey: ['analytics', 'revenue', 'daily', CHART_DAYS, isoDay(midnight)],
    // From the shop's midnight 29 days ago, so the chart shows exactly 30 whole days, today last.
    queryFn: () => analyticsApi.revenue('daily', from.toISOString()),
    refetchInterval: 5 * 60_000,
  });
  const todayKey = isoDay(midnight);
  const points = days.data?.points ?? [];
  const before = points.filter((point) => point.periodStart !== todayKey);
  const average = before.length > 0 ? before.reduce((sum, point) => sum + point.revenue, 0) / before.length : undefined;
  const columns = points.map((point) => {
    const [year, month, day] = point.periodStart.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return {
      key: point.periodStart,
      label: String(day),
      description: `${formatDateWith(date, { weekday: 'short', day: 'numeric', month: 'short' })}: ${formatMoney(point.revenue)}`,
      value: point.revenue,
    };
  });

  return (
    <Card
      title={t.overview.takings30}
      description={average !== undefined ? t.overview.usualDay(formatMoney(average)) : undefined}
      actions={
        <Link to="/report" className="text-link">
          {t.nav.items.reports}
        </Link>
      }
    >
      {days.isPending && <Loading />}
      {days.isError && <ErrorNotice error={days.error} onRetry={() => days.refetch()} />}
      {days.data && <ColumnChart columns={columns} label={t.overview.takings30} highlight={todayKey} average={average} />}
    </Card>
  );
}

/** What is at or below its reorder level, the lowest first. */
function RestockCard() {
  const t = useT();
  const lowStock = useQuery({
    queryKey: ['inventory', { lowStock: true, page: 1, limit: ROWS_ON_OVERVIEW }],
    queryFn: () => inventoryApi.list({ page: 1, lowStock: true, limit: ROWS_ON_OVERVIEW }),
  });
  const lowCount = lowStock.data?.meta.total;
  return (
    <Card
      title={lowCount ? t.overview.restockCount(lowCount) : t.overview.needsRestocking}
      actions={
        <Link to="/inventory?status=low" className="text-link">
          {lowCount !== undefined && lowCount > ROWS_ON_OVERVIEW ? t.overview.seeAllRestock(lowCount) : t.overview.seeAllStock}
        </Link>
      }
    >
      {lowStock.isPending && <Loading />}
      {lowStock.isError && <ErrorNotice error={lowStock.error} onRetry={() => lowStock.refetch()} />}
      {lowStock.data && lowStock.data.items.length === 0 && <p className="overview-quiet">{t.overview.restockNone}</p>}
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
  );
}

/** Supplier bills late or due in the next 7 days, the most pressing first. Only for those who read the books. */
function BillsDueCard() {
  const t = useT();
  const open = useQuery({ queryKey: ['bills', { status: 'open' }], queryFn: () => billsApi.list({ status: 'open' }) });
  const due = (open.data ?? [])
    .filter((bill) => bill.kind === 'bill' && bill.left > 0 && bill.daysLeft !== null && bill.daysLeft <= DUE_WITHIN_DAYS)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  const shown = due.slice(0, ROWS_ON_OVERVIEW);

  function when(daysLeft: number): string {
    if (daysLeft < 0) return t.overview.daysLate(-daysLeft);
    if (daysLeft === 0) return t.overview.dueToday;
    return t.overview.dueIn(daysLeft);
  }

  return (
    <Card
      title={t.overview.billsDueWeek}
      actions={
        <Link to="/bills" className="text-link">
          {due.length > shown.length ? t.overview.seeAllBills(due.length) : t.overview.openBills}
        </Link>
      }
    >
      {open.isPending && <Loading />}
      {open.isError && <ErrorNotice error={open.error} onRetry={() => open.refetch()} />}
      {open.data && shown.length === 0 && <p className="overview-quiet">{t.overview.billsNoneWeek}</p>}
      {shown.length > 0 && (
        <ul className="restock-list">
          {shown.map((bill) => (
            <li key={bill.id}>
              <Link to={`/bills/${bill.id}`} className="restock-list__row bills-due__row">
                <span className="restock-list__name">{bill.supplier?.name ?? bill.number ?? t.overview.billNoSupplier}</span>
                <span className={bill.overdue ? 'restock-list__meta bills-due__when bills-due__when--late' : 'restock-list__meta bills-due__when'}>
                  {when(bill.daysLeft ?? 0)}
                </span>
                <span className="bills-due__amount">{formatMoney(bill.left)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

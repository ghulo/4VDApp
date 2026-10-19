import {
  ArrowCounterClockwise,
  CalendarX,
  CaretRight,
  Car,
  ClipboardText,
  Coins,
  type Icon,
  Notebook,
  Package,
  Receipt,
  Sparkle,
  Truck,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { useCurrentUser } from '../../auth/useAuth';
import { ErrorNotice } from '../../components/Feedback';
import { TodoList } from '../../components/TodoList';
import { Badge, ShopSunrise } from '../../components/ui';
import { useT } from '../../i18n/useT';
import { customersApi, inventoryApi, stockCountsApi } from '../../services/api';
import { checkoutSummary, DELIVERIES_KEY, dayRange, MY_SALES_KEY, monthRange, teamApi } from '../../services/teamApi';
import { formatDateWith, formatHeadlineMoney, formatMoney, formatTime } from '../../utils/format';
import { useAttention } from '../../utils/useAttention';
import { useDayChecklist } from '../../utils/useDayChecklist';

const LOW_STOCK_SHOWN = 5;
const RECENT_SALES_SHOWN = 3;
/** Decided requests stay on Home this long, so a rejection reason isn't missed. */
const DECIDED_SHOWN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Home for the counter staff (the team app's Home, in the dashboard): the day
 * in one strip, what needs them, the things that happen at the counter, their
 * jobs, their requests, what's running low and their latest sales.
 */
export function StaffHomePage() {
  const t = useT();
  const user = useCurrentUser();
  // Fixed for the visit, so the ranges (and the queries keyed on them) stay put while it is open.
  const [now] = useState(() => new Date());
  const day = dayRange(now);
  const month = monthRange(now);
  const monthName = formatDateWith(month.start, { month: 'long' });

  const today = useQuery({ queryKey: [...MY_SALES_KEY, day.startDate], queryFn: () => teamApi.mySales(day) });
  const thisMonth = useQuery({ queryKey: [...MY_SALES_KEY, month.startDate], queryFn: () => teamApi.mySales(month) });
  const recent = useQuery({
    queryKey: [...MY_SALES_KEY, 'checkouts', month.startDate, RECENT_SALES_SHOWN],
    queryFn: () => teamApi.myCheckouts({ startDate: month.startDate, endDate: month.endDate, limit: RECENT_SALES_SHOWN }),
  });
  const shop = useDayChecklist();
  const counts = useQuery({ queryKey: ['stock-counts'], queryFn: stockCountsApi.list });
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list });
  const requests = useQuery({ queryKey: ['approvals', 'mine'], queryFn: teamApi.myRequests });
  const deliveries = useQuery({ queryKey: DELIVERIES_KEY, queryFn: teamApi.deliveries });
  const lowStock = useQuery({ queryKey: ['inventory', 'low', LOW_STOCK_SHOWN], queryFn: () => inventoryApi.list({ page: 1, lowStock: true, limit: LOW_STOCK_SHOWN }) });
  const attention = useAttention();

  const steps = (shop.data?.steps ?? []).filter((step) => step.kind === 'drawer' || step.kind === 'carwash');
  const stepsDone = steps.filter((step) => step.done).length;
  // Only once the steps are in, so a slow network never says "closed up" by mistake.
  const closedUp = Boolean(shop.data) && steps.length > 0 && stepsDone === steps.length;
  const hasCarwash = steps.some((step) => step.kind === 'carwash');
  const openCounts = counts.data?.filter((count) => count.status === 'open').length ?? 0;
  const owing = (customers.data ?? []).filter((customer) => customer.balance > 0);
  const visibleRequests = (requests.data ?? []).filter(
    (request) =>
      request.status === 'pending' ||
      request.status === 'submitted' ||
      (request.decidedAt !== null && now.getTime() - new Date(request.decidedAt).getTime() < DECIDED_SHOWN_DAYS * DAY_MS),
  );
  const hour = now.getHours();
  const hello = hour < 12 ? t.staff.home.morning : hour < 18 ? t.staff.home.afternoon : t.staff.home.evening;
  const target = thisMonth.data?.monthlyTarget ?? null;

  return (
    <div className="staff-home">
      <header className="staff-home__hero">
        <p className="overview-hero__kicker">{formatDateWith(now, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="overview-hero__title">{t.staff.home.greeting(hello, user.name.split(' ')[0] ?? user.name)}</h1>
      </header>

      {/* The day in one strip; selling itself is the Sell tab. */}
      <Link to="/my-sales" className="staff-today">
        <span className="staff-today__art" aria-hidden="true">
          <ShopSunrise />
        </span>
        <span className="staff-today__text">
          <span className="staff-today__headline" aria-live="polite">
            {today.data
              ? today.data.current.salesCount > 0
                ? t.staff.home.takenToday(formatHeadlineMoney(today.data.current.revenue), today.data.current.salesCount)
                : t.staff.home.noSalesToday
              : '…'}
          </span>
          {thisMonth.data && <span className="staff-today__detail">{t.staff.home.salesIn(thisMonth.data.current.salesCount, monthName)}</span>}
          {closedUp && <span className="staff-today__detail staff-today__detail--ok">{t.staff.home.closedUp}</span>}
        </span>
        <CaretRight size={18} aria-hidden="true" />
      </Link>
      {thisMonth.data && target !== null && target > 0 && <TargetBar revenue={thisMonth.data.current.revenue} target={target} monthName={monthName} />}

      <StaffSection title={t.staff.home.todo}>
        {attention.isError && <ErrorNotice error={attention.error} onRetry={() => attention.refetch()} />}
        {attention.data && attention.data.todo.length === 0 && <p className="staff-muted">{t.staff.home.nothingToDo}</p>}
        {attention.data && attention.data.todo.length > 0 && <TodoList items={attention.data.todo} />}
      </StaffSection>

      <StaffSection title={t.staff.home.somethingHappened}>
        <ul className="staff-rows">
          <ActionRow to="/my-sales" icon={ArrowCounterClockwise} title={t.staff.home.happened.returnSale} hint={t.staff.home.happened.returnSaleHint} />
          <ActionRow to="/catalog?then=writeOff" icon={Package} title={t.staff.home.happened.damage} hint={t.staff.home.happened.damageHint} />
          <ActionRow to="/catalog?then=expiry" icon={CalendarX} title={t.staff.home.happened.expiry} hint={t.staff.home.happened.expiryHint} />
          <ActionRow to="/new-product" icon={Sparkle} title={t.staff.home.happened.newProduct} hint={t.staff.home.happened.newProductHint} />
          <ActionRow to="/scan-bill" icon={Receipt} title={t.staff.home.happened.supplierBill} hint={t.staff.home.happened.supplierBillHint} />
          {hasCarwash && <ActionRow to="/shift#carwash" icon={Car} title={t.staff.home.happened.carwash} hint={t.staff.home.happened.carwashHint} />}
        </ul>
      </StaffSection>

      <div className="staff-jobs">
        <JobTile
          to="/shift"
          icon={Coins}
          title={t.staff.home.endShift}
          detail={steps.length > 0 && stepsDone === steps.length ? t.staff.home.shiftDone : t.staff.home.shiftSteps(stepsDone, steps.length)}
        />
        <JobTile to="/counts" icon={ClipboardText} title={t.staff.home.stockCount} detail={openCounts > 0 ? t.staff.home.countsOpen(openCounts) : t.staff.home.startCount} />
        <JobTile
          to="/tabs"
          icon={Notebook}
          title={t.staff.home.tabs}
          detail={
            owing.length > 0
              ? t.staff.home.tabsOwed(formatMoney(owing.reduce((sum, customer) => sum + customer.balance, 0)), owing.length)
              : t.staff.home.tabsNone
          }
        />
        {/* Only while something is on its way, so Home stays calm the rest of the time. */}
        {(deliveries.data?.length ?? 0) > 0 && (
          <JobTile to="/deliveries" icon={Truck} title={t.staff.home.deliveries} detail={t.staff.home.deliveriesWaiting(deliveries.data!.length)} />
        )}
      </div>

      {visibleRequests.length > 0 && (
        <StaffSection title={t.staff.home.yourRequests}>
          <ul className="staff-rows">
            {visibleRequests.map((request) => {
              const rejected = request.status === 'rejected' || request.status === 'undone';
              const waiting = request.status === 'pending' || request.status === 'submitted';
              return (
                <li key={`${request.type}-${request.id}`} className="staff-row staff-row--static">
                  <span className="staff-row__text">
                    <span className="staff-row__title">{request.summary}</span>
                    {rejected && request.decisionNote && <span className="staff-row__hint">{request.decisionNote}</span>}
                  </span>
                  <Badge tone={rejected ? 'danger' : waiting ? 'warn' : 'ok'}>{t.staff.home.requestStatus[request.status] ?? request.status}</Badge>
                </li>
              );
            })}
          </ul>
        </StaffSection>
      )}

      <StaffSection title={t.staff.home.runningLow}>
        {lowStock.isError && <ErrorNotice error={lowStock.error} onRetry={() => lowStock.refetch()} />}
        {lowStock.data?.items.length === 0 && <p className="staff-muted">{t.staff.home.wellStocked}</p>}
        {lowStock.data && lowStock.data.items.length > 0 && (
          <ul className="staff-rows">
            {lowStock.data.items.map((item) => (
              <li key={item.productId}>
                <Link to={`/catalog/${item.productId}`} className="staff-row">
                  <span className={item.quantity === 0 ? 'staff-signal staff-signal--out' : 'staff-signal'} aria-hidden="true" />
                  <span className="staff-row__title staff-row__grow">{item.productName}</span>
                  <span className={item.quantity === 0 ? 'staff-row__value staff-row__value--out' : 'staff-row__value'}>
                    {item.quantity === 0 ? t.staff.home.soldOut : t.staff.home.left(item.quantity)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {lowStock.data && lowStock.data.meta.total > lowStock.data.items.length && (
          <p className="staff-muted">{t.staff.home.andMore(lowStock.data.meta.total - lowStock.data.items.length)}</p>
        )}
      </StaffSection>

      <StaffSection title={t.staff.home.latestSales}>
        {recent.data?.length === 0 && <p className="staff-muted">{t.staff.home.noSalesYet}</p>}
        {recent.data && recent.data.length > 0 && (
          <ul className="staff-rows">
            {recent.data.map((checkout) => (
              <li key={checkout.key}>
                <Link to="/my-sales" className="staff-row">
                  <span className="staff-row__title staff-row__grow staff-row__clip">{checkoutSummary(checkout)}</span>
                  <span className="staff-row__value">{formatMoney(checkout.total)}</span>
                  <span className="staff-row__time">{saleTime(checkout.saleDate, now)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </StaffSection>
    </div>
  );
}

/** "10:42" for today, "28 Sep" for earlier days. */
function saleTime(iso: string, now: Date): string {
  const date = new Date(iso);
  return date.toDateString() === now.toDateString() ? formatTime(iso) : formatDateWith(date, { day: 'numeric', month: 'short' });
}

export function StaffSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="staff-section">
      <h2 className="staff-section__title">{title}</h2>
      {children}
    </section>
  );
}

/** One thing that can happen at the counter, opening where it gets reported. */
function ActionRow({ to, icon: RowIcon, title, hint }: { to: string; icon: Icon; title: string; hint: string }) {
  return (
    <li>
      <Link to={to} className="staff-row">
        <span className="todo-row__icon" aria-hidden="true">
          <RowIcon size={20} />
        </span>
        <span className="staff-row__text staff-row__grow">
          <span className="staff-row__title">{title}</span>
          <span className="staff-row__hint">{hint}</span>
        </span>
        <CaretRight size={18} aria-hidden="true" className="staff-row__caret" />
      </Link>
    </li>
  );
}

/** A job the bottom tabs don't cover, as a tile with its icon. */
function JobTile({ to, icon: TileIcon, title, detail }: { to: string; icon: Icon; title: string; detail: string }) {
  return (
    <Link to={to} className="staff-job">
      <span className="todo-row__icon" aria-hidden="true">
        <TileIcon size={20} />
      </span>
      <span className="staff-job__title">{title}</span>
      <span className="staff-job__detail">{detail}</span>
    </Link>
  );
}

/** Progress towards the monthly target the owner set; full once it is reached. */
function TargetBar({ revenue, target, monthName }: { revenue: number; target: number; monthName: string }) {
  const t = useT();
  const share = Math.min(Math.max(revenue / target, 0), 1);
  const reached = revenue >= target;
  const label = reached
    ? t.staff.home.targetReached(formatMoney(target), monthName)
    : t.staff.home.targetToGo({ left: formatMoney(target - revenue), month: monthName, target: formatMoney(target) });
  return (
    <div className="staff-target">
      <div className="staff-target__track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
        <span className={reached ? 'staff-target__fill staff-target__fill--done' : 'staff-target__fill'} style={{ width: `${share * 100}%` }} />
      </div>
      <p className="staff-muted">{label}</p>
    </div>
  );
}

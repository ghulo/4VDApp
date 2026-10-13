import { CaretLeft, CaretRight, Coins, Wallet } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CashCountsTable, CountForm, formatDay } from '../components/CashCount';
import { DayChecklist } from '../components/DayChecklist';
import { ErrorNotice, Loading } from '../components/Feedback';
import { useT } from '../i18n/useT';
import type { ShopDay } from '../services/types';
import { formatDateWith, formatMoney } from '../utils/format';
import { carwashLabel, useCarwashes } from '../utils/useCarwashes';
import { useDayChecklist } from '../utils/useDayChecklist';
import { Button, DataTable, DateField, EmptyState, PageHeader, Section, Sheet } from '../components/ui';

const DAY_MS = 24 * 60 * 60 * 1000;
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const longDay = (day: string) =>
  formatDateWith(new Date(`${day}T00:00:00Z`), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * One shop day (DESIGN.md 3.4): the close-the-day steps, then each drawer's
 * count, the carwash takings and what was spent. History across days lives in
 * the Cash counts and Carwash tabs and in Reports.
 */
export function DayPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? undefined;
  const day = useDayChecklist(date);
  // Which drawer the count panel opens on; null while it's closed.
  const [counting, setCounting] = useState<string | null>(null);

  const go = (next: string) => setParams(next === day.data?.today ? {} : { date: next });

  return (
    <>
      <Sheet open={counting !== null} onClose={() => setCounting(null)} title={t.cash.countTitle}>
        {counting !== null && <CountForm key={counting} drawer={counting} />}
      </Sheet>
      <PageHeader
        title={t.nav.items.day}
        description={day.data ? t.dayPage.description(longDay(day.data.day)) : undefined}
        actions={
          day.data && (
            <span className="report-toolbar__dates">
              <Button variant="ghost" size="sm" icon={CaretLeft} aria-label={t.dayPage.earlier} onClick={() => go(shift(day.data.day, -1))} />
              <label className="inline-field">
                <span className="visually-hidden">{t.dayPage.pick}</span>
                <DateField
                  value={day.data.day}
                  max={day.data.today}
                  onChange={(value) => value && go(value)}
                />
              </label>
              <Button
                variant="ghost"
                size="sm"
                icon={CaretRight}
                aria-label={t.dayPage.later}
                disabled={day.data.day >= day.data.today}
                onClick={() => go(shift(day.data.day, 1))}
              />
              {day.data.day !== day.data.today && (
                <Button size="sm" onClick={() => go(day.data.today)}>
                  {t.dayPage.today}
                </Button>
              )}
            </span>
          )
        }
      />

      {day.isPending && <Loading />}
      {day.isError && <ErrorNotice error={day.error} onRetry={() => day.refetch()} />}
      {day.data && (
        <>
          <DayChecklist day={day.data} onCountDrawer={setCounting} />
          {day.data.details && <DayDetails day={day.data} details={day.data.details} />}
        </>
      )}
    </>
  );
}

function DayDetails({ day, details }: { day: ShopDay; details: NonNullable<ShopDay['details']> }) {
  const t = useT();
  const { several } = useCarwashes();
  return (
    <>
      <Section
        title={t.dayPage.counts}
       
        actions={
          <Link to="/cash" className="text-link">
            {t.dayPage.seeAll}
          </Link>
        }
      >
        <CashCountsTable
          counts={details.counts}
          showDay={false}
          empty={<EmptyState icon={Coins} title={t.dayPage.noCounts} />}
        />
      </Section>

      {details.carwash.length > 0 && (
        <Section
          title={t.dayPage.carwash}
         
          actions={
            <Link to="/carwash" className="text-link">
              {t.dayPage.seeAll}
            </Link>
          }
        >
          <DataTable
            caption={t.dayPage.carwash}
            rows={details.carwash}
            rowKey={(row) => row.id}
            columns={[
              { header: t.carwash.place, cell: (row) => carwashLabel(t.cash.places.carwash, row.name, several), title: true },
              { header: t.carwash.carwash, cell: (row) => (row.takings ? formatMoney(row.takings.carwash) : t.dayPage.notEntered), align: 'end' },
              { header: t.carwash.change, cell: (row) => (row.takings ? formatMoney(row.takings.change) : '–'), align: 'end' },
            ]}
          />
        </Section>
      )}

      <Section
        title={t.dayPage.expenses}
       
        actions={
          <Link to="/expenses" className="text-link">
            {t.dayPage.seeAll}
          </Link>
        }
      >
        <DataTable
          caption={`${t.dayPage.expenses}, ${formatDay(day.day)}`}
          rows={details.expenses}
          rowKey={(row) => row.id}
          empty={<EmptyState icon={Wallet} title={t.dayPage.noExpenses} />}
          columns={[
            { header: t.expenses.category, cell: (row) => t.expenses.categories[row.category], title: true },
            {
              header: t.carwash.place,
              cell: (row) => (row.place === 'carwash' ? carwashLabel(t.cash.places.carwash, row.carwashName, several) : t.expenses.places[row.place]),
            },
            { header: t.expenses.amount, cell: (row) => formatMoney(row.amount), align: 'end' },
            {
              header: t.expenses.addedBy,
              cell: (row) => (
                <>
                  {row.addedBy ?? '–'}
                  {row.note && <span className="table__secondary">{row.note}</span>}
                </>
              ),
            },
          ]}
        />
      </Section>
    </>
  );
}

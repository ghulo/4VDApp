import { Plus } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PeriodPicker } from '../components/PeriodPicker';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { expensesApi } from '../services/api';
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory, type ExpensePlace, type ExpenseTotals, type RecurringExpense } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateWith, formatMoney } from '../utils/format';
import { carwashLabel, useCarwashes } from '../utils/useCarwashes';
import { usePeriodParams } from '../utils/usePeriodParams';
import { Badge, Button, Card, DataTable, EmptyState, Field, PageHeader, Sheet, StatGrid, StatTile, useNewSheet } from '../components/ui';

/** Same cap as the server: every month has a 28th. */
const LAST_REPEAT_DAY = 28;

/** "2026-10-04": today on this computer's calendar. */
const today = () => new Date().toLocaleDateString('en-CA');

/** "Sat 4 Oct" for a "2026-10-04" day, without any time zone moving it. */
const formatDay = (day: string) =>
  formatDateWith(new Date(`${day}T00:00:00Z`), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** What the business spends, so reports can show real profit. */
export function ExpensesPage() {
  const t = useT();
  const { period, from, to, range, rangeKey, changePeriod } = usePeriodParams('this-month');
  const expenses = useQuery({
    queryKey: ['expenses', rangeKey],
    queryFn: () => expensesApi.list(rangeKey),
    placeholderData: keepPreviousData,
  });
  const recurring = useQuery({ queryKey: ['expenses', 'recurring'], queryFn: expensesApi.recurring });
  const { role } = useCurrentUser();
  const [adding, setAdding] = useNewSheet();

  return (
    <>
      <PageHeader
        title={t.expenses.title}
        description={t.expenses.description(range.label)}
        actions={
          <>
            <PeriodPicker period={period} from={from} to={to} onChange={changePeriod} />
            {canManage(role) && (
              <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
                {t.expenses.add}
              </Button>
            )}
          </>
        }
      />

      {expenses.data && <Totals totals={expenses.data.totals} />}
      {!canManage(role) && <p className="field-hint">{t.expenses.managersOnly}</p>}
      {!canManage(role) && <p className="field-hint">{t.expenses.managersOnly}</p>}

      {expenses.isPending && <Loading />}
      {expenses.isError && <ErrorNotice error={expenses.error} onRetry={() => expenses.refetch()} />}
      {expenses.data && <ExpenseTable expenses={expenses.data.expenses} />}
      {recurring.data && recurring.data.length > 0 && <RecurringTable rules={recurring.data} />}
      <Sheet open={adding} onClose={() => setAdding(false)} title={t.expenses.add}>
        <ExpenseForm />
      </Sheet>
    </>
  );
}

function Totals({ totals }: { totals: ExpenseTotals }) {
  const t = useT();
  const biggest = EXPENSE_CATEGORIES.reduce<ExpenseCategory | null>(
    (best, category) => (totals.byCategory[category] > 0 && (best === null || totals.byCategory[category] > totals.byCategory[best]) ? category : best),
    null,
  );
  return (
    <StatGrid>
      <StatTile label={t.expenses.total} value={formatMoney(totals.total)} />
      <StatTile
        label={`${t.expenses.places.shop} · ${t.expenses.places.carwash} · ${t.expenses.places.both}`}
        value={`${formatMoney(totals.byPlace.shop)} · ${formatMoney(totals.byPlace.carwash)} · ${formatMoney(totals.byPlace.both)}`}
        hint={totals.byCarwash.length > 1 ? totals.byCarwash.map((row) => `${row.name} ${formatMoney(row.total)}`).join(' · ') : undefined}
      />
      <StatTile
        label={t.expenses.biggest}
        value={biggest ? t.expenses.categories[biggest] : '–'}
        hint={biggest ? formatMoney(totals.byCategory[biggest]) : undefined}
      />
    </StatGrid>
  );
}

function ExpenseForm() {
  const t = useT();
  const queryClient = useQueryClient();
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('rent');
  // "shop", "both" or "carwash:<id>", so each carwash has its own choice.
  const [place, setPlace] = useState('shop');
  const { places: carwashes, several } = useCarwashes();
  const [note, setNote] = useState('');
  const [repeatMonthly, setRepeatMonthly] = useState(false);

  const add = useMutation({
    mutationFn: () => {
      const input = { day, amount: Number(amount), category, note: note.trim() || null, repeatMonthly };
      return place.startsWith('carwash:')
        ? expensesApi.add({ ...input, place: 'carwash', carwashId: Number(place.split(':')[1]) })
        : expensesApi.add({ ...input, place: place as ExpensePlace });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setAmount('');
      setNote('');
      setRepeatMonthly(false);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    add.mutate();
  }

  const isValid = day !== '' && day <= today() && Number(amount) > 0;
  const repeatDay = Math.min(Number(day.slice(8, 10)) || 1, LAST_REPEAT_DAY);

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <Field label={t.expenses.day}>
          <input type="date" required max={today()} value={day} onChange={(event) => setDay(event.target.value)} />
        </Field>
        <Field label={t.expenses.amount}>
          <input
            type="number"
            inputMode="decimal"
            required
            min={0.01}
            step={0.01}
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              add.reset();
            }}
          />
        </Field>
      </div>
      <div className="field-row">
        <Field label={t.expenses.category} hint={t.expenses.stockHint}>
          <select value={category} onChange={(event) => setCategory(event.target.value as ExpenseCategory)}>
            {EXPENSE_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {t.expenses.categories[option]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.expenses.place}>
          <select value={place} onChange={(event) => setPlace(event.target.value)}>
            <option value="shop">{t.expenses.places.shop}</option>
            {carwashes.map((carwash) => (
              <option key={carwash.id} value={`carwash:${carwash.id}`}>
                {carwashLabel(t.expenses.places.carwash, carwash.name, several)}
              </option>
            ))}
            <option value="both">{t.expenses.places.both}</option>
          </select>
        </Field>
      </div>
      <Field label={t.expenses.note}>
        <input maxLength={500} placeholder={t.expenses.notePlaceholder} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <label className="toggle">
        <input type="checkbox" checked={repeatMonthly} onChange={(event) => setRepeatMonthly(event.target.checked)} />
        {t.expenses.repeat}
      </label>
      {repeatMonthly && <p className="field-hint">{t.expenses.repeatHint(repeatDay)}</p>}
      {add.isError && (
        <p className="form-error" role="alert">
          {errorMessage(add.error)}
        </p>
      )}
      {add.isSuccess && (
        <p className="form-success" role="status">
          {t.expenses.saved}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={!isValid || add.isPending}>
        {add.isPending ? t.expenses.saving : t.expenses.save}
      </Button>
    </form>
  );
}

function ExpenseTable({ expenses }: { expenses: Expense[] }) {
  const t = useT();
  const { role } = useCurrentUser();
  const { several } = useCarwashes();
  return (
    <Card title={t.expenses.list} flush>
      <DataTable
        caption={t.expenses.caption}
        rows={expenses}
        rowKey={(row) => row.id}
        empty={<EmptyState title={t.expenses.none}>{t.expenses.noneHint}</EmptyState>}
        columns={[
          {
            header: t.expenses.category,
            title: true,
            cell: (row) => (
              <>
                {t.expenses.categories[row.category]}
                {row.note && <span className="table__secondary">{row.note}</span>}
              </>
            ),
          },
          { header: t.expenses.day, cell: (row) => formatDay(row.day) },
          { header: t.expenses.place, cell: (row) => carwashLabel(t.expenses.places[row.place], row.carwashName, several) },
          { header: t.expenses.amount, cell: (row) => formatMoney(row.amount), align: 'end' },
          {
            header: t.expenses.addedBy,
            cell: (row) => (row.recurringId !== null && row.addedBy === null ? <Badge tone="neutral">{t.expenses.automatic}</Badge> : (row.addedBy ?? '–')),
          },
          ...(canManage(role)
            ? [{ header: <span className="visually-hidden">{t.expenses.remove}</span>, cell: (row: Expense) => <RemoveExpense expense={row} /> }]
            : []),
        ]}
      />
    </Card>
  );
}

function RemoveExpense({ expense }: { expense: Expense }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => expensesApi.remove(expense.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
  const what = `${t.expenses.categories[expense.category]} ${formatDay(expense.day)}`;

  return (
    <div className="form-actions">
      {confirming ? (
        <>
          <Button variant="danger-text" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {t.expenses.confirmRemove}
          </Button>
          <Button variant="ghost" disabled={remove.isPending} onClick={() => setConfirming(false)}>
            {t.expenses.keep}
          </Button>
        </>
      ) : (
        <Button variant="danger-text" aria-label={t.expenses.removeLabel(what)} onClick={() => setConfirming(true)}>
          {t.expenses.remove}
        </Button>
      )}
      {remove.isError && (
        <p className="form-error" role="alert">
          {errorMessage(remove.error)}
        </p>
      )}
    </div>
  );
}

function RecurringTable({ rules }: { rules: RecurringExpense[] }) {
  const t = useT();
  const { role } = useCurrentUser();
  const { several } = useCarwashes();
  const queryClient = useQueryClient();
  const stop = useMutation({
    mutationFn: (id: number) => expensesApi.stopRepeating(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', 'recurring'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });

  return (
    <Card title={t.expenses.repeating} flush>
      <DataTable
        caption={t.expenses.repeatingCaption}
        rows={rules}
        rowKey={(row) => row.id}
        columns={[
          {
            header: t.expenses.category,
            title: true,
            cell: (row) => (
              <>
                {t.expenses.categories[row.category]}
                {row.note && <span className="table__secondary">{row.note}</span>}
              </>
            ),
          },
          { header: t.expenses.monthly, cell: (row) => t.expenses.onDay(row.dayOfMonth) },
          { header: t.expenses.place, cell: (row) => carwashLabel(t.expenses.places[row.place], row.carwashName, several) },
          { header: t.expenses.amount, cell: (row) => formatMoney(row.amount), align: 'end' },
          ...(canManage(role)
            ? [
                {
                  header: <span className="visually-hidden">{t.expenses.stop}</span>,
                  cell: (row: RecurringExpense) => (
                    <Button
                      variant="danger-text"
                      disabled={stop.isPending}
                      aria-label={t.expenses.stopLabel(t.expenses.categories[row.category])}
                      onClick={() => stop.mutate(row.id)}
                    >
                      {t.expenses.stop}
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
      {stop.isError && (
        <p className="form-error" role="alert">
          {errorMessage(stop.error)}
        </p>
      )}
    </Card>
  );
}

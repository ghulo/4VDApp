import { ClipboardText, Minus, Package, Plus } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ErrorNotice, Loading } from '../../components/Feedback';
import { Button, Card, EmptyState, Field, PageHeader } from '../../components/ui';
import { useT } from '../../i18n/useT';
import { categoriesApi, stockCountsApi } from '../../services/api';
import type { StockCount, StockCountSummary } from '../../services/types';
import { teamApi } from '../../services/teamApi';
import { errorMessage } from '../../utils/errors';

const COUNTS_KEY = ['stock-counts'];

/** Counts to carry on, counts waiting for the owner, and starting a new one. */
export function StaffCountsPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const counts = useQuery({ queryKey: COUNTS_KEY, queryFn: stockCountsApi.list });
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list, staleTime: 5 * 60_000 });
  const [scope, setScope] = useState('all');
  const scopeName = (count: StockCountSummary) => count.category?.name ?? t.staff.counts.wholeShop;

  const start = useMutation({
    mutationFn: () => stockCountsApi.start(scope === 'all' ? null : Number(scope)),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: COUNTS_KEY });
      navigate(`/counts/${count.id}`);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    start.mutate();
  }

  const open = counts.data?.filter((count) => count.status === 'open') ?? [];
  const waiting = counts.data?.filter((count) => count.status === 'submitted') ?? [];

  return (
    <>
      <PageHeader title={t.staff.counts.title} description={t.staff.counts.intro} crumbs={[{ label: t.staff.nav.home, to: '/' }]} />
      <div className="staff-page">
        {counts.isPending && <Loading />}
        {counts.isError && <ErrorNotice error={counts.error} onRetry={() => counts.refetch()} />}
        {open.length > 0 && (
          <section className="staff-section">
            <h2 className="staff-section__title">{t.staff.counts.carryOn}</h2>
            <ul className="staff-rows">
              {open.map((count) => (
                <li key={count.id}>
                  <Link to={`/counts/${count.id}`} className="staff-row">
                    <span className="staff-row__text staff-row__grow">
                      <span className="staff-row__title">{scopeName(count)}</span>
                      <span className="staff-row__hint">{t.staff.counts.startedBy(count.startedBy?.name ?? null)}</span>
                    </span>
                    <span className="staff-row__hint">{t.staff.counts.progress(count.totals.counted, count.totals.products)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {waiting.length > 0 && (
          <section className="staff-section">
            <h2 className="staff-section__title">{t.staff.counts.waiting}</h2>
            <ul className="staff-rows">
              {waiting.map((count) => (
                <li key={count.id} className="staff-row">
                  <span className="staff-row__title">{scopeName(count)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Card title={t.staff.counts.start}>
          <form className="settings-form" onSubmit={submit}>
            <Field label={t.staff.counts.whatToCount}>
              <select value={scope} onChange={(event) => setScope(event.target.value)}>
                <option value="all">{t.staff.counts.wholeShop}</option>
                {(categories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
            {start.isError && (
              <p className="form-error" role="alert">
                {errorMessage(start.error)}
              </p>
            )}
            <Button type="submit" variant="primary" loading={start.isPending}>
              {t.staff.counts.startCounting}
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}

/** Index of the first product not counted yet at or after `from`, wrapping round; -1 when all are counted. */
function nextUncounted(count: StockCount, from: number): number {
  const total = count.lines.length;
  for (let step = 0; step < total; step++) {
    const index = (from + step) % total;
    if (count.lines[index]!.countedQuantity === null) return index;
  }
  return -1;
}

/** Counting one product at a time: each is saved as soon as it is counted, so closing the page loses nothing. */
export function StaffCountPage() {
  const t = useT();
  const { id } = useParams();
  const countId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const count = useQuery({ queryKey: [...COUNTS_KEY, countId], queryFn: () => stockCountsApi.get(countId), enabled: Number.isInteger(countId) });
  const title = count.data ? (count.data.category?.name ?? t.staff.counts.wholeShop) : t.staff.counts.title;
  const header = <PageHeader title={title} crumbs={[{ label: t.staff.counts.title, to: '/counts' }]} />;

  if (count.isPending) return <Loading />;
  if (count.isError) return <ErrorNotice error={count.error} onRetry={() => count.refetch()} />;
  if (count.data.lines.length === 0) {
    return (
      <>
        {header}
        <EmptyState icon={Package} title={t.staff.counts.noProducts} />
      </>
    );
  }
  if (count.data.status !== 'open') {
    return (
      <>
        {header}
        <EmptyState icon={ClipboardText} title={t.staff.counts.finished}>
          {count.data.status === 'submitted' ? t.staff.counts.waitingForOwner : t.staff.counts.startNew}
        </EmptyState>
      </>
    );
  }
  return (
    <>
      {header}
      <Counter
        count={count.data}
        onSaved={(updated) => queryClient.setQueryData([...COUNTS_KEY, countId], updated)}
        onSubmitted={() => {
          for (const key of ['stock-counts', 'approvals', 'attention']) queryClient.invalidateQueries({ queryKey: [key] });
          navigate('/counts');
        }}
      />
    </>
  );
}

function Counter({ count, onSaved, onSubmitted }: { count: StockCount; onSaved: (updated: StockCount) => void; onSubmitted: () => void }) {
  const t = useT();
  const [index, setIndex] = useState(() => Math.max(0, nextUncounted(count, 0)));
  const line = count.lines[index]!;
  const [value, setValue] = useState(line.countedQuantity === null ? '' : String(line.countedQuantity));
  const [showList, setShowList] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function goTo(nextIndex: number, source: StockCount = count) {
    const next = source.lines[nextIndex]!;
    setIndex(nextIndex);
    setValue(next.countedQuantity === null ? '' : String(next.countedQuantity));
    setShowList(false);
  }

  const save = useMutation({
    mutationFn: () => teamApi.countLine(count.id, line.productId, Number(value)),
    onSuccess: (updated) => {
      onSaved(updated);
      const next = nextUncounted(updated, index + 1);
      if (next === -1) setConfirming(true);
      else goTo(next, updated);
    },
  });
  const submit = useMutation({ mutationFn: () => teamApi.submitCount(count.id), onSuccess: onSubmitted });

  const uncounted = count.totals.products - count.totals.counted;
  const amount = Number(value);
  const canSave = value !== '' && Number.isInteger(amount) && amount >= 0;

  function saveLine(event: FormEvent) {
    event.preventDefault();
    if (canSave) save.mutate();
  }

  const progress = (
    <div className="staff-count-progress">
      <span className="staff-row__title">{t.staff.counts.progress(count.totals.counted, count.totals.products)}</span>
      <Button size="sm" variant="ghost" onClick={() => setShowList((shown) => !shown)}>
        {showList ? t.staff.counts.backToCounting : t.staff.counts.seeList}
      </Button>
      <div className="staff-target__track" role="progressbar" aria-label={t.staff.counts.progress(count.totals.counted, count.totals.products)} aria-valuemin={0} aria-valuemax={count.totals.products} aria-valuenow={count.totals.counted}>
        <span className="staff-target__fill staff-target__fill--done" style={{ width: `${(count.totals.counted / count.totals.products) * 100}%` }} />
      </div>
    </div>
  );

  if (showList) {
    return (
      <div className="staff-page">
        {progress}
        <ul className="staff-rows">
          {count.lines.map((item, itemIndex) => (
            <li key={item.productId}>
              <button type="button" className="staff-row" onClick={() => goTo(itemIndex)}>
                <span className="staff-row__title staff-row__grow staff-row__clip">{item.productName}</span>
                <span className={item.countedQuantity === null ? 'staff-row__hint' : 'staff-row__value'}>
                  {item.countedQuantity === null ? t.staff.counts.notCounted : item.countedQuantity}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="staff-page">
      {progress}
      <Card>
        <p className="staff-muted">{line.categoryName}</p>
        <p className="staff-count-name">{line.productName}</p>
        {line.sku && <p className="staff-muted">SKU {line.sku}</p>}
      </Card>
      <form className="settings-form" onSubmit={saveLine}>
        <Field label={t.staff.counts.onShelf}>
          <span className="staff-stepper">
            <Button icon={Minus} aria-label={t.staff.counts.less} disabled={!canSave || amount <= 0} onClick={() => setValue(String(Math.max(0, amount - 1)))} />
            <input type="number" inputMode="numeric" min={0} step={1} value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
            <Button icon={Plus} aria-label={t.staff.counts.more} onClick={() => setValue(String((canSave ? amount : 0) + 1))} />
          </span>
        </Field>
        {save.isError && (
          <p className="form-error" role="alert">
            {errorMessage(save.error)}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={!canSave} loading={save.isPending}>
          {t.staff.counts.saveNext}
        </Button>
        <Button variant="ghost" onClick={() => goTo((index + 1) % count.lines.length)}>
          {t.staff.counts.skip}
        </Button>
      </form>

      <div className="staff-count-finish">
        {confirming ? (
          <>
            <p>{uncounted === 0 ? t.staff.counts.allCounted : t.staff.counts.someLeft(uncounted)}</p>
            {submit.isError && (
              <p className="form-error" role="alert">
                {errorMessage(submit.error)}
              </p>
            )}
            <div className="staff-actions">
              <Button variant="primary" loading={submit.isPending} onClick={() => submit.mutate()}>
                {t.staff.counts.send}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t.staff.counts.keepCounting}
              </Button>
            </div>
          </>
        ) : (
          <Button variant="ghost" disabled={count.totals.counted === 0} onClick={() => setConfirming(true)}>
            {t.staff.counts.finish}
          </Button>
        )}
      </div>
    </div>
  );
}

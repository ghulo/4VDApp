import { CopySimple } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ErrorNotice } from '../components/Feedback';
import { ProductPhoto } from '../components/ProductPhoto';
import { Badge, Button, DataTable, EmptyState, PageHeader, Sheet } from '../components/ui';
import { useT } from '../i18n/useT';
import { duplicatesApi } from '../services/api';
import type { DuplicatePair, DuplicateSide } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';

type Status = 'open' | 'done';

/**
 * Products that look like the same item twice (Stock → Possible duplicates).
 * Each pair opens side by side: pick the one to keep and its barcode, then
 * merge, or keep both. The next pair opens straight after, so a long list
 * from an import can be worked through in one go.
 */
export function DuplicatesPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const status: Status = params.get('show') === 'done' ? 'done' : 'open';
  const pairs = useQuery({ queryKey: ['duplicates', status], queryFn: () => duplicatesApi.list(status) });
  const openCount = useQuery({ queryKey: ['duplicates', 'open'], queryFn: () => duplicatesApi.list('open'), enabled: status === 'done' });
  const [reviewing, setReviewing] = useState<number | null>(null);
  const rows = pairs.data ?? [];
  const current = rows.find((pair) => pair.id === reviewing) ?? null;
  const waiting = (status === 'open' ? pairs.data : openCount.data)?.length ?? 0;

  /** After a decision, the pair below it (or above, at the end of the list) opens next. */
  function decided(id: number) {
    const index = rows.findIndex((pair) => pair.id === id);
    const next = rows[index + 1] ?? rows[index - 1];
    setReviewing(next && next.id !== id ? next.id : null);
  }

  return (
    <>
      <PageHeader wide title={t.nav.items.duplicates} description={t.duplicates.description} crumbs={[{ to: '/products', label: t.nav.items.stock }]} />

      {pairs.isError && <ErrorNotice error={pairs.error} onRetry={() => pairs.refetch()} />}
      <DataTable<DuplicatePair>
        caption={t.duplicates.caption}
        rows={rows}
        rowKey={(pair) => pair.id}
        onRowClick={status === 'open' ? (pair) => setReviewing(pair.id) : undefined}
        toolbar={
          <div className="toolbar">
            <div className="segmented segmented--chips" role="radiogroup" aria-label={t.duplicates.show}>
              {(['open', 'done'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={status === option}
                  className="segmented__option"
                  onClick={() => setParams(option === 'done' ? { show: 'done' } : {})}
                >
                  {t.duplicates[option]}
                  {option === 'open' && waiting > 0 && <span className="segmented__count">{waiting}</span>}
                </button>
              ))}
            </div>
          </div>
        }
        empty={
          pairs.isPending ? (
            <p className="loading" role="status">
              {t.common.loading}
            </p>
          ) : status === 'open' ? (
            <EmptyState icon={CopySimple} title={t.duplicates.noneOpen}>
              {t.duplicates.noneOpenHint}
            </EmptyState>
          ) : (
            <EmptyState icon={CopySimple} title={t.duplicates.noneDone}>
              {t.duplicates.noneDoneHint}
            </EmptyState>
          )
        }
        columns={
          status === 'open'
            ? [
                { header: t.duplicates.pair, title: true, cell: (pair) => <PairNames pair={pair} /> },
                {
                  header: t.duplicates.sold90,
                  align: 'end',
                  className: 'table__phone-hide',
                  cell: (pair) => pair.products.map((side) => side.unitsSold90d).join(' / '),
                },
                {
                  header: <span className="visually-hidden">{t.duplicates.compare}</span>,
                  align: 'end',
                  cell: (pair) => (
                    <Button size="sm" onClick={() => setReviewing(pair.id)} aria-label={`${t.duplicates.compare}: ${pair.products[0].name}`}>
                      {t.duplicates.compare}
                    </Button>
                  ),
                },
              ]
            : [
                { header: t.duplicates.pair, title: true, cell: (pair) => <PairNames pair={pair} /> },
                {
                  header: t.duplicates.decision,
                  cell: (pair) => <Badge tone={pair.resolution === 'merged' ? 'ok' : 'neutral'}>{pair.resolution === 'merged' ? t.duplicates.merged : t.duplicates.keptBoth}</Badge>,
                },
                { header: t.duplicates.decidedBy, cell: (pair) => pair.resolvedBy ?? '–' },
                { header: t.duplicates.when, align: 'end', cell: (pair) => (pair.resolvedAt ? formatDate(pair.resolvedAt) : '–') },
              ]
        }
      />

      <Sheet
        open={current !== null}
        onClose={() => setReviewing(null)}
        title={t.duplicates.compareTitle}
        description={current && rows.length > 1 ? t.duplicates.left(rows.length) : t.duplicates.compareHint}
      >
        {current && <PairReview key={current.id} pair={current} onDecided={() => decided(current.id)} />}
      </Sheet>
    </>
  );
}

function PairNames({ pair }: { pair: DuplicatePair }) {
  return (
    <span className="duplicate-names">
      {pair.products.map((side) => (
        <span key={side.id} className="duplicate-names__row">
          <span className="table__primary">{side.name}</span>
          {side.barcode && <span className="table__secondary">{side.barcode}</span>}
        </span>
      ))}
    </span>
  );
}

function PairReview({ pair, onDecided }: { pair: DuplicatePair; onDecided: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [first, second] = pair.products;
  const [keepId, setKeepId] = useState(first.id);
  const kept = keepId === first.id ? first : second;
  const other = keepId === first.id ? second : first;
  const barcodes = (other.barcode ? 1 : 0) + other.otherBarcodes.length;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['duplicates'] });
    queryClient.invalidateQueries({ queryKey: ['attention'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
  };
  const merge = useMutation({
    mutationFn: () => duplicatesApi.merge(pair.id, { keepId }),
    onSuccess: () => {
      refresh();
      onDecided();
    },
  });
  const keepBoth = useMutation({
    mutationFn: () => duplicatesApi.keepBoth(pair.id),
    onSuccess: () => {
      refresh();
      onDecided();
    },
  });
  const busy = merge.isPending || keepBoth.isPending;
  const error = merge.error ?? keepBoth.error;

  return (
    <div className="duplicate-review">
      <fieldset className="duplicate-review__sides">
        <legend className="visually-hidden">{t.duplicates.keepThis}</legend>
        {pair.products.map((side) => (
          <SideCard key={side.id} side={side} chosen={side.id === keepId} onChoose={() => setKeepId(side.id)} disabled={busy} />
        ))}
      </fieldset>

      <p className="duplicate-review__summary" aria-live="polite">{t.duplicates.summary({ kept: kept.name, other: other.name, stock: other.stock, barcodes })}</p>

      {error && (
        <p className="form-error" role="alert">
          {errorMessage(error)}
        </p>
      )}
      <div className="form-actions">
        <Button onClick={() => keepBoth.mutate()} disabled={busy} loading={keepBoth.isPending}>
          {t.duplicates.keepBoth}
        </Button>
        <Button variant="primary" onClick={() => merge.mutate()} disabled={busy} loading={merge.isPending}>
          {t.duplicates.merge}
        </Button>
      </div>
    </div>
  );
}

/** One product of the pair, as a choice: pressed in when it is the one that stays. */
function SideCard({ side, chosen, onChoose, disabled }: { side: DuplicateSide; chosen: boolean; onChoose: () => void; disabled: boolean }) {
  const t = useT();
  return (
    <label className={chosen ? 'duplicate-side duplicate-side--chosen' : 'duplicate-side'}>
      <input
        type="radio"
        name="keep"
        className="visually-hidden"
        aria-label={`${t.duplicates.keepThis}: ${side.name}${side.barcode ? ` (${side.barcode})` : ''}`}
        checked={chosen}
        onChange={onChoose}
        disabled={disabled}
      />
      <span className="duplicate-side__head">
        <ProductPhoto src={side.imageUrl} />
        <span className="duplicate-side__title">
          <span className="duplicate-side__name">{side.name}</span>
          <span className="duplicate-side__category">{side.category}</span>
          <span className="duplicate-side__stamp">
            <Badge tone={chosen ? 'brand' : 'neutral'}>{chosen ? t.duplicates.keeps : t.duplicates.goes}</Badge>
          </span>
        </span>
      </span>
      <dl className="duplicate-side__facts">
        <div>
          <dt>{t.duplicates.barcode}</dt>
          <dd>{side.barcode ? [side.barcode, ...side.otherBarcodes].join(', ') : t.duplicates.noBarcode}</dd>
        </div>
        <div>
          <dt>{t.duplicates.price}</dt>
          <dd>{formatMoney(side.price)}</dd>
        </div>
        <div>
          <dt>{t.duplicates.cost}</dt>
          <dd>{side.costPrice === null ? t.duplicates.noCost : formatMoney(side.costPrice)}</dd>
        </div>
        <div>
          <dt>{t.duplicates.stock}</dt>
          <dd>{side.stock}</dd>
        </div>
        <div>
          <dt>{t.duplicates.sold90}</dt>
          <dd>{side.unitsSold90d}</dd>
        </div>
        <div>
          <dt>{t.duplicates.soldEver}</dt>
          <dd>{side.unitsSold}</dd>
        </div>
        <div>
          <dt>{t.duplicates.lastSold}</dt>
          <dd>{side.lastSoldAt ? formatDate(side.lastSoldAt) : t.duplicates.never}</dd>
        </div>
      </dl>
    </label>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { DecisionControls, StatusPill } from '../components/Decision';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { stockCountsApi } from '../services/api';
import type { StockCount, StockCountLine } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateTime, formatMoney, formatSignedQuantity } from '../utils/format';
import { Button, Card, PageHeader, StatGrid, StatTile } from '../components/ui';
import { useT } from '../i18n/useT';

const AFFECTED_QUERIES = ['stock-counts', 'approvals', 'inventory', 'products', 'reports', 'activity'];

export function StockCountDetailPage() {
  const t = useT();
  const countId = Number(useParams().id);
  const queryClient = useQueryClient();
  const count = useQuery({ queryKey: ['stock-counts', countId], queryFn: () => stockCountsApi.get(countId) });
  const [onlyDifferences, setOnlyDifferences] = useState(true);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  function refresh(updated?: StockCount) {
    if (updated) queryClient.setQueryData(['stock-counts', countId], updated);
    for (const key of AFFECTED_QUERIES) queryClient.invalidateQueries({ queryKey: [key] });
  }

  const applyAll = useMutation({
    mutationFn: () => stockCountsApi.approveAll(countId),
    onSuccess: (result) => {
      refresh();
      setApplyMessage(
        result.failed.length === 0
          ? t.counts.corrected(result.approved)
          : t.counts.correctedSome(result.approved, result.failed.map((line) => `${line.productName} (${line.message})`).join('; ')),
      );
    },
  });
  const cancel = useMutation({ mutationFn: () => stockCountsApi.cancel(countId), onSuccess: refresh });

  if (count.isPending) return <Loading />;
  if (count.isError) return <ErrorNotice error={count.error} onRetry={() => count.refetch()} />;

  const data = count.data;
  const counted = data.lines.filter((line) => line.countedQuantity !== null);
  const shown = onlyDifferences ? counted.filter((line) => line.difference !== 0) : data.lines;
  const shortage = data.totals.shortageValue ?? 0;

  return (
    <>
      <PageHeader
        title={t.counts.countOf(data.category?.name ?? t.counts.theWholeShopLower)}
        crumbs={[{ label: t.counts.title, to: '/counts' }]}
        meta={<StatusPill status={data.status} />}
        description={t.counts.summary({
          by: data.startedBy?.name ?? t.counts.unknown,
          when: formatDateTime(data.startedAt),
          counted: data.totals.counted,
          products: data.totals.products,
        })}
        actions={
          <>
            {data.status === 'open' && (
              <Button variant="danger-text" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                {t.counts.cancelCount}
              </Button>
            )}
            {data.status === 'submitted' && (data.totals.pending ?? 0) > 0 && (
              <Button variant="primary" onClick={() => applyAll.mutate()} disabled={applyAll.isPending}>
                {applyAll.isPending ? t.counts.correcting : t.counts.applyAll}
              </Button>
            )}
          </>
        }
      />

      <StatGrid>
        <StatTile label={t.counts.differ} value={data.totals.differences} />
        <StatTile
          label={t.counts.stillWaiting}
          value={data.totals.pending ?? 0}
          tone={(data.totals.pending ?? 0) > 0 ? 'warn' : 'default'}
        />
        <StatTile
          label={shortage >= 0 ? t.counts.missing : t.counts.extra}
          value={formatMoney(Math.abs(shortage))}
          tone={shortage > 0 ? 'danger' : 'default'}
        />
      </StatGrid>
      <div className="count-notes">
        {data.status === 'open' && (
          <p className="field-hint">{t.counts.stillCounting}</p>
        )}
        {applyMessage && (
          <p className={applyAll.data?.failed.length ? 'form-error' : 'form-success'} role="status">
            {applyMessage}
          </p>
        )}
        {(applyAll.isError || cancel.isError) && (
          <p className="form-error" role="alert">
            {errorMessage(applyAll.error ?? cancel.error)}
          </p>
        )}
      </div>

      <Card
        title={t.counts.products}
        flush
        actions={
          <label className="toggle">
            <input type="checkbox" checked={onlyDifferences} onChange={(event) => setOnlyDifferences(event.target.checked)} />
            {t.counts.onlyDifferences}
          </label>
        }
      >
        {shown.length === 0 ? (
          <EmptyState title={onlyDifferences ? t.counts.noDifferences : t.counts.nothingToCount} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t.counts.product}</th>
                  <th scope="col" className="table__numeric">{t.counts.expected}</th>
                  <th scope="col" className="table__numeric">{t.counts.counted}</th>
                  <th scope="col" className="table__numeric">{t.counts.difference}</th>
                  <th scope="col" className="table__numeric">{t.counts.value}</th>
                  <th scope="col">{t.counts.status}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((line) => (
                  <LineRow key={line.productId} countId={countId} line={line} onChange={refresh} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function LineRow({ countId, line, onChange }: { countId: number; line: StockCountLine; onChange: (updated?: StockCount) => void }) {
  const t = useT();
  const decide = useMutation({
    mutationFn: (decision: { approve: true } | { approve: false; note: string }) =>
      decision.approve
        ? stockCountsApi.approveLine(countId, line.productId)
        : stockCountsApi.rejectLine(countId, line.productId, decision.note),
    onSuccess: onChange,
  });

  return (
    <tr>
      <td>
        <Link to={`/inventory/${line.productId}`} className="table__primary-link">
          {line.productName}
        </Link>
        <span className="table__secondary">{line.sku ?? line.categoryName}</span>
      </td>
      <td className="table__numeric">{line.expectedQuantity ?? '–'}</td>
      <td className="table__numeric">{line.countedQuantity ?? t.counts.notCounted}</td>
      <td className="table__numeric">{line.difference === undefined ? '–' : formatSignedQuantity(line.difference)}</td>
      <td className="table__numeric">{line.value === undefined || line.value === null ? '–' : formatMoney(line.value)}</td>
      <td>
        {line.status === 'pending' ? (
          <DecisionControls
            subject={t.counts.subject(line.productName)}
            isBusy={decide.isPending}
            error={decide.error}
            onApprove={() => decide.mutate({ approve: true })}
            onReject={(note) => decide.mutate({ approve: false, note })}
          />
        ) : (
          line.status && (
            <>
              <StatusPill status={line.status} />
              {line.decisionNote && <span className="table__secondary">{line.decisionNote}</span>}
            </>
          )
        )}
      </td>
    </tr>
  );
}

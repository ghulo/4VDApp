import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { DecisionControls, StatusPill } from '../components/Decision';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { stockCountsApi } from '../services/api';
import type { StockCount, StockCountLine } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateTime, formatMoney, formatSignedQuantity } from '../utils/format';

const AFFECTED_QUERIES = ['stock-counts', 'approvals', 'inventory', 'products', 'reports', 'activity'];

export function StockCountDetailPage() {
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
          ? `Corrected ${result.approved} ${result.approved === 1 ? 'product' : 'products'}.`
          : `Corrected ${result.approved}. Couldn't correct: ${result.failed.map((line) => `${line.productName} (${line.message})`).join('; ')}`,
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
      <header className="page-header">
        <Link to="/counts" className="back-link">
          Stock counts
        </Link>
        <h1 className="page-title">Count of {data.category?.name ?? 'the whole shop'}</h1>
        <p className="page-intro page-intro--wide">
          <StatusPill status={data.status} /> Started by {data.startedBy?.name ?? 'Unknown'} on {formatDateTime(data.startedAt)}.{' '}
          {data.totals.counted} of {data.totals.products} products counted.
        </p>
      </header>

      <section className="panel">
        <dl className="summary__figures">
          <div>
            <dt>Products that differ</dt>
            <dd>{data.totals.differences}</dd>
          </div>
          <div>
            <dt>Still waiting for you</dt>
            <dd>{data.totals.pending}</dd>
          </div>
          <div>
            <dt>{shortage >= 0 ? 'Missing, at cost' : 'Found extra, at cost'}</dt>
            <dd>{formatMoney(Math.abs(shortage))}</dd>
          </div>
        </dl>
        <div className="form-actions form-actions--spaced">
          {data.status === 'submitted' && (data.totals.pending ?? 0) > 0 && (
            <button type="button" className="button button--primary" onClick={() => applyAll.mutate()} disabled={applyAll.isPending}>
              {applyAll.isPending ? 'Correcting…' : 'Apply all differences'}
            </button>
          )}
          {data.status === 'open' && (
            <button type="button" className="button button--danger-text" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Cancel this count
            </button>
          )}
        </div>
        {data.status === 'open' && (
          <p className="field-hint">Employees are still counting. Differences can be approved once they submit the count.</p>
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
      </section>

      <section className="panel" aria-labelledby="lines-heading">
        <div className="panel__header">
          <h2 id="lines-heading" className="panel__title">
            Products
          </h2>
          <label className="toggle">
            <input type="checkbox" checked={onlyDifferences} onChange={(event) => setOnlyDifferences(event.target.checked)} />
            Only show differences
          </label>
        </div>
        {shown.length === 0 ? (
          <EmptyState title={onlyDifferences ? 'No differences' : 'Nothing to count'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col" className="table__numeric">Expected</th>
                  <th scope="col" className="table__numeric">Counted</th>
                  <th scope="col" className="table__numeric">Difference</th>
                  <th scope="col" className="table__numeric">Value</th>
                  <th scope="col">Status</th>
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
      </section>
    </>
  );
}

function LineRow({ countId, line, onChange }: { countId: number; line: StockCountLine; onChange: (updated?: StockCount) => void }) {
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
      <td className="table__numeric">{line.countedQuantity ?? 'Not counted'}</td>
      <td className="table__numeric">{line.difference === undefined ? '–' : formatSignedQuantity(line.difference)}</td>
      <td className="table__numeric">{line.value === undefined || line.value === null ? '–' : formatMoney(line.value)}</td>
      <td>
        {line.status === 'pending' ? (
          <DecisionControls
            subject={`the count of ${line.productName}`}
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

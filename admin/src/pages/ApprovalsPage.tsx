import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { DecisionControls } from '../components/Decision';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { returnsApi, stockCountsApi, writeOffsApi } from '../services/api';
import type { ReturnItem, WriteOff } from '../services/types';
import { formatDateTime, formatMoney } from '../utils/format';

/** Everything that changes stock or money changes the reports and activity too. */
const AFFECTED_QUERIES = ['returns', 'write-offs', 'approvals', 'sales', 'inventory', 'products', 'reports', 'activity'];

function useInvalidateAll() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of AFFECTED_QUERIES) queryClient.invalidateQueries({ queryKey: [key] });
  };
}

export function ApprovalsPage() {
  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Approvals</h1>
        <p className="page-intro">
          What employees asked for that needs your decision. Nothing here touches stock or money until you approve it.
        </p>
      </header>
      <PendingReturns />
      <PendingWriteOffs />
      <PendingCounts />
    </>
  );
}

function PendingReturns() {
  const returns = useQuery({ queryKey: ['returns', 'pending'], queryFn: () => returnsApi.list('pending') });
  return (
    <section className="panel" aria-labelledby="returns-heading">
      <h2 id="returns-heading" className="panel__title">
        Returns
      </h2>
      {returns.isPending && <Loading />}
      {returns.isError && <ErrorNotice error={returns.error} onRetry={() => returns.refetch()} />}
      {returns.data?.length === 0 && <EmptyState title="No returns waiting" />}
      {returns.data && returns.data.length > 0 && (
        <ul className="approval-list">
          {returns.data.map((item) => (
            <ReturnRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReturnRow({ item }: { item: ReturnItem }) {
  const invalidate = useInvalidateAll();
  const decide = useMutation({
    mutationFn: (decision: { approve: true } | { approve: false; note: string }) =>
      decision.approve ? returnsApi.approve(item.id) : returnsApi.reject(item.id, decision.note),
    onSuccess: invalidate,
  });
  const subject = `the return of ${item.quantity} × ${item.productName}`;

  return (
    <li className="approval-row">
      <div className="approval-row__what">
        <span className="approval-row__title">
          {item.quantity} × {item.productName}, refund {formatMoney(item.refundAmount)}
          {item.condition === 'damaged' && ', damaged'}
        </span>
        <span className="approval-row__meta">
          Sold by {item.soldBy?.name ?? 'someone who has left'} on {formatDateTime(item.saleDate)}. Asked by{' '}
          {item.requestedBy?.name ?? 'Unknown'} on {formatDateTime(item.requestedAt)}.
        </span>
        <span className="approval-row__why">Needs you because: {item.needsApprovalBecause.join(', ')}</span>
        {item.notes && <span className="approval-row__meta">“{item.notes}”</span>}
      </div>
      <DecisionControls
        subject={subject}
        isBusy={decide.isPending}
        error={decide.error}
        onApprove={() => decide.mutate({ approve: true })}
        onReject={(note) => decide.mutate({ approve: false, note })}
      />
    </li>
  );
}

function PendingWriteOffs() {
  const writeOffs = useQuery({ queryKey: ['write-offs', 'pending'], queryFn: () => writeOffsApi.list('pending') });
  return (
    <section className="panel" aria-labelledby="write-offs-heading">
      <h2 id="write-offs-heading" className="panel__title">
        Damaged, lost or expired stock
      </h2>
      {writeOffs.isPending && <Loading />}
      {writeOffs.isError && <ErrorNotice error={writeOffs.error} onRetry={() => writeOffs.refetch()} />}
      {writeOffs.data?.length === 0 && <EmptyState title="No write-offs waiting" />}
      {writeOffs.data && writeOffs.data.length > 0 && (
        <ul className="approval-list">
          {writeOffs.data.map((item) => (
            <WriteOffRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function WriteOffRow({ item }: { item: WriteOff }) {
  const invalidate = useInvalidateAll();
  const decide = useMutation({
    mutationFn: (decision: { approve: true } | { approve: false; note: string }) =>
      decision.approve ? writeOffsApi.approve(item.id) : writeOffsApi.reject(item.id, decision.note),
    onSuccess: invalidate,
  });

  return (
    <li className="approval-row">
      <div className="approval-row__what">
        <span className="approval-row__title">
          {item.quantity} × <Link to={`/inventory/${item.productId}`}>{item.productName}</Link>, {item.reason}
        </span>
        <span className="approval-row__meta">
          {item.value === null ? 'No cost price, so no value' : `${formatMoney(item.value)} at cost`}. Reported by{' '}
          {item.requestedBy?.name ?? 'Unknown'} on {formatDateTime(item.requestedAt)}.
        </span>
        {item.notes && <span className="approval-row__meta">“{item.notes}”</span>}
      </div>
      <DecisionControls
        subject={`the write-off of ${item.quantity} × ${item.productName}`}
        isBusy={decide.isPending}
        error={decide.error}
        onApprove={() => decide.mutate({ approve: true })}
        onReject={(note) => decide.mutate({ approve: false, note })}
      />
    </li>
  );
}

function PendingCounts() {
  const counts = useQuery({ queryKey: ['stock-counts'], queryFn: stockCountsApi.list });
  const submitted = counts.data?.filter((count) => count.status === 'submitted') ?? [];
  return (
    <section className="panel" aria-labelledby="counts-heading">
      <h2 id="counts-heading" className="panel__title">
        Stock counts
      </h2>
      {counts.isPending && <Loading />}
      {counts.isError && <ErrorNotice error={counts.error} onRetry={() => counts.refetch()} />}
      {counts.data && submitted.length === 0 && <EmptyState title="No counts waiting" />}
      {submitted.length > 0 && (
        <ul className="approval-list">
          {submitted.map((count) => (
            <li key={count.id} className="approval-row">
              <div className="approval-row__what">
                <span className="approval-row__title">Count of {count.category?.name ?? 'the whole shop'}</span>
                <span className="approval-row__meta">
                  By {count.startedBy?.name ?? 'Unknown'}, submitted {count.submittedAt && formatDateTime(count.submittedAt)}.
                </span>
              </div>
              <Link to={`/counts/${count.id}`} className="button button--primary">
                Review differences
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

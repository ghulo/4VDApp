import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { DecisionControls } from '../components/Decision';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { returnsApi, stockCountsApi, writeOffsApi } from '../services/api';
import type { ReturnItem, WriteOff } from '../services/types';
import { formatDateTime, formatMoney } from '../utils/format';
import { ButtonLink, Card, PageHeader } from '../components/ui';
import { useT } from '../i18n/useT';
import { describeReason } from '../utils/approvalReasons';

/** Everything that changes stock or money changes the reports and activity too. */
const AFFECTED_QUERIES = ['returns', 'write-offs', 'approvals', 'sales', 'inventory', 'products', 'reports', 'activity'];

function useInvalidateAll() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of AFFECTED_QUERIES) queryClient.invalidateQueries({ queryKey: [key] });
  };
}


export function ApprovalsPage() {
  const t = useT();
  return (
    <>
      <PageHeader
        title={t.approvals.title}
        description={t.approvals.description}
      />
      <PendingReturns />
      <PendingWriteOffs />
      <PendingCounts />
    </>
  );
}

function PendingReturns() {
  const t = useT();
  const returns = useQuery({ queryKey: ['returns', 'pending'], queryFn: () => returnsApi.list('pending') });
  return (
    <Card title={t.approvals.returns}>
      {returns.isPending && <Loading />}
      {returns.isError && <ErrorNotice error={returns.error} onRetry={() => returns.refetch()} />}
      {returns.data?.length === 0 && <EmptyState title={t.approvals.noReturns} />}
      {returns.data && returns.data.length > 0 && (
        <ul className="approval-list">
          {returns.data.map((item) => (
            <ReturnRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReturnRow({ item }: { item: ReturnItem }) {
  const t = useT();
  const invalidate = useInvalidateAll();
  const decide = useMutation({
    mutationFn: (decision: { approve: true } | { approve: false; note: string }) =>
      decision.approve ? returnsApi.approve(item.id) : returnsApi.reject(item.id, decision.note),
    onSuccess: invalidate,
  });
  const subject = t.approvals.returnSubject(`${item.quantity} × ${item.productName}`);

  return (
    <li className="approval-row">
      <div className="approval-row__what">
        <span className="approval-row__title">
          {t.approvals.refund(`${item.quantity} × ${item.productName}`, formatMoney(item.refundAmount))}
          {item.condition === 'damaged' && t.approvals.damaged}
        </span>
        <span className="approval-row__meta">
          {t.approvals.soldAsked({
            seller: item.soldBy?.name ?? null,
            sold: formatDateTime(item.saleDate),
            asker: item.requestedBy?.name ?? null,
            asked: formatDateTime(item.requestedAt),
          })}
        </span>
        <span className="approval-row__why">
          {t.approvals.needsYou(item.needsApprovalBecause.map((reason) => describeReason(t, reason)).join(', '))}
        </span>
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
  const t = useT();
  const writeOffs = useQuery({ queryKey: ['write-offs', 'pending'], queryFn: () => writeOffsApi.list('pending') });
  return (
    <Card title={t.approvals.writeOffs}>
      {writeOffs.isPending && <Loading />}
      {writeOffs.isError && <ErrorNotice error={writeOffs.error} onRetry={() => writeOffs.refetch()} />}
      {writeOffs.data?.length === 0 && <EmptyState title={t.approvals.noWriteOffs} />}
      {writeOffs.data && writeOffs.data.length > 0 && (
        <ul className="approval-list">
          {writeOffs.data.map((item) => (
            <WriteOffRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function WriteOffRow({ item }: { item: WriteOff }) {
  const t = useT();
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
          {item.quantity} × <Link to={`/inventory/${item.productId}`}>{item.productName}</Link>,{' '}
          {t.writeOff.reasons[item.reason] ?? item.reason}
        </span>
        <span className="approval-row__meta">
          {item.value === null ? t.approvals.noValue : t.approvals.atCost(formatMoney(item.value))}.{' '}
          {t.approvals.reported({ by: item.requestedBy?.name ?? null, when: formatDateTime(item.requestedAt) })}
        </span>
        {item.notes && <span className="approval-row__meta">“{item.notes}”</span>}
      </div>
      <DecisionControls
        subject={t.approvals.writeOffSubject(`${item.quantity} × ${item.productName}`)}
        isBusy={decide.isPending}
        error={decide.error}
        onApprove={() => decide.mutate({ approve: true })}
        onReject={(note) => decide.mutate({ approve: false, note })}
      />
    </li>
  );
}

function PendingCounts() {
  const t = useT();
  const counts = useQuery({ queryKey: ['stock-counts'], queryFn: stockCountsApi.list });
  const submitted = counts.data?.filter((count) => count.status === 'submitted') ?? [];
  return (
    <Card title={t.approvals.counts}>
      {counts.isPending && <Loading />}
      {counts.isError && <ErrorNotice error={counts.error} onRetry={() => counts.refetch()} />}
      {counts.data && submitted.length === 0 && <EmptyState title={t.approvals.noCounts} />}
      {submitted.length > 0 && (
        <ul className="approval-list">
          {submitted.map((count) => (
            <li key={count.id} className="approval-row">
              <div className="approval-row__what">
                <span className="approval-row__title">{t.approvals.countOf(count.category?.name ?? t.approvals.wholeShop)}</span>
                <span className="approval-row__meta">
                  {t.approvals.submittedBy({
                    by: count.startedBy?.name ?? null,
                    when: count.submittedAt ? formatDateTime(count.submittedAt) : '',
                  })}
                </span>
              </div>
              <ButtonLink to={`/counts/${count.id}`} variant="primary">
                {t.approvals.review}
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

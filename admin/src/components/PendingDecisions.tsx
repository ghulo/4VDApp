import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { CountryFlag } from './CountryFlag';
import { ProductPhoto } from './ProductPhoto';
import { DecisionControls } from './Decision';
import { SealCheck } from '@phosphor-icons/react';
import { ErrorNotice, Loading } from './Feedback';
import { categoriesApi, productRequestsApi, returnsApi, stockCountsApi, writeOffsApi } from '../services/api';
import type { ProductRequest, ReturnItem, WriteOff } from '../services/types';
import { formatDateTime, formatMoney } from '../utils/format';
import { ButtonLink, Card, EmptyState } from './ui';
import { useT } from '../i18n/useT';
import { describeReason } from '../utils/approvalReasons';

/** Everything that changes stock or money changes the reports and activity too. */
const AFFECTED_QUERIES = ['returns', 'write-offs', 'product-requests', 'approvals', 'attention', 'sales', 'inventory', 'products', 'reports', 'activity'];

function useInvalidateAll() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of AFFECTED_QUERIES) queryClient.invalidateQueries({ queryKey: [key] });
  };
}

/** Everything waiting for a decision. Only kinds with something waiting are shown. */
export function PendingDecisions() {
  const t = useT();
  const returns = useQuery({ queryKey: ['returns', 'pending'], queryFn: () => returnsApi.list('pending') });
  const writeOffs = useQuery({ queryKey: ['write-offs', 'pending'], queryFn: () => writeOffsApi.list('pending') });
  const counts = useQuery({ queryKey: ['stock-counts'], queryFn: stockCountsApi.list });
  const products = useQuery({ queryKey: ['product-requests', 'pending'], queryFn: productRequestsApi.pending });
  const submitted = counts.data?.filter((count) => count.status === 'submitted') ?? [];
  const queries = [returns, writeOffs, counts, products];

  if (queries.some((query) => query.isPending)) return <Loading />;
  const failed = queries.find((query) => query.isError);
  if (failed) return <ErrorNotice error={failed.error} onRetry={() => queries.forEach((query) => query.refetch())} />;
  if (!returns.data?.length && !writeOffs.data?.length && !products.data?.length && submitted.length === 0) {
    return <EmptyState icon={SealCheck} title={t.inbox.noDecisions}>{t.inbox.noDecisionsHint}</EmptyState>;
  }

  return (
    <>
      {products.data && products.data.length > 0 && (
        <Card title={t.approvals.products}>
          <ul className="approval-list">
            {products.data.map((item) => (
              <ProductRequestRow key={item.id} item={item} />
            ))}
          </ul>
        </Card>
      )}
      {returns.data && returns.data.length > 0 && (
        <Card title={t.approvals.returns}>
          <ul className="approval-list">
            {returns.data.map((item) => (
              <ReturnRow key={item.id} item={item} />
            ))}
          </ul>
        </Card>
      )}
      {writeOffs.data && writeOffs.data.length > 0 && (
        <Card title={t.approvals.writeOffs}>
          <ul className="approval-list">
            {writeOffs.data.map((item) => (
              <WriteOffRow key={item.id} item={item} />
            ))}
          </ul>
        </Card>
      )}
      {submitted.length > 0 && (
        <Card title={t.approvals.counts}>
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
        </Card>
      )}
    </>
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

/** A new product from the counter: the price and category can be corrected before approving creates it. */
function ProductRequestRow({ item }: { item: ProductRequest }) {
  const t = useT();
  const invalidate = useInvalidateAll();
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const [categoryId, setCategoryId] = useState(item.category ? String(item.category.id) : '');
  const [price, setPrice] = useState(String(item.price));
  const priceId = useId();
  const categoryFieldId = useId();
  const decide = useMutation({
    mutationFn: (decision: { approve: true } | { approve: false; note: string }) =>
      decision.approve
        ? productRequestsApi.approve(item.id, { categoryId: categoryId ? Number(categoryId) : undefined, price: Number(price) })
        : productRequestsApi.reject(item.id, decision.note),
    onSuccess: invalidate,
  });

  return (
    <li className="approval-row approval-row--product">
      <ProductPhoto src={item.photoUrl} size="lg" />
      <div className="approval-row__what">
        <span className="approval-row__title">
          {item.originCountry && <CountryFlag code={item.originCountry} />} {item.name}
        </span>
        <span className="approval-row__meta">{[item.barcode, t.approvals.productStock(item.stock)].filter(Boolean).join(' · ')}</span>
        <span className="approval-row__meta">{t.approvals.productAsked({ by: item.requestedBy?.name ?? null, when: formatDateTime(item.requestedAt) })}</span>
        {item.note && <span className="approval-row__meta">“{item.note}”</span>}
        <span className="approval-row__fields">
          <label className="visually-hidden" htmlFor={priceId}>
            {t.approvals.priceFor(item.name)}
          </label>
          <input
            id={priceId}
            className="input--compact"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
          <label className="visually-hidden" htmlFor={categoryFieldId}>
            {t.approvals.categoryFor(item.name)}
          </label>
          <select id={categoryFieldId} required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="" disabled>
              {t.approvals.chooseCategory}
            </option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </span>
      </div>
      <DecisionControls
        subject={t.approvals.productSubject(item.name)}
        isBusy={decide.isPending || !categoryId || price === ''}
        error={decide.error}
        onApprove={() => decide.mutate({ approve: true })}
        onReject={(note) => decide.mutate({ approve: false, note })}
      />
    </li>
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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { CustomsBillPicker } from '../components/CustomsFields';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Button, ButtonLink, Card, EmptyState, PageHeader, useToast } from '../components/ui';
import { useT } from '../i18n/useT';
import { billsApi } from '../services/api';
import type { CustomsPaper } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';

/** A customs paper scanned before its bill was in 4VD: put it on its import bill, or throw it away. Opened from To do. */
export function CustomsPaperPage() {
  const t = useT();
  const w = t.customsPaper;
  const id = Number(useParams().id);
  const paper = useQuery({ queryKey: ['bills', 'customs', id], queryFn: () => billsApi.customsPaper(id) });
  const crumbs = [{ label: t.nav.tabs.bills, to: '/bills' }];

  if (paper.isPending) return <Loading />;
  if (paper.isError) return <ErrorNotice error={paper.error} onRetry={() => paper.refetch()} />;
  const data = paper.data;
  const title = data.number ? w.titleNo(data.number) : w.title;

  if (data.status !== 'waiting') {
    return (
      <>
        <PageHeader title={title} crumbs={crumbs} />
        <EmptyState
          title={data.status === 'attached' ? w.attached : w.closed}
          action={
            data.billId ? (
              <ButtonLink to={`/bills/${data.billId}#customs`} variant="primary">
                {w.openBill}
              </ButtonLink>
            ) : (
              <ButtonLink to="/bills">{t.nav.tabs.bills}</ButtonLink>
            )
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={title} crumbs={crumbs} description={w.waitingDescription} />
      <WaitingPaper paper={data} />
    </>
  );
}

function WaitingPaper({ paper }: { paper: CustomsPaper }) {
  const t = useT();
  const w = t.customsPaper;
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [billId, setBillId] = useState(() => (paper.matchId ? String(paper.matchId) : ''));
  const [discarding, setDiscarding] = useState(false);
  const done = () => {
    for (const key of ['bills', 'bill-scans', 'products', 'attention', 'activity', 'books', 'vat', 'cash']) queryClient.invalidateQueries({ queryKey: [key] });
  };
  const attach = useMutation({
    mutationFn: () => billsApi.attachCustomsPaper(paper.id, Number(billId)),
    onSuccess: (bill) => {
      done();
      toast({ title: w.putOnToast });
      navigate(`/bills/${bill.id}#customs`);
    },
  });
  const discard = useMutation({
    mutationFn: () => billsApi.discardCustomsPaper(paper.id),
    onSuccess: () => {
      done();
      toast({ title: w.discardedToast });
      navigate('/bills');
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (billId) attach.mutate();
  }

  const total = Math.round((paper.vat + paper.duty + paper.excise) * 100) / 100;
  const error = attach.error ?? discard.error;
  return (
    <form className="product-layout" onSubmit={handleSubmit}>
      <div className="product-layout__main">
        <Card title={w.paper} description={w.paperHint}>
          <dl className="partner-facts">
            <div>
              <dt>{t.bills.customsCard.paperDate}</dt>
              <dd>{formatDate(paper.issuedOn)}</dd>
            </div>
            <div>
              <dt>{t.bills.customsCard.paperVat}</dt>
              <dd>{formatMoney(paper.vat)}</dd>
            </div>
            <div>
              <dt>{t.bills.customsCard.paperDuty}</dt>
              <dd>{formatMoney(paper.duty)}</dd>
            </div>
            {paper.excise > 0 && (
              <div>
                <dt>{t.bills.customsCard.paperExcise}</dt>
                <dd>{formatMoney(paper.excise)}</dd>
              </div>
            )}
            <div>
              <dt>{t.bills.customsCard.paidTotal}</dt>
              <dd>
                {formatMoney(total)} · {t.billForm.customsMethods[paper.method]}
              </dd>
            </div>
          </dl>
        </Card>
        <Card title={w.readFrom}>
          <dl className="partner-facts">
            <div>
              <dt>{w.seller}</dt>
              <dd>{paper.supplierName ?? '–'}</dd>
            </div>
            <div>
              <dt>{w.invoices}</dt>
              <dd>{paper.invoiceNumbers.length > 0 ? paper.invoiceNumbers.join(', ') : '–'}</dd>
            </div>
            <div>
              <dt>{w.declared}</dt>
              <dd>{paper.declaredValue ? formatMoney(paper.declaredValue) : '–'}</dd>
            </div>
          </dl>
          {paper.scanId && (
            <ButtonLink size="sm" to={`/bills/scans/${paper.scanId}`}>
              {w.openScan}
            </ButtonLink>
          )}
        </Card>
      </div>

      <div className="product-layout__side buy-side">
        <Card title={w.bill}>
          <CustomsBillPicker bills={paper.bills} value={billId} onChange={setBillId} allowWaiting={false} />
          {error && (
            <p className="form-error" role="alert">
              {errorMessage(error)}
            </p>
          )}
          <Button type="submit" variant="primary" wide disabled={!billId || attach.isPending} aria-describedby={billId ? undefined : 'customs-why'} loading={attach.isPending}>
            {w.putOn}
          </Button>
          {!billId && (
            <p id="customs-why" className="field-hint">
              {paper.bills.length > 0 ? w.needBill : w.noBills}
            </p>
          )}
          <div className="scan-discard">
            {discarding ? (
              <>
                <p>{w.discardSure}</p>
                <div className="form-actions">
                  <Button size="sm" variant="ghost" onClick={() => setDiscarding(false)}>
                    {w.keep}
                  </Button>
                  <Button size="sm" variant="danger" disabled={discard.isPending} loading={discard.isPending} onClick={() => discard.mutate()}>
                    {w.yesDiscard}
                  </Button>
                </div>
              </>
            ) : (
              <Button size="sm" variant="danger-text" onClick={() => setDiscarding(true)}>
                {w.discard}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </form>
  );
}

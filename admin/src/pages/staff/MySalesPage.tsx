import { CaretDown } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice, Loading, SavedToast } from '../../components/Feedback';
import { PrintDocumentButton } from '../../components/PrintDocumentButton';
import { ReturnForm } from '../../components/ReturnForm';
import { Button, Card, PageHeader, Sheet } from '../../components/ui';
import { useT } from '../../i18n/useT';
import type { Checkout, Sale } from '../../services/types';
import { checkoutSummary, MY_SALES_KEY, monthRange, teamApi } from '../../services/teamApi';
import { formatDateWith, formatHeadlineMoney, formatMoney, formatTime } from '../../utils/format';

/** How many of this month's sales the list shows. */
const CHECKOUTS_SHOWN = 50;

/**
 * Your month in one figure, then every sale this month. A sale opens to its
 * lines; each line can be returned (the owner approves it when over the limit),
 * and its invoice printed again.
 */
export function MySalesPage() {
  const t = useT();
  const [month] = useState(() => monthRange(new Date()));
  const monthName = formatDateWith(month.start, { month: 'long' });
  const totals = useQuery({ queryKey: [...MY_SALES_KEY, month.startDate], queryFn: () => teamApi.mySales(month) });
  const checkouts = useQuery({
    queryKey: [...MY_SALES_KEY, 'checkouts', month.startDate, CHECKOUTS_SHOWN],
    queryFn: () => teamApi.myCheckouts({ startDate: month.startDate, endDate: month.endDate, limit: CHECKOUTS_SHOWN }),
  });
  const [returning, setReturning] = useState<Sale | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <>
      <Sheet open={returning !== null} onClose={() => setReturning(null)} title={returning ? t.staff.mySales.returnLabel(returning.productName) : ''}>
        {returning && (
          <ReturnForm
            key={returning.id}
            sale={returning}
            onDone={(done) => {
              setReturning(null);
              setMessage(done);
            }}
          />
        )}
      </Sheet>
      <PageHeader title={t.staff.mySales.title} crumbs={[{ label: t.staff.nav.home, to: '/' }]} />

      <div className="staff-page">
        <Card title={t.staff.mySales.month(monthName)}>
          {totals.isPending && <Loading />}
          {totals.isError && <ErrorNotice error={totals.error} onRetry={() => totals.refetch()} />}
          {totals.data && (
            <>
              <p className="staff-figure">{formatHeadlineMoney(totals.data.current.revenue)}</p>
              <p className="staff-muted">
                {t.staff.mySales.summary({
                  sales: totals.data.current.salesCount,
                  units: totals.data.current.unitsSold,
                  refunds: totals.data.current.refunds > 0 ? formatMoney(totals.data.current.refunds) : null,
                  lastMonth: formatMoney(totals.data.previous.revenue),
                })}
              </p>
            </>
          )}
        </Card>

        {message && (
          <SavedToast message={message} />
        )}

        <section className="staff-section">
          <h2 className="staff-section__title">{t.staff.mySales.sales}</h2>
          {checkouts.isPending && <Loading />}
          {checkouts.isError && <ErrorNotice error={checkouts.error} onRetry={() => checkouts.refetch()} />}
          {checkouts.data?.length === 0 && <p className="staff-muted">{t.staff.mySales.none}</p>}
          {checkouts.data && checkouts.data.length > 0 && (
            <ul className="staff-rows">
              {checkouts.data.map((checkout) => (
                <CheckoutRow key={checkout.key} checkout={checkout} onReturn={setReturning} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

/** "10:42" for today, "4 Oct, 10:42" for earlier days. */
function saleTime(iso: string): string {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? formatTime(iso)
    : formatDateWith(date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** One sale: when, its invoice and total; opens to its lines, each with Return. */
function CheckoutRow({ checkout, onReturn }: { checkout: Checkout; onReturn: (sale: Sale) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const allReturned = checkout.lines.every((line) => line.returnedQuantity >= line.quantity);
  const panelId = `sale-${checkout.key}`;
  return (
    <li>
      <button type="button" className="staff-row" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((current) => !current)}>
        <span className="staff-row__text staff-row__grow">
          <span className="staff-row__hint">
            {saleTime(checkout.saleDate)}
            {checkout.invoice ? ` · ${checkout.invoice.number}` : ''}
            {allReturned ? ` · ${t.staff.mySales.returned}` : ''}
          </span>
          <span className={open ? 'staff-row__title' : 'staff-row__title staff-row__clip'}>{checkoutSummary(checkout)}</span>
        </span>
        <span className="staff-row__value">{formatMoney(checkout.total)}</span>
        <CaretDown size={16} aria-hidden="true" className={open ? 'staff-row__caret staff-row__caret--open' : 'staff-row__caret'} />
      </button>
      {open && (
        <div id={panelId} className="staff-sale-lines">
          {checkout.lines.map((line) => {
            const left = line.quantity - line.returnedQuantity;
            return (
              <div key={line.id} className="staff-sale-line">
                <span className="staff-row__text staff-row__grow">
                  <span>
                    {line.quantity} × {line.productName}
                  </span>
                  <span className="staff-row__hint">
                    {formatMoney(line.totalAmount)}
                    {line.returnedQuantity > 0 ? ` · ${t.staff.mySales.returnedSome(line.returnedQuantity)}` : ''}
                  </span>
                </span>
                {left > 0 ? (
                  <Button size="sm" aria-label={t.staff.mySales.returnLabel(line.productName)} onClick={() => onReturn(line)}>
                    {t.staff.mySales.return}
                  </Button>
                ) : (
                  <span className="staff-row__hint">{t.staff.mySales.returned}</span>
                )}
              </div>
            );
          })}
          {checkout.invoice && (
            <div className="staff-sale-lines__print">
              <PrintDocumentButton document={checkout.invoice} size="sm" variant="ghost" />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

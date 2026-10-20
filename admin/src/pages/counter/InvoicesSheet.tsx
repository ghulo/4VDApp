import { ArrowCounterClockwise, ArrowLeft, ArrowSquareOut, CaretLeft, CaretRight, MagnifyingGlass, Printer, X } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { ErrorNotice, Loading } from '../../components/Feedback';
import { Button, ButtonLink, Sheet } from '../../components/ui';
import { useT } from '../../i18n/useT';
import { counterApi } from '../../services/api';
import type { CounterReceipt } from '../../services/types';
import { formatDateWith, formatMoney, formatQuantity, formatTime, localDay } from '../../utils/format';
import { codeFromScan } from '../../utils/scanLinks';
import type { Unprinted } from './useFiscalPrinter';

interface InvoicesProps {
  online: boolean;
  /** Owners and admins can open the invoice in the dashboard. */
  canOpen: boolean;
  unprinted: Unprinted[];
  onPrintAgain: (item: Unprinted) => void;
  onRefund: (number: string) => void;
}

/**
 * Every invoice the till made, one day at a time (F1): today first, the
 * arrows step back through the days. Type to narrow the day by number,
 * customer or cashier; Enter on a full number finds it on any day.
 */
export function InvoicesSheet({ open, onClose, ...props }: InvoicesProps & { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} title={t.counter.invoices.title} placement="center" wide>
      <InvoicesBody {...props} />
    </Sheet>
  );
}

const shiftDay = (day: string, by: number) => {
  const [year, month, date] = day.split('-').map(Number);
  return localDay(new Date(year!, month! - 1, date! + by).toISOString());
};

function InvoicesBody({ online, canOpen, unprinted, onPrintAgain, onRefund }: InvoicesProps) {
  const t = useT();
  const v = t.counter.invoices;
  // The day the card opened on; it opens fresh each time.
  const [today] = useState(() => localDay(new Date().toISOString()));
  const [day, setDay] = useState(today);
  const [text, setText] = useState('');
  const [number, setNumber] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useQuery({
    queryKey: ['counter', 'receipts', number ? `n:${number}` : `d:${day}`],
    queryFn: () => (number ? counterApi.receipts(number) : counterApi.receipts(undefined, day)),
    enabled: online,
  });

  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(
    () =>
      number
        ? (list.data ?? [])
        : (list.data ?? []).filter((receipt) => {
            const haystack = `${receipt.number} ${receipt.fiscalReceiptNo ?? ''} ${receipt.customerName ?? ''} ${receipt.soldBy ?? ''}`.toLowerCase();
            return words.every((word) => haystack.includes(word));
          }),
    [list.data, number, words],
  );
  const opened = list.data?.find((receipt) => receipt.id === openId) ?? null;
  const totals = useMemo(() => {
    const all = list.data ?? [];
    const sum = (pick: (receipt: CounterReceipt) => number) => Math.round(all.reduce((total, receipt) => total + pick(receipt), 0) * 100) / 100;
    return {
      count: all.length,
      total: sum((receipt) => receipt.total),
      card: sum((receipt) => (receipt.paidBy === 'card' ? receipt.total : receipt.paidBy === 'split' ? (receipt.cardAmount ?? 0) : 0)),
      tab: sum((receipt) => (receipt.paidBy === 'tab' ? receipt.total : 0)),
    };
  }, [list.data]);

  function goTo(next: string) {
    setDay(next > today ? today : next);
    setNumber(null);
    setOpenId(null);
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (shown.length === 1) return setOpenId(shown[0]!.id);
    const code = codeFromScan(text).toUpperCase();
    // A whole invoice number from another day: look it up on its own.
    if (/^[A-Z]+-\d{4}-\d+$/.test(code)) setNumber(code);
  }

  if (!online) return <p className="counter-message counter-message--problem">{v.offline}</p>;

  if (opened) {
    return (
      <InvoiceDetail
        receipt={opened}
        canOpen={canOpen}
        unprinted={unprinted.find((item) => item.documentId === opened.id) ?? null}
        onBack={() => setOpenId(null)}
        onPrintAgain={onPrintAgain}
        onRefund={onRefund}
      />
    );
  }

  const dayLabel =
    day === today ? v.today : day === shiftDay(today, -1) ? v.yesterday : formatDateWith(new Date(`${day}T12:00:00`), { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="counter-finder-form">
      <div className="counter-finder-top">
        <div className="counter-invoices-bar">
          <div className="counter-invoices-day" role="group" aria-label={v.day}>
            <button type="button" className="counter-invoices-day__step" aria-label={v.dayBefore} onClick={() => goTo(shiftDay(day, -1))}>
              <CaretLeft size={16} weight="bold" aria-hidden="true" />
            </button>
            <label className="counter-invoices-day__pick">
              <span className="counter-invoices-day__label">{number ? v.anyDay : dayLabel}</span>
              <input type="date" value={day} max={today} aria-label={v.pickDay} onChange={(event) => event.target.value && goTo(event.target.value)} />
            </label>
            <button type="button" className="counter-invoices-day__step" aria-label={v.dayAfter} disabled={day >= today && !number} onClick={() => goTo(shiftDay(day, 1))}>
              <CaretRight size={16} weight="bold" aria-hidden="true" />
            </button>
          </div>
          <label className="counter-search counter-invoices-search">
            <MagnifyingGlass size={18} weight="bold" aria-hidden="true" />
            <span className="visually-hidden">{v.search}</span>
            <input
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the till types straight away, as in Products
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder={v.searchPlaceholder}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setNumber(null);
              }}
              onKeyDown={handleKey}
            />
            {text && (
              <button
                type="button"
                className="counter-search__clear"
                aria-label={t.counter.finder.clear}
                onClick={() => {
                  setText('');
                  setNumber(null);
                }}
              >
                <X size={16} weight="bold" aria-hidden="true" />
              </button>
            )}
          </label>
        </div>
        {!number && list.data && list.data.length > 0 && (
          <dl className="counter-invoices-totals">
            <div>
              <dt>{v.count}</dt>
              <dd>{totals.count}</dd>
            </div>
            <div>
              <dt>{v.total}</dt>
              <dd>{formatMoney(totals.total)}</dd>
            </div>
            <div>
              <dt>{t.counter.paidWith.card}</dt>
              <dd>{formatMoney(totals.card)}</dd>
            </div>
            {totals.tab > 0 && (
              <div>
                <dt>{t.counter.paidWith.tab}</dt>
                <dd>{formatMoney(totals.tab)}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorNotice error={list.error} onRetry={() => list.refetch()} />
      ) : shown.length === 0 ? (
        <div className="counter-empty">
          <MagnifyingGlass size={32} aria-hidden="true" className="counter-empty__icon" />
          <p className="counter-empty__title">{number ? t.counter.noReceipt(number) : words.length > 0 ? v.noMatch : v.none}</p>
          {!number && words.length > 0 && <p className="counter-hint">{v.noMatchHint}</p>}
        </div>
      ) : (
        <ul className="counter-finder counter-invoices" aria-label={v.title}>
          {shown.map((receipt) => {
            const failed = unprinted.some((item) => item.documentId === receipt.id);
            return (
              <li key={receipt.id}>
                <button type="button" className="counter-invoices__item" onClick={() => setOpenId(receipt.id)}>
                  <span className="counter-invoices__time">{number ? formatDateWith(new Date(receipt.issuedAt), { day: 'numeric', month: 'short' }) : formatTime(receipt.issuedAt)}</span>
                  <span className="counter-invoices__main">
                    <span className="counter-invoices__number">{receipt.number}</span>
                    <span className="counter-invoices__meta">
                      {[receipt.soldBy, receipt.customerName, v.lines(receipt.lines.length)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className={`counter-invoices__paid counter-invoices__paid--${receipt.paidBy}`}>{t.counter.paidWith[receipt.paidBy]}</span>
                  <span className="counter-invoices__fiscal">
                    {failed ? (
                      <span className="counter-invoices__failed">{t.counter.printer.failed}</span>
                    ) : receipt.fiscalReceiptNo ? (
                      t.counter.fiscalNo(receipt.fiscalReceiptNo)
                    ) : null}
                  </span>
                  <span className="counter-invoices__total">{formatMoney(receipt.total)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="counter-finder-foot">
        <p className="counter-finder-foot__status" aria-live="polite">
          {list.data && !number ? v.shown(shown.length, list.data.length) : ''}
        </p>
        <p className="counter-finder-foot__keys">
          <span>
            <kbd>Enter</kbd> {v.enterHint}
          </span>
          <span>
            <kbd>Esc</kbd> {t.counter.finder.close}
          </span>
        </p>
      </div>
    </div>
  );
}

function InvoiceDetail({
  receipt,
  canOpen,
  unprinted,
  onBack,
  onPrintAgain,
  onRefund,
}: {
  receipt: CounterReceipt;
  canOpen: boolean;
  unprinted: Unprinted | null;
  onBack: () => void;
  onPrintAgain: (item: Unprinted) => void;
  onRefund: (number: string) => void;
}) {
  const t = useT();
  const v = t.counter.invoices;
  const canGiveBack = receipt.lines.some((line) => !line.undone && line.quantity - line.returnedQuantity > 0);
  return (
    <div className="counter-invoice">
      <div className="counter-invoice__head">
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={onBack}>
          {v.back}
        </Button>
        <div className="counter-invoice__title">
          <p className="counter-invoice__number">{receipt.number}</p>
          <p className="counter-hint">
            {formatDateWith(new Date(receipt.issuedAt), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {receipt.soldBy ? ` · ${receipt.soldBy}` : ''}
          </p>
        </div>
        <p className="counter-invoice__total">{formatMoney(receipt.total)}</p>
      </div>

      <dl className="counter-invoices-totals">
        <div>
          <dt>{t.counter.paidBy}</dt>
          <dd>{receipt.paidBy === 'split' && receipt.cardAmount !== null ? t.counter.paidScreen.split(formatMoney(receipt.cardAmount)) : t.counter.paidWith[receipt.paidBy]}</dd>
        </div>
        {receipt.customerName && (
          <div>
            <dt>{t.counter.customer}</dt>
            <dd>{receipt.customerName}</dd>
          </div>
        )}
        <div>
          <dt>{v.fiscal}</dt>
          <dd>{unprinted ? <span className="counter-invoices__failed">{t.counter.printer.failed}</span> : (receipt.fiscalReceiptNo ?? v.noFiscal)}</dd>
        </div>
      </dl>

      <div className="counter-invoice__lines">
        <table className="counter-invoice__table">
          <thead>
            <tr>
              <th scope="col">{v.product}</th>
              <th scope="col" className="counter-invoice__num">
                {v.quantity}
              </th>
              <th scope="col" className="counter-invoice__num">
                {v.price}
              </th>
              <th scope="col" className="counter-invoice__num">
                {v.lineTotal}
              </th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((line) => (
              <tr key={line.saleId} className={line.undone ? 'counter-invoice__row--undone' : undefined}>
                <td>
                  {line.productName}
                  {line.undone ? (
                    <span className="counter-invoice__note">{t.counter.undone}</span>
                  ) : (
                    line.returnedQuantity > 0 && <span className="counter-invoice__note">{v.returned(formatQuantity(line.returnedQuantity))}</span>
                  )}
                </td>
                <td className="counter-invoice__num">{formatQuantity(line.quantity)}</td>
                <td className="counter-invoice__num">{formatMoney(line.pricePerUnit)}</td>
                <td className="counter-invoice__num">{formatMoney(Math.round(line.quantity * line.pricePerUnit * 100) / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="counter-invoice__actions">
        {unprinted?.text && (
          <Button icon={Printer} onClick={() => onPrintAgain(unprinted)}>
            {t.counter.paidScreen.printAgain}
          </Button>
        )}
        <Button icon={ArrowCounterClockwise} disabled={!canGiveBack} onClick={() => onRefund(receipt.number)}>
          {t.counter.refund}
        </Button>
        {canOpen && (
          <ButtonLink variant="ghost" icon={ArrowSquareOut} to={`/documents/${receipt.id}`}>
            {t.counter.openInvoice}
          </ButtonLink>
        )}
      </div>
    </div>
  );
}

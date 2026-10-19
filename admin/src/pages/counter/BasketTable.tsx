import { Hourglass, User } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { useT } from '../../i18n/useT';
import { formatMoney, formatQuantity } from '../../utils/format';
import type { BasketSummary, CounterLine, PriceReason } from './basketMath';

interface TableProps {
  lines: CounterLine[];
  selectedId: number | null;
  /** The product just scanned in: its row flashes once. */
  flashId: number | null;
  /** Bumped on every scan, so scanning the same product again flashes it again. */
  flashKey: number;
  /** Product id to days until its soonest expiry date still on the shelf. */
  expiry: Map<number, number>;
  onSelect: (productId: number) => void;
}

/**
 * The basket as a till's line table: every line with its code, quantity, the
 * price and why it differs from the shelf, the rabat, VAT, the line total and
 * what stays on the shelf. A row is picked with a click or the arrow keys.
 */
export function BasketTable({ lines, selectedId, flashId, flashKey, expiry, onSelect }: TableProps) {
  const t = useT();
  const selectedRow = useRef<HTMLTableRowElement>(null);

  // The picked line stays in view when the arrows move past the edge.
  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, lines.length]);

  return (
    <div className="counter-table-wrap">
      <table className="counter-table" aria-label={t.counter.lines}>
        <thead>
          <tr>
            <th scope="col" className="counter-table__no">{t.counter.columns.number}</th>
            <th scope="col" className="counter-table__code">{t.counter.columns.code}</th>
            <th scope="col">{t.counter.columns.product}</th>
            <th scope="col" className="counter-table__num">{t.counter.columns.quantity}</th>
            <th scope="col" className="counter-table__num">{t.counter.columns.price}</th>
            <th scope="col" className="counter-table__num counter-table__rabat">{t.counter.columns.rabat}</th>
            <th scope="col" className="counter-table__num counter-table__vat">{t.counter.columns.vat}</th>
            <th scope="col" className="counter-table__num">{t.counter.columns.total}</th>
            <th scope="col" className="counter-table__num counter-table__left">{t.counter.columns.left}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            const product = line.product;
            const isSelected = line.productId === selectedId;
            const unit = product?.unit ?? 'piece';
            const left = product ? Math.round((product.stock.quantity - line.quantity) * 1000) / 1000 : null;
            const stockTone = left === null ? '' : left <= 0 ? ' counter-stock--out' : product && left <= product.stock.reorderLevel ? ' counter-stock--low' : '';
            const days = expiry.get(line.productId);
            const name = product?.name ?? line.name;
            return (
              <tr
                key={line.productId === flashId ? `${line.productId}-${flashKey}` : line.productId}
                ref={isSelected ? selectedRow : undefined}
                className={`counter-row${isSelected ? ' counter-row--selected' : ''}${line.productId === flashId ? ' counter-row--new' : ''}`}
                onClick={() => onSelect(line.productId)}
              >
                <td className="counter-table__no">{index + 1}</td>
                <td className="counter-table__code">{product?.barcode ?? product?.sku ?? ''}</td>
                <td className="counter-table__product">
                  {/* The row's button: what the keyboard and screen readers pick. */}
                  <button
                    type="button"
                    className="counter-row__pick"
                    aria-pressed={isSelected}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(line.productId);
                    }}
                  >
                    {name}
                  </button>
                  {(line.reasons.length > 0 || days !== undefined) && (
                    <span className="counter-row__notes">
                      {line.reasons.map((reason) => (
                        <span key={reason.kind} className={`counter-note counter-note--${reason.kind === 'priceSet' ? 'set' : 'off'}`}>
                          {reasonText(t, reason)}
                        </span>
                      ))}
                      {days !== undefined && (
                        <span className={days <= 0 ? 'counter-note counter-note--danger' : 'counter-note counter-note--warn'}>
                          <Hourglass size={12} weight="bold" aria-hidden="true" />
                          {t.counter.expires(days)}
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td className="counter-table__num counter-table__qty">{formatQuantity(line.quantity, unit)}</td>
                <td className="counter-table__num">
                  {product && line.unitPrice < product.price && (
                    <span className="counter-row__was">
                      <s aria-hidden="true">{formatMoney(product.price)}</s>
                      <span className="visually-hidden">{t.counter.shelfPrice(formatMoney(product.price))}</span>
                    </span>
                  )}
                  {formatMoney(line.unitPrice)}
                  {unit === 'kg' && <span className="counter-row__unit">{t.counter.perKg}</span>}
                </td>
                <td className="counter-table__num counter-table__rabat">{line.percent > 0 ? `${line.percent}%` : '–'}</td>
                <td className="counter-table__num counter-table__vat">{product ? `${product.vatExempt ? 0 : product.vatRate}%` : '–'}</td>
                <td className="counter-table__num counter-table__total">{formatMoney(line.total)}</td>
                <td className={`counter-table__num counter-table__left${stockTone}`} title={left === null ? undefined : t.counter.stockAfter(left)}>
                  {left === null ? '–' : formatQuantity(left, unit)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function reasonText(t: ReturnType<typeof useT>, reason: PriceReason): string {
  switch (reason.kind) {
    case 'priceSet':
      return t.counter.reason.priceSet;
    case 'rabat':
      return t.counter.reason.rabat(`${reason.percent}%`);
    case 'basketRabat':
      return t.counter.reason.basketRabat(`${reason.percent}%`);
    case 'promotion':
      return t.counter.reason.promotion(reason.name);
    case 'bulk':
      return t.counter.reason.bulk(reason.from);
  }
}

/** Above the lines: who is buying, the receipt it becomes, when the basket started, and its rabat. */
export function SaleHead({
  customerName,
  nextReceipt,
  startedAt,
  basketRabat,
  onCustomer,
}: {
  customerName: string | null;
  nextReceipt: string | null;
  startedAt: string;
  basketRabat: number;
  onCustomer: () => void;
}) {
  const t = useT();
  return (
    <div className="counter-head">
      <button type="button" className="counter-head__customer" onClick={onCustomer} aria-keyshortcuts="F5" title={`${t.counter.changeCustomer} · F5`}>
        <User size={16} weight="bold" aria-hidden="true" />
        <span className="counter-head__label">{t.counter.customer}</span>
        <span className={customerName ? 'counter-head__name' : 'counter-head__name counter-head__name--walkin'}>{customerName ?? t.counter.walkIn}</span>
        <kbd className="counter-key__hotkey" aria-hidden="true">
          F5
        </kbd>
      </button>
      <dl className="counter-head__facts">
        {basketRabat > 0 && (
          <div className="counter-head__fact counter-head__fact--rabat">
            <dt>{t.counter.basketRabat}</dt>
            <dd>{basketRabat}%</dd>
          </div>
        )}
        {nextReceipt && (
          <div className="counter-head__fact">
            <dt>{t.counter.nextReceipt}</dt>
            <dd className="counter-head__mono">{nextReceipt}</dd>
          </div>
        )}
      </dl>
      <p className="counter-head__started">{t.counter.startedAt(startedAt)}</p>
    </div>
  );
}

/** Under the lines, like the foot of a receipt: counts, subtotal, rabat, the VAT inside, and what to pay. */
export function BasketSummaryFoot({ summary }: { summary: BasketSummary }) {
  const t = useT();
  return (
    <div className="counter-foot" aria-label={t.counter.summary.label} role="group">
      <dl className="counter-foot__facts">
        <div className="counter-foot__fact">
          <dt>{t.counter.summary.products}</dt>
          <dd>{summary.products}</dd>
        </div>
        <div className="counter-foot__fact">
          <dt>{t.counter.summary.pieces}</dt>
          <dd>{summary.pieces}</dd>
        </div>
        <div className="counter-foot__fact">
          <dt>{t.counter.summary.subtotal}</dt>
          <dd>{formatMoney(summary.subtotal)}</dd>
        </div>
        {summary.rabat > 0 && (
          <div className="counter-foot__fact counter-foot__fact--rabat">
            <dt>{t.counter.summary.rabat}</dt>
            <dd>−{formatMoney(summary.rabat)}</dd>
          </div>
        )}
        {summary.vat.map((part) => (
          <div key={part.rate} className="counter-foot__fact counter-foot__fact--quiet">
            <dt>{t.counter.summary.vat(part.rate)}</dt>
            <dd>{formatMoney(part.amount)}</dd>
          </div>
        ))}
      </dl>
      <p className="counter-foot__total">
        <span className="counter-foot__total-label">{t.counter.summary.toPay}</span>
        <span className="counter-foot__amount">{formatMoney(summary.total)}</span>
      </p>
    </div>
  );
}

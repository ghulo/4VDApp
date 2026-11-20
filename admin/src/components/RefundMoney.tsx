import { CreditCard } from '@phosphor-icons/react';
import { useId } from 'react';
import { Segmented } from './BillLines';
import { Field } from './ui';
import { useT } from '../i18n/useT';
import type { RefundInfo } from '../services/types';
import { partsOf, type RefundChoice } from '../utils/refundChoice';
import { isIbanOrEmpty } from '../utils/iban';
import { formatDate, formatMoney, formatTime } from '../utils/format';
import { partsTotal, REFUND_METHODS, type RefundMethod, type RefundParts } from '../utils/refundSplit';

/** The receipt line at the top: its number, when it was sold and how it was paid. */
export function ReceiptLine({ info }: { info: RefundInfo }) {
  const t = useT();
  const how = info.paidBy === 'tab' && info.tabCustomer ? t.refundMoney.onTab(info.tabCustomer) : t.refundMoney.paidBy(t.refundMoney.paidWith[info.paidBy]);
  return (
    <p className="refund-money__receipt">
      <span className="refund-money__number">{info.receiptNumber ? t.refundMoney.receipt(info.receiptNumber) : t.refundMoney.noReceipt}</span>
      <span className="refund-money__meta">
        {formatDate(info.soldAt)} {formatTime(info.soldAt)} · {how}
        {info.paidBy === 'split' && info.cardAmount !== null && info.receiptTotal !== null
          ? ` (${formatMoney(info.cardAmount)} / ${formatMoney(info.receiptTotal)})`
          : ''}
      </span>
    </p>
  );
}

/**
 * The "How does the money go back?" step of a refund: cash from the till,
 * on the card terminal, by bank transfer, off their tab, or split. It starts
 * the way the sale was paid. The screen around it owns the state (utils/refundChoice).
 */
export function RefundMoney({
  info,
  amount,
  waits,
  choice,
  onChange,
}: {
  info: RefundInfo;
  amount: number;
  waits: boolean;
  choice: RefundChoice;
  onChange: (choice: RefundChoice) => void;
}) {
  const t = useT();
  const id = useId();
  const words = t.refundMoney;
  const parts = partsOf(choice, info, amount);
  const methods = REFUND_METHODS.filter((method) => method !== 'tab' || info.paidBy === 'tab');
  const set = (changes: Partial<RefundChoice>) => onChange({ ...choice, ...changes });
  const sum = partsTotal(parts);
  const adds = Math.round(sum * 100) === Math.round(amount * 100);

  function pick(mode: RefundChoice['mode']) {
    // Splitting starts from what is chosen now, so nothing has to be typed twice.
    set({ mode, split: mode === 'split' ? toText(parts) : choice.split, terminalDone: false });
  }

  return (
    <fieldset className="refund-money">
      <legend className="field__label">{words.howBack}</legend>
      <Segmented
        label={words.howBack}
        value={choice.mode}
        onChange={pick}
        options={[...methods.map((method) => ({ value: method, label: words.methods[method] })), { value: 'split' as const, label: words.methods.split }]}
      />

      {choice.mode === 'split' && (
        <div className="refund-money__split">
          {methods.map((method) => (
            <Field key={method} label={words.parts[method]}>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                value={(choice.split ?? toText(parts))[method]}
                onChange={(event) => set({ split: { ...(choice.split ?? toText(parts)), [method]: event.target.value } })}
              />
            </Field>
          ))}
          <p className={adds ? 'refund-money__sum' : 'refund-money__sum refund-money__sum--off'} aria-live="polite">
            {adds ? words.partsAddUp(formatMoney(sum), formatMoney(amount)) : words.partsWrong(formatMoney(sum), formatMoney(amount))}
          </p>
        </div>
      )}

      {parts.card > 0 && (
        <div className="refund-money__terminal" role="group" aria-labelledby={`${id}-terminal`}>
          <p id={`${id}-terminal`} className="refund-money__terminal-title">
            <CreditCard aria-hidden="true" weight="duotone" />
            {words.onTerminal(formatMoney(parts.card))}
          </p>
          {waits ? (
            <p className="refund-money__hint">{words.waitsForOwner}</p>
          ) : (
            <>
              <p className="refund-money__hint">{words.onTerminalHint}</p>
              <label className="toggle refund-money__done">
                <input type="checkbox" checked={choice.terminalDone} onChange={(event) => set({ terminalDone: event.target.checked })} />
                {words.terminalDone}
              </label>
            </>
          )}
          <Field label={words.approvalCode}>
            <input autoComplete="off" spellCheck={false} maxLength={40} value={choice.approvalCode} onChange={(event) => set({ approvalCode: event.target.value })} />
          </Field>
        </div>
      )}

      {parts.transfer > 0 && (
        <div className="refund-money__transfer" role="group" aria-labelledby={`${id}-transfer`}>
          <p id={`${id}-transfer`} className="refund-money__terminal-title">
            {words.transferTitle(formatMoney(parts.transfer))}
          </p>
          <p className="refund-money__hint">{words.transferHint}</p>
          <div className="field-row">
            <Field label={words.customerName}>
              <input autoComplete="off" maxLength={200} required value={choice.customerName} onChange={(event) => set({ customerName: event.target.value })} />
            </Field>
            <Field label={words.iban} error={isIbanOrEmpty(choice.iban) ? undefined : words.ibanWrong}>
              <input autoComplete="off" spellCheck={false} maxLength={40} value={choice.iban} onChange={(event) => set({ iban: event.target.value })} />
            </Field>
          </div>
        </div>
      )}

      {parts.transfer === 0 && (
        <Field label={words.customerNameOptional}>
          <input autoComplete="off" maxLength={200} value={choice.customerName} onChange={(event) => set({ customerName: event.target.value })} />
        </Field>
      )}
    </fieldset>
  );
}

const toText = (parts: RefundParts): Record<RefundMethod, string> => ({
  cash: parts.cash ? String(parts.cash) : '',
  card: parts.card ? String(parts.card) : '',
  transfer: parts.transfer ? String(parts.transfer) : '',
  tab: parts.tab ? String(parts.tab) : '',
});

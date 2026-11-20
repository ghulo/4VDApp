import { MagnifyingGlass } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Segmented } from '../../components/BillLines';
import { ErrorNotice, Loading } from '../../components/Feedback';
import { Button, Field, Sheet } from '../../components/ui';
import { useT } from '../../i18n/useT';
import { counterApi, returnsApi } from '../../services/api';
import type { CounterReceipt, ReturnCondition } from '../../services/types';
import { errorMessage } from '../../utils/errors';
import { formatDate, formatMoney, formatTime } from '../../utils/format';
import { codeFromScan } from '../../utils/scanLinks';
import { RefundMoney } from '../../components/RefundMoney';
import { initialChoice, partsOf, type RefundChoice, refundByInput, refundProblem, waitsForOwner } from '../../utils/refundChoice';
import { shareOverLines } from '../../utils/refundSplit';

/**
 * Giving something back at the Counter: find the invoice (scanned, typed or
 * one of today's), say how many of each line come back and in what state,
 * and how the money goes back (the way it was paid, unless changed). The
 * shop's usual approval limits apply; nothing prints.
 */
export function RefundSheet({ open, initialNumber, onClose, onDone }: { open: boolean; initialNumber: string | null; onClose: () => void; onDone: (message: string) => void }) {
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} title={t.counter.refundTitle} description={t.counter.refundHint} placement="center" wide>
      <RefundForm initialNumber={initialNumber} onDone={onDone} />
    </Sheet>
  );
}

function RefundForm({ initialNumber, onDone }: { initialNumber: string | null; onDone: (message: string) => void }) {
  const t = useT();
  const [text, setText] = useState(initialNumber ?? '');
  const [number, setNumber] = useState<string | null>(initialNumber);
  const [picked, setPicked] = useState<CounterReceipt | null>(null);
  const found = useQuery({
    queryKey: ['counter', 'receipts', number ?? 'today'],
    queryFn: () => counterApi.receipts(number ?? undefined),
  });

  function find(event: FormEvent) {
    event.preventDefault();
    const code = codeFromScan(text).toUpperCase();
    setPicked(null);
    setNumber(code || null);
  }

  const receipt = picked ?? (number && found.data?.length === 1 ? found.data[0]! : null);

  return (
    <div className="counter-form">
      {!receipt && (
        <>
          <form className="counter-find" onSubmit={find}>
            <Field label={t.counter.receiptNumber}>
              <input value={text} autoComplete="off" spellCheck={false} placeholder="F-2026-000042" onChange={(event) => setText(event.target.value)} />
            </Field>
            <Button type="submit" icon={MagnifyingGlass}>
              {t.counter.find}
            </Button>
          </form>
          {found.isPending ? (
            <Loading />
          ) : found.isError ? (
            <ErrorNotice error={found.error} onRetry={() => found.refetch()} />
          ) : number && found.data.length === 0 ? (
            <p className="counter-hint" role="alert">
              {t.counter.noReceipt(number)}
            </p>
          ) : !number ? (
            <section aria-label={t.counter.today}>
              <h3 className="counter-subhead">{t.counter.today}</h3>
              {found.data.length === 0 ? (
                <p className="counter-hint">{t.counter.noReceipts}</p>
              ) : (
                <ul className="counter-receipts">
                  {found.data.map((item) => (
                    <li key={item.id}>
                      <button type="button" className="counter-receipts__item" onClick={() => setPicked(item)}>
                        <span className="counter-receipts__number">{item.number}</span>
                        <span className="counter-receipts__meta">
                          {formatTime(item.issuedAt)} · {t.counter.paidWith[item.paidBy]}
                          {item.soldBy ? ` · ${item.soldBy}` : ''}
                        </span>
                        <span className="counter-receipts__total">{formatMoney(item.total)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      )}
      {receipt && (
        <RefundLines
          key={receipt.id}
          receipt={receipt}
          onOther={() => {
            setPicked(null);
            setNumber(null);
            setText('');
          }}
          onDone={onDone}
        />
      )}
    </div>
  );
}

function RefundLines({ receipt, onOther, onDone }: { receipt: CounterReceipt; onOther: () => void; onDone: (message: string) => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [condition, setCondition] = useState<ReturnCondition>('resellable');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = receipt.lines.map((line) => ({ ...line, left: line.undone ? 0 : Math.max(0, line.quantity - line.returnedQuantity) }));
  const chosen = lines
    .map((line) => ({ line, quantity: Math.min(Math.max(Math.floor(Number(counts[line.saleId] ?? 0)) || 0, 0), line.left) }))
    .filter((pick) => pick.quantity > 0);
  const lineAmounts = chosen.map((pick) => Math.round(pick.quantity * pick.line.pricePerUnit * 100) / 100);
  const amount = Math.round(lineAmounts.reduce((sum, value) => sum + value, 0) * 100) / 100;
  const firstSale = receipt.lines[0]?.saleId;
  const info = useQuery({ queryKey: ['returns', 'refund-info', firstSale], queryFn: () => returnsApi.refundInfo(firstSale!), enabled: firstSale !== undefined });
  const [picked, setPicked] = useState<RefundChoice | null>(null);
  const choice = picked ?? (info.data ? initialChoice(info.data) : null);
  const money = info.data && choice ? partsOf(choice, info.data, amount) : null;
  const waits = info.data ? waitsForOwner(info.data, lineAmounts, condition === 'damaged') : false;
  const problem = money && choice && chosen.length > 0 ? refundProblem(t, choice, money, amount, waits) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (chosen.length === 0) return setError(t.counter.nothingPicked);
    if (!money || !choice || problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const results = [];
      // One refund over several lines: each line gets its share of each way, and they show as one payment to make.
      const shares = shareOverLines(lineAmounts, money);
      const batch = chosen.length > 1 ? crypto.randomUUID() : null;
      for (const [index, pick] of chosen.entries()) {
        results.push(await returnsApi.request(pick.line.saleId, { quantity: pick.quantity, condition, notes: null, refundBy: refundByInput(choice, shares[index]!, batch) }));
      }
      for (const key of ['returns', 'sales', 'inventory', 'products', 'counter', 'notifications', 'cash', 'money']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      const waiting = results.some((result) => result.status === 'pending');
      onDone(waiting ? t.counter.refundWaiting : t.counter.refundDone(formatMoney(amount)));
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <form className="counter-form" onSubmit={submit}>
      <div className="counter-refund-head">
        <div>
          <p className="counter-refund-head__number">{receipt.number}</p>
          <p className="counter-refund-head__meta">
            {formatDate(receipt.issuedAt)} {formatTime(receipt.issuedAt)} · {t.counter.paidWith[receipt.paidBy]} · {formatMoney(receipt.total)}
            {receipt.fiscalReceiptNo ? ` · ${t.counter.fiscalNo(receipt.fiscalReceiptNo)}` : ''}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onOther}>
          {t.counter.otherInvoice}
        </Button>
      </div>
      <ul className="counter-refund-lines">
        {lines.map((line) => (
          <li key={line.saleId} className="counter-refund-line">
            <div>
              <p className="counter-refund-line__name">{line.productName}</p>
              <p className="counter-refund-line__meta">
                {line.undone ? t.counter.undone : line.left === 0 ? t.counter.allBack : t.counter.returnable(line.left, line.quantity)} ·{' '}
                {t.counter.each(formatMoney(line.pricePerUnit))}
              </p>
            </div>
            <input
              className="counter-refund-line__count"
              type="number"
              min={0}
              max={line.left}
              step={1}
              inputMode="numeric"
              disabled={line.left === 0}
              aria-label={t.counter.howMany(line.productName)}
              value={counts[line.saleId] ?? ''}
              placeholder="0"
              onChange={(event) => setCounts((now) => ({ ...now, [line.saleId]: event.target.value }))}
            />
          </li>
        ))}
      </ul>
      <div className="field">
        <span className="field__label" aria-hidden="true">
          {t.counter.condition}
        </span>
        <Segmented
          label={t.counter.condition}
          value={condition}
          onChange={setCondition}
          options={[
            { value: 'resellable', label: t.counter.resellable },
            { value: 'damaged', label: t.counter.damaged },
          ]}
        />
      </div>
      {info.isError ? (
        <p className="form-error" role="alert">
          {t.refundMoney.loadFailed}
        </p>
      ) : (
        info.data && choice && <RefundMoney info={info.data} amount={amount} waits={waits} choice={choice} onChange={setPicked} />
      )}
      {problem && chosen.length > 0 && !error && (
        <p className="counter-hint" role="status">
          {problem}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Button variant="primary" type="submit" wide loading={busy} disabled={chosen.length === 0 || !money || problem !== null}>
          {chosen.length === 0 ? t.counter.nothingPicked : t.counter.refundAmount(formatMoney(amount))}
        </Button>
      </div>
    </form>
  );
}

import { Printer } from '@phosphor-icons/react';
import { type FormEvent, useState } from 'react';
import { Segmented } from '../../components/BillLines';
import { Button, Field, Sheet } from '../../components/ui';
import { useT } from '../../i18n/useT';
import type { Customer } from '../../services/types';
import { errorMessage } from '../../utils/errors';
import { formatDateTime, formatMoney, formatTime } from '../../utils/format';
import { changeIn, likelyNotes } from './changeCoach';
import type { Unprinted } from './useFiscalPrinter';

/** "7,5" or "7.5" as a number; NaN when it isn't one. */
export const parseAmount = (text: string) => (text.trim() === '' ? Number.NaN : Number(text.replace(',', '.')));

export type ReasonKey = 'scannedTwice' | 'changedMind' | 'wrongProduct' | 'leftWithout' | 'change' | 'other';

interface ReasonProps {
  reasons: ReasonKey[];
  confirm: string;
  onConfirm: (reason: string) => Promise<void>;
}

/** Asks why before a line, a basket or the drawer goes: the owner reads it in the Counter report. */
export function ReasonSheet({ open, title, onClose, ...form }: ReasonProps & { open: boolean; title: string; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <ReasonForm {...form} />
    </Sheet>
  );
}

function ReasonForm({ reasons, confirm, onConfirm }: ReasonProps) {
  const t = useT();
  const [picked, setPicked] = useState<ReasonKey>(reasons[0]!);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = picked === 'other' ? other.trim() : t.counter.reasons[picked];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason) return setError(t.counter.reasonNeeded);
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <form className="counter-form" onSubmit={submit}>
      <fieldset className="counter-reasons">
        <legend className="field__label">{t.counter.why}</legend>
        {[...reasons, 'other' as const].map((key) => (
          <label key={key} className="counter-reason">
            <input type="radio" name="reason" checked={picked === key} onChange={() => setPicked(key)} />
            <span>{t.counter.reasons[key]}</span>
          </label>
        ))}
      </fieldset>
      {picked === 'other' && (
        <Field label={t.counter.why} hint={t.counter.whyHint}>
          <input value={other} maxLength={200} autoFocus onChange={(event) => setOther(event.target.value)} />
        </Field>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Button variant="danger" type="submit" loading={busy}>
          {confirm}
        </Button>
      </div>
    </form>
  );
}

interface NumberProps {
  label: string;
  hint?: string;
  initial: string;
  /** Only whole numbers (a quantity). */
  whole?: boolean;
  /** Why it can't be used, or null. */
  check: (value: number) => string | null;
  onApply: (value: number) => void;
}

/** One number for the chosen line: how many, the price, or the rabat. */
export function NumberSheet({ open, title, onClose, ...form }: NumberProps & { open: boolean; title: string; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <NumberForm {...form} />
    </Sheet>
  );
}

function NumberForm({ label, hint, initial, whole, check, onApply }: NumberProps) {
  const t = useT();
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = parseAmount(text);
    const problem = !Number.isFinite(value) || value < 0 || (whole && !Number.isInteger(value)) ? t.counter.reasonNeeded : check(value);
    if (problem) return setError(problem);
    onApply(value);
  }

  return (
    <form className="counter-form" onSubmit={submit}>
      <Field label={label} hint={hint} error={error ?? undefined}>
        <input
          className="counter-number"
          inputMode={whole ? 'numeric' : 'decimal'}
          autoComplete="off"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          onFocus={(event) => event.target.select()}
        />
      </Field>
      <div className="form-actions">
        <Button variant="primary" type="submit">
          {t.counter.apply}
        </Button>
      </div>
    </form>
  );
}

export interface Payment {
  paidBy: 'cash' | 'card' | 'tab';
  tendered: number | null;
  customerId: number | null;
}

interface PayProps {
  total: number;
  customers: Customer[] | undefined;
  onPay: (payment: Payment) => Promise<void>;
}

/** Taking the money: cash (with the change and how to give it), card on the bank's terminal, or on a customer's tab. */
export function PaySheet({ open, onClose, ...form }: PayProps & { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} title={t.counter.payTitle(formatMoney(form.total))}>
      <PayForm {...form} />
    </Sheet>
  );
}

function PayForm({ total, customers, onPay }: PayProps) {
  const t = useT();
  const [paidBy, setPaidBy] = useState<Payment['paidBy']>('cash');
  const [tendered, setTendered] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const given = parseAmount(tendered);
  const change = Number.isFinite(given) ? Math.round((given - total) * 100) / 100 : null;
  const short = change !== null && change < 0;
  const blocked = (paidBy === 'tab' && customerId === '') || (paidBy === 'cash' && short);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      await onPay({
        paidBy,
        tendered: paidBy === 'cash' && Number.isFinite(given) ? given : null,
        customerId: paidBy === 'tab' ? Number(customerId) : null,
      });
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <form className="counter-form" onSubmit={submit}>
      <Segmented
        label={t.counter.paidBy}
        value={paidBy}
        onChange={setPaidBy}
        options={[
          { value: 'cash', label: t.counter.cash },
          { value: 'card', label: t.counter.card },
          { value: 'tab', label: t.counter.tab },
        ]}
      />
      {paidBy === 'cash' && (
        <>
          <Field label={t.counter.tendered}>
            <input
              className="counter-number"
              inputMode="decimal"
              autoComplete="off"
              placeholder={total.toFixed(2)}
              value={tendered}
              onChange={(event) => setTendered(event.target.value)}
            />
          </Field>
          <div className="counter-notes" role="group" aria-label={t.counter.tendered}>
            <Button size="sm" onClick={() => setTendered(total.toFixed(2))}>
              {t.counter.exact}
            </Button>
            {likelyNotes(total).map((note) => (
              <Button key={note} size="sm" onClick={() => setTendered(String(note))}>
                {formatMoney(note)}
              </Button>
            ))}
          </div>
          {change !== null && (
            <div className={short ? 'counter-change counter-change--short' : 'counter-change'} aria-live="polite">
              <p className="counter-change__label">{short ? t.counter.short(formatMoney(-change)) : t.counter.giveBack}</p>
              {!short && <p className="counter-change__amount">{formatMoney(change)}</p>}
              {!short && change > 0 && (
                <ul className="counter-coach" aria-label={t.counter.coach}>
                  {changeIn(change).map((piece) => (
                    <li key={piece.value} className={piece.value >= 5 ? 'counter-coach__piece counter-coach__piece--note' : 'counter-coach__piece'}>
                      {t.counter.coachNote(piece.count, formatMoney(piece.value))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
      {paidBy === 'card' && <p className="counter-hint">{t.counter.cardHint}</p>}
      {paidBy === 'tab' &&
        (customers && customers.length === 0 ? (
          <p className="counter-hint">{t.counter.noCustomers}</p>
        ) : (
          <Field label={t.counter.customer}>
            <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">{t.counter.pickCustomer}</option>
              {customers?.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </Field>
        ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Button variant="primary" type="submit" wide loading={busy} disabled={blocked}>
          {t.counter.recordSale(formatMoney(total))}
        </Button>
      </div>
    </form>
  );
}

interface ZProps {
  lastZ: { at: string; by: string | null } | null;
  onRun: () => Promise<void>;
}

/** The Z report closes the fiscal day; a second one in a day is almost always a mistake. */
export function ZSheet({ open, onClose, ...form }: ZProps & { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} title={t.counter.zConfirm} description={t.counter.zHint}>
      <ZForm {...form} />
    </Sheet>
  );
}

function ZForm({ lastZ, onRun }: ZProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [todayIs] = useState(() => new Date().toDateString());
  const today = lastZ !== null && new Date(lastZ.at).toDateString() === todayIs;
  return (
    <div className="counter-form">
      {lastZ && today && (
        <p className="counter-warning" role="alert">
          {t.counter.zAlready(formatTime(lastZ.at), lastZ.by ?? '—')}
        </p>
      )}
      <div className="form-actions">
        <Button
          variant={today ? 'danger' : 'primary'}
          icon={Printer}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await onRun();
            setBusy(false);
          }}
        >
          {t.counter.runZ}
        </Button>
      </div>
    </div>
  );
}

/** Sales recorded whose receipt didn't print: each can be printed once the printer is ready. */
export function UnprintedSheet({
  open,
  items,
  canPrint,
  onClose,
  onPrint,
  onLeave,
}: {
  open: boolean;
  items: Unprinted[];
  canPrint: boolean;
  onClose: () => void;
  onPrint: (item: Unprinted) => Promise<void>;
  onLeave: (item: Unprinted) => void;
}) {
  const t = useT();
  const [printing, setPrinting] = useState<number | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title={t.counter.notPrintedTitle} description={t.counter.notPrintedHint}>
      {items.length === 0 ? (
        <p className="counter-hint">{t.counter.nothingUnprinted}</p>
      ) : (
        <ul className="counter-unprinted">
          {items.map((item) => (
            <li key={item.documentId} className="counter-unprinted__item">
              <div>
                <p className="counter-unprinted__title">
                  {item.number} · {formatMoney(item.total)}
                </p>
                <p className="counter-unprinted__meta">{formatDateTime(item.at)}</p>
                <p className="counter-unprinted__reason">{item.reason}</p>
              </div>
              <div className="counter-unprinted__actions">
                <Button
                  size="sm"
                  icon={Printer}
                  aria-label={t.counter.printAgainLabel(item.number)}
                  disabled={!canPrint || (printing !== null && printing !== item.documentId)}
                  loading={printing === item.documentId}
                  onClick={async () => {
                    setPrinting(item.documentId);
                    await onPrint(item);
                    setPrinting(null);
                  }}
                >
                  {t.counter.printAgain}
                </Button>
                <Button size="sm" variant="ghost" aria-label={t.counter.dismissLabel(item.number)} onClick={() => onLeave(item)}>
                  {t.counter.dismiss}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

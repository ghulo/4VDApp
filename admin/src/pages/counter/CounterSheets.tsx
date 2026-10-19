import { ArrowLeft, Printer } from '@phosphor-icons/react';
import { type FormEvent, useState } from 'react';
import { Segmented } from '../../components/BillLines';
import { Button, Field, Sheet } from '../../components/ui';
import { useT } from '../../i18n/useT';
import type { Customer } from '../../services/types';
import { errorMessage } from '../../utils/errors';
import { formatDateTime, formatMoney, formatTime } from '../../utils/format';
import { changeIn, likelyNotes } from './changeCoach';
import { cashDue, changeFor, type PayDraft, splitFor } from './payDraft';
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
          aria-invalid={error ? true : undefined}
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
  /** 'split': part on the card terminal (`cardAmount`), the rest cash. */
  paidBy: 'cash' | 'card' | 'tab' | 'split';
  /** The cash the customer handed over. */
  tendered: number | null;
  customerId: number | null;
  cardAmount: number | null;
}

interface PayProps {
  total: number;
  customers: Customer[] | undefined;
  draft: PayDraft;
  onChange: (draft: PayDraft) => void;
  onPay: (payment: Payment) => Promise<void>;
  onBack: () => void;
}

/**
 * Taking the money, in place of the till keys: cash (with the change and how to
 * give it), card on the bank's terminal, part of each, or on a customer's tab. The receipt
 * beside it shows what was paid and the change as it is typed.
 */
export function PayPanel({ total, customers, draft, onChange, onPay, onBack }: PayProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cash = changeFor(draft, total);
  const split = splitFor(draft, total);
  const due = cashDue(draft, total);
  const short = cash !== null && cash.change < 0;
  const blocked = (draft.paidBy === 'tab' && draft.customerId === '') || short || (draft.paidBy === 'split' && !split?.valid);
  const takesCash = draft.paidBy === 'cash' || (draft.paidBy === 'split' && split?.valid === true);
  const set = (patch: Partial<PayDraft>) => onChange({ ...draft, ...patch });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      await onPay({
        paidBy: draft.paidBy,
        tendered: cash ? cash.given : null,
        customerId: draft.paidBy === 'tab' ? Number(draft.customerId) : null,
        cardAmount: draft.paidBy === 'split' && split ? split.card : null,
      });
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <form className="counter-form counter-pay-panel" onSubmit={submit} aria-label={t.counter.payTitle(formatMoney(total))}>
      <Segmented
        label={t.counter.paidBy}
        value={draft.paidBy}
        onChange={(paidBy) => set({ paidBy })}
        options={[
          { value: 'cash', label: t.counter.cash },
          { value: 'card', label: t.counter.card },
          { value: 'split', label: t.counter.split },
          { value: 'tab', label: t.counter.tab },
        ]}
      />
      {draft.paidBy === 'split' && (
        <>
          <Field
            label={t.counter.onCard}
            hint={split && !split.valid ? undefined : t.counter.onCardHint}
            error={split && !split.valid ? t.counter.onCardWrong(formatMoney(total)) : undefined}
          >
            <input
              className="counter-number"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              name="card-part"
              aria-invalid={split && !split.valid ? true : undefined}
              value={draft.card}
              onChange={(event) => set({ card: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onBack();
              }}
            />
          </Field>
          {split?.valid && <p className="counter-split-due" role="status">{t.counter.cashToTake(formatMoney(due))}</p>}
        </>
      )}
      {takesCash && (
        <>
          <Field label={t.counter.tendered}>
            <input
              className="counter-number"
              inputMode="decimal"
              autoComplete="off"
              name="tendered"
              autoFocus={draft.paidBy === 'cash'}
              placeholder={due.toFixed(2)}
              value={draft.tendered}
              onChange={(event) => set({ tendered: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onBack();
              }}
            />
          </Field>
          <div className="counter-notes" role="group" aria-label={t.counter.tendered}>
            <Button size="sm" onClick={() => set({ tendered: due.toFixed(2) })}>
              {t.counter.exact}
            </Button>
            {likelyNotes(due).map((note) => (
              <Button key={note} size="sm" onClick={() => set({ tendered: String(note) })}>
                {formatMoney(note)}
              </Button>
            ))}
          </div>
          {cash && !short && cash.change > 0 && (
            <ul className="counter-coach" aria-label={t.counter.coach}>
              {changeIn(cash.change).map((piece) => (
                <li key={piece.value} className={piece.value >= 5 ? 'counter-coach__piece counter-coach__piece--note' : 'counter-coach__piece'}>
                  {t.counter.coachNote(piece.count, formatMoney(piece.value))}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {draft.paidBy === 'card' && <p className="counter-hint">{t.counter.cardHint}</p>}
      {draft.paidBy === 'tab' &&
        (customers && customers.length === 0 ? (
          <p className="counter-hint">{t.counter.noCustomers}</p>
        ) : (
          <Field label={t.counter.customer}>
            <select value={draft.customerId} onChange={(event) => set({ customerId: event.target.value })}>
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
      <div className="counter-pay-panel__actions">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack} title="Esc">
          {t.counter.backToBasket}
        </Button>
        <Button variant="primary" type="submit" loading={busy} disabled={blocked} className="counter-pay-panel__record">
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

/** F5: who is buying. A walk-in by default; a registered customer puts the sale on their record. */
export function CustomerSheet({
  open,
  customers,
  current,
  onClose,
  onPick,
}: {
  open: boolean;
  customers: Customer[] | undefined;
  current: number | null;
  onClose: () => void;
  onPick: (customer: Customer | null) => void;
}) {
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} title={t.counter.customerTitle} description={t.counter.customerHint}>
      <CustomerForm customers={customers} current={current} onPick={onPick} />
    </Sheet>
  );
}

function CustomerForm({ customers, current, onPick }: { customers: Customer[] | undefined; current: number | null; onPick: (customer: Customer | null) => void }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const words = query.trim().toLowerCase();
  const shown = (customers ?? []).filter((customer) => customer.name.toLowerCase().includes(words));
  return (
    <div className="counter-form">
      <Field label={t.counter.customerSearch}>
        <input
          name="customer-search"
          autoFocus
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && shown.length > 0) {
              event.preventDefault();
              onPick(shown[0]!);
            }
          }}
        />
      </Field>
      <ul className="counter-customers">
        {words === '' && (
          <li>
            <button type="button" className="counter-customers__item" aria-pressed={current === null} onClick={() => onPick(null)}>
              {t.counter.walkIn}
            </button>
          </li>
        )}
        {shown.map((customer) => (
          <li key={customer.id}>
            <button type="button" className="counter-customers__item" aria-pressed={current === customer.id} onClick={() => onPick(customer)}>
              {customer.name}
            </button>
          </li>
        ))}
      </ul>
      {customers && customers.length === 0 && <p className="counter-hint">{t.counter.noCustomers}</p>}
      {customers && customers.length > 0 && shown.length === 0 && <p className="counter-hint">{t.counter.noCustomerMatch}</p>}
    </div>
  );
}

interface CountProps {
  /** What the drawer started with today. */
  opening: number;
  /** Already counted today: saving replaces it. */
  countedToday: boolean;
  onSave: (counted: number, note: string | null) => Promise<void>;
}

/**
 * The drawer count, blind: the person counts every note and coin and never
 * sees what 4VD expects. The owner sees how it came out.
 */
export function CountSheet({ open, onClose, ...form }: CountProps & { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} title={t.counter.countTitle}>
      <CountForm {...form} />
    </Sheet>
  );
}

function CountForm({ opening, countedToday, onSave }: CountProps) {
  const t = useT();
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const counted = parseAmount(text);
    if (!Number.isFinite(counted) || counted < 0) return setError(t.counter.amountNeeded);
    setBusy(true);
    try {
      await onSave(Math.round(counted * 100) / 100, note.trim() || null);
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="counter-form" onSubmit={submit}>
      <Field label={t.counter.countLabel} hint={t.counter.countHint(formatMoney(opening))} error={error ?? undefined}>
        <input
          className="counter-number"
          name="counted"
          inputMode="decimal"
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
        />
      </Field>
      <Field label={t.counter.countNote}>
        <input name="note" autoComplete="off" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {countedToday && <p className="field-hint">{t.counter.countAgain}</p>}
      <div className="form-actions">
        <Button variant="primary" type="submit" loading={busy}>
          {t.counter.countSave}
        </Button>
      </div>
    </form>
  );
}

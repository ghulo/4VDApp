import { Plus, X } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { useT } from '../i18n/useT';
import { productsApi } from '../services/api';
import { BILL_LINE_KINDS, EQUIPMENT_CATEGORIES, EXPENSE_CATEGORIES, type BillLineKind, type Supplier } from '../services/types';
import { type DraftLine, emptyLine, EXEMPT, type LineProduct, withKind } from '../utils/bills';
import { formatMoney } from '../utils/format';
import { Button, Field } from './ui';

const VAT_RATES = ['18', '16', '8', '0', EXEMPT];
const SEARCH_DEBOUNCE_MS = 250;
const MATCHES = 8;

/**
 * Joined choices on an inset track, for a choice inside a form (DESIGN 10.10).
 * One tab stop, like radio buttons: the arrow keys move the choice.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size,
  describedBy,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
  size?: 'sm';
  describedBy?: string;
}) {
  // The tab stop: the chosen option, or the first one when nothing is chosen yet.
  const stop = options.some((option) => option.value === value) ? value : options.find((option) => !option.disabled)?.value;

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const enabled = options.filter((option) => !option.disabled);
    const next = enabled[(enabled.findIndex((option) => option.value === value) + step + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]');
    buttons[options.indexOf(next)]?.focus();
  }

  return (
    <div
      className={size === 'sm' ? 'segmented segmented--small' : 'segmented'}
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      onKeyDown={handleKey}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={stop === option.value ? 0 : -1}
          disabled={option.disabled}
          className="segmented__option"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Finds a product by name or code as you type; arrows move, Enter picks. */
function ProductSearch({ label, onPick }: { label: string; onPick: (product: LineProduct) => void }) {
  const t = useT();
  const listId = useId();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const found = useQuery({
    queryKey: ['products', 'bill-line', query],
    queryFn: () => productsApi.list({ page: 1, limit: MATCHES, search: query }),
    enabled: query !== '',
    placeholderData: keepPreviousData,
  });
  const items = text.trim() !== '' && query !== '' ? (found.data?.items ?? []) : [];
  const open = text.trim() !== '' && query !== '' && !found.isPending;

  function pick(index: number) {
    const product = items[index];
    if (!product) return;
    onPick({ id: product.id, name: product.name, vatRate: product.vatRate, costPrice: product.costPrice ?? null });
    setText('');
    setActive(0);
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length > 0) setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
    } else if (event.key === 'Enter') {
      // Enter picks a match instead of sending the form.
      event.preventDefault();
      pick(active);
    } else if (event.key === 'Escape' && text !== '') {
      event.preventDefault();
      setText('');
    }
  }

  return (
    <div className="bill-search">
      <Field label={label} hint={t.billForm.findProductHint}>
        <input
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={handleKey}
        />
      </Field>
      <ul id={listId} role="listbox" aria-label={label} className="bill-search__list" hidden={!open}>
        {items.map((product, index) => (
          <li
            key={product.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            className="bill-search__option"
            // Picked on press, before the field loses focus.
            onMouseDown={(event) => {
              event.preventDefault();
              pick(index);
            }}
          >
            <span>{product.name}</span>
            <span className="table__secondary">
              {[product.sku, product.costPrice != null ? t.billForm.lastCost(formatMoney(product.costPrice)) : null].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
        {items.length === 0 && (
          <li role="option" aria-disabled="true" aria-selected="false" className="bill-search__none">
            {t.billForm.noMatch}
          </li>
        )}
      </ul>
    </div>
  );
}

interface BillLinesProps {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  /** A bill from abroad shows no VAT: 4VD works it out. */
  abroad: boolean;
  supplier?: Supplier | null;
  /** What each line comes to, from the server's preview, in the same order. */
  sums?: Array<{ net: number; vat: number } | undefined>;
  /** A return or credit: lines come from the bill, each kept or left out, and can't change kind. */
  fromBill?: boolean;
  /** On a return the price for one stays as billed; on a price credit it is what the price went down by. */
  lockPrices?: boolean;
}

/** The lines of a bill: each one a product into stock, a cost in its category, or equipment. */
export function BillLines({ lines, onChange, abroad, supplier, sums, fromBill, lockPrices }: BillLinesProps) {
  const t = useT();
  const set = (key: number, patch: Partial<DraftLine>) => onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const categoryName = (line: DraftLine) =>
    (line.kind === 'cost' ? (t.expenses.categories as Record<string, string>) : (t.bills.equipmentCategories as Record<string, string>))[line.category] ??
    line.category;
  const kindOptions = BILL_LINE_KINDS.map((kind) => ({ value: kind, label: t.bills.kinds[kind] }));
  const root = useRef<HTMLDivElement>(null);
  // The field that had focus can disappear (a picked product, a removed line): focus moves on, after the render.
  const focusNext = (selector: string) => requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(selector)?.focus());

  return (
    <div className="bill-lines" ref={root}>
      {lines.map((line, index) => {
        const n = index + 1;
        const sum = sums?.[index];
        const what = line.kind === 'product' ? (line.product?.name ?? t.billForm.lineLabel(n)) : t.billForm.lineLabel(n);
        const off = fromBill && !line.include;
        return (
          <fieldset key={line.key} data-line={line.key} className={off ? 'bill-line bill-line--off' : 'bill-line'}>
            <legend className="visually-hidden">{t.billForm.lineLabel(n)}</legend>
            <div className="bill-line__head">
              {fromBill ? (
                <label className="toggle">
                  <input type="checkbox" checked={line.include} onChange={(event) => set(line.key, { include: event.target.checked })} />
                  {t.creditForm.include(line.kind === 'product' ? what : categoryName(line))}
                </label>
              ) : (
                <Segmented
                  size="sm"
                  label={t.billForm.kind}
                  value={line.kind}
                  options={kindOptions}
                  onChange={(kind: BillLineKind) => set(line.key, withKind(line, kind))}
                />
              )}
              {sum && !off && (
                <span className="bill-line__sum">
                  {abroad || sum.vat === 0 ? formatMoney(sum.net) : t.billForm.lineSum(formatMoney(sum.net), formatMoney(sum.vat))}
                </span>
              )}
              {!fromBill && lines.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={X}
                  aria-label={t.billForm.removeLine(n)}
                  onClick={() => {
                    onChange(lines.filter((row) => row.key !== line.key));
                    focusNext('[data-add-line]');
                  }}
                />
              )}
            </div>
            {!off && (
              <div className="bill-line__fields">
                {line.kind === 'product' &&
                  !fromBill &&
                  (line.product ? (
                    <div className="bill-line__product">
                      <span className="bill-line__name">{line.product.name}</span>
                      {line.product.costPrice != null && <span className="table__secondary">{t.billForm.lastCost(formatMoney(line.product.costPrice))}</span>}
                      {!fromBill && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            set(line.key, { product: null });
                            focusNext(`[data-line="${line.key}"] input[role=combobox]`);
                          }}
                        >
                          {t.billForm.change}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <ProductSearch
                      label={t.billForm.findProduct}
                      onPick={(product) => {
                        set(line.key, { product, vatRate: abroad ? line.vatRate : String(product.vatRate) });
                        focusNext(`[data-line="${line.key}"] input[inputmode=numeric]`);
                      }}
                    />
                  ))}
                {line.kind !== 'product' && (
                  <div className="field-row">
                    <Field label={line.kind === 'cost' ? t.billForm.category : t.billForm.equipmentCategory}>
                      <select value={line.category} disabled={fromBill} onChange={(event) => set(line.key, { category: event.target.value })}>
                        {line.kind === 'cost'
                          ? EXPENSE_CATEGORIES.map((category) => (
                              <option key={category} value={category}>
                                {t.expenses.categories[category]}
                              </option>
                            ))
                          : EQUIPMENT_CATEGORIES.map((category) => (
                              <option key={category} value={category}>
                                {t.bills.equipmentCategories[category]}
                              </option>
                            ))}
                      </select>
                    </Field>
                    <Field label={t.billForm.lineDescription}>
                      <input
                        maxLength={300}
                        autoComplete="off"
                        placeholder={line.kind === 'cost' ? t.billForm.costPlaceholder : t.billForm.equipmentPlaceholder}
                        value={line.description}
                        onChange={(event) => set(line.key, { description: event.target.value })}
                      />
                    </Field>
                  </div>
                )}
                <div className="field-row">
                  {line.kind === 'product' ? (
                    <>
                      <Field
                        label={t.billForm.quantity}
                        error={line.max !== undefined && Number(line.quantity) > line.max ? t.creditForm.atMost(line.max) : undefined}
                      >
                        <input
                          type="number"
                          inputMode="numeric"
                          required
                          min={1}
                          max={line.max}
                          step={1}
                          value={line.quantity}
                          onChange={(event) => set(line.key, { quantity: event.target.value })}
                        />
                      </Field>
                      <Field label={t.billForm.unitPrice}>
                        <input
                          type="number"
                          inputMode="decimal"
                          required
                          min={0.0001}
                          step="any"
                          disabled={fromBill && lockPrices}
                          value={line.unitPrice}
                          onChange={(event) => set(line.key, { unitPrice: event.target.value })}
                        />
                      </Field>
                    </>
                  ) : (
                    <Field
                      label={t.billForm.amount}
                      error={line.max !== undefined && Number(line.amount) > line.max ? t.creditForm.atMost(line.max) : undefined}
                    >
                      <input
                        type="number"
                        inputMode="decimal"
                        required
                        min={0.01}
                        max={line.max}
                        step={0.01}
                        value={line.amount}
                        onChange={(event) => set(line.key, { amount: event.target.value })}
                      />
                    </Field>
                  )}
                  {!abroad && (
                    <Field label={t.billForm.vat}>
                      <select value={line.vatRate} disabled={fromBill} onChange={(event) => set(line.key, { vatRate: event.target.value })}>
                        {VAT_RATES.map((rate) => (
                          <option key={rate} value={rate}>
                            {rate === EXEMPT ? t.billForm.vatExempt : t.bills.vatAt(Number(rate))}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                </div>
              </div>
            )}
          </fieldset>
        );
      })}
      {!fromBill && (
        <div>
          <Button size="sm" icon={Plus} data-add-line onClick={() => onChange([...lines, emptyLine(supplier)])}>
            {t.billForm.addLine}
          </Button>
        </div>
      )}
    </div>
  );
}

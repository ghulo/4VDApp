import { Minus, Plus, X } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react';
import { useT } from '../i18n/useT';
import { customersApi, productsApi, salesApi } from '../services/api';
import type { Product } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { codeFromScan } from '../utils/scanLinks';
import { EmptyState, ErrorNotice, Loading } from './Feedback';
import { Button, Field } from './ui';

const SUGGESTIONS = 6;

/** Same rule as the server: the biggest bulk tier reached, or the promotion when that's cheaper. */
export function unitPriceFor(product: Product, quantity: number): number {
  const tier = product.bulkPricingTiers.reduce((price, next) => (quantity >= next.quantity ? next.price : price), product.price);
  return product.promotion && product.promotion.price < tier ? product.promotion.price : tier;
}

const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

/**
 * The counter's checkout: scan or type products into a basket, see the total
 * and the change to give back, then record it all at once.
 */
export function BasketForm() {
  const t = useT();
  const queryClient = useQueryClient();
  const scanRef = useRef<HTMLInputElement>(null);
  const products = useQuery({
    queryKey: ['products', { page: 1, limit: 100, inStock: true }],
    queryFn: () => productsApi.list({ page: 1, limit: 100, inStock: true }),
  });
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list });
  const [lines, setLines] = useState<Array<{ product: Product; quantity: number }>>([]);
  const [scan, setScan] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [paid, setPaid] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [notes, setNotes] = useState('');
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const sellable = products.data?.items.filter((product) => product.isActive) ?? [];
  const query = scan.trim().toLowerCase();
  const suggestions = query
    ? sellable.filter((product) => product.name.toLowerCase().includes(query) || product.sku?.toLowerCase().includes(query)).slice(0, SUGGESTIONS)
    : [];

  function add(product: Product) {
    setSavedMessage(null);
    setScanError(null);
    setLines((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) return current.map((line) => (line === existing ? { ...line, quantity: Math.min(line.quantity + 1, product.stock.quantity) } : line));
      return [...current, { product, quantity: 1 }];
    });
    setScan('');
    scanRef.current?.focus();
  }

  /** Enter in the box: a scanner always sends it after the code. A known barcode adds straight away. */
  async function handleScanKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    // A QR-capable scanner reads a product's QR code as its link; the code is inside.
    const code = codeFromScan(scan);
    if (!code) return;
    const byBarcode = sellable.find((product) => product.barcode === code);
    if (byBarcode) return add(byBarcode);
    if (suggestions.length === 1) return add(suggestions[0]!);
    try {
      add(await productsApi.byBarcode(code));
    } catch {
      if (suggestions.length === 0) setScanError(t.basket.notFound(code));
    }
  }

  function setQuantity(productId: number, quantity: number) {
    setLines((current) =>
      current
        .map((line) => (line.product.id === productId ? { ...line, quantity: Math.min(Math.max(quantity, 0), line.product.stock.quantity) } : line))
        .filter((line) => line.quantity > 0),
    );
  }

  const total = roundMoney(lines.reduce((sum, line) => sum + unitPriceFor(line.product, line.quantity) * line.quantity, 0));
  const paidAmount = Number(paid);
  const change = paid.trim() !== '' && paidAmount >= total ? roundMoney(paidAmount - total) : null;

  const record = useMutation({
    mutationFn: () =>
      salesApi.recordBasket({
        items: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        notes: notes.trim() || null,
        ...(customerId && { customerId: Number(customerId) }),
      }),
    onSuccess: (result) => {
      for (const key of ['sales', 'inventory', 'products', 'analytics', 'notifications', 'reports', 'activity', 'customers', 'cash']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      setSavedMessage(t.basket.saved(result.sales.length, formatMoney(result.total)));
      setLines([]);
      setPaid('');
      setCustomerId('');
      setNotes('');
      scanRef.current?.focus();
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSavedMessage(null);
    record.mutate();
  }

  if (products.isPending) return <Loading />;
  if (products.isError) return <ErrorNotice error={products.error} onRetry={() => products.refetch()} />;
  if (sellable.length === 0) return <EmptyState title={t.sales.nothingInStock} />;

  return (
    <form onSubmit={handleSubmit} className="basket">
      <Field label={t.basket.scan} hint={t.basket.scanHint}>
        <input
          ref={scanRef}
          autoFocus
          autoComplete="off"
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls="basket-suggestions"
          value={scan}
          onChange={(event) => {
            setScan(event.target.value);
            setScanError(null);
          }}
          onKeyDown={handleScanKey}
        />
      </Field>
      {scanError && (
        <p className="form-error" role="alert">
          {scanError}
        </p>
      )}
      {suggestions.length > 0 && (
        <ul id="basket-suggestions" className="basket__suggestions" aria-label={t.basket.matches}>
          {suggestions.map((product) => (
            <li key={product.id}>
              <button type="button" className="basket__suggestion" onClick={() => add(product)}>
                <span>{product.name}</span>
                <span className="table__secondary">{t.basket.priceAndStock(formatMoney(product.promotion?.price ?? product.price), product.stock.quantity)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {lines.length === 0 ? (
        <p className="field-hint">{t.basket.empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="table table--stack">
            <caption className="visually-hidden">{t.basket.title}</caption>
            <thead>
              <tr>
                <th scope="col">{t.sales.product}</th>
                <th scope="col">{t.sales.quantity}</th>
                <th scope="col" className="table__numeric">{t.sales.each}</th>
                <th scope="col" className="table__numeric">{t.sales.total}</th>
                <th scope="col">
                  <span className="visually-hidden">{t.basket.remove}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const each = unitPriceFor(line.product, line.quantity);
                return (
                  <tr key={line.product.id}>
                    <td>
                      {line.product.name}
                      {each < line.product.price && <span className="table__secondary">{t.basket.cheaper}</span>}
                    </td>
                    <td data-label={t.sales.quantity}>
                      <span className="basket__stepper">
                        <Button variant="ghost" aria-label={t.basket.oneLess(line.product.name)} onClick={() => setQuantity(line.product.id, line.quantity - 1)} icon={Minus} />
                        <span className="basket__quantity" aria-live="polite">
                          {line.quantity}
                        </span>
                        <Button
                          variant="ghost"
                          aria-label={t.basket.oneMore(line.product.name)}
                          disabled={line.quantity >= line.product.stock.quantity}
                          onClick={() => setQuantity(line.product.id, line.quantity + 1)}
                          icon={Plus}
                        />
                      </span>
                    </td>
                    <td className="table__numeric" data-label={t.sales.each}>{formatMoney(each)}</td>
                    <td className="table__numeric" data-label={t.sales.total}>{formatMoney(roundMoney(each * line.quantity))}</td>
                    <td>
                      <Button variant="ghost" aria-label={t.basket.removeLabel(line.product.name)} onClick={() => setQuantity(line.product.id, 0)} icon={X} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="basket__total">{t.basket.total(formatMoney(total))}</p>

      <div className="field-row">
        <Field label={t.basket.paid} narrow>
          <input type="number" inputMode="decimal" min={0} step={0.01} value={paid} onChange={(event) => setPaid(event.target.value)} disabled={customerId !== ''} />
        </Field>
        {customers.data && customers.data.length > 0 && (
          <Field label={t.tabs.putOnTab} hint={customerId ? t.tabs.onTabHint : undefined}>
            <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">{t.tabs.noTab}</option>
              {customers.data.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {change !== null && !customerId && <p className="basket__change">{t.basket.change(formatMoney(change))}</p>}
      {paid.trim() !== '' && paidAmount < total && !customerId && <p className="form-error">{t.basket.short(formatMoney(roundMoney(total - paidAmount)))}</p>}
      <Field label={t.sales.note}>
        <input type="text" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>

      {record.isError && (
        <p className="form-error" role="alert">
          {errorMessage(record.error)}
        </p>
      )}
      {savedMessage && (
        <p className="form-success" role="status">
          {savedMessage}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={lines.length === 0 || record.isPending}>
        {record.isPending ? t.sales.recording : t.basket.record(formatMoney(total))}
      </Button>
    </form>
  );
}

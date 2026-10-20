import { Minus, Plus, X } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useCurrentUser } from '../auth/useAuth';
import { canOversee } from '../auth/roles';
import { useT } from '../i18n/useT';
import { customersApi, documentsApi, productsApi, salesApi, settingsApi } from '../services/api';
import type { DocumentRef, Product } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney, formatPercent } from '../utils/format';
import { codeFromScan, documentNumberFromScan } from '../utils/scanLinks';
import { EmptyState, ErrorNotice, Loading } from './Feedback';
import { PrintDocumentButton } from './PrintDocumentButton';
import { Button, ButtonLink, Combobox, Field } from './ui';
import { useWarnBeforeLeaving } from '../utils/useWarnBeforeLeaving';

const SUGGESTIONS = 6;

/** Same rule as the server: the biggest bulk tier reached, or the promotion when that's cheaper. */
export function unitPriceFor(product: Product, quantity: number): number {
  const tier = product.bulkPricingTiers.reduce((price, next) => (quantity >= next.quantity ? next.price : price), product.price);
  return product.promotion && product.promotion.price < tier ? product.promotion.price : tier;
}

export const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

/** The unit price after a rabat, rounded like the server rounds it. */
export const afterDiscount = (price: number, percent: number) => (percent > 0 ? roundMoney(price * (1 - percent / 100)) : price);

/** "7,5" or "7.5" typed into a box, as a number; blank means no rabat. */
export const parsePercent = (text: string) => {
  const value = Number(text.replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(value) ? 0 : value;
};

/**
 * The counter's checkout: scan or type products into a basket, see the total
 * and the change to give back, then record it all at once.
 */
export function BasketForm() {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const scanRef = useRef<HTMLInputElement>(null);
  const products = useQuery({
    queryKey: ['products', { page: 1, limit: 100, inStock: true }],
    queryFn: () => productsApi.list({ page: 1, limit: 100, inStock: true }),
  });
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list });
  const settings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const { role } = useCurrentUser();
  // Owners and admins give any rabat; everyone else up to the shop's limit.
  const discountLimit = canOversee(role) ? 100 : (settings.data?.employeeDiscountLimit ?? 0);
  // `discount` is the box's text, so a half-typed "7," stays as typed.
  const [lines, setLines] = useState<Array<{ product: Product; quantity: number; discount: string }>>([]);
  const [discountAll, setDiscountAll] = useState('');
  const [scan, setScan] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [paid, setPaid] = useState('');
  const [customerId, setCustomerId] = useState('');
  // A named customer pays now unless the tab is picked; anonymous sales are always paid now.
  const [onTab, setOnTab] = useState(false);
  const owing = customerId !== '' && onTab;
  const [notes, setNotes] = useState('');
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<DocumentRef | null>(null);

  const sellable = products.data?.items.filter((product) => product.isActive) ?? [];
  const query = scan.trim().toLowerCase();
  const suggestions = query
    ? sellable.filter((product) => product.name.toLowerCase().includes(query) || product.sku?.toLowerCase().includes(query)).slice(0, SUGGESTIONS)
    : [];

  function add(product: Product) {
    setSavedMessage(null);
    setInvoice(null);
    setScanError(null);
    setLines((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) return current.map((line) => (line === existing ? { ...line, quantity: Math.min(line.quantity + 1, product.stock.quantity) } : line));
      return [...current, { product, quantity: 1, discount: discountAll }];
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
    // An invoice's own barcode (a customer bringing something back): open that invoice.
    const documentNumber = documentNumberFromScan(code);
    if (documentNumber && canOversee(role)) {
      try {
        const found = (await documentsApi.list({ page: 1, search: documentNumber })).items.find((document) => document.number === documentNumber);
        if (found) return navigate(`/documents/${found.id}`);
        return setScanError(t.basket.notFound(code));
      } catch (error) {
        return setScanError(errorMessage(error));
      }
    }
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

  function setDiscount(productId: number, discount: string) {
    setLines((current) => current.map((line) => (line.product.id === productId ? { ...line, discount } : line)));
  }

  function setDiscountForAll(discount: string) {
    setDiscountAll(discount);
    setLines((current) => current.map((line) => ({ ...line, discount })));
  }

  const priceOf = (line: { product: Product; quantity: number; discount: string }) =>
    afterDiscount(unitPriceFor(line.product, line.quantity), parsePercent(line.discount));
  const tooMuchDiscount = lines.some((line) => parsePercent(line.discount) > discountLimit || parsePercent(line.discount) < 0);
  const total = roundMoney(lines.reduce((sum, line) => sum + priceOf(line) * line.quantity, 0));
  const paidAmount = Number(paid);
  const change = paid.trim() !== '' && paidAmount >= total ? roundMoney(paidAmount - total) : null;

  useWarnBeforeLeaving(lines.length > 0);

  const record = useMutation({
    mutationFn: () =>
      salesApi.recordBasket({
        items: lines.map((line) => {
          const discount = roundMoney(parsePercent(line.discount));
          return { productId: line.product.id, quantity: line.quantity, ...(discount > 0 && { discountPercent: discount }) };
        }),
        notes: notes.trim() || null,
        ...(customerId && { customerId: Number(customerId), paidNow: !onTab }),
      }),
    onSuccess: (result) => {
      for (const key of ['sales', 'inventory', 'products', 'analytics', 'notifications', 'reports', 'activity', 'customers', 'cash']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      setSavedMessage(t.basket.saved(result.sales.length, formatMoney(result.total)));
      setInvoice(result.invoice);
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setLines([]);
      setDiscountAll('');
      setPaid('');
      setCustomerId('');
      setOnTab(false);
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
        // The basket reads like the till receipt it becomes, as on the team app's Sell.
        <div className="basket__receipt">
          <div className="table-wrap">
            <table className="table table--stack">
              <caption className="visually-hidden">{t.basket.title}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.sales.product}</th>
                  <th scope="col">{t.sales.quantity}</th>
                  <th scope="col" className="table__numeric">{t.basket.discount}</th>
                  <th scope="col" className="table__numeric">{t.sales.total}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t.basket.remove}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const listed = unitPriceFor(line.product, line.quantity);
                  const percent = parsePercent(line.discount);
                  const each = afterDiscount(listed, percent);
                  return (
                    <tr key={line.product.id}>
                      <td>
                        {line.product.name}
                        {listed < line.product.price && <span className="table__secondary">{t.basket.cheaper}</span>}
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
                      <td className="table__numeric" data-label={t.basket.discount}>
                        <input
                          className="input--compact basket__discount"
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0"
                          aria-label={t.basket.discountFor(line.product.name)}
                          aria-invalid={percent > discountLimit || percent < 0}
                          value={line.discount}
                          onChange={(event) => setDiscount(line.product.id, event.target.value)}
                        />
                      </td>
                      <td className="table__numeric" data-label={t.sales.total}>
                        {formatMoney(roundMoney(each * line.quantity))}
                        <span className="table__secondary">{t.basket.each(formatMoney(each))}</span>
                        {percent > 0 && <span className="table__secondary">{t.basket.discountOff(formatPercent(percent / 100))}</span>}
                      </td>
                      <td>
                        <Button variant="ghost" aria-label={t.basket.removeLabel(line.product.name)} onClick={() => setQuantity(line.product.id, 0)} icon={X} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="basket__total">
            <span className="basket__total-label">{t.basket.total}</span>
            <span className="basket__total-amount">{formatMoney(total)}</span>
          </p>
        </div>
      )}

      {lines.length > 0 && (
        <Field
          label={t.basket.discountAll}
          narrow
          hint={discountLimit < 100 ? t.basket.discountUpTo(discountLimit) : undefined}
          error={tooMuchDiscount ? t.basket.discountTooHigh(discountLimit) : undefined}
        >
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            aria-invalid={tooMuchDiscount}
            value={discountAll}
            onChange={(event) => setDiscountForAll(event.target.value)}
          />
        </Field>
      )}

      <div className="field-row">
        <Field label={t.basket.paid} narrow>
          <input type="number" inputMode="decimal" min={0} step={0.01} value={paid} onChange={(event) => setPaid(event.target.value)} disabled={owing} />
        </Field>
        {customers.data && customers.data.length > 0 && (
          <Combobox
            label={t.tabs.customer}
            hint={customerId ? undefined : t.tabs.anonymousHint}
            placeholder={t.tabs.anonymous}
            value={customerId}
            onChange={setCustomerId}
            options={customers.data.map((customer) => ({ value: String(customer.id), label: customer.name, hint: customer.phone ?? undefined }))}
          />
        )}
      </div>
      {customerId && (
        <Field label={t.tabs.howPaid} hint={onTab ? t.tabs.onTabHint : undefined}>
          <div className="segmented" role="radiogroup" aria-label={t.tabs.howPaid}>
            {[false, true].map((option) => (
              <button key={String(option)} type="button" role="radio" aria-checked={onTab === option} className="segmented__option" onClick={() => setOnTab(option)}>
                {option ? t.tabs.putOnTab : t.tabs.paidNow}
              </button>
            ))}
          </div>
        </Field>
      )}
      {change !== null && !owing && <p className="basket__change">{t.basket.change(formatMoney(change))}</p>}
      {paid.trim() !== '' && paidAmount < total && !owing && <p className="form-error">{t.basket.short(formatMoney(roundMoney(total - paidAmount)))}</p>}
      <Field label={t.sales.note}>
        <input type="text" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>

      {record.isError && (
        <p className="form-error" role="alert">
          {errorMessage(record.error)}
        </p>
      )}
      {savedMessage && (
        <div className="basket__invoice">
          <p className="form-success" role="status">
            {savedMessage} {invoice && t.documents.invoiceReady(invoice.number)}
          </p>
          {invoice && (
            <>
              <PrintDocumentButton document={invoice} size="sm" />
              <ButtonLink to={`/documents/${invoice.id}`} variant="ghost" size="sm">
                {t.documents.open}
              </ButtonLink>
            </>
          )}
        </div>
      )}
      <Button type="submit" variant="primary" disabled={lines.length === 0 || tooMuchDiscount || record.isPending} loading={record.isPending}>
        {t.basket.record(formatMoney(total))}
      </Button>
    </form>
  );
}

import { Minus, Plus, Tag, X } from '@phosphor-icons/react';
import { offersByProduct, type ShortDatedPick, shortDatedUnits, tapShortDated } from '../utils/shortDated';
import { piecesFor } from '../utils/units';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useCurrentUser } from '../auth/useAuth';
import { canOversee } from '../auth/roles';
import { useT } from '../i18n/useT';
import { customersApi, documentsApi, expiryApi, productsApi, salesApi, settingsApi } from '../services/api';
import type { DocumentRef, Product } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney, formatPercent } from '../utils/format';
import { codeFromScan, documentNumberFromScan } from '../utils/scanLinks';
import { EmptyState, ErrorNotice, Loading } from './Feedback';
import { PrintDocumentButton } from './PrintDocumentButton';
import { Button, ButtonLink, Combobox, Field } from './ui';
import { useWarnBeforeLeaving } from '../utils/useWarnBeforeLeaving';

const SUGGESTIONS = 6;

/** The customer's price level: the shelf price, or the wholesale price (never above the shelf price). Same rule as the server's `levelPrice`. */
export function levelPriceFor(product: Product, wholesale: boolean): number {
  return wholesale && product.wholesalePrice !== null ? Math.min(product.price, product.wholesalePrice) : product.price;
}

/**
 * Same rule as the server's `listPrice`: the price level, a bulk price when
 * the quantity reaches one and it is lower, then the promotion when that's cheaper.
 */
export function unitPriceFor(product: Product, quantity: number, wholesale = false): number {
  const bulk = product.bulkPricingTiers.reduce((price, next) => (quantity >= next.quantity ? next.price : price), product.price);
  const tier = Math.min(levelPriceFor(product, wholesale), bulk);
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
  // `shortDated`: stickered short-dated units the seller tapped, sold at the batch's price.
  const [lines, setLines] = useState<Array<{ product: Product; quantity: number; discount: string; shortDated?: ShortDatedPick }>>([]);
  const shortDatedBatches = useQuery({ queryKey: ['expiry', 'short-dated'], queryFn: expiryApi.shortDated, staleTime: 5 * 60_000 });
  const offers = useMemo(() => offersByProduct(shortDatedBatches.data), [shortDatedBatches.data]);
  const [discountAll, setDiscountAll] = useState('');
  const [scan, setScan] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [paid, setPaid] = useState('');
  const [customerId, setCustomerId] = useState('');
  // A named customer pays now unless the tab is picked; anonymous sales are always paid now.
  const [onTab, setOnTab] = useState(false);
  const owing = customerId !== '' && onTab;
  // Wholesale prices: what the customer pays, unless switched for this sale (only the owner's side may switch them on).
  const [wholesaleSwitch, setWholesaleSwitch] = useState<boolean | null>(null);
  const buyer = customerId ? customers.data?.find((one) => String(one.id) === customerId) : undefined;
  const wholesale = wholesaleSwitch ?? buyer?.paysWholesale ?? false;
  const mayWholesale = canOversee(role) || Boolean(buyer?.paysWholesale);
  const [notes, setNotes] = useState('');
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<DocumentRef | null>(null);

  const sellable = products.data?.items.filter((product) => product.isActive) ?? [];
  const query = scan.trim().toLowerCase();
  const suggestions = query
    ? sellable.filter((product) => product.name.toLowerCase().includes(query) || product.sku?.toLowerCase().includes(query)).slice(0, SUGGESTIONS)
    : [];

  function add(product: Product, pieces = 1) {
    setSavedMessage(null);
    setInvoice(null);
    setScanError(null);
    setLines((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) return current.map((line) => (line === existing ? { ...line, quantity: Math.min(line.quantity + pieces, product.stock.quantity) } : line));
      return [...current, { product, quantity: Math.min(pieces, Math.max(1, product.stock.quantity)), discount: discountAll }];
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
    const byBarcode = sellable.find((product) => product.barcode === code || product.otherBarcodes.includes(code));
    if (byBarcode) return add(byBarcode, piecesFor(byBarcode, code));
    if (suggestions.length === 1) return add(suggestions[0]!);
    try {
      const found = await productsApi.byBarcode(code);
      add(found, piecesFor(found, code));
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

  /** What the line costs: stickered short-dated units at their price (or a cheaper one), the rest as usual; same rule as the server. */
  const priced = (line: { product: Product; quantity: number; discount: string; shortDated?: ShortDatedPick }) => {
    const percent = parsePercent(line.discount);
    const short = shortDatedUnits(line.shortDated, line.quantity);
    const rest = line.quantity - short;
    const listed = unitPriceFor(line.product, rest > 0 ? rest : line.quantity, wholesale);
    const each = afterDiscount(listed, percent);
    const shortEach = short > 0 ? afterDiscount(Math.min(line.shortDated!.price, unitPriceFor(line.product, short, wholesale)), percent) : 0;
    return { listed, each, short, rest, shortEach, total: roundMoney(each * rest + shortEach * short) };
  };
  function tapShort(productId: number) {
    const offer = offers.get(productId);
    if (!offer) return;
    setLines((current) => current.map((line) => (line.product.id === productId ? { ...line, shortDated: tapShortDated(line.shortDated, offer, line.quantity) } : line)));
  }
  const tooMuchDiscount = lines.some((line) => parsePercent(line.discount) > discountLimit || parsePercent(line.discount) < 0);
  const total = roundMoney(lines.reduce((sum, line) => sum + priced(line).total, 0));
  const paidAmount = Number(paid);
  const change = paid.trim() !== '' && paidAmount >= total ? roundMoney(paidAmount - total) : null;

  useWarnBeforeLeaving(lines.length > 0);

  const record = useMutation({
    mutationFn: () =>
      salesApi.recordBasket({
        // Stickered short-dated units go as their own line, with their batch.
        items: lines.flatMap((line) => {
          const discount = roundMoney(parsePercent(line.discount));
          const rabat = discount > 0 ? { discountPercent: discount } : {};
          const { short, rest } = priced(line);
          return [
            ...(short > 0 && line.shortDated ? [{ productId: line.product.id, quantity: short, shortDatedId: line.shortDated.id, ...rabat }] : []),
            ...(rest > 0 ? [{ productId: line.product.id, quantity: rest, ...rabat }] : []),
          ];
        }),
        notes: notes.trim() || null,
        ...(customerId && { customerId: Number(customerId), paidNow: !onTab }),
        ...(wholesaleSwitch !== null && { wholesale: wholesaleSwitch }),
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
                  const percent = parsePercent(line.discount);
                  const { listed, each, short, shortEach, total: lineTotal } = priced(line);
                  const offer = offers.get(line.product.id);
                  return (
                    <tr key={line.product.id}>
                      <td>
                        {line.product.name}
                        {listed < line.product.price && <span className="table__secondary">{t.basket.cheaper}</span>}
                        {offer && (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={Tag}
                            aria-pressed={short > 0}
                            title={t.counter.shortDatedTapHint}
                            onClick={() => tapShort(line.product.id)}
                          >
                            {short > 0 ? t.counter.reason.shortDated(short, `${offer.percentOff}%`) : t.counter.shortDatedTap(`${offer.percentOff}%`)}
                          </Button>
                        )}
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
                        {formatMoney(lineTotal)}
                        <span className="table__secondary">{t.basket.each(formatMoney(each))}</span>
                        {short > 0 && <span className="table__secondary">{t.basket.shortDatedEach(short, formatMoney(shortEach))}</span>}
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
            onChange={(next) => {
              setCustomerId(next);
              setWholesaleSwitch(null);
            }}
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
      {mayWholesale && (
        <Field label={t.basket.prices} hint={buyer?.paysWholesale && wholesale ? t.basket.paysWholesale(buyer.name) : undefined}>
          <div className="segmented" role="radiogroup" aria-label={t.basket.prices}>
            {[false, true].map((option) => (
              <button
                key={String(option)}
                type="button"
                role="radio"
                aria-checked={wholesale === option}
                className="segmented__option"
                onClick={() => setWholesaleSwitch(option === (buyer?.paysWholesale ?? false) ? null : option)}
              >
                {option ? t.basket.wholesale : t.basket.shelf}
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

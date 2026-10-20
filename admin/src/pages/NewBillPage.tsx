import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { BillLines, Segmented } from '../components/BillLines';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PlaceSelect, usePlaces, usualPlace } from '../components/MoneyParts';
import { Badge, Button, Card, Combobox, DateField, Field, PageHeader } from '../components/ui';
import { useT } from '../i18n/useT';
import { billsApi, suppliersApi } from '../services/api';
import {
  type BillFormInput,
  type BillPreview,
  type CustomsPaidMethod,
  type ExpensePlace,
  type Supplier,
  WITHHOLDING_RATES,
  WITHHOLDING_TYPES,
  type WithholdingType,
} from '../services/types';
import { addDaysIso, capitalise, type DraftLine, emptyLine, isLineDone, joinParts, todayIso, toLineInput } from '../utils/bills';
import { errorMessage } from '../utils/errors';
import { formatMoney, formatPercent } from '../utils/format';
import { carwashLabel, useCarwashes } from '../utils/useCarwashes';

const PREVIEW_DEBOUNCE_MS = 300;
/** Same cap as the server: every month has a 28th. */
const LAST_REPEAT_DAY = 28;

/** Waits until typing pauses, so each keystroke isn't a request. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(JSON.parse(key) as T), ms);
    return () => clearTimeout(timer);
  }, [key, ms]);
  return settled;
}

/** The one bill form: any supplier bill, from a box of stock to rent, an import or a coffee machine. */
export function NewBillPage() {
  const t = useT();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const header = <PageHeader title={t.billForm.title} crumbs={[{ label: t.nav.tabs.bills, to: '/bills' }]} description={t.billForm.description} />;

  if (suppliers.isPending) return <Loading />;
  if (suppliers.isError) return <ErrorNotice error={suppliers.error} onRetry={() => suppliers.refetch()} />;
  return (
    <>
      {header}
      <NewBillForm suppliers={suppliers.data} />
    </>
  );
}

function NewBillForm({ suppliers }: { suppliers: Supplier[] }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const { places: carwashes, several } = useCarwashes();
  const initialSupplier = suppliers.find((row) => String(row.id) === params.get('supplier')) ?? null;

  const [supplierId, setSupplierId] = useState(initialSupplier ? String(initialSupplier.id) : '');
  const supplier = suppliers.find((row) => String(row.id) === supplierId) ?? null;
  const abroad = supplier?.abroad ?? false;
  const [number, setNumber] = useState('');
  const [issuedOn, setIssuedOn] = useState(todayIso());
  const [dueOn, setDueOn] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [emptyLine(initialSupplier)]);
  const [pricesIncludeVat, setPricesIncludeVat] = useState(true);
  const [customsVat, setCustomsVat] = useState('');
  const [duty, setDuty] = useState('');
  const [customsMethod, setCustomsMethod] = useState<CustomsPaidMethod>('bank');
  const [withholding, setWithholding] = useState<WithholdingType | ''>(initialSupplier?.withholdingType ?? '');
  const [pay, setPay] = useState<'later' | 'now'>(params.get('paid') === 'now' ? 'now' : 'later');
  const places = usePlaces();
  const [chosenPayPlace, setPayPlace] = useState<number | null>(null);
  const payPlace = chosenPayPlace ?? usualPlace(places.data, 'bank');
  const payFromShopTill = places.data?.some((row) => row.id === payPlace && row.kind === 'till' && row.carwashId === null) ?? false;
  // "shop", "both" or "carwash:<id>", so each carwash has its own choice.
  const [place, setPlace] = useState('shop');
  const [repeatMonthly, setRepeatMonthly] = useState(false);
  // Shelf prices chosen from the price alerts, by product.
  const [prices, setPrices] = useState<Record<number, { use: boolean; price: string }>>({});

  /** Choosing a supplier starts the bill the way their bills usually are. */
  function chooseSupplier(id: string) {
    const next = suppliers.find((row) => String(row.id) === id) ?? null;
    setSupplierId(id);
    setWithholding(next?.withholdingType ?? '');
    // Only untouched lines follow the supplier; anything typed stays.
    setLines((current) => current.map((line) => (line.product === null && line.amount === '' && line.unitPrice === '' && line.description === '' ? { ...emptyLine(next), key: line.key } : line)));
  }

  const done = lines.filter(isLineDone);
  const allDone = lines.length > 0 && done.length === lines.length;
  const onlyCosts = lines.every((line) => line.kind === 'cost');
  const hasCosts = lines.some((line) => line.kind === 'cost');
  const hasGoods = lines.some((line) => line.kind !== 'cost');
  const showCustoms = abroad && hasGoods;
  const [placeKind, carwashId] = place.startsWith('carwash:') ? ['carwash' as const, Number(place.split(':')[1])] : [place as ExpensePlace, null];

  const input: BillFormInput = {
    supplierId: supplier?.id ?? null,
    number: number.trim() || null,
    issuedOn,
    dueOn: pay === 'later' && dueOn ? dueOn : null,
    note: note.trim() || null,
    lines: done.map(toLineInput),
    pricesIncludeVat: abroad ? false : pricesIncludeVat,
    customs: showCustoms && (Number(customsVat) > 0 || Number(duty) > 0) ? { vat: Number(customsVat) || 0, duty: Number(duty) || 0, method: customsMethod } : null,
    withholdingType: withholding || null,
    paidNow: pay === 'now' ? (payPlace === null ? { method: 'bank' } : { placeId: payPlace }) : null,
    place: hasCosts ? placeKind : 'shop',
    carwashId: hasCosts ? carwashId : null,
    repeatMonthly: onlyCosts && repeatMonthly,
    prices: Object.entries(prices)
      .filter(([, choice]) => choice.use && Number(choice.price) > 0)
      .map(([productId, choice]) => ({ productId: Number(productId), price: Number(choice.price) })),
  };

  const settled = useSettled(input, PREVIEW_DEBOUNCE_MS);
  const preview = useQuery({
    // The shelf prices don't change what the bill does, so choosing one doesn't ask again.
    queryKey: ['bills', 'preview', { ...settled, prices: [] }],
    queryFn: () => billsApi.preview({ ...settled, prices: [] }),
    enabled: settled.lines.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const figures = done.length > 0 ? preview.data : undefined;

  const blocker =
    lines.length === 0
      ? t.billForm.needLine
      : !allDone
        ? t.billForm.lineIncomplete(lines.findIndex((line) => !isLineDone(line)) + 1)
        : pay === 'later' && !supplier
          ? t.billForm.needsSupplier
          : null;

  const create = useMutation({
    mutationFn: () => billsApi.create(input),
    onSuccess: (bill) => {
      for (const key of ['bills', 'attention', 'expenses', 'inventory', 'products', 'activity', 'reports', 'books']) queryClient.invalidateQueries({ queryKey: [key] });
      navigate(`/bills/${bill.id}`);
    },
  });

  // Reloading or closing the tab asks first once something is typed, so a long bill isn't lost.
  const typed = number.trim() !== '' || lines.some((line) => line.product !== null || line.unitPrice !== '' || line.amount !== '' || line.description !== '');
  const guard = typed && !create.isPending && !create.isSuccess;
  useEffect(() => {
    if (!guard) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [guard]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (blocker === null) create.mutate();
  }

  // Each line's sum, matched to the lines that are done (the preview only sees those).
  const sums = lines.map((line) => {
    const index = done.indexOf(line);
    return index >= 0 ? figures?.lines[index] : undefined;
  });
  const repeatDay = Math.min(Number(issuedOn.slice(8, 10)) || 1, LAST_REPEAT_DAY);

  return (
    <form className="product-layout" onSubmit={handleSubmit} noValidate>
      <div className="product-layout__main">
        <Card title={t.billForm.who}>
          <Combobox
            label={t.bills.supplier}
            hint={
              supplier?.usualKind
                ? t.billForm.usually(
                    supplier.usualKind === 'cost' && supplier.usualCategory
                      ? t.expenses.categories[supplier.usualCategory as keyof typeof t.expenses.categories] ?? t.bills.kinds.cost
                      : t.bills.kinds[supplier.usualKind],
                  )
                : undefined
            }
            placeholder={t.billForm.noSupplier}
            value={supplierId}
            onChange={chooseSupplier}
            options={suppliers.map((row) => ({ value: String(row.id), label: row.name, hint: row.nui ?? row.phone ?? undefined }))}
          />
          {abroad && (
            <p className="bill-abroad">
              <Badge tone="info">{t.billForm.abroadStamp}</Badge>
              <span>{t.billForm.abroadHint}</span>
            </p>
          )}
          <div className="field-row">
            <Field label={t.bills.number}>
              <input maxLength={60} autoComplete="off" value={number} onChange={(event) => setNumber(event.target.value)} />
            </Field>
            <Field label={t.bills.issuedOn}>
              <DateField required max={todayIso()} value={issuedOn} onChange={(value) => setIssuedOn(value)} />
            </Field>
          </div>
        </Card>

        <Card
          title={t.bills.lines}
          description={t.billForm.linesHint}
          actions={
            !abroad && (
              <label className="toggle">
                <input type="checkbox" checked={pricesIncludeVat} onChange={(event) => setPricesIncludeVat(event.target.checked)} />
                {t.billForm.pricesIncludeVat}
              </label>
            )
          }
        >
          <BillLines lines={lines} onChange={setLines} abroad={abroad} supplier={supplier} sums={sums} />
          {!abroad && !pricesIncludeVat && <p className="field-hint">{t.billForm.pricesIncludeVatHint}</p>}
        </Card>

        {showCustoms && (
          <Card title={t.billForm.customs} description={t.billForm.customsHint}>
            <div className="field-row">
              <Field label={t.billForm.customsVat}>
                <input type="number" inputMode="decimal" min={0} step={0.01} value={customsVat} onChange={(event) => setCustomsVat(event.target.value)} />
              </Field>
              <Field label={t.billForm.duty}>
                <input type="number" inputMode="decimal" min={0} step={0.01} value={duty} onChange={(event) => setDuty(event.target.value)} />
              </Field>
            </div>
            <div className="field">
              <span className="field__label">{t.billForm.customsMethod}</span>
              <Segmented
                label={t.billForm.customsMethod}
                value={customsMethod}
                options={(['bank', 'cash'] as const).map((method) => ({ value: method, label: t.billForm.customsMethods[method] }))}
                onChange={setCustomsMethod}
              />
            </div>
          </Card>
        )}

        <Card title={t.billForm.paying}>
          <div className="field">
            <span className="field__label">{t.billForm.when}</span>
            <Segmented
              label={t.billForm.when}
              value={pay}
              options={[
                { value: 'later', label: t.billForm.payLater },
                { value: 'now', label: t.billForm.paidNow },
              ]}
              onChange={setPay}
            />
            {pay === 'later' && !supplier && <span className="field__hint">{t.billForm.needsSupplier}</span>}
          </div>
          {pay === 'later' ? (
            <>
              <Field label={t.bills.due} hint={t.bills.dueHint}>
                <DateField min={issuedOn} value={dueOn} onChange={(value) => setDueOn(value)} />
              </Field>
              <div className="quick-due" role="group" aria-label={t.bills.quickDue}>
                {[0, 15, 30, 60].map((days) => (
                  <Button key={days} size="sm" variant="ghost" onClick={() => setDueOn(addDaysIso(issuedOn || todayIso(), days))}>
                    {days === 0 ? t.bills.dueNow : t.bills.inDays(days)}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <div className="field">
              <label className="field__label" htmlFor="new-bill-place">
                {t.money.payBills.from}
              </label>
              <PlaceSelect id="new-bill-place" places={places.data ?? []} value={payPlace} onChange={setPayPlace} required />
              {payFromShopTill && <span className="field__hint">{t.bills.drawerHint}</span>}
            </div>
          )}
          <div className="field-row">
            <Field label={t.billForm.withholding} hint={withholding ? t.billForm.withholdingHint : undefined}>
              <select value={withholding} onChange={(event) => setWithholding(event.target.value as WithholdingType | '')}>
                <option value="">{t.billForm.withholdingNone}</option>
                {WITHHOLDING_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t.billForm.withholdingOption(t.bills.withholdingTypes[type], WITHHOLDING_RATES[type])}
                  </option>
                ))}
              </select>
            </Field>
            {hasCosts && (
              <Field label={t.billForm.place}>
                <select value={place} onChange={(event) => setPlace(event.target.value)}>
                  <option value="shop">{t.expenses.places.shop}</option>
                  {carwashes.map((carwash) => (
                    <option key={carwash.id} value={`carwash:${carwash.id}`}>
                      {carwashLabel(t.expenses.places.carwash, carwash.name, several)}
                    </option>
                  ))}
                  <option value="both">{t.expenses.places.both}</option>
                </select>
              </Field>
            )}
          </div>
          {onlyCosts && (
            <>
              <label className="toggle">
                <input type="checkbox" checked={repeatMonthly} onChange={(event) => setRepeatMonthly(event.target.checked)} />
                {t.billForm.repeat}
              </label>
              {repeatMonthly && <p className="field-hint">{t.billForm.repeatHint(repeatDay)}</p>}
            </>
          )}
          <Field label={t.bills.note}>
            <input maxLength={500} autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </Card>
      </div>

      <div className="product-layout__side buy-side">
        <Card title={t.billForm.summary}>
          <BillSummary figures={figures} loading={preview.isFetching && !figures} supplier={supplier} paidNow={pay === 'now'} />
          {preview.isError && done.length > 0 && (
            <p className="form-error" role="alert">
              {errorMessage(preview.error)}
            </p>
          )}
          {figures && figures.priceAlerts.length > 0 && (
            <PriceAlerts alerts={figures.priceAlerts} prices={prices} onChange={setPrices} />
          )}
          {create.isError && (
            <p className="form-error" role="alert">
              {errorMessage(create.error)}
            </p>
          )}
          <Button type="submit" variant="primary" wide disabled={blocker !== null || create.isPending} aria-describedby="new-bill-why" loading={create.isPending}>
            {t.billForm.save}
          </Button>
          <p id="new-bill-why" className="field-hint">
            {blocker ?? t.billForm.afterSave}
          </p>
          {supplier && (
            <p className="field-hint">
              <Link to={`/suppliers/${supplier.id}`}>{t.suppliers.see}</Link>
            </p>
          )}
        </Card>
      </div>
    </form>
  );
}

/** "Adds €120.00 to stock and €21.60 VAT to claim back. You owe Fresh Foods €141.60." */
export function billSentence(t: ReturnType<typeof useT>, figures: BillPreview, who: string | null, paidNow: boolean) {
  const costs = Object.values(figures.costs).reduce((sum, amount) => sum + amount, 0);
  const parts = [
    figures.stock > 0 && t.billForm.stock(formatMoney(figures.stock)),
    costs > 0 && t.billForm.costs(formatMoney(costs)),
    figures.equipment > 0 && t.billForm.equipment(formatMoney(figures.equipment)),
    figures.vatToClaim > 0 && t.billForm.vatBack(formatMoney(figures.vatToClaim)),
    figures.customs > 0 && t.billForm.atCustoms(formatMoney(figures.customs)),
    figures.withheld > 0 && t.billForm.withheld(formatMoney(figures.withheld)),
  ].filter((part): part is string => typeof part === 'string');
  const first = parts.length > 0 ? `${capitalise(joinParts(parts, t.billForm.and))}. ` : '';
  const last = paidNow || !who ? t.billForm.youPayNow(formatMoney(figures.owed)) : t.billForm.youOwe(who, formatMoney(figures.owed));
  return `${first}${last}`;
}

function BillSummary({ figures, loading, supplier, paidNow }: { figures: BillPreview | undefined; loading: boolean; supplier: Supplier | null; paidNow: boolean }) {
  const t = useT();
  if (!figures) return <p className="field-hint">{loading ? t.common.loading : t.billForm.fillToSee}</p>;
  return (
    <>
      <p className="bill-sentence" role="status" aria-live="polite">
        {billSentence(t, figures, supplier?.name ?? null, paidNow)}
      </p>
      {figures.selfVat > 0 && <p className="field-hint">{t.billForm.selfVat(formatMoney(figures.selfVat))}</p>}
      <dl className="buy-summary">
        <div>
          <dt>{t.billForm.total}</dt>
          <dd>{formatMoney(figures.total)}</dd>
        </div>
        {figures.vatToClaim > 0 && (
          <div>
            <dt>{t.bills.vatToClaim}</dt>
            <dd>{formatMoney(figures.vatToClaim)}</dd>
          </div>
        )}
        {figures.withheld > 0 && (
          <div>
            <dt>{t.billForm.withholding}</dt>
            <dd>{formatMoney(figures.withheld)}</dd>
          </div>
        )}
        <div className="buy-summary__total">
          <dt>{paidNow ? t.billForm.payNow : t.billForm.owe}</dt>
          <dd>{formatMoney(figures.owed)}</dd>
        </div>
      </dl>
    </>
  );
}

function PriceAlerts({
  alerts,
  prices,
  onChange,
}: {
  alerts: BillPreview['priceAlerts'];
  prices: Record<number, { use: boolean; price: string }>;
  onChange: (prices: Record<number, { use: boolean; price: string }>) => void;
}) {
  const t = useT();
  return (
    <div className="price-alerts">
      <h3 className="price-alerts__title">{t.billForm.priceAlerts}</h3>
      {alerts.map((alert) => {
        const choice = prices[alert.productId] ?? { use: false, price: String(alert.suggestedPrice) };
        const set = (patch: Partial<typeof choice>) => onChange({ ...prices, [alert.productId]: { ...choice, ...patch } });
        return (
          <div key={alert.productId} className="price-alert">
            <p className="price-alert__what">
              {t.billForm.priceAlert(alert.name, alert.oldCost === null ? '–' : formatMoney(alert.oldCost), formatMoney(alert.newCost))}{' '}
              {alert.marginBefore !== null && t.billForm.margin(formatPercent(alert.marginBefore / 100), formatPercent(alert.marginAfter / 100))}
            </p>
            <label className="toggle">
              <input type="checkbox" checked={choice.use} onChange={(event) => set({ use: event.target.checked })} />
              {t.billForm.usePrice(alert.name)}
            </label>
            {choice.use && (
              <Field label={t.billForm.newPrice(alert.name)} hint={t.billForm.keepsMargin(formatMoney(alert.suggestedPrice))} narrow>
                <input type="number" inputMode="decimal" min={0.01} step={0.01} value={choice.price} onChange={(event) => set({ price: event.target.value })} />
              </Field>
            )}
          </div>
        );
      })}
    </div>
  );
}

import { FilePdf } from '@phosphor-icons/react';
import { LocationSelect } from '../components/LocationSelect';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { canOversee } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { BillFields } from '../components/BillParts';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Badge, Button, ButtonLink, Card, Combobox, DateField, EmptyState, Field, PageHeader, type Tone, useToast } from '../components/ui';
import { useT } from '../i18n/useT';
import { billScansApi, categoriesApi, suppliersApi } from '../services/api';
import { mediaSrc } from '../services/apiClient';
import type { BillScan, ScanStamp } from '../services/types';
import { type BillDraft, isBillValid, todayIso, toBillInput } from '../utils/bills';
import { errorMessage } from '../utils/errors';
import { formatDate, formatDateTime, formatMoney, formatQuantity } from '../utils/format';
import { orderSummary } from '../utils/orders';
import { HistoryCard } from '../components/HistoryCard';
import { CustomsBillPicker, CustomsFields } from '../components/CustomsFields';
import { customsDraftValid, customsInput, draftFromReading } from '../utils/customs';

const STAMP_TONE: Record<ScanStamp, Tone> = { new: 'brand', unsure: 'warn', barcode: 'warn', price: 'info', match: 'ok' };
const VAT_RATES = [18, 16, 8, 0] as const;
const NEW = 'new';
const SKIP = 'skip';

/** One line as the form holds it; `choice` is a product id, NEW or SKIP. */
interface Decision {
  choice: string;
  pieces: string;
  perPack: string;
  unitCost: string;
  updateCost: boolean;
  updateBarcode: boolean;
  name: string;
  barcode: string;
  price: string;
  vatRate: string;
  /** A best-before date for these units, or ''. */
  expiresOn?: string;
}

const roundMoney = (amount: number) => Math.round(amount * 100) / 100;
const filled = (value: string) => value.trim() !== '' && Number(value) > 0;

function firstDecisions(scan: BillScan): Decision[] {
  return scan.lines.map(({ read, match }, index) => {
    const fresh = freshDecision(read, match);
    if (!scan.previous) return fresh;
    // Reopened: start from what was chosen last time; a line not sent then was skipped.
    const before = scan.previous.lines.find((line) => line.readIndex === index);
    if (!before) return { ...fresh, choice: SKIP };
    return {
      ...fresh,
      choice: before.productId ? String(before.productId) : NEW,
      pieces: String(before.pieces),
      perPack: String(before.unitsPerPack),
      unitCost: before.unitCost === null ? '' : String(before.unitCost),
      updateCost: before.updateCost,
      updateBarcode: before.updateBarcode,
      ...(before.newProduct && {
        name: before.newProduct.name,
        barcode: before.newProduct.barcode ?? '',
        price: String(before.newProduct.price),
        vatRate: String(before.newProduct.vatRate),
      }),
    };
  });
}

function freshDecision(read: BillScan['lines'][number]['read'], match: BillScan['lines'][number]['match']): Decision {
  return {
    choice: match.productId ? String(match.productId) : NEW,
    pieces: String(match.pieces),
    perPack: String(match.unitsPerPack),
    unitCost: match.unitCost === null ? '' : String(match.unitCost),
    // A new price from the supplier usually is the new cost; a new barcode could be a misread, so it waits for a tick.
    updateCost: match.stamp === 'price',
    updateBarcode: false,
    name: read.name,
    barcode: read.barcode ?? '',
    price: '',
    vatRate: String(VAT_RATES.find((rate) => rate === read.vatRate) ?? 18),
  };
}

function firstBill(scan: BillScan): BillDraft {
  const previous = scan.previous?.bill;
  if (previous) {
    return {
      number: previous.number ?? '',
      issuedOn: previous.issuedOn,
      dueOn: previous.dueOn ?? '',
      amount: String(previous.amount),
      vat: previous.vatAmount === null || previous.vatAmount === undefined ? '' : String(previous.vatAmount),
      note: previous.note ?? '',
    };
  }
  const { reading, totals } = scan;
  const issued = reading.issuedOn && reading.issuedOn <= todayIso() ? reading.issuedOn : todayIso();
  const amount = reading.totals.gross ?? (reading.totals.net !== null ? reading.totals.net + (reading.totals.vat ?? 0) : totals.linesTotal);
  return {
    number: reading.number ?? '',
    issuedOn: issued,
    dueOn: reading.dueOn && reading.dueOn >= issued ? reading.dueOn : '',
    amount: amount > 0 ? String(roundMoney(amount)) : '',
    vat: reading.totals.vat !== null && reading.totals.vat >= 0 && reading.totals.vat < amount ? String(roundMoney(reading.totals.vat)) : '',
    note: '',
  };
}

/** The difference page: what the AI read off a supplier's bill, line by line, against what 4VD knows. */
export function ScanCheckPage() {
  const t = useT();
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const chosenSupplier = Number(params.get('supplier')) || undefined;
  const scan = useQuery({ queryKey: ['bill-scans', id, chosenSupplier], queryFn: () => billScansApi.get(id, chosenSupplier), placeholderData: (previous) => previous });

  const crumbs = [{ label: t.nav.tabs.bills, to: '/bills' }];
  if (scan.isPending) return <Loading />;
  if (scan.isError) return <ErrorNotice error={scan.error} onRetry={() => scan.refetch()} />;
  const data = scan.data;
  const title = data.supplier ? t.scans.titleFrom(data.supplier.name) : t.scans.title;

  if (data.status !== 'waiting') {
    const when = formatDateTime(data.decidedAt ?? data.scannedAt);
    return (
      <>
        <PageHeader title={title} crumbs={crumbs} />
        <EmptyState
          title={data.status === 'confirmed' ? t.scans.confirmed({ by: data.decidedBy, when }) : t.scans.discarded({ by: data.decidedBy, when })}
          action={
            data.billId ? (
              <div className="form-actions">
                <ButtonLink to={`/bills/${data.billId}`} variant="primary">
                  {t.scans.openBill}
                </ButtonLink>
                {data.orderId && <ButtonLink to={`/orders/${data.orderId}`}>{t.scans.openOrder}</ButtonLink>}
              </div>
            ) : (
              <ButtonLink to="/bills">{t.nav.tabs.bills}</ButtonLink>
            )
          }
        />
        <div className="scan-done-pages">
          <ReopenCard scan={data} />
          <Pages scan={data} />
          <HistoryCard entityType="bill_scan" entityId={data.id} />
        </div>
      </>
    );
  }

  const chooseSupplier = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('supplier', value);
    else next.delete('supplier');
    setParams(next, { replace: true });
  };

  if (data.reading.kind === 'customs') {
    return (
      <>
        <PageHeader
          title={data.reading.number ? t.customsPaper.titleNo(data.reading.number) : t.customsPaper.title}
          crumbs={crumbs}
          description={(data.emailFrom ? t.scans.cameByEmail(data.emailFrom) : '') + t.customsPaper.scanDescription}
        />
        <CustomsCheck scan={data} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={title} crumbs={crumbs} description={(data.emailFrom ? t.scans.cameByEmail(data.emailFrom) : '') + t.scans.description} />
      {/* New matches for another supplier start the decisions over. */}
      <CheckForm key={data.supplier?.id ?? 'none'} scan={data} onSupplier={chooseSupplier} />
    </>
  );
}

/** A delivery staff already put into stock: what they counted, so its bill only sets the costs. */
function ArrivalNotice({ arrival }: { arrival: NonNullable<BillScan['arrival']> }) {
  const t = useT();
  return (
    <div className="notice" role="status">
      <div>
        <p>
          <strong>{t.scans.arrivalTitle(arrival.by ?? t.scans.arrivalSomeone, formatDate(arrival.at))}</strong>
        </p>
        {arrival.lines.length > 0 && <p>{arrival.lines.map((line) => `${line.productName} × ${formatQuantity(line.quantity)}`).join(', ')}</p>}
        <p>{t.scans.arrivalHint}</p>
      </div>
      <Link to={`/orders/${arrival.orderId}`}>{t.scans.arrivalOrder(arrival.orderId)}</Link>
    </div>
  );
}

function CheckForm({ scan, onSupplier }: { scan: BillScan; onSupplier: (id: string) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const [decisions, setDecisions] = useState(() => firstDecisions(scan));
  const [bill, setBill] = useState(() => firstBill(scan));
  const [orderId, setOrderId] = useState(() => {
    const previous = scan.previous?.orderId;
    if (scan.arrival) return '';
    if (previous && scan.openOrders.some((order) => order.id === previous)) return String(previous);
    return scan.openOrders[0] ? String(scan.openOrders[0].id) : '';
  });
  const [categoryId, setCategoryId] = useState(() => (scan.previous?.categoryId ? String(scan.previous.categoryId) : ''));
  const [locationId, setLocationId] = useState<number | null>(scan.previous?.locationId ?? null);
  const [discarding, setDiscarding] = useState(false);
  // The accountant saves a delivery's bill; throwing a scan away stays with those who run the shop.
  const mayDiscard = canOversee(useCurrentUser().role);

  const kept = decisions.filter((decision) => decision.choice !== SKIP);
  const anyNew = kept.some((decision) => decision.choice === NEW);
  const pieces = kept.reduce((sum, decision) => sum + (Number(decision.pieces) || 0), 0);
  const products = new Set(kept.map((decision, index) => (decision.choice === NEW ? `new-${index}` : decision.choice))).size;
  const blocker = !scan.supplier
    ? t.scans.needSupplier
    : kept.length === 0 && !scan.arrival
      ? t.scans.needLines
      : kept.some((decision) => decision.choice === '' || !filled(decision.pieces) || !filled(decision.perPack))
        ? t.scans.needProduct
        : kept.some((decision) => decision.choice === NEW && (decision.name.trim() === '' || !filled(decision.price)))
          ? t.scans.needNew
          : anyNew && !categoryId
            ? t.scans.needCategory
            : !isBillValid(bill)
              ? t.scans.needBill
              : null;

  const done = () => {
    for (const key of ['bill-scans', 'bills', 'orders', 'products', 'inventory', 'attention', 'activity']) queryClient.invalidateQueries({ queryKey: [key] });
  };
  const confirm = useMutation({
    mutationFn: () =>
      billScansApi.confirm(scan.id, {
        supplierId: scan.supplier!.id,
        orderId: orderId ? Number(orderId) : null,
        categoryId: anyNew ? Number(categoryId) : null,
        locationId,
        bill: toBillInput(bill),
        lines: decisions.flatMap((decision, index) => {
          if (decision.choice === SKIP) return [];
          const { read } = scan.lines[index]!;
          const isNew = decision.choice === NEW;
          return [
            {
              readIndex: index,
              productId: isNew ? null : Number(decision.choice),
              newProduct: isNew
                ? { name: decision.name.trim(), barcode: decision.barcode.trim() || null, price: Number(decision.price), vatRate: Number(decision.vatRate) }
                : null,
              code: read.code,
              pieces: Number(decision.pieces),
              unitsPerPack: Number(decision.perPack),
              unitCost: decision.unitCost.trim() === '' ? null : Number(decision.unitCost),
              updateCost: !isNew && decision.updateCost,
              barcode: read.barcode,
              updateBarcode: !isNew && decision.updateBarcode,
              ...(!isNew && decision.expiresOn && { expiresOn: decision.expiresOn }),
            },
          ];
        }),
      }),
    onSuccess: (result) => {
      done();
      // The toast's check turns into place as the bill opens.
      toast({ title: t.scans.confirmedToast });
      navigate(`/bills/${result.billId}`);
    },
  });
  const discard = useMutation({
    mutationFn: () => billScansApi.discard(scan.id),
    onSuccess: () => {
      done();
      navigate('/bills');
    },
  });

  function change(index: number, patch: Partial<Decision>) {
    setDecisions((current) => current.map((decision, at) => (at === index ? { ...decision, ...patch } : decision)));
  }

  /** A different box size changes the pieces and what one piece costs, from the same price per unit. */
  function changePack(index: number, value: string) {
    const { read, match } = scan.lines[index]!;
    const perPack = Math.round(Number(value));
    if (!(perPack > 0)) return change(index, { perPack: value });
    const unitPrice = match.unitCost === null ? null : match.unitCost * match.unitsPerPack;
    change(index, {
      perPack: value,
      pieces: String(Math.round(read.quantity * perPack)),
      ...(unitPrice !== null && { unitCost: String(roundMoney(unitPrice / perPack)) }),
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (blocker === null) confirm.mutate();
  }

  const { reading, totals } = scan;
  return (
    <form className="product-layout" onSubmit={handleSubmit}>
      <div className="product-layout__main">
        {scan.duplicateBillId && (
          <div className="notice notice--warn" role="status">
            <span>{t.scans.duplicate}</span>
            <Link to={`/bills/${scan.duplicateBillId}`}>{t.scans.seeDuplicate}</Link>
          </div>
        )}
        {!totals.adds && totals.printedTotal !== null && (
          <p className="notice notice--warn" role="status">
            {t.scans.totalsOff({ lines: formatMoney(totals.linesTotal), printed: formatMoney(totals.printedTotal) })}
          </p>
        )}
        {scan.arrival && <ArrivalNotice arrival={scan.arrival} />}
        {scan.arrival?.billSupplier && (
          <p className="notice notice--warn" role="status">
            {t.scans.arrivalOtherSupplier(scan.arrival.billSupplier, scan.supplier?.name ?? '')}
          </p>
        )}
        {scan.previous && <p className="notice">{t.scans.previousChoices}</p>}
        {reading.remarks && <p className="notice">{t.scans.remarks(reading.remarks)}</p>}

        <Card>
          <div className="field-row">
            <Combobox
              label={t.scans.supplier}
              hint={scan.supplier ? t.scans.supplierBy[scan.supplier.matchedBy] : reading.supplier.name ? t.scans.supplierOnBill(reading.supplier.name) : t.scans.supplierMissing}
              placeholder={t.scans.chooseSupplier}
              required
              value={scan.supplier ? String(scan.supplier.id) : ''}
              onChange={onSupplier}
              options={(suppliers.data ?? []).map((supplier) => ({ value: String(supplier.id), label: supplier.name, hint: supplier.nui ?? supplier.phone ?? undefined }))}
            />
            {scan.supplier && !scan.arrival && (
              <Field label={t.scans.order} hint={scan.openOrders.length > 0 ? t.scans.orderHint : undefined}>
                <select value={orderId} onChange={(event) => setOrderId(event.target.value)}>
                  {scan.openOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {t.scans.fillOrder(order.id, orderSummary(order, t.orders.andMore))}
                    </option>
                  ))}
                  <option value="">{t.scans.newOrder}</option>
                </select>
              </Field>
            )}
          </div>
          {!scan.supplier && (
            <Link to="/suppliers?new=1" className="scan-add-supplier">
              {t.scans.addSupplier}
            </Link>
          )}
        </Card>

        <Card title={t.scans.lines} description={t.scans.linesHint(scan.lines.length)} flush>
          {reading.pricesIncludeVat && <p className="scan-vat-note">{t.scans.vatIncluded}</p>}
          <ol className="scan-lines">
            {scan.lines.map((line, index) => (
              <ScanLine
                key={index}
                index={index}
                line={line}
                decision={decisions[index]!}
                products={scan.products}
                onChange={(patch) => change(index, patch)}
                onPack={(value) => changePack(index, value)}
              />
            ))}
          </ol>
          <LocationSelect coming="in" value={locationId} onChange={setLocationId} />
          {anyNew && (
            <div className="buy-add-line">
              <Field label={t.scans.category}>
                <select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  <option value="">{t.scans.chooseCategory}</option>
                  {categories.data?.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </Card>
      </div>

      <div className="product-layout__side buy-side">
        <Pages scan={scan} />
        <Card title={t.scans.bill} description={t.scans.billHint}>
          <BillFields draft={bill} onChange={setBill} />
          <dl className="buy-summary">
            <div>
              <dt>{t.scans.lines}</dt>
              <dd>{t.scans.receive({ products, pieces })}</dd>
            </div>
            <div>
              <dt>{t.scans.linesTotal}</dt>
              <dd>{formatMoney(totals.linesTotal)}</dd>
            </div>
            {totals.printedTotal !== null && (
              <div className="buy-summary__total">
                <dt>{t.scans.printedTotal}</dt>
                <dd>{formatMoney(totals.printedTotal)}</dd>
              </div>
            )}
          </dl>
          {confirm.isError && (
            <p className="form-error" role="alert">
              {errorMessage(confirm.error)}
            </p>
          )}
          <Button type="submit" variant="primary" wide disabled={blocker !== null || confirm.isPending} aria-describedby="scan-why" loading={confirm.isPending}>
            {t.scans.confirm}
          </Button>
          <p id="scan-why" className="field-hint">
            {blocker ?? (scan.arrival ? t.scans.arrivalAfter : t.scans.afterConfirm)}
          </p>
          {mayDiscard && (
            <div className="scan-discard">
              {discarding ? (
                <>
                  <p>{t.scans.discardSure}</p>
                  {discard.isError && (
                    <p className="form-error" role="alert">
                      {errorMessage(discard.error)}
                    </p>
                  )}
                  <div className="form-actions">
                    <Button size="sm" variant="ghost" onClick={() => setDiscarding(false)}>
                      {t.scans.keep}
                    </Button>
                    <Button size="sm" variant="danger" disabled={discard.isPending} onClick={() => discard.mutate()}>
                      {t.scans.yesDiscard}
                    </Button>
                  </div>
                </>
              ) : (
                <Button size="sm" variant="danger-text" onClick={() => setDiscarding(true)}>
                  {t.scans.discard}
                </Button>
              )}
            </div>
          )}
        </Card>
      </div>
    </form>
  );
}

/**
 * A scanned customs declaration: its figures as read, to check, and the
 * import bill it covers (the one it names picked already), or left waiting
 * for its bill.
 */
function CustomsCheck({ scan }: { scan: BillScan }) {
  const t = useT();
  const w = t.customsPaper;
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { reading } = scan;
  const bills = scan.customs?.bills ?? [];
  const [draft, setDraft] = useState(() => draftFromReading(reading));
  const [billId, setBillId] = useState(() => (scan.customs?.matchId ? String(scan.customs.matchId) : ''));
  const [discarding, setDiscarding] = useState(false);
  const valid = customsDraftValid(draft);

  const done = () => {
    for (const key of ['bill-scans', 'bills', 'products', 'attention', 'activity', 'books', 'vat', 'cash']) queryClient.invalidateQueries({ queryKey: [key] });
  };
  const save = useMutation({
    mutationFn: () => billScansApi.confirmCustoms(scan.id, { ...customsInput(draft), billId: billId ? Number(billId) : null }),
    onSuccess: (result) => {
      done();
      toast({ title: result.billId ? w.putOnToast : w.waitingToast });
      navigate(result.billId ? `/bills/${result.billId}#customs` : '/bills');
    },
  });
  const discard = useMutation({
    mutationFn: () => billScansApi.discard(scan.id),
    onSuccess: () => {
      done();
      navigate('/bills');
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (valid) save.mutate();
  }

  const read = reading.customs;
  return (
    <form className="product-layout" onSubmit={handleSubmit}>
      <div className="product-layout__main">
        {reading.remarks && <p className="notice">{t.scans.remarks(reading.remarks)}</p>}
        <Card title={w.paper} description={w.paperHint}>
          <div className="settings-form">
            <CustomsFields draft={draft} onChange={setDraft} />
          </div>
        </Card>
        <Card title={w.readFrom}>
          <dl className="partner-facts">
            <div>
              <dt>{w.seller}</dt>
              <dd>{reading.supplier.name ?? '–'}</dd>
            </div>
            <div>
              <dt>{w.invoices}</dt>
              <dd>{read && read.invoiceNumbers.length > 0 ? read.invoiceNumbers.join(', ') : '–'}</dd>
            </div>
            <div>
              <dt>{w.declared}</dt>
              <dd>{read?.declaredValue ? formatMoney(read.declaredValue) : '–'}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="product-layout__side buy-side">
        <Pages scan={scan} />
        <Card title={w.bill}>
          <CustomsBillPicker bills={bills} value={billId} onChange={setBillId} allowWaiting />
          {save.isError && (
            <p className="form-error" role="alert">
              {errorMessage(save.error)}
            </p>
          )}
          <Button type="submit" variant="primary" wide disabled={!valid || save.isPending} aria-describedby={valid ? undefined : 'customs-why'} loading={save.isPending}>
            {billId ? w.putOn : w.keepWaiting}
          </Button>
          {!valid && (
            <p id="customs-why" className="field-hint">
              {w.needAmount}
            </p>
          )}
          <div className="scan-discard">
            {discarding ? (
              <>
                <p>{t.scans.discardSure}</p>
                {discard.isError && (
                  <p className="form-error" role="alert">
                    {errorMessage(discard.error)}
                  </p>
                )}
                <div className="form-actions">
                  <Button size="sm" variant="ghost" onClick={() => setDiscarding(false)}>
                    {t.scans.keep}
                  </Button>
                  <Button size="sm" variant="danger" disabled={discard.isPending} loading={discard.isPending} onClick={() => discard.mutate()}>
                    {t.scans.yesDiscard}
                  </Button>
                </div>
              </>
            ) : (
              <Button size="sm" variant="danger-text" onClick={() => setDiscarding(true)}>
                {t.scans.discard}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </form>
  );
}

interface ScanLineProps {
  index: number;
  line: BillScan['lines'][number];
  decision: Decision;
  products: BillScan['products'];
  onChange: (patch: Partial<Decision>) => void;
  onPack: (value: string) => void;
}

function ScanLine({ index, line, decision, products, onChange, onPack }: ScanLineProps) {
  const t = useT();
  const { read, match } = line;
  const isNew = decision.choice === NEW;
  const skipped = decision.choice === SKIP;
  const sameProduct = decision.choice === String(match.productId);
  const label = (what: string) => `${what}: ${read.name}`;
  const meta = [
    t.scans.onBill({ quantity: String(read.quantity), unit: read.unit, price: read.unitPrice === null ? null : formatMoney(read.unitPrice) }),
    read.discountPercent ? t.scans.rabat(read.discountPercent) : null,
    read.code ? t.scans.code(read.code) : null,
    read.barcode ? t.scans.barcode(read.barcode) : null,
  ].filter(Boolean);
  const showBarcode = !isNew && !skipped && read.barcode !== null && (!sameProduct || match.stamp === 'barcode');
  // Offered only when the cost may differ: a new price, or a product other than the one matched.
  const showCost = !isNew && !skipped && decision.unitCost.trim() !== '' && (!sameProduct || match.oldCost !== null || match.stamp === 'price');

  return (
    <li className={['scan-line', skipped && 'scan-line--skipped'].filter(Boolean).join(' ')}>
      <div className="scan-line__head">
        <Badge tone={STAMP_TONE[match.stamp]}>{t.scans.stamps[match.stamp]}</Badge>
        <div className="scan-line__read">
          <strong>
            <span className="scan-line__number">{index + 1}.</span> {read.name}
          </strong>
          <span className="scan-line__meta">{meta.join(' · ')}</span>
        </div>
        {read.lineTotal !== null && <span className="scan-line__total">{formatMoney(read.lineTotal)}</span>}
      </div>

      <div className="scan-line__body">
        <Field label={t.scans.what}>
          <select aria-label={label(t.scans.what)} value={decision.choice} onChange={(event) => onChange({ choice: event.target.value })}>
            <option value={NEW}>{t.scans.addNew}</option>
            <option value={SKIP}>{t.scans.skip}</option>
            <optgroup label={t.scans.product}>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>

        {!skipped && (
          <div className="field-row scan-line__numbers">
            <Field label={t.scans.pieces}>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                required
                aria-label={label(t.scans.pieces)}
                value={decision.pieces}
                onChange={(event) => onChange({ pieces: event.target.value })}
              />
            </Field>
            <Field label={t.scans.perPack} hint={t.scans.perPackHint}>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                required
                aria-label={label(t.scans.perPack)}
                value={decision.perPack}
                onChange={(event) => onPack(event.target.value)}
              />
            </Field>
            <Field label={t.scans.unitCost} hint={t.scans.unitCostHint}>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                aria-label={label(t.scans.unitCost)}
                value={decision.unitCost}
                onChange={(event) => onChange({ unitCost: event.target.value })}
              />
            </Field>
            {!isNew && products.find((product) => String(product.id) === decision.choice)?.hasBestBefore && (
              <Field label={t.billForm.bestBefore} hint={t.billForm.bestBeforeHint}>
                <DateField value={decision.expiresOn ?? ''} aria-label={label(t.billForm.bestBefore)} onChange={(day) => onChange({ expiresOn: day })} />
              </Field>
            )}
          </div>
        )}

        {isNew && (
          <div className="field-row">
            <Field label={t.scans.newName}>
              <input required maxLength={255} aria-label={label(t.scans.newName)} value={decision.name} onChange={(event) => onChange({ name: event.target.value })} />
            </Field>
            <Field label={t.scans.newBarcode}>
              <input maxLength={64} autoComplete="off" aria-label={label(t.scans.newBarcode)} value={decision.barcode} onChange={(event) => onChange({ barcode: event.target.value })} />
            </Field>
            <Field label={t.scans.newPrice}>
              <input
                type="number"
                inputMode="decimal"
                min={0.01}
                step={0.01}
                required
                aria-label={label(t.scans.newPrice)}
                value={decision.price}
                onChange={(event) => onChange({ price: event.target.value })}
              />
            </Field>
            <Field label={t.scans.newVat}>
              <select aria-label={label(t.scans.newVat)} value={decision.vatRate} onChange={(event) => onChange({ vatRate: event.target.value })}>
                {VAT_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}%
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {(showCost || showBarcode) && (
          <div className="scan-line__ticks">
            {showCost && (
              <label className="toggle">
                <input type="checkbox" checked={decision.updateCost} onChange={(event) => onChange({ updateCost: event.target.checked })} />
                {sameProduct && match.oldCost !== null ? t.scans.updateCost(formatMoney(match.oldCost)) : t.scans.useCost}
              </label>
            )}
            {showBarcode && (
              <label className="toggle">
                <input type="checkbox" checked={decision.updateBarcode} onChange={(event) => onChange({ updateBarcode: event.target.checked })} />
                {t.scans.updateBarcode({ from: sameProduct ? match.oldBarcode : null, to: read.barcode! })}
              </label>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** The photographed or PDF pages, to compare against while checking. */
function Pages({ scan }: { scan: BillScan }) {
  const t = useT();
  return (
    <Card title={t.scans.pagesTitle}>
      <ul className="scan-pages">
        {scan.pages.map((page, index) => (
          <li key={page.url}>
            <a href={mediaSrc(page.url) ?? undefined} target="_blank" rel="noreferrer" aria-label={page.isPdf ? t.scans.openPdf(index + 1) : t.scans.openPage(index + 1)}>
              {page.isPdf ? (
                <span className="scan-pages__pdf">
                  <FilePdf aria-hidden="true" />
                  PDF
                </span>
              ) : (
                <img src={mediaSrc(page.url) ?? undefined} alt="" loading="lazy" width={300} height={400} />
              )}
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The developer can take back a decided scan: everything it did is put back and it waits to be checked again. */
function ReopenCard({ scan }: { scan: BillScan }) {
  const t = useT();
  const { role } = useCurrentUser();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const reopen = useMutation({
    mutationFn: () => billScansApi.reopen(scan.id),
    onSuccess: () => {
      for (const key of ['bill-scans', 'bills', 'orders', 'products', 'inventory', 'attention', 'activity']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  if (role !== 'developer') return null;
  return (
    <Card title={t.scans.reopen} description={scan.status === 'confirmed' ? t.scans.reopenHint : t.scans.reopenDiscarded}>
      {reopen.isError && (
        <p className="form-error" role="alert">
          {errorMessage(reopen.error)}
        </p>
      )}
      {asking ? (
        <>
          <p className="field-hint">{t.scans.reopenSure}</p>
          <div className="form-actions">
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
              {t.scans.keep}
            </Button>
            <Button size="sm" variant="danger" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
              {t.scans.yesReopen}
            </Button>
          </div>
        </>
      ) : (
        <Button size="sm" onClick={() => setAsking(true)}>
          {t.scans.reopen}
        </Button>
      )}
    </Card>
  );
}

import { FilePdf, Image, Storefront, Trash, X } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '../../auth/useAuth';
import { toPage } from '../../components/BillScanParts';
import { CameraScanButton } from '../../components/CameraScanner';
import { ErrorNotice, Loading, SavedToast } from '../../components/Feedback';
import { ProductPicker } from '../../components/ProductPicker';
import { Button, Card, Combobox, DateField, EmptyState, Field, PageHeader } from '../../components/ui';
import { useT } from '../../i18n/useT';
import { billScansApi, productsApi } from '../../services/api';
import { DELIVERIES_KEY, type Delivery, teamApi } from '../../services/teamApi';
import type { Product } from '../../services/types';
import { type ArrivalDraft, type DeliveryDraft, keepListed, loadArrival, loadDrafts, parseReceived, saveArrival, saveDrafts } from '../../utils/deliveryDraft';
import { errorMessage } from '../../utils/errors';
import { formatDate, formatQuantity } from '../../utils/format';
import { allowsParts } from '../../utils/units';
import { lookupFailure } from '../counter/tillRules';

/** Matches the server's MAX_SCAN_PAGES. */
const MAX_PAGES = 6;
/** What a saved delivery changes on other pages. */
const TOUCHED = ['orders', 'inventory', 'products', 'expiry', 'activity', 'attention', 'bill-scans'];

/**
 * "A delivery came": one place for every delivery at the counter. Pick who
 * brought it; their order on its way opens to tick off (choose when there
 * are several), else count what came and it goes into stock at once. Then
 * the bill's photo goes to the owner, linked to the delivery, so checking it
 * never puts the goods in twice. What is typed is kept in this tab until it
 * goes into stock.
 */
export function DeliveriesPage() {
  const t = useT();
  const { businessId } = useCurrentUser();
  const deliveries = useQuery({ queryKey: DELIVERIES_KEY, queryFn: teamApi.deliveries });
  const suppliers = useQuery({ queryKey: ['orders', 'delivery-suppliers'], queryFn: teamApi.deliverySuppliers });
  const [arrival, setArrival] = useState<ArrivalDraft | null>(() => loadArrival(businessId));
  const [supplierId, setSupplierId] = useState<number | null>(() => arrival?.supplierId ?? null);
  const [pickedOrderId, setPickedOrderId] = useState<number | null>(null);
  const [counting, setCounting] = useState(() => arrival !== null);
  const [drafts, setDrafts] = useState<Record<number, DeliveryDraft>>(() => loadDrafts(businessId));
  // The delivery just put into stock: its bill's photo comes next.
  const [inStock, setInStock] = useState<{ orderId: number; message: string; files: File[] } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const orders = deliveries.data ?? [];
  const named = new Map((suppliers.data ?? []).map((supplier) => [supplier.id, supplier.name]));
  const theirs = orders.filter((order) => order.supplierId === supplierId);
  const order = counting ? undefined : (theirs.find((entry) => entry.id === pickedOrderId) ?? theirs[0]);
  const supplierName = supplierId === null ? '' : (named.get(supplierId) ?? theirs[0]?.supplierName ?? '');

  // Kept in the tab, without orders put into stock or cancelled elsewhere meanwhile.
  const listed = deliveries.data?.map((entry) => entry.id).join(',');
  useEffect(() => {
    if (listed === undefined) return;
    saveDrafts(businessId, keepListed(drafts, listed === '' ? [] : listed.split(',').map(Number)));
  }, [businessId, drafts, listed]);
  useEffect(() => saveArrival(businessId, arrival), [businessId, arrival]);

  function choose(id: number | null) {
    setDone(null);
    setSupplierId(id);
    setPickedOrderId(null);
    setCounting(false);
  }

  function finished(message: string) {
    setInStock(null);
    // After choose(), which clears the last message.
    choose(null);
    setDone(message);
  }

  if (deliveries.isPending || suppliers.isPending) return <Shell>{<Loading />}</Shell>;
  if (suppliers.isError) return <Shell>{<ErrorNotice error={suppliers.error} onRetry={() => suppliers.refetch()} />}</Shell>;

  return (
    <Shell>
      {done && <SavedToast key={done} message={done} />}
      {deliveries.isError && <ErrorNotice error={deliveries.error} onRetry={() => deliveries.refetch()} />}
      {inStock ? (
        <BillPhoto key={inStock.orderId} orderId={inStock.orderId} files={inStock.files} onDone={(sent) => finished(sent ? `${inStock.message} ${t.staff.deliveries.photoSent}` : inStock.message)} />
      ) : supplierId === null ? (
        <PickSupplier suppliers={suppliers.data} orders={orders} onPick={choose} />
      ) : (
        <>
          <div className="delivery-who">
            <p className="delivery-who__name">{supplierName}</p>
            <Button size="sm" variant="ghost" onClick={() => choose(null)} disabled={arrival !== null && arrival.lines.length > 0}>
              {t.staff.deliveries.changeSupplier}
            </Button>
          </div>
          {theirs.length > 1 && !counting && (
            <div className="chip-row" role="radiogroup" aria-label={t.staff.deliveries.which}>
              {theirs.map((entry) => (
                <button key={entry.id} type="button" role="radio" className="chip" aria-checked={entry.id === order?.id} onClick={() => setPickedOrderId(entry.id)}>
                  {t.staff.deliveries.orderLabel(formatDate(entry.createdAt), entry.lines.length)}
                </button>
              ))}
            </div>
          )}
          {order ? (
            <>
              <ReceiveForm
                key={order.id}
                order={order}
                draft={drafts[order.id]}
                onDraft={(draft) => setDrafts((current) => ({ ...current, [order.id]: draft }))}
                onDone={(message) => {
                  setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => Number(id) !== order.id)));
                  setInStock({ orderId: order.id, message, files: [] });
                }}
              />
              <Button variant="ghost" onClick={() => setCounting(true)}>
                {t.staff.deliveries.notOnOrder}
              </Button>
            </>
          ) : (
            <>
              <CountForm
                supplierId={supplierId}
                supplierName={supplierName}
                draft={arrival?.supplierId === supplierId ? arrival : null}
                onDraft={setArrival}
                onDone={(orderId, message, files) => {
                  setArrival(null);
                  setInStock({ orderId, message, files });
                }}
              />
              {theirs.length > 0 && (
                <Button variant="ghost" onClick={() => setCounting(false)} disabled={arrival !== null && arrival.lines.length > 0}>
                  {t.staff.deliveries.backToOrder}
                </Button>
              )}
            </>
          )}
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <>
      <PageHeader title={t.staff.deliveries.title} crumbs={[{ label: t.staff.nav.home, to: '/' }]} />
      <div className="staff-page">{children}</div>
    </>
  );
}

/** Who brought it: those with an order on its way first, then any supplier by name. */
function PickSupplier({ suppliers, orders, onPick }: { suppliers: Array<{ id: number; name: string }>; orders: Delivery[]; onPick: (id: number) => void }) {
  const t = useT();
  const waiting = [...new Map(orders.filter((order) => order.supplierId !== undefined).map((order) => [order.supplierId!, order.supplierName])).entries()];
  if (suppliers.length === 0 && waiting.length === 0) {
    return (
      <EmptyState icon={Storefront} title={t.staff.deliveries.noSuppliers}>
        {t.staff.deliveries.noSuppliersDetail}
      </EmptyState>
    );
  }
  return (
    <Card title={t.staff.deliveries.who}>
      {waiting.length > 0 && (
        <div className="delivery-waiting">
          <p className="field__label">{t.staff.deliveries.onTheirWay}</p>
          <div className="chip-row">
            {waiting.map(([id, name]) => (
              <button key={id} type="button" className="chip" onClick={() => onPick(id)}>
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
      <Combobox
        label={t.staff.deliveries.supplier}
        hint={t.staff.deliveries.supplierHint}
        value=""
        options={suppliers.map((supplier) => ({ value: String(supplier.id), label: supplier.name }))}
        onChange={(value) => value && onPick(Number(value))}
      />
    </Card>
  );
}

/** Ticking off an order: what came against what was ordered, with best-before dates. */
function ReceiveForm({
  order,
  draft,
  onDraft,
  onDone,
}: {
  order: Delivery;
  draft: DeliveryDraft | undefined;
  onDraft: (draft: DeliveryDraft) => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const form = useRef<HTMLFormElement>(null);
  // A line not typed in yet starts at what was ordered.
  const came: Record<number, string> = { ...Object.fromEntries(order.lines.map((line) => [line.id, String(line.quantity)])), ...draft?.came };
  const expires = draft?.expires ?? {};
  const readings = order.lines.map((line) => parseReceived(came[line.id] ?? '', line.unit));
  const amounts = readings.map((reading) => (reading.kind === 'number' ? reading.value : null));
  // Problems show once Save was pressed, not while someone is still typing.
  const [tried, setTried] = useState(false);

  const receive = useMutation({
    mutationFn: () =>
      teamApi.receive(
        order.id,
        order.lines.map((line, index) => ({ lineId: line.id, receivedQuantity: amounts[index]!, expiresOn: expires[line.id] || null })),
      ),
    onSuccess: () => {
      for (const key of TOUCHED) queryClient.invalidateQueries({ queryKey: [key] });
      onDone(t.staff.deliveries.done(amounts.filter((amount) => amount !== null && amount > 0).length, order.supplierName));
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    const wrong = amounts.findIndex((amount) => amount === null);
    if (wrong >= 0) {
      form.current?.querySelectorAll<HTMLInputElement>('input[data-came]')[wrong]?.focus();
      return;
    }
    receive.mutate();
  }

  return (
    <Card title={t.staff.deliveries.from(order.supplierName, formatDate(order.createdAt))} description={t.staff.deliveries.intro}>
      {order.note && <p className="staff-muted">{order.note}</p>}
      <form ref={form} className="settings-form" onSubmit={submit} noValidate>
        {order.lines.map((line, index) => {
          const reading = readings[index]!;
          return (
            <fieldset key={line.id} className="staff-receive-line">
              <legend className="staff-row__title">{line.productName}</legend>
              <div className="field-row">
                <CameField
                  value={came[line.id] ?? ''}
                  unit={line.unit}
                  hint={t.staff.deliveries.ordered(formatQuantity(line.quantity, line.unit ?? 'piece'))}
                  problem={tried ? reading.kind : 'number'}
                  onChange={(value) => onDraft({ came: { ...draft?.came, [line.id]: value }, expires })}
                />
                <label className="field">
                  <span className="field__label">{t.staff.deliveries.expiresOn}</span>
                  <DateField value={expires[line.id] ?? ''} onChange={(value) => onDraft({ came: draft?.came ?? {}, expires: { ...expires, [line.id]: value ?? '' } })} />
                </label>
              </div>
            </fieldset>
          );
        })}
        {receive.isError && (
          <p className="form-error" role="alert">
            {errorMessage(receive.error)}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={receive.isPending}>
            {t.staff.deliveries.save}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** "How many came": blank is not 0, and a piece takes whole numbers only. */
function CameField({
  value,
  unit,
  hint,
  problem,
  onChange,
}: {
  value: string;
  unit: Product['unit'] | undefined;
  hint?: string;
  problem: 'number' | 'blank' | 'invalid' | 'zero';
  onChange: (value: string) => void;
}) {
  const t = useT();
  const parts = allowsParts(unit);
  const error =
    problem === 'number'
      ? undefined
      : problem === 'blank'
        ? t.staff.deliveries.typeCame
        : problem === 'zero'
          ? t.staff.deliveries.countZero
          : parts
            ? t.staff.deliveries.notAmount
            : t.staff.deliveries.wholeOnly;
  return (
    <Field label={t.staff.deliveries.came} hint={hint} error={error}>
      <input type="text" inputMode={parts ? 'decimal' : 'numeric'} autoComplete="off" data-came="" value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

/** Counting a delivery that came without an order: each product found or scanned, how many, and the bill's photo. */
function CountForm({
  supplierId,
  supplierName,
  draft,
  onDraft,
  onDone,
}: {
  supplierId: number;
  supplierName: string;
  draft: ArrivalDraft | null;
  onDraft: (draft: ArrivalDraft | null) => void;
  onDone: (orderId: number, message: string, files: File[]) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const form = useRef<HTMLFormElement>(null);
  const lines = draft?.lines ?? [];
  const [files, setFiles] = useState<File[]>([]);
  const [tried, setTried] = useState(false);
  const [scanProblem, setScanProblem] = useState<string | null>(null);
  const readings = lines.map((line) => parseReceived(line.came, line.unit));

  const update = (next: ArrivalDraft['lines']) => onDraft({ supplierId, key: draft?.key ?? crypto.randomUUID(), lines: next });
  function add(product: Product) {
    setScanProblem(null);
    if (lines.some((line) => line.productId === product.id)) return;
    update([...lines, { productId: product.id, name: product.name, unit: product.unit, came: '', expires: '' }]);
  }
  async function scanned(code: string) {
    setScanProblem(null);
    try {
      add(await productsApi.byBarcode(code));
    } catch (error) {
      setScanProblem(lookupFailure(error) === 'notFound' ? t.staff.camera.notFound(code) : t.staff.camera.cantCheck(code));
    }
  }

  const save = useMutation({
    mutationFn: () =>
      teamApi.arrived({
        key: draft!.key,
        supplierId,
        lines: lines.map((line, index) => ({ productId: line.productId, quantity: (readings[index] as { value: number }).value, expiresOn: line.expires || null })),
      }),
    onSuccess: (result) => {
      for (const key of TOUCHED) queryClient.invalidateQueries({ queryKey: [key] });
      onDone(result.id, t.staff.deliveries.done(lines.length, supplierName), files);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (lines.length === 0) return;
    const wrong = readings.findIndex((reading) => reading.kind !== 'number' || reading.value <= 0);
    if (wrong >= 0) {
      form.current?.querySelectorAll<HTMLInputElement>('input[data-came]')[wrong]?.focus();
      return;
    }
    save.mutate();
  }

  return (
    <Card title={t.staff.deliveries.countTitle(supplierName)} description={t.staff.deliveries.countIntro}>
      <form ref={form} className="settings-form" onSubmit={submit} noValidate>
        <div className="delivery-add">
          <ProductPicker label={t.staff.deliveries.addProduct} value="" resetAfterPick onPick={(product) => product && add(product)} exclude={(product) => lines.some((line) => line.productId === product.id)} />
          <CameraScanButton onScan={scanned} label={t.staff.deliveries.scan} />
        </div>
        {scanProblem && (
          <p className="form-error" role="alert">
            {scanProblem}
          </p>
        )}
        {lines.length === 0 ? (
          <p className={tried ? 'form-error' : 'staff-muted'} role={tried ? 'alert' : undefined}>
            {tried ? t.staff.deliveries.needLine : t.staff.deliveries.nothingYet}
          </p>
        ) : (
          lines.map((line, index) => {
            const reading = readings[index]!;
            const problem = !tried ? 'number' : reading.kind === 'number' && reading.value <= 0 ? 'zero' : reading.kind;
            const change = (patch: Partial<ArrivalDraft['lines'][number]>) => update(lines.map((one) => (one.productId === line.productId ? { ...one, ...patch } : one)));
            return (
              <fieldset key={line.productId} className="staff-receive-line">
                <legend className="staff-row__title delivery-line__head">
                  <span>{line.name}</span>
                  <Button size="sm" variant="ghost" icon={Trash} aria-label={t.staff.deliveries.remove(line.name)} onClick={() => update(lines.filter((one) => one.productId !== line.productId))} />
                </legend>
                <div className="field-row">
                  <CameField value={line.came} unit={line.unit} problem={problem} onChange={(came) => change({ came })} />
                  <label className="field">
                    <span className="field__label">{t.staff.deliveries.expiresOn}</span>
                    <DateField value={line.expires} onChange={(value) => change({ expires: value ?? '' })} />
                  </label>
                </div>
              </fieldset>
            );
          })
        )}
        <PhotoField files={files} onFiles={setFiles} disabled={save.isPending} label={t.staff.deliveries.billPhoto} hint={t.staff.deliveries.billPhotoHint} />
        {save.isError && (
          <p className="form-error" role="alert">
            {errorMessage(save.error)}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t.staff.deliveries.save}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** The bill's photo for a delivery already in stock: sent now, again after a failure, or skipped. */
function BillPhoto({ orderId, files: picked, onDone }: { orderId: number; files: File[]; onDone: (sent: boolean) => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>(picked);
  const send = useMutation({
    mutationFn: async () => billScansApi.scan(await Promise.all(files.map(toPage)), orderId),
    onSuccess: () => {
      for (const key of ['bill-scans', 'attention']) queryClient.invalidateQueries({ queryKey: [key] });
      onDone(true);
    },
  });
  // Picked with the count: it goes at once.
  const sentPicked = useRef(false);
  useEffect(() => {
    if (sentPicked.current || picked.length === 0) return;
    sentPicked.current = true;
    send.mutate();
  }, [picked.length, send]);

  return (
    <Card title={t.staff.deliveries.photoTitle} description={t.staff.deliveries.photoIntro}>
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate();
        }}
      >
        <PhotoField files={files} onFiles={setFiles} disabled={send.isPending} label={t.staff.deliveries.billPhoto} />
        {send.isError && (
          <p className="form-error" role="alert">
            {t.staff.deliveries.photoFailed} {errorMessage(send.error)}
          </p>
        )}
        {send.isPending && (
          <p className="field-hint" role="status">
            {t.scans.reading}
          </p>
        )}
        <div className="form-actions">
          <Button variant="ghost" onClick={() => onDone(false)} disabled={send.isPending}>
            {t.staff.deliveries.noBill}
          </Button>
          <Button type="submit" variant="primary" disabled={files.length === 0} loading={send.isPending}>
            {t.staff.deliveries.sendPhoto}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Photos (or a PDF) of the bill, up to the server's page limit. */
function PhotoField({ files, onFiles, disabled, label, hint }: { files: File[]; onFiles: (files: File[]) => void; disabled: boolean; label: string; hint?: string }) {
  const t = useT();
  function pick(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])];
    event.target.value = '';
    onFiles([...files, ...picked].slice(0, MAX_PAGES));
  }
  return (
    <>
      <Field label={label} hint={hint}>
        <input type="file" accept="image/*,application/pdf" capture="environment" multiple disabled={disabled || files.length >= MAX_PAGES} onChange={pick} />
      </Field>
      {files.length > 0 && (
        <ul className="scan-files">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              {file.type === 'application/pdf' ? <FilePdf aria-hidden="true" /> : <Image aria-hidden="true" />}
              <span className="scan-files__name">{file.name}</span>
              <Button size="sm" variant="ghost" icon={X} aria-label={t.scans.remove(file.name)} disabled={disabled} onClick={() => onFiles(files.filter((_, at) => at !== index))} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

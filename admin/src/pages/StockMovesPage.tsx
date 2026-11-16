import { ArrowRight, Plus, Printer, X } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { canOversee } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { ExportMenu } from '../components/ExportMenu';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PeriodPicker } from '../components/PeriodPicker';
import { Badge, Button, Card, Combobox, DataTable, DateField, EmptyState, Field, PageHeader, Section, Sheet, StatGrid, StatTile, useNewSheet, useToast } from '../components/ui';
import { useT } from '../i18n/useT';
import { businessApi, counterApi, reportsApi, stockMovesApi } from '../services/api';
import type { ProductUnit, StockMove } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateWith, formatQuantity } from '../utils/format';
import { allowsParts } from '../utils/units';
import { useLocations } from '../utils/useLocations';
import { usePeriodParams } from '../utils/usePeriodParams';
import { useWarnBeforeLeaving } from '../utils/useWarnBeforeLeaving';

/** "2026-10-04": today on this computer's calendar. */
const today = () => new Date().toLocaleDateString('en-CA');

/** "Sat 4 Oct" for a "2026-10-04" day, without any time zone moving it. */
const formatDay = (day: string) => formatDateWith(new Date(`${day}T00:00:00Z`), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const readQuantity = (text: string) => Number(text.replace(',', '.'));

/**
 * Stock moved between locations: the shelf refilled from the storeroom, or
 * goods put away. One list with the period picker and Excel; each move prints
 * as an LV- note. Moving never changes the total or the books.
 */
export function StockMovesPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const { period, from, to, range, rangeKey, changePeriod } = usePeriodParams('this-month');
  const moves = useQuery({ queryKey: ['stock-moves', rangeKey], queryFn: () => stockMovesApi.list(rangeKey), placeholderData: keepPreviousData });
  const [params] = useSearchParams();
  // "Bring" on the stock list opens the form with that product and amount.
  const prefill = params.get('product') ? { productId: Number(params.get('product')), quantity: params.get('qty') ?? '1' } : null;
  const [adding, setAdding] = useNewSheet();
  const live = (moves.data ?? []).filter((row) => !row.voidedAt);

  return (
    <>
      <PageHeader
        title={t.moves.title}
        description={t.moves.description(range.label)}
        actions={
          canOversee(role) && (
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              {t.moves.add}
            </Button>
          )
        }
      />
      <PeriodPicker period={period} from={from} to={to} onChange={changePeriod} />
      {moves.data && (
        <StatGrid compact>
          <StatTile label={t.moves.count} value={String(live.length)} />
          <StatTile label={t.moves.units} value={String(Math.round(live.reduce((sum, row) => sum + row.units, 0) * 1000) / 1000)} />
        </StatGrid>
      )}
      {moves.isPending && <Loading />}
      {moves.isError && <ErrorNotice error={moves.error} onRetry={() => moves.refetch()} />}
      {moves.data && (
        <Section title={t.moves.list}>
          <DataTable
            caption={t.moves.caption}
            rows={moves.data}
            rowKey={(row) => row.id}
            toolbar={
              <div className="toolbar">
                <div className="toolbar__end">
                  <ExportMenu kind="stock-moves" range={rangeKey} />
                </div>
              </div>
            }
            empty={<EmptyState title={t.moves.none}>{t.moves.noneHint}</EmptyState>}
            columns={[
              {
                header: t.moves.number,
                title: true,
                cell: (row) => (
                  <>
                    <Link to={`/stock-moves/${row.id}`}>{row.number}</Link>
                    {row.note && <span className="table__secondary">{row.note}</span>}
                  </>
                ),
              },
              { header: t.moves.day, cell: (row) => formatDay(row.day) },
              { header: t.moves.route, cell: (row) => <Route move={row} /> },
              { header: t.moves.products, cell: (row) => row.lineCount, align: 'end', className: 'table__phone-hide' },
              { header: t.moves.by, cell: (row) => row.createdBy ?? '–', className: 'table__phone-hide' },
            ]}
          />
        </Section>
      )}
      <Sheet open={adding} onClose={() => setAdding(false)} title={t.moves.add}>
        <StockMoveForm prefill={prefill} onSaved={() => setAdding(false)} />
      </Sheet>
    </>
  );
}

/** "Depo → Shop floor", or Voided. */
function Route({ move }: { move: Pick<StockMove, 'from' | 'to' | 'voidedAt'> }) {
  const t = useT();
  if (move.voidedAt) return <Badge tone="neutral">{t.moves.voided}</Badge>;
  return (
    <span className="move-route">
      {move.from}
      <ArrowRight aria-hidden="true" />
      <span className="visually-hidden"> {t.moves.toWord} </span>
      {move.to}
    </span>
  );
}

interface DraftLine {
  productId: number;
  quantity: string;
}

/** A new move: from, to, the day and its products (a scan adds one more). Says what it will do before saving. */
function StockMoveForm({ prefill, onSaved }: { prefill: DraftLine | null; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { locations, selling } = useLocations();
  const firstStore = locations.find((location) => !location.sellsHere);
  // Most moves refill the shelf: from the storeroom to where the till sells.
  const [fromId, setFromId] = useState<number | null>(firstStore?.id ?? null);
  const [toId, setToId] = useState<number | null>(selling?.id ?? null);
  const [day, setDay] = useState(today);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(prefill ? [prefill] : []);
  const shelf = useQuery({ queryKey: ['products', 'counter-shelf'], queryFn: counterApi.products, staleTime: 60_000 });
  const stock = useQuery({ queryKey: ['reports', 'reorder'], queryFn: reportsApi.reorderSuggestions });
  useWarnBeforeLeaving(lines.length > 0);

  const from = fromId ?? firstStore?.id ?? null;
  const to = toId ?? selling?.id ?? null;
  const fromName = locations.find((location) => location.id === from)?.name ?? '';
  const toName = locations.find((location) => location.id === to)?.name ?? '';
  const byId = useMemo(() => new Map((shelf.data ?? []).map((product) => [product.id, product])), [shelf.data]);
  const placesOf = useMemo(() => new Map((stock.data ?? []).map((row) => [row.productId, row.places])), [stock.data]);
  const thereOf = (productId: number) => placesOf.get(productId)?.find((place) => place.locationId === from)?.quantity ?? 0;
  const options = (shelf.data ?? []).map((product) => ({ value: String(product.id), label: product.name, hint: product.barcode ?? product.sku ?? undefined }));

  const problemOf = (line: DraftLine): string | null => {
    const product = byId.get(line.productId);
    const quantity = readQuantity(line.quantity);
    if (!product) return null;
    if (!(quantity > 0)) return t.moves.quantityError;
    if (!allowsParts(product.unit) && !Number.isInteger(quantity)) return t.moves.wholeError;
    if (stock.data && placesOf.has(line.productId) && quantity > thereOf(line.productId)) return t.moves.moreThanThere(formatQuantity(thereOf(line.productId), product.unit), fromName);
    return null;
  };
  const problems = lines.map(problemOf);
  const same = from !== null && from === to;
  const valid = lines.length > 0 && problems.every((problem) => problem === null) && !same && from !== null && to !== null && day !== '' && day <= today();

  const save = useMutation({
    mutationFn: () =>
      stockMovesApi.create({
        fromId: from!,
        toId: to!,
        day,
        note: note.trim() || null,
        lines: lines.map((line) => ({ productId: line.productId, quantity: readQuantity(line.quantity) })),
      }),
    onSuccess: (move) => {
      for (const key of ['stock-moves', 'products', 'inventory', 'reports', 'locations', 'activity']) queryClient.invalidateQueries({ queryKey: [key] });
      toast({ title: t.moves.saved(move.number) });
      setLines([]);
      onSaved();
      navigate(`/stock-moves/${move.id}`);
    },
  });

  /** A pick (or a scan) adds the product, or one more of it when it's already on. */
  function add(picked: string | null) {
    if (!picked) return;
    const productId = Number(picked);
    setLines((now) =>
      now.some((line) => line.productId === productId)
        ? now.map((line) => (line.productId === productId ? { ...line, quantity: String(readQuantity(line.quantity) + 1) } : line))
        : [...now, { productId, quantity: '1' }],
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (valid) save.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <Field label={t.moves.from}>
          <select value={from ?? ''} onChange={(event) => setFromId(Number(event.target.value))}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.moves.to} error={same ? t.moves.sameError : undefined}>
          <select value={to ?? ''} onChange={(event) => setToId(Number(event.target.value))}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t.moves.day}>
        <DateField required max={today()} value={day} onChange={(next) => setDay(next)} />
      </Field>
      <Combobox label={t.moves.addProduct} placeholder={t.moves.findProduct} value="" resetAfterPick options={options} onChange={add} />
      {lines.length > 0 && (
        <ul className="stock-doc-lines">
          {lines.map((line, index) => {
            const product = byId.get(line.productId);
            const unit = (product?.unit ?? 'piece') as ProductUnit;
            return (
              <li key={line.productId} className="stock-doc-lines__row">
                <span className="stock-doc-lines__name">
                  {product?.name}
                  {placesOf.has(line.productId) && <span className="table__secondary">{t.moves.there(formatQuantity(thereOf(line.productId), unit), fromName)}</span>}
                </span>
                <Field label={t.moves.quantityFor(product?.name ?? '')} narrow error={problems[index] ?? undefined}>
                  <input
                    type="number"
                    inputMode={allowsParts(unit) ? 'decimal' : 'numeric'}
                    min={allowsParts(unit) ? 0.001 : 1}
                    step={allowsParts(unit) ? 0.001 : 1}
                    required
                    value={line.quantity}
                    onChange={(event) => setLines((now) => now.map((one) => (one.productId === line.productId ? { ...one, quantity: event.target.value } : one)))}
                  />
                </Field>
                <Button variant="ghost" icon={X} aria-label={t.moves.removeLine(product?.name ?? '')} onClick={() => setLines((now) => now.filter((one) => one.productId !== line.productId))} />
              </li>
            );
          })}
        </ul>
      )}
      <Field label={t.moves.note}>
        <input maxLength={500} placeholder={t.moves.notePlaceholder} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {lines.length === 0 && <p className="field-hint">{t.moves.needLine}</p>}
      {lines.length > 0 && !same && (
        <p className="notice" aria-live="polite">
          {t.moves.preview(lines.length, fromName, toName)}
        </p>
      )}
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!valid || save.isPending} loading={save.isPending}>
          {t.moves.save}
        </Button>
      </div>
    </form>
  );
}

/** One move: its lines, Print for the LV note that goes with the goods, and Void for those who oversee. */
export function StockMovePage() {
  const t = useT();
  const { id } = useParams();
  const { role } = useCurrentUser();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const move = useQuery({ queryKey: ['stock-moves', 'one', Number(id)], queryFn: () => stockMovesApi.get(Number(id)) });
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });
  const voiding = useMutation({
    mutationFn: () => stockMovesApi.void(Number(id)),
    onSuccess: (updated) => {
      queryClient.setQueryData(['stock-moves', 'one', Number(id)], updated);
      for (const key of ['stock-moves', 'products', 'inventory', 'reports', 'locations', 'activity']) queryClient.invalidateQueries({ queryKey: [key] });
      toast({ title: t.moves.voidedToast(updated.number) });
      setConfirming(false);
    },
  });

  if (move.isPending) return <Loading />;
  if (move.isError) return <ErrorNotice error={move.error} onRetry={() => move.refetch()} />;
  const doc = move.data;
  const lines = doc.lines ?? [];
  const at = (iso: string) => formatDateWith(new Date(iso), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const note = (
    <article className="statement">
      <header className="statement__head">
        <div>
          <p className="statement__shop">{business.data?.name ?? ''}</p>
          <p className="statement__muted">{[business.data?.address, business.data?.phone].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="statement__title">
          <h2>{t.moves.noteTitle}</h2>
          <p className="statement__muted">
            {doc.number} · {formatDay(doc.day)}
          </p>
        </div>
      </header>
      <p className="statement__to">
        <span className="statement__muted">{t.moves.from}</span> <strong>{doc.from}</strong> <span className="statement__muted">{t.moves.toWord}</span> <strong>{doc.to}</strong>
      </p>
      <table className="statement__table">
        <caption className="visually-hidden">{t.moves.linesCaption(doc.number)}</caption>
        <thead>
          <tr>
            <th scope="col">{t.moves.product}</th>
            <th scope="col">{t.moves.code}</th>
            <th scope="col" className="statement__number">
              {t.moves.quantity}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.productId}>
              <td>{line.productName}</td>
              <td>{line.sku ?? ''}</td>
              <td className="statement__number">{formatQuantity(line.quantity, line.unit as ProductUnit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {doc.note && <p className="statement__muted">{doc.note}</p>}
      {doc.voidedAt && <p className="statement__muted">{t.moves.voidedBy(doc.voidedBy ?? '–', at(doc.voidedAt))}</p>}
      <p className="move-signatures">
        <span>{t.moves.takenBy}</span>
        <span>{t.moves.receivedBy}</span>
      </p>
    </article>
  );

  return (
    <>
      <PageHeader
        title={doc.number}
        crumbs={[{ to: '/stock-moves', label: t.moves.title }]}
        description={`${doc.from} → ${doc.to} · ${formatDay(doc.day)}`}
        actions={
          <>
            {doc.voidedAt && <Badge tone="neutral">{t.moves.voided}</Badge>}
            <Button icon={Printer} onClick={() => window.print()}>
              {t.moves.print}
            </Button>
          </>
        }
      />
      <Card title={t.moves.products}>
        <DataTable
          caption={t.moves.linesCaption(doc.number)}
          rows={lines}
          rowKey={(row) => row.productId}
          columns={[
            { header: t.moves.product, title: true, cell: (row) => <Link to={`/products/${row.productId}`}>{row.productName}</Link> },
            { header: t.moves.quantity, cell: (row) => formatQuantity(row.quantity, row.unit as ProductUnit), align: 'end' },
          ]}
        />
        {doc.note && <p className="field-hint">{doc.note}</p>}
        <p className="field-hint">
          {t.moves.madeBy(doc.createdBy ?? '–', at(doc.createdAt))}
          {doc.voidedAt && ` ${t.moves.voidedBy(doc.voidedBy ?? '–', at(doc.voidedAt))}`}
        </p>
        {canOversee(role) && !doc.voidedAt && (
          <div className="form-actions">
            {confirming ? (
              <>
                <Button variant="danger" loading={voiding.isPending} disabled={voiding.isPending} onClick={() => voiding.mutate()}>
                  {t.moves.confirmVoid}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  {t.common.cancel}
                </Button>
              </>
            ) : (
              <Button variant="danger-text" onClick={() => setConfirming(true)}>
                {t.moves.void}
              </Button>
            )}
          </div>
        )}
        {confirming && <p className="field-hint">{t.moves.voidHint}</p>}
        {voiding.isError && (
          <p className="form-error" role="alert">
            {errorMessage(voiding.error)}
          </p>
        )}
      </Card>
      {/* A copy straight on the page body, so printing starts at the top of the paper, away from the app's layout. */}
      {createPortal(
        <div className="print-root" aria-hidden="true">
          {note}
        </div>,
        document.body,
      )}
    </>
  );
}

import { ArrowDown, ArrowUp, Plus, X } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { EntriesPanel } from '../components/BooksParts';
import { ExportMenu } from '../components/ExportMenu';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PeriodPicker } from '../components/PeriodPicker';
import { Badge, Button, Card, Combobox, DataTable, DateField, EmptyState, Field, PageHeader, Section, Sheet, StatGrid, StatTile, useNewSheet, useToast } from '../components/ui';
import { useT } from '../i18n/useT';
import { counterApi, pricesApi, stockDocumentsApi } from '../services/api';
import type { ProductUnit, StockDocument, StockDocumentDirection, StockDocumentReason } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateWith, formatHeadlineMoney, formatMoney, formatQuantity } from '../utils/format';
import { allowsParts } from '../utils/units';
import { usePeriodParams } from '../utils/usePeriodParams';
import { useWarnBeforeLeaving } from '../utils/useWarnBeforeLeaving';

/** Why goods come in or go out; the same lists as the server's. Damage, loss and expiry are write-offs. */
const REASONS: Record<StockDocumentDirection, StockDocumentReason[]> = {
  in: ['found', 'received_free', 'other'],
  out: ['own_use', 'given_away', 'other'],
};

/** "2026-10-04": today on this computer's calendar. */
const today = () => new Date().toLocaleDateString('en-CA');

/** "Sat 4 Oct" for a "2026-10-04" day, without any time zone moving it. */
const formatDay = (day: string) => formatDateWith(new Date(`${day}T00:00:00Z`), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Goods in or out without a bill or a sale: one list for both, with the period picker and Excel. */
export function StockDocumentsPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const { period, from, to, range, rangeKey, changePeriod } = usePeriodParams('this-month');
  const documents = useQuery({ queryKey: ['stock-documents', rangeKey], queryFn: () => stockDocumentsApi.list(rangeKey), placeholderData: keepPreviousData });
  const [adding, setAdding] = useNewSheet();
  const live = (documents.data ?? []).filter((row) => !row.voidedAt);
  const sum = (direction: StockDocumentDirection) => live.filter((row) => row.direction === direction).reduce((total, row) => total + row.value, 0);

  return (
    <>
      <PageHeader
        title={t.stockDocs.title}
        description={t.stockDocs.description(range.label)}
        actions={
          canManage(role) && (
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              {t.stockDocs.add}
            </Button>
          )
        }
      />
      <PeriodPicker period={period} from={from} to={to} onChange={changePeriod} />
      {documents.data && (
        <StatGrid compact>
          <StatTile label={t.stockDocs.inTotal} value={formatHeadlineMoney(sum('in'))} />
          <StatTile label={t.stockDocs.outTotal} value={formatHeadlineMoney(sum('out'))} />
          <StatTile label={t.stockDocs.count} value={String(live.length)} />
        </StatGrid>
      )}
      {documents.isPending && <Loading />}
      {documents.isError && <ErrorNotice error={documents.error} onRetry={() => documents.refetch()} />}
      {documents.data && (
        <Section title={t.stockDocs.list}>
          <DataTable
            caption={t.stockDocs.caption}
            rows={documents.data}
            rowKey={(row) => row.id}
            toolbar={
              <div className="toolbar">
                <div className="toolbar__end">
                  <ExportMenu kind="stock-documents" range={rangeKey} />
                </div>
              </div>
            }
            empty={<EmptyState title={t.stockDocs.none}>{t.stockDocs.noneHint}</EmptyState>}
            columns={[
              {
                header: t.stockDocs.number,
                title: true,
                cell: (row) => (
                  <>
                    <Link to={`/stock-documents/${row.id}`}>{row.number}</Link>
                    <span className="table__secondary">{[t.stockDocs.reasons[row.reason], row.note].filter(Boolean).join(' · ')}</span>
                  </>
                ),
              },
              { header: t.stockDocs.day, cell: (row) => formatDay(row.day) },
              { header: t.stockDocs.direction, cell: (row) => <DirectionBadge document={row} /> },
              { header: t.stockDocs.products, cell: (row) => row.lineCount, align: 'end', className: 'table__phone-hide' },
              { header: t.stockDocs.value, cell: (row) => (row.voidedAt ? '–' : formatMoney(row.direction === 'in' ? row.value : -row.value)), align: 'end' },
              { header: t.stockDocs.by, cell: (row) => row.createdBy ?? '–', className: 'table__phone-hide' },
            ]}
          />
        </Section>
      )}
      <Sheet open={adding} onClose={() => setAdding(false)} title={t.stockDocs.add}>
        <StockDocumentForm onSaved={() => setAdding(false)} />
      </Sheet>
    </>
  );
}

function DirectionBadge({ document }: { document: Pick<StockDocument, 'direction' | 'voidedAt'> }) {
  const t = useT();
  if (document.voidedAt) return <Badge tone="neutral">{t.stockDocs.voided}</Badge>;
  return <Badge tone={document.direction === 'in' ? 'ok' : 'warn'}>{document.direction === 'in' ? t.stockDocs.in : t.stockDocs.out}</Badge>;
}

interface DraftLine {
  productId: number;
  quantity: string;
}

/** A new document: in or out, why, the day, and its products. Shows what it will do before saving. */
function StockDocumentForm({ onSaved }: { onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<StockDocumentDirection>('out');
  const [reason, setReason] = useState<StockDocumentReason>('own_use');
  const [day, setDay] = useState(today);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const shelf = useQuery({ queryKey: ['products', 'counter-shelf'], queryFn: counterApi.products, staleTime: 60_000 });
  const costs = useQuery({ queryKey: ['prices'], queryFn: pricesApi.list, staleTime: 60_000 });
  useWarnBeforeLeaving(lines.length > 0);

  const byId = useMemo(() => new Map((shelf.data ?? []).map((product) => [product.id, product])), [shelf.data]);
  const costOf = useMemo(() => new Map((costs.data ?? []).map((row) => [row.id, row.cost])), [costs.data]);
  const options = (shelf.data ?? [])
    .filter((product) => !lines.some((line) => line.productId === product.id))
    .map((product) => ({ value: String(product.id), label: product.name, hint: product.barcode ?? product.sku ?? undefined }));

  const problemOf = (line: DraftLine): string | null => {
    const product = byId.get(line.productId);
    const quantity = Number(line.quantity.replace(',', '.'));
    if (!product) return null;
    if (!(quantity > 0)) return t.stockDocs.quantityError;
    if (!allowsParts(product.unit) && !Number.isInteger(quantity)) return t.stockDocs.wholeError;
    if (direction === 'out' && quantity > product.stock.quantity) return t.stockDocs.moreThanStock(formatQuantity(product.stock.quantity, product.unit));
    return null;
  };
  const problems = lines.map(problemOf);
  let value = 0;
  let noCost = 0;
  for (const line of lines) {
    const cost = costOf.get(line.productId) ?? null;
    const quantity = Number(line.quantity.replace(',', '.'));
    if (cost === null) noCost += 1;
    else if (quantity > 0) value += Math.round(quantity * cost * 100) / 100;
  }
  const valid = lines.length > 0 && problems.every((problem) => problem === null) && day !== '' && day <= today();

  const save = useMutation({
    mutationFn: () =>
      stockDocumentsApi.create({
        direction,
        reason,
        day,
        note: note.trim() || null,
        lines: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity.replace(',', '.')) })),
      }),
    onSuccess: (document) => {
      queryClient.invalidateQueries({ queryKey: ['stock-documents'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      toast({ title: t.stockDocs.saved(document.number) });
      setLines([]);
      onSaved();
      navigate(`/stock-documents/${document.id}`);
    },
  });

  function choose(next: StockDocumentDirection) {
    setDirection(next);
    setReason(REASONS[next][0]!);
    save.reset();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (valid) save.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <div className="segmented" role="radiogroup" aria-label={t.stockDocs.direction}>
        {(['out', 'in'] as const).map((option) => (
          <button key={option} type="button" role="radio" aria-checked={direction === option} className="segmented__option" onClick={() => choose(option)}>
            {option === 'in' ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
            {option === 'in' ? t.stockDocs.bringIn : t.stockDocs.takeOut}
          </button>
        ))}
      </div>
      <div className="field-row">
        <Field label={t.stockDocs.reason} hint={direction === 'out' ? t.stockDocs.damageHint : undefined}>
          <select value={reason} onChange={(event) => setReason(event.target.value as StockDocumentReason)}>
            {REASONS[direction].map((option) => (
              <option key={option} value={option}>
                {t.stockDocs.reasons[option]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.stockDocs.day}>
          <DateField required max={today()} value={day} onChange={(next) => setDay(next)} />
        </Field>
      </div>
      <Combobox
        label={t.stockDocs.addProduct}
        placeholder={t.stockDocs.findProduct}
        value=""
        resetAfterPick
        options={options}
        onChange={(picked) => picked && setLines((now) => [...now, { productId: Number(picked), quantity: '1' }])}
      />
      {lines.length > 0 && (
        <ul className="stock-doc-lines">
          {lines.map((line, index) => {
            const product = byId.get(line.productId);
            const unit = (product?.unit ?? 'piece') as ProductUnit;
            return (
              <li key={line.productId} className="stock-doc-lines__row">
                <span className="stock-doc-lines__name">
                  {product?.name}
                  <span className="table__secondary">{t.stockDocs.onShelf(formatQuantity(product?.stock.quantity ?? 0, unit))}</span>
                </span>
                <Field label={t.stockDocs.quantityFor(product?.name ?? '')} narrow error={problems[index] ?? undefined}>
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
                <Button variant="ghost" icon={X} aria-label={t.stockDocs.removeLine(product?.name ?? '')} onClick={() => setLines((now) => now.filter((one) => one.productId !== line.productId))} />
              </li>
            );
          })}
        </ul>
      )}
      <Field label={t.stockDocs.note}>
        <input maxLength={500} placeholder={t.stockDocs.notePlaceholder} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {lines.length === 0 && <p className="field-hint">{t.stockDocs.needLine}</p>}
      {lines.length > 0 && (
        <p className="notice" aria-live="polite">
          {t.stockDocs.preview(direction, lines.length, formatMoney(value))}
          {noCost > 0 && ` ${t.stockDocs.previewNoCost(noCost)}`}
        </p>
      )}
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={!valid || save.isPending} loading={save.isPending}>
        {direction === 'in' ? t.stockDocs.saveIn : t.stockDocs.saveOut}
      </Button>
    </form>
  );
}

/** One document: its lines, the entry it wrote, and Void for those who change stock. */
export function StockDocumentPage() {
  const t = useT();
  const { id } = useParams();
  const { role } = useCurrentUser();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const document = useQuery({ queryKey: ['stock-documents', 'one', Number(id)], queryFn: () => stockDocumentsApi.get(Number(id)) });
  const voiding = useMutation({
    mutationFn: () => stockDocumentsApi.void(Number(id)),
    onSuccess: (updated) => {
      queryClient.setQueryData(['stock-documents', 'one', Number(id)], updated);
      queryClient.invalidateQueries({ queryKey: ['stock-documents'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      toast({ title: t.stockDocs.voidedToast(updated.number) });
      setConfirming(false);
    },
  });

  if (document.isPending) return <Loading />;
  if (document.isError) return <ErrorNotice error={document.error} onRetry={() => document.refetch()} />;
  const doc = document.data;
  const lines = doc.lines ?? [];

  return (
    <>
      <PageHeader
        title={doc.number}
        crumbs={[{ to: '/stock-documents', label: t.stockDocs.title }]}
        description={`${doc.direction === 'in' ? t.stockDocs.in : t.stockDocs.out} · ${t.stockDocs.reasons[doc.reason]} · ${formatDay(doc.day)}`}
        actions={<DirectionBadge document={doc} />}
      />
      <Card title={t.stockDocs.products}>
        <DataTable
          caption={t.stockDocs.linesCaption(doc.number)}
          rows={lines}
          rowKey={(row) => row.productId}
          columns={[
            { header: t.stockDocs.product, title: true, cell: (row) => <Link to={`/products/${row.productId}`}>{row.productName}</Link> },
            { header: t.stockDocs.quantity, cell: (row) => formatQuantity(row.quantity, row.unit as ProductUnit), align: 'end' },
            { header: t.stockDocs.costEach, cell: (row) => (row.unitCost === null ? t.stockDocs.noCost : formatMoney(row.unitCost)), align: 'end' },
            { header: t.stockDocs.value, cell: (row) => (row.value === null ? '–' : formatMoney(row.value)), align: 'end' },
          ]}
          totals={[t.common.total, '', '', formatMoney(doc.value)]}
        />
        {doc.note && <p className="field-hint">{doc.note}</p>}
        <p className="field-hint">
          {t.stockDocs.madeBy(doc.createdBy ?? '–', formatDateWith(new Date(doc.createdAt), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}
          {doc.voidedAt && ` ${t.stockDocs.voidedBy(doc.voidedBy ?? '–', formatDateWith(new Date(doc.voidedAt), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}`}
        </p>
        {canManage(role) && !doc.voidedAt && (
          <div className="form-actions">
            {confirming ? (
              <>
                <Button variant="danger" loading={voiding.isPending} disabled={voiding.isPending} onClick={() => voiding.mutate()}>
                  {t.stockDocs.confirmVoid}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  {t.common.cancel}
                </Button>
              </>
            ) : (
              <Button variant="danger-text" onClick={() => setConfirming(true)}>
                {t.stockDocs.void}
              </Button>
            )}
          </div>
        )}
        {confirming && <p className="field-hint">{t.stockDocs.voidHint(doc.direction)}</p>}
        {voiding.isError && (
          <p className="form-error" role="alert">
            {errorMessage(voiding.error)}
          </p>
        )}
      </Card>
      <EntriesPanel source="stock_doc" id={doc.id} />
    </>
  );
}

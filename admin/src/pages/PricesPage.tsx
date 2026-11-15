import { Calculator, DownloadSimple, FileXls, Tag, UploadSimple } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { Badge, Button, DataTable, EmptyState, Field, MenuButton, PageHeader, Sheet, type Column, useToast } from '../components/ui';
import { useLanguage, useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';
import { categoriesApi, exportsApi, pricesApi } from '../services/api';
import type { PlannedPriceChange, PriceChangeInput, PriceFilePlan, PriceRow } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { useWarnBeforeLeaving } from '../utils/useWarnBeforeLeaving';

const PAGE_SIZE = 50;
const SHOW = ['all', 'changed', 'noCost', 'belowCost'] as const;
type Show = (typeof SHOW)[number];
type Source = 'editor' | 'excel' | 'fromCost';

/** What has been typed for a product, as text, so a half-typed "1," stays as typed. Left out: unchanged. */
interface Draft {
  cost?: string;
  wholesale?: string;
  price?: string;
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;
/** "1,25" or "1.25" as a number; '' is null (no price); anything else is NaN. */
const parseAmount = (text: string): number | null => (text.trim() === '' ? null : Number(text.trim().replace(',', '.')));
/** What it adds on top of the cost, in percent (TREFIN's "Marzha"); null without a cost. */
const markupOf = (price: number | null, cost: number | null) => (price === null || cost === null || cost <= 0 ? null : Math.round(((price - cost) / cost) * 1000) / 10);
const amountText = (value: number | null) => (value === null ? '' : value.toFixed(2));

/** The prices a row shows now: typed ones over saved ones. */
function current(row: PriceRow, draft: Draft | undefined) {
  const pick = (typed: string | undefined, saved: number | null) => (typed === undefined ? saved : parseAmount(typed));
  return { cost: pick(draft?.cost, row.cost), wholesale: pick(draft?.wholesale, row.wholesalePrice), price: pick(draft?.price, row.price) };
}

/** The drafts as the API takes them; a draft that can't be read is left out (its box says why). */
function toChanges(drafts: Record<number, Draft>): PriceChangeInput[] {
  const changes: PriceChangeInput[] = [];
  for (const [id, draft] of Object.entries(drafts)) {
    const change: PriceChangeInput = { productId: Number(id) };
    let ok = true;
    const read = (text: string | undefined, nullable: boolean) => {
      if (text === undefined) return undefined;
      const value = parseAmount(text);
      if (value === null ? !nullable : !Number.isFinite(value) || value < 0) ok = false;
      return value === null ? null : roundMoney(value);
    };
    const cost = read(draft.cost, true);
    const wholesale = read(draft.wholesale, true);
    const price = read(draft.price, false);
    if (!ok) continue;
    if (cost !== undefined) change.costPrice = cost;
    if (wholesale !== undefined) change.wholesalePrice = wholesale;
    if (price !== undefined && price !== null) change.price = price;
    changes.push(change);
  }
  return changes;
}

/** Drafts from a plan the server made (from cost or from a file): each new price as text. */
function draftsFrom(changes: PlannedPriceChange[]): Record<number, Draft> {
  const drafts: Record<number, Draft> = {};
  for (const change of changes) {
    if (change.problems.includes('notFound')) continue;
    const draft: Draft = {};
    if (change.cost.to !== change.cost.from) draft.cost = amountText(change.cost.to);
    if (change.wholesalePrice.to !== change.wholesalePrice.from) draft.wholesale = amountText(change.wholesalePrice.to);
    if (change.price.to !== change.price.from) draft.price = amountText(change.price.to);
    drafts[change.productId] = draft;
  }
  return drafts;
}

function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Every product's cost, wholesale price and shelf price in one list, each
 * price with its mark-up. Prices typed here, worked out from cost or read
 * from an Excel file all wait as changes, checked as you go, until "Save".
 */
export function PricesPage() {
  const t = useT();
  const { language } = useLanguage();
  const toast = useToast();
  const queryClient = useQueryClient();
  const rows = useQuery({ queryKey: ['prices'], queryFn: pricesApi.list });
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [source, setSource] = useState<Source>('editor');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [page, setPage] = useState(1);
  const [fromCostOpen, setFromCostOpen] = useState(false);
  const [fileResult, setFileResult] = useState<PriceFilePlan | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const changes = useMemo(() => toChanges(drafts), [drafts]);
  // The server checks the changes a moment after typing stops.
  const [checked, setChecked] = useState(changes);
  useEffect(() => {
    const timer = window.setTimeout(() => setChecked(changes), 350);
    return () => window.clearTimeout(timer);
  }, [changes]);
  const plan = useQuery({
    queryKey: ['prices', 'plan', checked],
    queryFn: () => pricesApi.plan(checked),
    enabled: checked.length > 0,
  });
  const planned = useMemo(() => new Map((checked.length > 0 ? (plan.data?.changes ?? []) : []).map((change) => [change.productId, change])), [plan.data, checked]);
  const blocked = [...planned.values()].filter((change) => change.problems.length > 0).length;
  const toLook = [...planned.values()].filter((change) => change.warnings.length > 0).length;
  const unreadable = Object.keys(drafts).length - changes.length;
  useWarnBeforeLeaving(Object.keys(drafts).length > 0);

  const save = useMutation({
    mutationFn: () => pricesApi.save(changes, source),
    onSuccess: (result) => {
      setDrafts({});
      setSource('editor');
      setFileResult(null);
      toast({ title: t.prices.saved(result.changed) });
      for (const key of ['prices', 'products', 'counter', 'activity']) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  const readFile = useMutation({
    mutationFn: async (file: File) => pricesApi.readFile(file.name, await toBase64(file)),
    onSuccess: (result) => {
      setDrafts((now) => ({ ...now, ...draftsFrom(result.changes) }));
      setSource('excel');
      setFileResult(result);
      setShow('changed');
      setPage(1);
    },
  });

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) readFile.mutate(file);
  }

  function edit(row: PriceRow, field: keyof Draft, text: string) {
    setDrafts((now) => {
      const draft = { ...now[row.id], [field]: text };
      const saved = field === 'cost' ? row.cost : field === 'wholesale' ? row.wholesalePrice : row.price;
      // Typed back to what is saved: no change.
      if (parseAmount(text) === saved || (text.trim() === '' && saved === null)) delete draft[field];
      const next = { ...now };
      if (Object.keys(draft).length === 0) delete next[row.id];
      else next[row.id] = draft;
      return next;
    });
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (rows.data ?? []).filter((row) => {
      if (categoryId && row.categoryId !== Number(categoryId)) return false;
      if (query && !row.name.toLowerCase().includes(query) && row.barcode !== query.trim() && !row.otherBarcodes.includes(query.trim()) && row.sku?.toLowerCase() !== query) return false;
      const now = current(row, drafts[row.id]);
      if (show === 'changed') return drafts[row.id] !== undefined;
      if (show === 'noCost') return now.cost === null;
      if (show === 'belowCost') return now.cost !== null && ((now.price ?? 0) < now.cost || (now.wholesale !== null && now.wholesale < now.cost));
      return true;
    });
  }, [rows.data, categoryId, search, show, drafts]);
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const download = (kind: 'prices' | 'price-list', extra?: { level: 'shelf' | 'wholesale' }) =>
    exportsApi
      .download(kind, 'xlsx', undefined, kind === 'price-list' ? { ...extra, lang: language, ...(categoryId && { categoryId: Number(categoryId) }) } : undefined)
      .catch((error: unknown) => toast({ title: errorMessage(error), tone: 'danger' }));

  const count = Object.keys(drafts).length;
  return (
    <>
      <PageHeader
        title={t.nav.items.stock}
        actions={
          <>
            <MenuButton
              label={t.prices.excel}
              icon={FileXls}
              loading={readFile.isPending}
              items={[
                { label: t.prices.downloadFile, icon: DownloadSimple, onSelect: () => void download('prices') },
                { label: t.prices.uploadFile, icon: UploadSimple, onSelect: () => fileRef.current?.click() },
                { label: t.prices.listShelf, icon: Tag, onSelect: () => void download('price-list', { level: 'shelf' }) },
                { label: t.prices.listWholesale, icon: Tag, onSelect: () => void download('price-list', { level: 'wholesale' }) },
              ]}
            />
            <Button icon={Calculator} onClick={() => setFromCostOpen(true)}>
              {t.prices.fromCost}
            </Button>
          </>
        }
      />
      <input ref={fileRef} type="file" accept=".xlsx,.csv" className="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={handleFile} />

      {readFile.isError && <ErrorNotice error={readFile.error} />}
      {fileResult && <FileNotice result={fileResult} onClose={() => setFileResult(null)} />}
      {rows.isPending && <Loading />}
      {rows.isError && <ErrorNotice error={rows.error} onRetry={() => rows.refetch()} />}
      {rows.data && (
        <form
          className="prices-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (changes.length > 0 && blocked === 0) save.mutate();
          }}
        >
          <DataTable
            caption={t.prices.caption}
            columns={columns(t, drafts, planned, edit)}
            rows={pageRows}
            rowKey={(row) => row.id}
            rowClassName={(row) => (drafts[row.id] ? 'prices-row--changed' : row.isActive ? undefined : 'table__row--muted')}
            toolbar={
              <div className="toolbar">
                <SearchInput
                  value={search}
                  onChange={(value) => {
                    setSearch(value);
                    setPage(1);
                  }}
                  label={t.prices.search}
                />
                <select
                  aria-label={t.products.category}
                  value={categoryId}
                  onChange={(event) => {
                    setCategoryId(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{t.products.allCategories}</option>
                  {categories.data?.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <div className="chip-row" role="radiogroup" aria-label={t.prices.show}>
                  {SHOW.map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={show === option}
                      className="chip"
                      onClick={() => {
                        setShow(option);
                        setPage(1);
                      }}
                    >
                      {option === 'changed' && count > 0 ? t.prices.changedCount(count) : t.prices.filters[option]}
                    </button>
                  ))}
                </div>
              </div>
            }
            empty={
              <EmptyState title={show === 'changed' ? t.prices.noChanges : t.prices.noMatch}>
                {show === 'changed' ? t.prices.noChangesHint : t.prices.noMatchHint}
              </EmptyState>
            }
            footer={
              filtered.length > 0 && <Pagination meta={{ page, limit: PAGE_SIZE, total: filtered.length }} itemLabel={t.products.items} onPageChange={setPage} />
            }
          />
          {count > 0 && (
            <div className="form-actions prices-form__actions">
              <p className="prices-form__summary" aria-live="polite">
                {t.prices.summary(changes.length)}
                {blocked > 0 && <span className="prices-form__problem">{t.prices.blocked(blocked)}</span>}
                {unreadable > 0 && <span className="prices-form__problem">{t.prices.unreadableTyped(unreadable)}</span>}
                {toLook > 0 && <span className="prices-form__look">{t.prices.toLook(toLook)}</span>}
              </p>
              {save.isError && (
                <p className="form-error" role="alert">
                  {errorMessage(save.error)}
                </p>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setDrafts({});
                  setSource('editor');
                  setFileResult(null);
                }}
                disabled={save.isPending}
              >
                {t.prices.discard}
              </Button>
              <Button type="submit" variant="primary" loading={save.isPending} disabled={save.isPending || changes.length === 0 || blocked > 0 || plan.isFetching}>
                {t.prices.save(changes.length)}
              </Button>
            </div>
          )}
        </form>
      )}

      <FromCostSheet
        open={fromCostOpen}
        onClose={() => setFromCostOpen(false)}
        categoryId={categoryId}
        categories={categories.data ?? []}
        onPlanned={(result) => {
          setDrafts((now) => ({ ...now, ...draftsFrom(result.changes) }));
          setSource('fromCost');
          setShow('changed');
          setPage(1);
          setFromCostOpen(false);
          toast({ title: t.prices.fromCostReady(result.changes.length), detail: result.noCost > 0 ? t.prices.noCostLeft(result.noCost) : undefined, tone: 'info' });
        }}
      />
    </>
  );
}

function columns(
  t: Catalogue,
  drafts: Record<number, Draft>,
  planned: Map<number, PlannedPriceChange>,
  edit: (row: PriceRow, field: keyof Draft, text: string) => void,
): Column<PriceRow>[] {
  const box = (row: PriceRow, field: keyof Draft, saved: number | null, label: string) => {
    const typed = drafts[row.id]?.[field];
    const value = typed ?? amountText(saved);
    const bad = typed !== undefined && (field === 'price' ? !(Number(parseAmount(typed)) > 0) : parseAmount(typed) !== null && !(Number(parseAmount(typed)) >= 0));
    return (
      <input
        className={typed === undefined ? 'price-box' : 'price-box price-box--changed'}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        aria-invalid={bad || undefined}
        value={value}
        placeholder={field === 'price' ? undefined : '–'}
        onChange={(event) => edit(row, field, event.target.value)}
      />
    );
  };
  const markup = (row: PriceRow, field: 'wholesale' | 'price') => {
    const now = current(row, drafts[row.id]);
    return <MarkupBox cost={now.cost} price={field === 'price' ? now.price : now.wholesale} label={t.prices.markupFor(field === 'price' ? t.prices.shelf : t.prices.wholesale, row.name)} onPrice={(price) => edit(row, field, price)} />;
  };
  return [
    {
      header: t.products.product,
      title: true,
      cell: (row) => {
        const change = planned.get(row.id);
        return (
          <span className="product-cell__text">
            <span className="table__primary">{row.name}</span>
            <span className="table__secondary">{[row.barcode, row.categoryName].filter(Boolean).join(' · ')}</span>
            {change && (change.problems.length > 0 || change.warnings.length > 0) && (
              <span className="prices-row__notes">
                {change.problems.map((problem) => (
                  <Badge key={problem} tone="danger">
                    {problem === 'bulkAbove' ? t.prices.problems.bulkAbove(formatMoney(change.lowestBulkPrice ?? 0)) : t.prices.problems[problem]}
                  </Badge>
                ))}
                {change.warnings.map((warning) => (
                  <Badge key={warning} tone="warn">
                    {t.prices.warnings[warning]}
                  </Badge>
                ))}
              </span>
            )}
          </span>
        );
      },
    },
    { header: t.prices.cost, label: t.prices.cost, cell: (row) => box(row, 'cost', row.cost, t.prices.costFor(row.name)) },
    {
      header: t.prices.wholesale,
      label: t.prices.wholesale,
      cell: (row) => (
        <span className="price-pair">
          {box(row, 'wholesale', row.wholesalePrice, t.prices.priceFor(t.prices.wholesale, row.name))}
          {markup(row, 'wholesale')}
        </span>
      ),
    },
    {
      header: t.prices.shelf,
      label: t.prices.shelf,
      cell: (row) => (
        <span className="price-pair">
          {box(row, 'price', row.price, t.prices.priceFor(t.prices.shelf, row.name))}
          {markup(row, 'price')}
        </span>
      ),
    },
  ];
}

/**
 * The mark-up beside a price, editable both ways: type a price and it shows
 * the mark-up, type a mark-up and it sets the price (to the cent). While it
 * has focus it keeps what is typed, so "33" doesn't jump to "33.3".
 */
function MarkupBox({ cost, price, label, onPrice }: { cost: number | null; price: number | null; label: string; onPrice: (price: string) => void }) {
  const [typing, setTyping] = useState<string | null>(null);
  const shown = markupOf(price, cost);
  if (cost === null || cost <= 0) return <span className="price-markup price-markup--none" aria-hidden="true" />;
  return (
    <span className="price-markup">
      <input
        className="price-box price-box--markup"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        value={typing ?? (shown === null ? '' : String(shown))}
        onFocus={() => setTyping(shown === null ? '' : String(shown))}
        onBlur={() => setTyping(null)}
        onChange={(event) => {
          setTyping(event.target.value);
          const percent = parseAmount(event.target.value);
          if (percent !== null && Number.isFinite(percent) && percent > -100) onPrice((Math.round(cost * (1 + percent / 100) * 100) / 100).toFixed(2));
        }}
      />
      <span className="price-markup__unit" aria-hidden="true">
        %
      </span>
    </span>
  );
}

function FileNotice({ result, onClose }: { result: PriceFilePlan; onClose: () => void }) {
  const t = useT();
  const missed = [...result.notFound.map((row) => ({ ...row, why: t.prices.fileNotFound })), ...result.unreadable.map((row) => ({ ...row, why: t.prices.fileUnreadable }))];
  return (
    <div className="notice prices-file" role="status">
      <p>
        {t.prices.fileRead(result.changes.length, result.unchanged)}
        {missed.length > 0 && ` ${t.prices.fileMissed(missed.length)}`}
      </p>
      {missed.length > 0 && (
        <details>
          <summary>{t.prices.fileShowMissed}</summary>
          <ul className="prices-file__list">
            {missed.slice(0, 200).map((row) => (
              <li key={`${row.row}-${row.why}`}>{t.prices.fileRow(row.row, row.text, row.why)}</li>
            ))}
          </ul>
        </details>
      )}
      <Button variant="ghost" size="sm" onClick={onClose}>
        {t.common.close}
      </Button>
    </div>
  );
}

function FromCostSheet({
  open,
  onClose,
  categoryId,
  categories,
  onPlanned,
}: {
  open: boolean;
  onClose: () => void;
  categoryId: string;
  categories: Array<{ id: number; name: string }>;
  onPlanned: (result: { changes: PlannedPriceChange[]; noCost: number }) => void;
}) {
  const t = useT();
  const [level, setLevel] = useState<'shelf' | 'wholesale'>('shelf');
  const [which, setWhich] = useState(categoryId);
  const [markup, setMarkup] = useState('25');
  const [rounding, setRounding] = useState<'nice' | 'exact'>('nice');
  useEffect(() => {
    if (open) setWhich(categoryId);
  }, [open, categoryId]);
  const percent = parseAmount(markup);
  const valid = percent !== null && Number.isFinite(percent) && percent >= 0 && percent <= 1000;
  const example = valid ? (rounding === 'nice' ? nice(1 + percent / 100) : roundMoney(1 + percent / 100)) : null;
  const run = useMutation({
    mutationFn: () => pricesApi.fromCost({ level, markupPercent: percent!, rounding, ...(which && { categoryId: Number(which) }) }),
    onSuccess: onPlanned,
  });
  return (
    <Sheet open={open} onClose={onClose} title={t.prices.fromCostTitle} description={t.prices.fromCostHint} placement="center">
      <form
        className="sheet-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) run.mutate();
        }}
      >
        <Field label={t.prices.whichPrice}>
          <div className="segmented" role="radiogroup" aria-label={t.prices.whichPrice}>
            {(['shelf', 'wholesale'] as const).map((option) => (
              <button key={option} type="button" role="radio" aria-checked={level === option} className="segmented__option" onClick={() => setLevel(option)}>
                {option === 'shelf' ? t.prices.shelf : t.prices.wholesale}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t.prices.whichProducts}>
          <select value={which} onChange={(event) => setWhich(event.target.value)}>
            <option value="">{t.prices.allProducts}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.prices.markup} hint={example !== null ? t.prices.example(formatMoney(1), formatMoney(example)) : undefined} error={valid ? undefined : t.prices.markupError} narrow>
          <input type="text" inputMode="decimal" value={markup} onChange={(event) => setMarkup(event.target.value)} />
        </Field>
        <Field label={t.prices.rounding}>
          <div className="segmented" role="radiogroup" aria-label={t.prices.rounding}>
            {(['nice', 'exact'] as const).map((option) => (
              <button key={option} type="button" role="radio" aria-checked={rounding === option} className="segmented__option" onClick={() => setRounding(option)}>
                {option === 'nice' ? t.prices.roundNice : t.prices.roundExact}
              </button>
            ))}
          </div>
        </Field>
        {run.isError && (
          <p className="form-error" role="alert">
            {errorMessage(run.error)}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={run.isPending} disabled={!valid || run.isPending}>
            {t.prices.showNewPrices}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

/** The same "usual price" rounding as the server (5 cents under €10, 50 cents under €100, else whole euros), for the example. */
function nice(amount: number): number {
  const cents = Math.ceil(amount * 100 - 1e-6);
  const step = cents < 1_000 ? 5 : cents < 10_000 ? 50 : 100;
  return (Math.ceil((cents + 1) / step) * step - 1) / 100;
}

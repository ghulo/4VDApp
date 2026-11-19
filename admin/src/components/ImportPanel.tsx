import { ArrowCounterClockwise, CaretRight, Check, DownloadSimple, FileArrowUp, FolderOpen, Info, LockKey, Package, Warning as WarningIcon, X } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DragEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useT } from '../i18n/useT';
import {
  type Cell,
  type ImportChoices,
  type ImportKind,
  type ImportListItem,
  type ImportPreview,
  type ImportProblem,
  type ImportSheet,
  type ImportView,
  NothingToSend,
  TooBig,
  type PickedFile,
  type UndoKind,
  type UndoPlan,
  importsApi,
} from '../services/imports';
import { errorMessage } from '../utils/errors';
import { formatCount, formatDateTime, formatMoney } from '../utils/format';
import { Segmented } from './BillLines';
import { ErrorNotice, Loading } from './Feedback';
import { Badge, Button, ButtonLink, Card, DataTable, Section, Sheet, ShimmerText, StatGrid, StatTile, Steps, SuccessCheck, type Tone, useToast } from './ui';

/**
 * Settings → Import: drop what the old program gave you, see what 4VD found,
 * check everything that would come in, bring it in as one import, and undo it
 * (all or by kind). Nothing is saved before "Bring in". The batch in the URL
 * (?batch=) is the one on screen, so To do's "check your import" lands on it.
 */

type Texts = ReturnType<typeof useT>['imports'];

const PRODUCT_FIELDS = ['code', 'barcode', 'otherBarcodes', 'name', 'category', 'unit', 'price', 'priceNet', 'wholesale', 'cost', 'costNet', 'vat', 'stock', 'reorder', 'supplier'];
const PARTNER_FIELDS = ['code', 'name', 'nui', 'businessNo', 'fiscalNo', 'vatNo', 'phone', 'mobile', 'email', 'address', 'city', 'iban', 'contact', 'owed', 'creditLimit', 'discount'];
const fieldsOf = (kind: ImportKind) => (kind === 'products' ? PRODUCT_FIELDS : PARTNER_FIELDS);
const LIVE: ImportView['status'][] = ['reading', 'running'];

export function ImportPanel() {
  const [params, setParams] = useSearchParams();
  const activeId = Number(params.get('batch')) || null;

  function open(id: number | null) {
    const next = new URLSearchParams(params);
    if (id) next.set('batch', String(id));
    else next.delete('batch');
    setParams(next, { replace: true });
  }

  return (
    <div className="import">
      {activeId ? <ActiveImport key={activeId} id={activeId} onClose={() => open(null)} /> : <DropStep onRead={(view) => open(view.id)} />}
      <PastImports activeId={activeId} onOpen={open} />
    </div>
  );
}

/**
 * One step on screen. A new step slides in from the side the flow is going
 * (back comes from the left), so the way back is the way it came (DESIGN.md 12).
 */
function Stage({ step, back = false, children }: { step: string; back?: boolean; children: ReactNode }) {
  return (
    <div key={step} className={back ? 'import-step import-step--back' : 'import-step'}>
      {children}
    </div>
  );
}

/* ───────────── Step 1: drop files ───────────── */

/** Every file inside a dropped folder, by its path in the folder. */
async function filesOf(event: DragEvent): Promise<PickedFile[]> {
  const entries = [...event.dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => !!entry);
  if (entries.length === 0) return [...event.dataTransfer.files].map((file) => ({ name: file.name, file }));
  const out: PickedFile[] = [];
  async function walk(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      out.push({ name: entry.fullPath.replace(/^\//, ''), file });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries hands back at most 100 at a time: read until it hands back none.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child);
    }
  }
  for (const entry of entries) await walk(entry);
  return out;
}

function DropStep({ onRead }: { onRead: (view: ImportView) => void }) {
  const T = useT().imports;
  const queryClient = useQueryClient();
  const [over, setOver] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const send = useMutation({
    mutationFn: importsApi.create,
    onSuccess: (view) => {
      queryClient.setQueryData(['imports', view.id], view);
      void queryClient.invalidateQueries({ queryKey: ['imports', 'list'] });
      onRead(view);
    },
  });
  const template = useMutation({ mutationFn: importsApi.downloadTemplate });

  function pick(list: FileList | null) {
    if (!list || list.length === 0) return;
    send.mutate([...list].map((file) => ({ name: file.webkitRelativePath || file.name, file })));
  }

  async function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setOver(false);
    if (send.isPending) return;
    const files = await filesOf(event);
    if (files.length > 0) send.mutate(files);
  }

  const nothing = send.error instanceof NothingToSend ? send.error : null;
  return (
    <Stage step="drop">
      <Card>
        <Steps steps={T.steps} current={0} label={T.stepsLabel} />
        <div className="import__intro">
          <h2 className="import__title">{T.dropTitle}</h2>
          <p className="import__lead">{T.dropLead}</p>
        </div>
        <div
          className={['import-drop', over && 'import-drop--over', send.isPending && 'import-drop--busy'].filter(Boolean).join(' ')}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => void drop(event)}
          aria-busy={send.isPending}
        >
          <span className="import-drop__mark" aria-hidden="true">
            <FileArrowUp size={28} weight="duotone" />
          </span>
          <p className="import-drop__title">{send.isPending ? T.sending : T.dropHere}</p>
          <p className="import-drop__kinds" id={hintId}>
            {T.dropKinds}
          </p>
          <div className="import-drop__keys">
            <Button variant="primary" icon={FileArrowUp} loading={send.isPending} onClick={() => filesInput.current?.click()} aria-describedby={hintId}>
              {T.choose}
            </Button>
            <Button variant="secondary" icon={FolderOpen} disabled={send.isPending} onClick={() => folderInput.current?.click()}>
              {T.chooseFolder}
            </Button>
          </div>
          <input
            ref={filesInput}
            type="file"
            multiple
            hidden
            accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt,.zip"
            onChange={(event) => {
              pick(event.target.files);
              event.target.value = '';
            }}
          />
          <input
            ref={folderInput}
            type="file"
            hidden
            {...{ webkitdirectory: '' }}
            onChange={(event) => {
              pick(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
        {nothing ? (
          <div className="import-nothing" role="alert">
            <p className="import__subtitle">{T.foundNothing}</p>
            <HealthRows rows={nothing.leftOut.map((item) => ({ file: item.file, key: item.why, tone: 'info' as const }))} />
          </div>
        ) : send.error instanceof TooBig ? (
          <p className="notice notice--warn" role="alert">
            {T.tooBig(formatCount(Math.ceil(send.error.bytes / 1024 / 1024)))}
          </p>
        ) : (
          send.isError && <ErrorNotice error={send.error} />
        )}
        <div className="import__foot">
          <button type="button" className="text-button" onClick={() => template.mutate()} disabled={template.isPending}>
            <DownloadSimple size={14} weight="bold" aria-hidden="true" /> {T.template}
          </button>
          <span className="import__quiet">{T.private}</span>
        </div>
        {template.isError && <p className="form-error">{errorMessage(template.error)}</p>}
      </Card>
    </Stage>
  );
}

/* ───────────── The import on screen ───────────── */

function ActiveImport({ id, onClose }: { id: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  // "What 4VD found" first; "Check what comes in" opens the check; Back returns.
  const [checking, setChecking] = useState<{ on: boolean; back: boolean }>({ on: false, back: false });
  const view = useQuery({
    queryKey: ['imports', id],
    queryFn: () => importsApi.get(id),
    refetchInterval: (query) => (query.state.data && LIVE.includes(query.state.data.status) ? 800 : false),
  });
  const status = view.data?.status;
  // When a run or a read finishes, the list below catches up.
  useEffect(() => {
    if (status && !LIVE.includes(status)) void queryClient.invalidateQueries({ queryKey: ['imports', 'list'] });
  }, [status, queryClient]);

  if (view.isPending) return <Loading />;
  if (view.isError) return <ErrorNotice error={view.error} onRetry={() => view.refetch()} />;
  const data = view.data;
  if (data.status === 'reading') return <ReadingStep view={data} />;
  if (data.status === 'running') return <RunStep view={data} at={view.dataUpdatedAt} />;
  if (data.status === 'done' || data.status === 'partly_undone') return <DoneStep view={data} onMore={onClose} />;
  if (data.status === 'ready') {
    const usable = !!data.preview && data.preview.shape !== 'nothing';
    if (!usable && data.health.some((note) => note.key === 'password')) return <LockedStep view={data} onOther={onClose} />;
    if (checking.on && usable) return <CheckStep view={data} onBack={() => setChecking({ on: false, back: true })} />;
    return <FoundStep view={data} back={checking.back} onCheck={() => setChecking({ on: true, back: false })} onOther={onClose} />;
  }
  return <EndedStep view={data} onMore={onClose} />;
}

function ReadingStep({ view }: { view: ImportView }) {
  const T = useT().imports;
  const progress = view.progress;
  const sorting = progress?.phase === 'sorting' && progress.total > 0;
  return (
    <Stage step="reading">
      <Card>
        <Steps steps={T.steps} current={0} label={T.stepsLabel} />
        <div className="import-wait" role="status" aria-live="polite">
          <h2 className="import__title">
            <ShimmerText>{T.reading}</ShimmerText>
          </h2>
          <p className="import__lead">{sorting ? T.sorting(formatCount(progress.done), formatCount(progress.total)) : T.readingLead}</p>
          {sorting && <Meter done={progress.done} total={progress.total} label={T.reading} />}
          <p className="import__quiet">{T.takesSeconds}</p>
        </div>
      </Card>
    </Stage>
  );
}

function LockedStep({ view, onOther }: { view: ImportView; onOther: () => void }) {
  const T = useT().imports;
  const discard = useDiscard(view.id, onOther);
  return (
    <Stage step="locked">
      <Card>
        <Steps steps={T.steps} current={0} label={T.stepsLabel} />
        <div className="import-locked">
          <span className="import-locked__mark" aria-hidden="true">
            <LockKey size={28} weight="duotone" />
          </span>
          <h2 className="import__title">{T.lockedTitle}</h2>
          <p className="import__lead">{T.lockedLead}</p>
          <h3 className="import__subtitle">{T.lockedHow}</h3>
          <ol className="import-locked__steps">
            {T.lockedSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
        <HealthList view={view} />
        <div className="import__actions">
          <span className="import__quiet">{T.nothingSaved}</span>
          <Button variant="primary" loading={discard.isPending} onClick={() => discard.mutate()}>
            {T.otherFiles}
          </Button>
        </div>
      </Card>
    </Stage>
  );
}

function useDiscard(id: number, after: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => importsApi.discard(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['imports', 'list'] });
      queryClient.removeQueries({ queryKey: ['imports', id] });
      after();
    },
  });
}

type HealthTone = 'ok' | 'info' | 'warn' | 'danger';
interface HealthRow {
  file: string;
  /** A key of T.health, or the words themselves for a sheet line. */
  key?: string;
  title?: string;
  hint?: string;
  tone: HealthTone;
}

const TONE_MARK = { ok: Check, info: Info, warn: WarningIcon, danger: X } satisfies Record<HealthTone, unknown>;
const BAD_NOTES = new Set(['password', 'notReadable', 'oldExcel', 'zipTooBig']);

/** One line per thing 4VD noticed: a mark for how it went, what it saw, what to do about it. */
function HealthRows({ rows }: { rows: HealthRow[] }) {
  const T = useT().imports;
  if (rows.length === 0) return null;
  return (
    <ul className="import-health">
      {rows.map((row, index) => {
        const [title, hint] = row.key ? (T.health[row.key] ?? T.health.unknown!) : [row.title ?? '', row.hint ?? ''];
        const Mark = TONE_MARK[row.tone];
        return (
          <li key={`${row.file}-${index}`} className={`import-health__row import-health__row--${row.tone}`}>
            <span className="import-health__mark" aria-hidden="true">
              <Mark size={12} weight="bold" />
            </span>
            <span className="import-health__what">
              <strong>{title}</strong>
              {hint && <span className="import-health__hint">{hint}</span>}
            </span>
            <span className="import-health__file">{row.file}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The sheets 4VD will read, then each file note. */
function HealthList({ view }: { view: ImportView }) {
  const T = useT().imports;
  const sheets: HealthRow[] = (view.preview?.sheets ?? [])
    .filter((sheet) => sheet.kind !== 'skip')
    .map((sheet) => ({
      file: sheet.sheet ? `${sheet.file} · ${sheet.sheet}` : sheet.file,
      title: T.sheetOk(formatCount(sheet.rows), T.kindWords[sheet.kind]),
      hint: [sheet.headerRow > 0 && T.headerOn(sheet.headerRow + 1), sheet.remembered && T.remembered].filter(Boolean).join(' '),
      tone: 'ok',
    }));
  const notes: HealthRow[] = view.health.map((note) => ({
    file: note.file,
    key: note.key === 'leftOut' ? note.why : note.key,
    tone: BAD_NOTES.has(note.key) ? 'danger' : note.key === 'emptySheet' || note.key === 'leftOut' || note.key === 'skippedInZip' || note.key === 'notSpreadsheet' ? 'info' : 'warn',
  }));
  return <HealthRows rows={[...sheets, ...notes]} />;
}

function foundWords(T: Texts, preview: ImportPreview | null): [string, string] {
  if (!preview || preview.shape === 'nothing') return [T.foundNothing, T.foundNothingLead];
  if (preview.profile) return [T.foundExport(preview.profile.name), T.foundExportLead];
  if (preview.shape === 'priceList') return [T.foundPriceList, T.foundPriceListLead];
  if (preview.shape === 'partners') return [T.foundPartners, T.foundPartnersLead];
  return [T.foundProducts, T.foundProductsLead];
}

/** What 4VD found in the files, before any figures. */
function FoundStep({ view, back, onCheck, onOther }: { view: ImportView; back: boolean; onCheck: () => void; onOther: () => void }) {
  const T = useT().imports;
  const discard = useDiscard(view.id, onOther);
  const [found, lead] = foundWords(T, view.preview);
  const usable = !!view.preview && view.preview.shape !== 'nothing';
  return (
    <Stage step="found" back={back}>
      <Card>
        <Steps steps={T.steps} current={0} label={T.stepsLabel} />
        <div className="import__intro">
          <h2 className="import__title">{found}</h2>
          <p className="import__lead">{lead}</p>
        </div>
        {view.error && <p className="notice notice--error">{view.error}</p>}
        <HealthList view={view} />
        <div className="import__actions">
          <Button variant="ghost" loading={discard.isPending} onClick={() => discard.mutate()}>
            {T.otherFiles}
          </Button>
          <span className="import__quiet">{T.nothingSaved}</span>
          {usable && (
            <Button variant="primary" onClick={onCheck}>
              {T.toCheck}
            </Button>
          )}
        </div>
      </Card>
    </Stage>
  );
}

/* ───────────── Step 2: check ───────────── */

function rowsToBring(preview: ImportPreview) {
  return preview.counts.products.new + preview.counts.products.changed + preview.counts.suppliers.new + preview.counts.customers.new;
}

function sayParts(T: Texts, preview: ImportPreview): string {
  const { counts } = preview;
  const parts: string[] = [];
  if (counts.products.new) parts.push(T.sayProducts(formatCount(counts.products.new), counts.products.new === 1) + (preview.stockValue > 0 ? ` ${T.sayStock(formatMoney(preview.stockValue))}` : ''));
  if (counts.products.changed) parts.push(T.sayChanged(formatCount(counts.products.changed), counts.products.changed === 1));
  if (counts.suppliers.new) parts.push(T.saySuppliers(formatCount(counts.suppliers.new), counts.suppliers.new === 1));
  if (counts.customers.new) parts.push(T.sayCustomers(formatCount(counts.customers.new), counts.customers.new === 1));
  return joinWords(parts, T.and);
}

function joinWords(parts: string[], and: string): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} ${and} ${parts.at(-1)}`;
}

function CheckStep({ view, onBack }: { view: ImportView; onBack: () => void }) {
  const T = useT().imports;
  const queryClient = useQueryClient();
  const preview = view.preview!;
  // Choices made while one is still saving build on each other, not on the last answer.
  const latest = useRef<ImportChoices | null>(null);
  const choose = useMutation({
    mutationFn: (choices: ImportChoices) => importsApi.setChoices(view.id, choices),
    onSuccess: (next) => queryClient.setQueryData(['imports', view.id], next),
  });
  const run = useMutation({
    mutationFn: () => importsApi.run(view.id),
    onSuccess: (next) => queryClient.setQueryData(['imports', view.id], next),
  });
  const problems = useMutation({ mutationFn: () => importsApi.downloadProblems(view.id) });

  function update(patch: (base: ImportChoices) => ImportChoices) {
    const base = latest.current ?? view.choices;
    const next = { ...base, ...patch(base) };
    latest.current = next;
    choose.mutate(next);
  }

  const total = rowsToBring(preview);
  const words = sayParts(T, preview);
  const toConfirm = preview.sheets.filter((sheet) => view.choices.sheets?.[sheet.key] || (sheet.kind !== 'skip' && (!sheet.kindSure || sheet.guessed.length > 0)));

  return (
    <Stage step="check">
      <Card>
        <Steps steps={T.steps} current={1} label={T.stepsLabel} onStep={onBack} />
        <div className="import__intro">
          <h2 className="import__title">{T.toCheck}</h2>
          <p className="import-say">{words ? T.say(words) : T.sayNothing}</p>
        </div>
        {view.error && <p className="notice notice--error">{view.error}</p>}
        <Figures preview={preview} />
        {preview.warnings.map((warning) => (
          <Warning key={warning.key} warning={warning} onStock={(stock) => update(() => ({ stock }))} />
        ))}
        {toConfirm.length > 0 && (
          <section className="import-part" aria-labelledby={`confirm-${view.id}`}>
            <h3 className="import__subtitle" id={`confirm-${view.id}`}>
              {T.confirmTitle(toConfirm.length)}
            </h3>
            <p className="import__quiet">{T.confirmLead}</p>
            {toConfirm.map((sheet) => (
              <SheetConfirm
                key={sheet.key}
                sheet={sheet}
                onKind={(kind) => update((base) => ({ sheets: { ...base.sheets, [sheet.key]: { kind, mapping: {} } } }))}
                onColumn={(column, field) =>
                  update((base) => {
                    const own = base.sheets?.[sheet.key];
                    const mapping = { ...own?.mapping };
                    // The server lays this over what it read, so a field taken off its column is sent as -1.
                    const old = Object.entries(sheet.mapping).find(([, index]) => index === column)?.[0];
                    if (old) mapping[old] = -1;
                    if (field) mapping[field] = column;
                    return { sheets: { ...base.sheets, [sheet.key]: { kind: own?.kind ?? sheet.kind, mapping } } };
                  })
                }
              />
            ))}
          </section>
        )}
        {preview.changes.length > 0 && <Changes preview={preview} />}
        {preview.problems.length > 0 && (
          <section className="import-part" aria-labelledby={`problems-${view.id}`}>
            <h3 className="import__subtitle" id={`problems-${view.id}`}>
              {T.problemsTitle(preview.problems.length)}
            </h3>
            <p className="import__quiet">{T.problemsLead}</p>
            <div className="import-problems">
              {preview.problems.map((problem) => (
                <Problem
                  key={problem.key}
                  problem={problem}
                  onChoose={(value) => update((base) => ({ problems: { ...base.problems, [problem.key]: value } }))}
                  onFix={(rowKey, price) => update((base) => ({ fixes: { ...base.fixes, [rowKey]: { ...base.fixes?.[rowKey], price } } }))}
                />
              ))}
            </div>
            <div className="import-excel">
              <p>{T.excel}</p>
              <Button variant="secondary" size="sm" icon={DownloadSimple} loading={problems.isPending} onClick={() => problems.mutate()}>
                {T.downloadProblems}
              </Button>
            </div>
          </section>
        )}
        {(choose.isError || run.isError || problems.isError) && <ErrorNotice error={choose.error ?? run.error ?? problems.error} />}
        <div className="import__actions">
          <Button variant="ghost" disabled={run.isPending} onClick={onBack}>
            {T.back}
          </Button>
          <span className="import__quiet">{T.nothingSavedUntil}</span>
          <Button variant="primary" disabled={total === 0 || choose.isPending} loading={run.isPending} onClick={() => run.mutate()}>
            {T.bringIn(T.bringWhat(formatCount(total)))}
          </Button>
        </div>
      </Card>
    </Stage>
  );
}

function Figures({ preview }: { preview: ImportPreview }) {
  const T = useT().imports;
  const { counts, owed } = preview;
  return (
    <StatGrid>
      <StatTile label={T.figs.products} value={formatCount(counts.products.new)} hint={counts.barcodes ? T.figs.productsHint(formatCount(counts.barcodes)) : undefined} />
      {(counts.products.changed > 0 || counts.products.same > 0) && (
        <StatTile label={T.figs.changed} value={formatCount(counts.products.changed)} hint={counts.products.same ? T.figs.changedHint(formatCount(counts.products.same)) : undefined} />
      )}
      {counts.categories.total > 0 && (
        <StatTile label={T.figs.categories} value={formatCount(counts.categories.total)} hint={counts.categories.new ? T.figs.categoriesHint(formatCount(counts.categories.new)) : undefined} />
      )}
      {(counts.suppliers.new > 0 || owed.suppliers > 0) && (
        <StatTile label={T.figs.suppliers} value={formatCount(counts.suppliers.new)} hint={owed.suppliers ? T.figs.owedSuppliers(formatMoney(owed.suppliers)) : undefined} />
      )}
      {(counts.customers.new > 0 || owed.customers > 0) && (
        <StatTile label={T.figs.customers} value={formatCount(counts.customers.new)} hint={owed.customers ? T.figs.owedCustomers(formatMoney(owed.customers)) : undefined} />
      )}
      {preview.stockValue > 0 && <StatTile label={T.figs.stock} value={formatMoney(preview.stockValue)} hint={T.figs.stockHint} />}
    </StatGrid>
  );
}

function Warning({ warning, onStock }: { warning: ImportPreview['warnings'][number]; onStock: (stock: 'bring' | 'none') => void }) {
  const W = useT().imports.warnings;
  if (warning.key === 'booksStarted') {
    return (
      <div className="notice notice--info import-warning">
        <div>
          <strong>{W.booksStarted.title}</strong>
          <p>{W.booksStarted.body(Number(warning.facts.products ?? 0))}</p>
        </div>
      </div>
    );
  }
  if (warning.key === 'owedKeptInNote') {
    return (
      <div className="notice notice--info import-warning">
        <div>
          <strong>{W.owedKeptInNote.title}</strong>
          <p>{warning.facts.reason === 'posted' ? W.owedKeptInNote.posted : W.owedKeptInNote.noStart}</p>
        </div>
      </div>
    );
  }
  const facts = warning.facts;
  return (
    <div className="notice notice--warn import-warning">
      <div className="import-warning__body">
        <strong>{W.stockConcentrated.title}</strong>
        <p>{W.stockConcentrated.body({ top: Number(facts.top), percent: Number(facts.percent), total: formatMoney(Number(facts.total)) })}</p>
        {warning.rows && warning.rows.length > 0 && (
          <details className="import-warning__top">
            <summary>{W.topProducts}</summary>
            <ul>
              {warning.rows.map((row) => (
                <li key={row.name}>
                  <span>{row.name}</span>
                  <span className="import__figure">{formatMoney(row.value)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <Segmented
          label={W.stockChoice}
          value={warning.chosen ?? 'bring'}
          options={[
            { value: 'bring', label: W.stockConcentrated.bring },
            { value: 'none', label: W.stockConcentrated.none },
          ]}
          onChange={onStock}
          size="sm"
        />
      </div>
    </div>
  );
}

/** A sheet 4VD wasn't sure of: what it holds, and which column is which. */
function SheetConfirm({ sheet, onKind, onColumn }: { sheet: ImportSheet; onKind: (kind: ImportKind | 'skip') => void; onColumn: (column: number, field: string) => void }) {
  const T = useT().imports;
  const kindId = useId();
  const fieldAt = (column: number) => Object.entries(sheet.mapping).find(([, index]) => index === column)?.[0] ?? '';
  const kinds: Array<ImportKind | 'skip'> = ['products', 'suppliers', 'customers', 'skip'];

  return (
    <div className="import-sheet">
      <div className="import-sheet__head">
        <p className="import-sheet__name">
          {sheet.file}
          {sheet.sheet ? ` · ${sheet.sheet}` : ''}
        </p>
        <label className="import-sheet__kind" htmlFor={kindId}>
          {T.sheetIs}
          <select id={kindId} value={sheet.kind} onChange={(event) => onKind(event.target.value as ImportKind | 'skip')}>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {T.kindWords[kind]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {sheet.headerRow > 0 && <p className="import__quiet">{T.headerOn(sheet.headerRow + 1)}</p>}
      {sheet.kind !== 'skip' && (
        <ul className="import-columns">
          {sheet.headers.map((header, column) => {
            const field = fieldAt(column);
            const name = header || `#${column + 1}`;
            const unsure = field !== '' && sheet.guessed.includes(field);
            const examples = sheet.examples
              .map((row) => row[column])
              .filter((value): value is string | number => value !== null && value !== '')
              .slice(0, 3);
            return (
              <li key={`${header}-${column}`} className={unsure ? 'import-columns__row import-columns__row--unsure' : 'import-columns__row'}>
                <span className="import-columns__header">
                  {name}
                  {examples.length > 0 && <span className="import-columns__example">{T.example(examples.join(', '))}</span>}
                </span>
                <select aria-label={T.columnIs(name)} value={field} onChange={(event) => onColumn(column, event.target.value)}>
                  <option value="">{T.leaveOut}</option>
                  {fieldsOf(sheet.kind as ImportKind).map((option) => (
                    <option key={option} value={option}>
                      {T.fields[option] ?? option}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function shown(value: string | number | null, field: string): string {
  if (value === null || value === '') return '–';
  if (typeof value === 'number' && (field === 'price' || field === 'cost' || field === 'wholesale')) return formatMoney(value);
  if (typeof value === 'number' && field === 'vat') return `${value}%`;
  return String(value);
}

function Changes({ preview }: { preview: ImportPreview }) {
  const T = useT().imports;
  const total = preview.counts.products.changed;
  return (
    <Section title={T.changesTitle} description={preview.changes.length < total ? T.shown(preview.changes.length, formatCount(total)) : undefined}>
      <DataTable
        caption={T.changesTitle}
        density="compact"
        rows={preview.changes}
        rowKey={(row) => `${row.name}-${row.field}`}
        columns={[
          { header: T.product, cell: (row) => row.name, title: true },
          { header: T.what, cell: (row) => T.changeField[row.field] ?? row.field },
          { header: T.now, cell: (row) => <span className="import__was">{shown(row.from, row.field)}</span>, align: 'end' },
          { header: T.becomes, cell: (row) => <strong>{shown(row.to, row.field)}</strong>, align: 'end' },
        ]}
      />
    </Section>
  );
}

const STAMP: Record<ImportProblem['tone'], Tone> = { danger: 'danger', warn: 'warn', info: 'info', neutral: 'neutral' };

/** A number, or a figure written as text ("96%", "€1.20"): lined up on the right. */
const isFigure = (cell: Cell) => typeof cell === 'number' || (typeof cell === 'string' && /^[-+€\d.,\s%]+$/.test(cell) && /\d/.test(cell));

function cellText(cell: Cell): string {
  if (cell === null || cell === '') return '–';
  return typeof cell === 'number' ? (Number.isInteger(cell) ? String(cell) : cell.toFixed(2)) : cell;
}

/** A price typed over a wrong one; the row leaves the list once it is right. */
function PriceFix({ label, value, onFix }: { label: string; value: Cell; onFix: (price: number) => void }) {
  return (
    <input
      className="import-fix"
      type="number"
      inputMode="decimal"
      min="0"
      step="0.01"
      aria-label={label}
      defaultValue={typeof value === 'number' ? value : ''}
      onBlur={(event) => {
        const price = Number(event.target.value);
        if (event.target.value !== '' && Number.isFinite(price) && price >= 0 && price !== value) onFix(Math.round(price * 100) / 100);
      }}
    />
  );
}

function Problem({ problem, onChoose, onFix }: { problem: ImportProblem; onChoose: (value: string) => void; onFix: (rowKey: string, price: number) => void }) {
  const T = useT().imports;
  const words = T.problems[problem.key];
  if (!words) return null;
  const fixable = problem.key === 'costAbovePrice';
  return (
    <details className="import-problem">
      <summary className="import-problem__head">
        <Badge tone={STAMP[problem.tone]}>{T.stamp[problem.tone]}</Badge>
        <span className="import-problem__title">{words.title(formatCount(problem.count), problem.count === 1)}</span>
        <span className="import-problem__chosen">{T.choices[problem.chosen] ?? problem.chosen}</span>
        <CaretRight size={14} weight="bold" className="import-problem__caret" aria-hidden="true" />
      </summary>
      <div className="import-problem__body">
        <p>{words.body}</p>
        <Segmented
          label={T.whatToDo}
          value={problem.chosen}
          options={problem.choices.map((choice) => ({ value: choice, label: `${T.choices[choice] ?? choice}${choice === problem.usual ? ` ${T.usual}` : ''}` }))}
          onChange={onChoose}
          size="sm"
        />
        {problem.sample.length > 0 && (
          <div className="import-problem__frame">
            <table className="import-problem__rows">
              <thead>
                <tr>
                  {words.cols.map((col) => (
                    <th key={col} scope="col">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {problem.sample.map((row) => (
                  <tr key={row.rowKey}>
                    {words.cols.map((col, index) => (
                      <td key={col} className={isFigure(row.cells[index] ?? null) || (fixable && index === 1) ? 'import-problem__num' : undefined}>
                        {fixable && index === 1 ? (
                          <PriceFix label={`${col}: ${cellText(row.cells[0] ?? null)}`} value={row.cells[1] ?? null} onFix={(price) => onFix(row.rowKey, price)} />
                        ) : (
                          cellText(row.cells[index] ?? null)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {problem.sample.length < problem.count && <p className="import__quiet">{T.shown(problem.sample.length, formatCount(problem.count))}</p>}
      </div>
    </details>
  );
}

/* ───────────── Step 3: bring in ───────────── */

function Meter({ done, total, label }: { done: number; total: number; label: string }) {
  const share = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div className="import-meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <span className="import-meter__fill" style={{ transform: `scaleX(${share})` }} />
    </div>
  );
}

/** `at` is when this progress arrived; the time left comes from the pace since the step first showed. */
function RunStep({ view, at }: { view: ImportView; at: number }) {
  const T = useT().imports;
  const progress = view.progress;
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const [start] = useState(() => ({ at, done }));
  let left: string = T.starting;
  if (total > 0 && done >= total) left = T.finishing;
  else if (done > start.done && at > start.at) {
    const perRow = (at - start.at) / (done - start.done);
    left = T.secondsLeft(Math.ceil((perRow * (total - done)) / 1000));
  }
  return (
    <Stage step="run">
      <Card>
        <Steps steps={T.steps} current={2} label={T.stepsLabel} />
        <div className="import-wait" role="status" aria-live="polite">
          <h2 className="import__title">{T.runTitle}</h2>
          <p className="import__lead">{T.runLead}</p>
          <Meter done={done} total={total} label={T.runTitle} />
          <p className="import-run__figures">
            <span className="import__figure">{total > 0 ? T.rows(formatCount(done), formatCount(total)) : T.starting}</span>
            <span className="import__quiet">{left}</span>
          </p>
          <p className="import__quiet">{T.leave}</p>
        </div>
      </Card>
    </Stage>
  );
}

function summaryParts(T: Texts, summary: NonNullable<ImportView['summary']>): string {
  const parts: string[] = [];
  if (summary.products.created) parts.push(T.sayProducts(formatCount(summary.products.created), summary.products.created === 1) + (summary.stockValue > 0 ? ` ${T.sayStock(formatMoney(summary.stockValue))}` : ''));
  if (summary.products.changed) parts.push(T.sayChanged(formatCount(summary.products.changed), summary.products.changed === 1));
  if (summary.suppliers) parts.push(T.saySuppliers(formatCount(summary.suppliers), summary.suppliers === 1));
  if (summary.customers) parts.push(T.sayCustomers(formatCount(summary.customers), summary.customers === 1));
  const words = joinWords(parts, T.and);
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : T.sayNothing;
}

function DoneStep({ view, onMore }: { view: ImportView; onMore: () => void }) {
  const T = useT().imports;
  const queryClient = useQueryClient();
  const [undoing, setUndoing] = useState(false);
  const summary = view.summary;
  const checked = useMutation({
    mutationFn: () => importsApi.markChecked(view.id),
    onSuccess: () => {
      // Exact, so the random products just approved stay on screen.
      void queryClient.invalidateQueries({ queryKey: ['imports', view.id], exact: true });
      void queryClient.invalidateQueries({ queryKey: ['attention'] });
    },
  });
  return (
    <Stage step="done">
      <Card>
        <div className="import-done">
          <SuccessCheck size={40} className="import-done__check" />
          <h2 className="import__title">{view.status === 'partly_undone' ? T.partlyUndone : T.doneTitle}</h2>
          {summary && <p className="import__lead">{T.doneSay(summaryParts(T, summary))}</p>}
          <div className="import__keys">
            <ButtonLink to="/products" variant="primary" icon={Package}>
              {T.openProducts}
            </ButtonLink>
            {summary && summary.similar > 0 && (
              <ButtonLink to="/inventory/duplicates" variant="secondary">
                {T.openDuplicates(formatCount(summary.similar))}
              </ButtonLink>
            )}
          </div>
        </div>
        {summary && summary.products.created > 0 && <SpotCheck id={view.id} checked={!!summary.checked} marking={checked.isPending} onChecked={() => checked.mutate()} />}
        <div className="import__actions">
          <Button variant="ghost" icon={ArrowCounterClockwise} onClick={() => setUndoing(true)}>
            {T.undoThis}
          </Button>
          <span className="import__quiet">{T.undoStays}</span>
          <Button variant="secondary" onClick={onMore}>
            {T.importMore}
          </Button>
        </div>
        <UndoSheet id={view.id} open={undoing} onClose={() => setUndoing(false)} />
      </Card>
    </Stage>
  );
}

function SpotCheck({ id, checked, marking, onChecked }: { id: number; checked: boolean; marking: boolean; onChecked: () => void }) {
  const T = useT().imports;
  const spot = useQuery({ queryKey: ['imports', id, 'spot'], queryFn: () => importsApi.spotCheck(id), staleTime: Infinity });
  const same = (a: Cell, b: Cell) => a === b || (a !== null && b !== null && Math.abs(Number(a) - Number(b)) < 0.005);
  const mark = (a: Cell, b: Cell, value: string) => (
    <span className={same(a, b) ? 'import-spot import-spot--same' : 'import-spot import-spot--differs'}>
      {value}
      <span className="visually-hidden"> ({same(a, b) ? T.same : T.differs})</span>
    </span>
  );
  const money = (value: Cell) => (value === null || value === '' || Number.isNaN(Number(value)) ? '–' : formatMoney(Number(value)));
  return (
    <Section
      title={T.spotTitle}
      description={T.spotLead}
      actions={
        <>
          <Button variant="ghost" size="sm" loading={spot.isFetching} onClick={() => void spot.refetch()}>
            {T.spotOther}
          </Button>
          {checked ? (
            <Badge tone="ok">{T.checked}</Badge>
          ) : (
            <Button variant="secondary" size="sm" loading={marking} onClick={onChecked}>
              {T.markChecked}
            </Button>
          )}
        </>
      }
    >
      {spot.isError ? (
        <ErrorNotice error={spot.error} onRetry={() => spot.refetch()} />
      ) : spot.isPending ? (
        <Loading />
      ) : (
        <DataTable
          caption={T.spotTitle}
          density="compact"
          rows={spot.data}
          rowKey={(row) => row.name}
          columns={[
            { header: T.spotCols.product, cell: (row) => row.name, title: true },
            { header: T.spotCols.filePrice, cell: (row) => money(row.file.price ?? null), align: 'end' },
            { header: T.spotCols.price, cell: (row) => mark(row.file.price ?? null, row.now.price ?? null, money(row.now.price ?? null)), align: 'end' },
            { header: T.spotCols.fileStock, cell: (row) => cellText(row.file.stock ?? null), align: 'end' },
            { header: T.spotCols.stock, cell: (row) => cellText(row.now.stock ?? null), align: 'end' },
          ]}
        />
      )}
    </Section>
  );
}

/** Failed, undone or thrown away: say so and start again. */
function EndedStep({ view, onMore }: { view: ImportView; onMore: () => void }) {
  const T = useT().imports;
  return (
    <Stage step="ended">
      <Card>
        <div className="import__intro">
          <h2 className="import__title">{T.status[view.status]}</h2>
          {view.status === 'failed' && view.error && <p className="notice notice--error">{view.error}</p>}
          {view.status === 'undone' && <p className="import__lead">{T.undone}</p>}
        </div>
        <div className="import__actions">
          <Button variant="primary" onClick={onMore}>
            {view.status === 'failed' ? T.tryAgain : T.importMore}
          </Button>
        </div>
      </Card>
    </Stage>
  );
}

/* ───────────── Undo ───────────── */

function UndoSheet({ id, open, onClose }: { id: number; open: boolean; onClose: () => void }) {
  const T = useT().imports;
  const plan = useQuery({ queryKey: ['imports', id, 'undo'], queryFn: () => importsApi.undoPlan(id), enabled: open, staleTime: 0 });
  const blocked = (plan.data?.blockers.length ?? 0) > 0;
  return (
    <Sheet open={open} onClose={onClose} title={blocked ? T.undoTitleBlocked : T.undoTitle}>
      {open &&
        (plan.isPending ? (
          <Loading />
        ) : plan.isError ? (
          <ErrorNotice error={plan.error} onRetry={() => plan.refetch()} />
        ) : (
          <UndoForm id={id} plan={plan.data} onClose={onClose} />
        ))}
    </Sheet>
  );
}

function UndoForm({ id, plan, onClose }: { id: number; plan: UndoPlan; onClose: () => void }) {
  const T = useT().imports;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [off, setOff] = useState<UndoKind[]>([]);
  const undo = useMutation({
    mutationFn: (kinds: UndoKind[]) => importsApi.undo(id, kinds),
    onSuccess: (view) => {
      queryClient.setQueryData(['imports', id], view);
      void queryClient.invalidateQueries({ queryKey: ['imports', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: view.status === 'undone' ? T.undone : T.partlyUndone, tone: 'ok' });
      onClose();
    },
  });

  const kinds = plan.kinds.filter((kind) => kind.created + kind.updated > 0);
  const chosen = kinds.filter((kind) => !off.includes(kind.kind)).map((kind) => kind.kind);
  const blocked = plan.blockers.length > 0;
  const changedSince = kinds.flatMap((kind) => kind.changedSince.map((row) => row.name));

  if (kinds.length === 0) {
    return (
      <>
        <p>{T.undoNothing}</p>
        <div className="form-actions">
          <Button variant="secondary" onClick={onClose}>
            {T.keep}
          </Button>
        </div>
      </>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen.length > 0) undo.mutate(chosen);
      }}
    >
      <p className="import__lead">{blocked ? T.undoLeadBlocked : T.undoLead}</p>
      <fieldset className="import-undo">
        <legend className="visually-hidden">{T.undoTitle}</legend>
        {kinds.map((kind) => {
          const removed = kind.created - kind.kept;
          return (
            <label key={kind.kind} className="import-undo__kind">
              <input
                type="checkbox"
                checked={!off.includes(kind.kind)}
                onChange={(event) => setOff((now) => (event.target.checked ? now.filter((k) => k !== kind.kind) : [...now, kind.kind]))}
              />
              <span className="import-undo__words">
                <strong>{T.undoKinds[kind.kind]}</strong>
                <span className="import__quiet">
                  {[removed > 0 && T.undoRemoved(formatCount(removed)), kind.updated > 0 && T.undoRestored(formatCount(kind.updated)), kind.kept > 0 && T.undoKept(formatCount(kind.kept))]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {kind.editedSince > 0 && <span className="import__quiet">{T.undoEdited(formatCount(kind.editedSince))}</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
      {blocked && (
        <div className="import-used">
          <h3 className="import__subtitle">{T.usedTitle}</h3>
          <ul>
            {plan.blockers.map((blocker) => (
              <li key={`${blocker.kind}-${blocker.usedBy}`}>
                <strong>
                  {formatCount(blocker.count)} {T.usedBy[blocker.usedBy] ?? T.usedOther}
                </strong>
                <span className="import__quiet">
                  {blocker.names.slice(0, 5).join(', ')}
                  {blocker.count > 5 ? ' …' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {changedSince.length > 0 && <p className="notice notice--info">{T.changedSince(changedSince.slice(0, 5).join(', ') + (changedSince.length > 5 ? ' …' : ''))}</p>}
      {undo.isError && <ErrorNotice error={undo.error} />}
      <div className="form-actions">
        <Button variant="secondary" onClick={onClose}>
          {T.keep}
        </Button>
        <Button type="submit" variant="danger" disabled={chosen.length === 0} loading={undo.isPending}>
          {chosen.length === 0 ? T.undoNone : chosen.length < kinds.length ? T.undoSome(chosen.length, kinds.length) : T.undoDo}
        </Button>
      </div>
    </form>
  );
}

/* ───────────── Past imports ───────────── */

const STATUS_TONE: Record<ImportView['status'], Tone> = {
  reading: 'info',
  ready: 'warn',
  running: 'info',
  done: 'ok',
  failed: 'danger',
  undone: 'neutral',
  partly_undone: 'neutral',
  discarded: 'neutral',
};

function PastImports({ activeId, onOpen }: { activeId: number | null; onOpen: (id: number) => void }) {
  const T = useT().imports;
  const queryClient = useQueryClient();
  const [undoId, setUndoId] = useState<number | null>(null);
  const list = useQuery({ queryKey: ['imports', 'list'], queryFn: importsApi.list });
  const discard = useMutation({
    mutationFn: importsApi.discard,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['imports', 'list'] }),
  });
  if (list.isPending) return null;
  if (list.isError) return <ErrorNotice error={list.error} onRetry={() => list.refetch()} />;
  const rows = list.data.filter((row) => row.status !== 'discarded');
  if (rows.length === 0) return null;

  const what = (row: ImportListItem) => (row.summary ? summaryParts(T, row.summary) : row.fileNames.slice(0, 2).join(', ') + (row.fileNames.length > 2 ? ' …' : ''));
  return (
    <Section title={T.pastTitle}>
      <DataTable
        caption={T.pastTitle}
        rows={rows}
        rowKey={(row) => row.id}
        rowClassName={(row) => (row.id === activeId ? 'is-current' : undefined)}
        columns={[
          { header: T.pastCols.when, cell: (row) => formatDateTime(row.finishedAt ?? row.createdAt) },
          { header: T.pastCols.from, cell: (row) => row.summary?.from ?? T.fromFile },
          { header: T.pastCols.what, cell: what, title: true },
          { header: T.pastCols.state, cell: (row) => <Badge tone={STATUS_TONE[row.status]}>{T.status[row.status]}</Badge> },
          {
            header: <span className="visually-hidden">{T.open}</span>,
            label: T.open,
            align: 'end',
            cell: (row) => (
              <span className="import-past__keys">
                {row.id !== activeId && ['ready', 'reading', 'running', 'done', 'partly_undone'].includes(row.status) && (
                  <Button variant="ghost" size="sm" onClick={() => onOpen(row.id)}>
                    {T.open}
                  </Button>
                )}
                {(row.status === 'done' || row.status === 'partly_undone') && (
                  <Button variant="ghost" size="sm" icon={ArrowCounterClockwise} onClick={() => setUndoId(row.id)}>
                    {T.undo}
                  </Button>
                )}
                {(row.status === 'ready' || row.status === 'failed') && (
                  <Button variant="ghost" size="sm" loading={discard.isPending && discard.variables === row.id} onClick={() => discard.mutate(row.id)}>
                    {T.discard}
                  </Button>
                )}
              </span>
            ),
          },
        ]}
      />
      {undoId !== null && <UndoSheet id={undoId} open onClose={() => setUndoId(null)} />}
    </Section>
  );
}

import { CaretLeft, CaretRight, CheckCircle, FileCsv, FilePdf, FileXls, LockSimple, LockSimpleOpen, Receipt } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { canReopen } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading } from '../components/Feedback';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  Field,
  Inspector,
  InspectorLayout,
  MenuButton,
  PageHeader,
  Section,
  Sheet,
} from '../components/ui';
import type { Catalogue } from '../i18n/en';
import { useLanguage, useT } from '../i18n/useT';
import { type BookKind, vatApi } from '../services/api';
import type { Over500Row, VatCheck, VatItem, VatMonth, VatYearRow, WithholdingRow } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatDateTime, formatDateWith, formatHeadlineMoney, formatMoney } from '../utils/format';
import { printHtml } from '../utils/printPage';
import { addMonths, formatMonth, bookBoxes, bookItems, bookTotal, boxSum, CHARGED_ROWS, CLAIM_ROWS, itemLink, thisMonth, VAT_18, VAT_8, type VatRowDef } from '../utils/vat';

/** "2026-09" → "September 2026", in the reader's language. */
/** "2026-10-20" → "20 October", the day a return is due. */
const formatDueDay = (day: string) => formatDateWith(new Date(`${day}T12:00:00`), { day: 'numeric', month: 'long' });

/** The month a VAT page shows, kept in the address; last month by default, the one most likely to file. */
function useMonthParam() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('month');
  const month = raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : addMonths(thisMonth(), -1);
  const setMonth = (next: string) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        updated.set('month', next);
        return updated;
      },
      { replace: true },
    );
  return [month, setMonth] as const;
}

/** Back a month, the month as a list, forward a month (up to this month). */
function MonthPicker({ month, onChange, first }: { month: string; onChange: (month: string) => void; first: string | null }) {
  const t = useT();
  const last = thisMonth();
  // Three years back, or from the first month of the books if that is earlier.
  const start = first && first < addMonths(last, -36) ? first : addMonths(last, -36);
  const months = useMemo(() => {
    const list: string[] = [];
    for (let candidate = last; candidate >= start; candidate = addMonths(candidate, -1)) list.push(candidate);
    if (!list.includes(month)) list.push(month);
    return list;
  }, [last, start, month]);
  return (
    <div className="month-picker" role="group" aria-label={t.vat.month}>
      <Button size="sm" variant="ghost" icon={CaretLeft} aria-label={t.vat.previous} title={t.vat.previous} onClick={() => onChange(addMonths(month, -1))} />
      <label className="month-picker__field">
        <span className="visually-hidden">{t.vat.month}</span>
        <select value={month} onChange={(event) => onChange(event.target.value)}>
          {months.map((option) => (
            <option key={option} value={option}>
              {formatMonth(option)}
            </option>
          ))}
        </select>
      </label>
      <Button
        size="sm"
        variant="ghost"
        icon={CaretRight}
        aria-label={t.vat.next}
        title={t.vat.next}
        disabled={month >= last}
        onClick={() => onChange(addMonths(month, 1))}
      />
    </div>
  );
}

function useVatMonth(month: string) {
  return useQuery({ queryKey: ['vat', 'month', month], queryFn: () => vatApi.month(month), placeholderData: keepPreviousData });
}

/** Filed, open, or not over yet: the month's stamp. */
function MonthStamp({ data }: { data: VatMonth }) {
  const t = useT();
  if (data.status === 'filed')
    return (
      <Badge tone="ok">
        <LockSimple size={12} aria-hidden="true" /> {t.vat.stamp.filed}
      </Badge>
    );
  return <Badge tone={data.canFile ? 'warn' : 'neutral'}>{data.canFile ? t.vat.stamp.open : t.vat.stamp.future}</Badge>;
}

/* ---------- The VAT month ---------- */

type OpenRow = { part: 'charged' | 'claim'; row: VatRowDef } | null;

/** One month's VAT return: what you charged, what you can claim back, the result, the checks, and filing. */
export function VatPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const [month, setMonth] = useMonthParam();
  const vat = useVatMonth(month);
  const [showAll, setShowAll] = useState(false);
  const [openRow, setOpenRow] = useState<OpenRow>(null);
  const [shownRow, setShownRow] = useState<OpenRow>(null);
  const [filing, setFiling] = useState(false);
  const [reopening, setReopening] = useState(false);
  const data = vat.data;

  const open = (part: 'charged' | 'claim', row: VatRowDef) => {
    setOpenRow({ part, row });
    setShownRow({ part, row });
  };
  const rowLabel = (shown: NonNullable<OpenRow>) => rowWords(t, shown.part, shown.row.key).label;

  return (
    <>
      <PageHeader
        wide
        title={t.nav.tabs.vat}
        description={t.vat.description}
        meta={data && data.month === month && <MonthStamp data={data} />}
        actions={
          data &&
          data.month === month &&
          (data.status === 'open' ? (
            data.canFile && (
              <Button variant="primary" icon={LockSimple} onClick={() => setFiling(true)}>
                {t.vat.markFiled}
              </Button>
            )
          ) : (
            canReopen(role) && (
              <Button icon={LockSimpleOpen} onClick={() => setReopening(true)}>
                {t.vat.reopen}
              </Button>
            )
          ))
        }
      />
      <div className="toolbar">
        <MonthPicker month={month} onChange={setMonth} first={data?.firstMonth ?? null} />
        <label className="toggle" title={t.vat.showAllHint}>
          <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
          {t.vat.showAll}
        </label>
      </div>
      {vat.isPending && <Loading />}
      {vat.isError && <ErrorNotice error={vat.error} onRetry={() => vat.refetch()} />}
      {data && (
        <InspectorLayout open={openRow !== null}>
          <div className="inspector-layout__list vat-month" aria-busy={vat.isFetching}>
            <Outcome data={data} />
            {data.status === 'open' && data.canFile && <Checks checks={data.checks} />}
            <BoxPart
              title={t.vat.charged.title}
              description={t.vat.charged.description}
              part="charged"
              rows={CHARGED_ROWS}
              data={data}
              showAll={showAll}
              total={{ label: t.vat.totalCharged, box: 30 }}
              openKey={openRow?.part === 'charged' ? openRow.row.key : null}
              onOpen={open}
            />
            <BoxPart
              title={t.vat.claim.title}
              description={t.vat.claim.description}
              part="claim"
              rows={CLAIM_ROWS}
              data={data}
              showAll={showAll}
              total={{ label: t.vat.totalClaim, box: 67 }}
              openKey={openRow?.part === 'claim' ? openRow.row.key : null}
              onOpen={open}
            />
            <ResultPart data={data} />
            <Over500 rows={data.over500} />
            <Withholding month={month} />
            <VatYear year={Number(month.slice(0, 4))} month={month} onPick={setMonth} />
          </div>
          <Inspector open={openRow !== null} onClose={() => setOpenRow(null)} title={shownRow ? rowLabel(shownRow) : t.nav.tabs.vat}>
            {shownRow && <BoxDocuments items={data.items} row={shownRow.row} />}
          </Inspector>
        </InspectorLayout>
      )}
      {data && (
        <>
          <Sheet open={filing} onClose={() => setFiling(false)} title={t.vat.fileTitle(formatMonth(month))}>
            <FileForm data={data} onDone={() => setFiling(false)} />
          </Sheet>
          <Sheet open={reopening} onClose={() => setReopening(false)} title={t.vat.reopenTitle(formatMonth(month))}>
            <ReopenForm month={month} onDone={() => setReopening(false)} />
          </Sheet>
        </>
      )}
    </>
  );
}

const rowWords = (t: Catalogue, part: 'charged' | 'claim', key: string) =>
  (t.vat.rows[part] as Record<string, { label: string; hint: string }>)[key] ?? { label: key, hint: '' };

/** The result in one sentence: pay by the 20th, or carry the credit on. */
function Outcome({ data }: { data: VatMonth }) {
  const t = useT();
  const sentence =
    data.outcome === 'pay'
      ? t.vat.outcome.pay(formatHeadlineMoney(data.boxes[72]!), formatDueDay(data.dueOn))
      : data.outcome === 'carry'
        ? t.vat.outcome.carry(formatHeadlineMoney(data.boxes[71]!))
        : t.vat.outcome.nothing;
  const hint = data.outcome === 'pay' ? t.vat.outcome.payHint : data.outcome === 'carry' ? t.vat.outcome.carryHint : t.vat.outcome.nothingHint;
  return (
    <Card className={data.status === 'filed' ? 'vat-outcome vat-outcome--filed' : 'vat-outcome'}>
      <p className="vat-outcome__month">{formatMonth(data.month)}</p>
      <p className="vat-outcome__sentence">{sentence}</p>
      <p className="vat-outcome__hint">{hint}</p>
      {data.status === 'filed' ? (
        <p className="vat-outcome__note">
          <LockSimple size={14} aria-hidden="true" /> {data.filedBy && data.filedAt ? `${t.vat.filedBy(data.filedBy, formatDateTime(data.filedAt))}. ` : ''}
          {t.vat.filedNote}
        </p>
      ) : (
        !data.canFile && <p className="vat-outcome__note">{t.vat.notOver}</p>
      )}
    </Card>
  );
}

/** What to look at before filing, each with the page that fixes it. */
function Checks({ checks }: { checks: VatCheck[] }) {
  const t = useT();
  return (
    <Section title={t.vat.checks.title} description={t.vat.checks.description}>
      {checks.length === 0 ? (
        <p className="vat-checks__none">
          <CheckCircle size={16} aria-hidden="true" /> {t.vat.checks.none}
        </p>
      ) : (
        <ul className="vat-checks">
          {checks.map((check, index) => (
            <li key={`${check.kind}:${index}`} className="notice notice--warn">
              <span>{checkText(t, check)}</span>
              <ButtonLink size="sm" to={check.to}>
                {t.vat.checks.fix}
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function checkText(t: Catalogue, check: VatCheck): string {
  const f = check.facts;
  const text = (value: string | number | null | undefined) => (value === null || value === undefined ? '–' : String(value));
  const eur = (value: string | number | null | undefined) => formatMoney(Number(value ?? 0));
  switch (check.kind) {
    case 'previous_open':
      return t.vat.checks.previous_open({ month: formatMonth(text(f.month)) });
    case 'no_nui':
      return t.vat.checks.no_nui({ supplier: text(f.supplier), number: text(f.number), vat: eur(f.vat) });
    case 'vat_mismatch':
      return t.vat.checks.vat_mismatch({
        supplier: text(f.supplier),
        number: text(f.number),
        rate: `${text(f.rate)}%`,
        vat: eur(f.vat),
        expected: f.expected === null || f.expected === undefined ? null : eur(f.expected),
      });
    case 'cash_over_limit':
      return t.vat.checks.cash_over_limit({ supplier: text(f.supplier), number: text(f.number), total: eur(f.total), cash: eur(f.cash) });
    case 'order_without_bill':
      return t.vat.checks.order_without_bill({ supplier: text(f.supplier), day: formatDate(`${text(f.received)}T12:00:00`) });
    case 'books_differ':
      return t.vat.checks.books_differ({ books: eur(f.books), vat: eur(f.vat) });
  }
}

/** A box number set small beside its figure, as on the form. */
const BoxNumber = ({ box }: { box: number }) => {
  const t = useT();
  return (
    <span className="vat-box" title={t.vat.boxLabel(box)}>
      <span className="visually-hidden">{t.vat.boxLabel(box)}: </span>
      {box}
    </span>
  );
};

const Figure = ({ box, amount }: { box: number; amount: number }) => (
  <span className="vat-figure">
    <BoxNumber box={box} />
    <span className={amount === 0 ? 'vat-figure__amount vat-figure__amount--zero' : 'vat-figure__amount'}>{formatMoney(amount)}</span>
  </span>
);

/** Boxes 9-30 or 31-67: one row per line of the form, each opening the documents behind it. */
function BoxPart({
  title,
  description,
  part,
  rows,
  data,
  showAll,
  total,
  openKey,
  onOpen,
}: {
  title: string;
  description: string;
  part: 'charged' | 'claim';
  rows: readonly VatRowDef[];
  data: VatMonth;
  showAll: boolean;
  total: { label: string; box: number };
  openKey: string | null;
  onOpen: (part: 'charged' | 'claim', row: VatRowDef) => void;
}) {
  const t = useT();
  const shown = rows.filter((row) => showAll || data.boxes[row.base] !== 0 || (row.vat !== undefined && data.boxes[row.vat] !== 0));
  return (
    <Section title={title} description={description}>
      <DataTable<VatRowDef>
        caption={title}
        rows={shown}
        rowKey={(row) => row.key}
        density="compact"
        onRowClick={(row) => onOpen(part, row)}
        rowClassName={(row) => (row.key === openKey ? 'table__row--selected' : undefined)}
        empty={<EmptyState icon={Receipt} title={t.vat.documents.none} />}
        columns={[
          {
            header: t.vat.what,
            title: true,
            className: 'vat-what',
            cell: (row) => {
              const words = rowWords(t, part, row.key);
              return (
                <>
                  <button type="button" className="table__primary-link vat-row-button" aria-label={t.vat.openRow(words.label)} onClick={() => onOpen(part, row)}>
                    {words.label}
                  </button>
                  <span className="table__secondary">{words.hint}</span>
                </>
              );
            },
          },
          { header: t.vat.base, align: 'end', cell: (row) => <Figure box={row.base} amount={data.boxes[row.base] ?? 0} /> },
          { header: t.vat.vatColumn, align: 'end', cell: (row) => (row.vat === undefined ? '–' : <Figure box={row.vat} amount={data.boxes[row.vat] ?? 0} />) },
        ]}
        totals={[total.label, '', <Figure key="total" box={total.box} amount={data.boxes[total.box] ?? 0} />]}
      />
    </Section>
  );
}

/** Boxes 68-72, with the credit carried in (first month only) and the refund asked for typed here. */
function ResultPart({ data }: { data: VatMonth }) {
  const t = useT();
  const rows = [68, 69, 70, 71, 72] as const;
  const editable = data.status === 'open';
  const typesCarried = data.firstMonth === null || data.month <= data.firstMonth;
  return (
    <Section title={t.vat.result.title} description={t.vat.result.description}>
      <DataTable<(typeof rows)[number]>
        caption={t.vat.result.title}
        rows={[...rows]}
        rowKey={(box) => box}
        density="compact"
        rowClassName={(box) => (box === 72 || box === 71 ? 'vat-result-row' : undefined)}
        columns={[
          {
            header: t.vat.what,
            title: true,
            className: 'vat-what',
            cell: (box) => (
              <>
                <span className="vat-result__label">{t.vat.results[box].label}</span>
                <span className="table__secondary">{box === 68 ? t.vat.carriedFrom[data.carriedFrom] : t.vat.results[box].hint}</span>
              </>
            ),
          },
          { header: t.vat.base, align: 'end', cell: (box) => <Figure box={box} amount={data.boxes[box] ?? 0} /> },
        ]}
      />
      {editable && <TypedFigures key={`${data.month}:${data.refundAsked}:${data.boxes[68]}`} data={data} typesCarried={typesCarried} />}
    </Section>
  );
}

function TypedFigures({ data, typesCarried }: { data: VatMonth; typesCarried: boolean }) {
  const t = useT();
  const client = useQueryClient();
  const [refund, setRefund] = useState(data.refundAsked ? String(data.refundAsked) : '');
  const [carried, setCarried] = useState(data.carriedFrom === 'typed' ? String(data.boxes[68]) : '');
  const save = useMutation({
    mutationFn: () =>
      vatApi.saveTyped(data.month, {
        refund: refund === '' ? 0 : Number(refund),
        ...(typesCarried && { carriedIn: carried === '' ? null : Number(carried) }),
      }),
    onSuccess: (saved) => {
      client.setQueryData(['vat', 'month', data.month], saved);
      void client.invalidateQueries({ queryKey: ['vat'] });
    },
  });
  const credit = data.boxes[69] ?? 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <form className="vat-typed" onSubmit={submit}>
      {typesCarried && (
        <Field label={<><BoxNumber box={68} /> {t.vat.carriedIn}</>} hint={t.vat.carriedFrom.none} narrow>
          <input type="number" inputMode="decimal" min={0} step={0.01} autoComplete="off" value={carried} onChange={(event) => setCarried(event.target.value)} />
        </Field>
      )}
      <Field label={<><BoxNumber box={70} /> {t.vat.refund}</>} hint={t.vat.results[70].hint} narrow>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={credit > 0 ? credit : undefined}
          step={0.01}
          autoComplete="off"
          disabled={credit <= 0 && !typesCarried}
          value={refund}
          onChange={(event) => setRefund(event.target.value)}
        />
      </Field>
      <div className="vat-typed__actions">
        <Button type="submit" loading={save.isPending} disabled={credit <= 0 && !typesCarried}>
          {t.vat.save}
        </Button>
        {save.isSuccess && !save.isPending && (
          <span className="field-hint" role="status">
            {t.vat.saved}
          </span>
        )}
        {save.isError && (
          <p className="form-error" role="alert">
            {errorMessage(save.error)}
          </p>
        )}
      </div>
    </form>
  );
}

/** The documents behind a line of the form, with what each puts in it. */
function BoxDocuments({ items, row }: { items: VatItem[]; row: VatRowDef }) {
  const t = useT();
  const boxes = [row.base, ...(row.vat ? [row.vat] : [])];
  const behind = items.filter((item) => boxes.some((box) => (item.boxes[box] ?? 0) !== 0));
  if (behind.length === 0) return <p className="field-hint">{t.vat.documents.none}</p>;
  return (
    <div className="vat-documents">
      <p className="field-hint">{t.vat.documents.intro(behind.length)}</p>
      <ul className="vat-documents__list">
        {behind.map((item) => {
          const link = itemLink(item);
          const name = itemName(t, item);
          return (
            <li key={`${item.kind}:${item.ref}`} className="vat-documents__item">
              <div className="vat-documents__head">
                {link ? (
                  <Link className="table__primary-link" to={link}>
                    {name}
                  </Link>
                ) : (
                  <span className="vat-documents__name">{name}</span>
                )}
                <span className="vat-documents__date">{formatDate(`${item.date}T12:00:00`)}</span>
              </div>
              {item.party && item.kind !== 'till_day' && <span className="table__secondary">{[item.party, item.nui].filter(Boolean).join(' · ')}</span>}
              {item.lateFrom && <span className="vat-documents__late">{t.vat.documents.late(formatMonth(item.lateFrom))}</span>}
              <span className="vat-documents__figures">
                {boxes.map((box) => (
                  <Figure key={box} box={box} amount={item.boxes[box] ?? 0} />
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function itemName(t: Catalogue, item: VatItem): string {
  const d = t.vat.documents;
  if (item.kind === 'till_day') return d.tillDay(item.count ?? 0);
  const kind = item.kind === 'invoice' ? d.invoice : item.kind === 'return' ? d.return : item.kind === 'credit' ? d.credit : d.bill;
  return `${kind} ${item.number ?? d.noNumber}`;
}

/** Final confirmation before the month locks. */
function FileForm({ data, onDone }: { data: VatMonth; onDone: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const file = useMutation({
    mutationFn: () => vatApi.file(data.month),
    onSuccess: (filed) => {
      client.setQueryData(['vat', 'month', data.month], filed);
      void client.invalidateQueries({ queryKey: ['vat'] });
      void client.invalidateQueries({ queryKey: ['attention'] });
      onDone();
    },
  });
  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        file.mutate();
      }}
    >
      <p>{t.vat.fileBody}</p>
      {data.checks.length > 0 && <p className="notice notice--warn">{t.vat.fileChecks(data.checks.length)}</p>}
      {file.isError && (
        <p className="form-error" role="alert">
          {errorMessage(file.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
        <Button type="submit" variant="primary" icon={LockSimple} loading={file.isPending}>
          {t.vat.fileConfirm}
        </Button>
      </div>
    </form>
  );
}

/** Reopening a filed month asks why; the reason goes to Activity. */
function ReopenForm({ month, onDone }: { month: string; onDone: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const short = reason.trim().length < 3;
  const reopen = useMutation({
    mutationFn: () => vatApi.reopen(month, reason.trim()),
    onSuccess: (opened) => {
      client.setQueryData(['vat', 'month', month], opened);
      void client.invalidateQueries({ queryKey: ['vat'] });
      void client.invalidateQueries({ queryKey: ['attention'] });
      onDone();
    },
  });
  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!short) reopen.mutate();
      }}
    >
      <p>{t.vat.reopenBody}</p>
      <Field label={t.vat.reason} hint={t.vat.reasonHint} error={tried && short ? t.vat.reasonShort : undefined}>
        <textarea required minLength={3} maxLength={500} rows={3} aria-invalid={tried && short} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {reopen.isError && (
        <p className="form-error" role="alert">
          {errorMessage(reopen.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
        <Button type="submit" variant="primary" icon={LockSimpleOpen} loading={reopen.isPending}>
          {t.vat.reopenConfirm}
        </Button>
      </div>
    </form>
  );
}

/** Bills over €500, with how they were paid (one paid in cash is flagged in the checks). */
function Over500({ rows }: { rows: Over500Row[] }) {
  const t = useT();
  const w = t.vat.over500;
  return (
    <Section title={w.title} description={w.description}>
      <DataTable<Over500Row>
        caption={w.title}
        rows={rows}
        rowKey={(row) => row.billId}
        density="compact"
        empty={<EmptyState icon={Receipt} title={w.empty} />}
        rowClassName={(row) => (row.cash > 0 ? 'vat-row--flag' : undefined)}
        columns={[
          { header: w.date, className: 'books-date', cell: (row) => formatDate(`${row.date}T12:00:00`) },
          {
            header: w.supplier,
            title: true,
            cell: (row) => (
              <Link className="table__primary-link" to={`/bills/${row.billId}`}>
                {row.supplier ?? '–'}
              </Link>
            ),
          },
          { header: w.nui, className: 'table__phone-hide', cell: (row) => row.nui ?? '–' },
          { header: w.number, cell: (row) => row.number ?? '–' },
          { header: w.total, align: 'end', cell: (row) => formatMoney(row.total) },
          { header: w.bank, align: 'end', cell: (row) => (row.bank ? formatMoney(row.bank) : '–') },
          { header: w.cash, align: 'end', cell: (row) => (row.cash ? <strong className="vat-cash">{formatMoney(row.cash)}</strong> : '–') },
          { header: w.unpaid, align: 'end', cell: (row) => (row.unpaid ? formatMoney(row.unpaid) : '–') },
        ]}
        totals={
          rows.length > 0
            ? ['', '', '', '', formatMoney(sum(rows, (row) => row.total)), formatMoney(sum(rows, (row) => row.bank)), formatMoney(sum(rows, (row) => row.cash)), formatMoney(sum(rows, (row) => row.unpaid))]
            : undefined
        }
      />
    </Section>
  );
}

const sum = <Row,>(rows: Row[], pick: (row: Row) => number) => Math.round(rows.reduce((total, row) => total + pick(row), 0) * 100) / 100;

/** Tax held back from suppliers in the month, with its Excel. */
function Withholding({ month }: { month: string }) {
  const t = useT();
  const { language } = useLanguage();
  const w = t.vat.withholding;
  const rows = useQuery({ queryKey: ['vat', 'withholding', month], queryFn: () => vatApi.withholding(month) });
  const download = useMutation({ mutationFn: () => vatApi.downloadWithholding(month, language) });
  return (
    <Section
      title={w.title}
      description={w.description}
      actions={
        rows.data &&
        rows.data.length > 0 && (
          <Button size="sm" variant="ghost" icon={FileXls} loading={download.isPending} onClick={() => download.mutate()}>
            {w.download}
          </Button>
        )
      }
    >
      {download.isError && (
        <p className="form-error" role="alert">
          {errorMessage(download.error)}
        </p>
      )}
      {rows.isPending && <Loading />}
      {rows.isError && <ErrorNotice error={rows.error} onRetry={() => rows.refetch()} />}
      {rows.data && (
        <DataTable<WithholdingRow>
          caption={w.title}
          rows={rows.data}
          rowKey={(row) => row.billId}
          density="compact"
          empty={<EmptyState icon={Receipt} title={w.empty} />}
          columns={[
            { header: t.vat.over500.date, className: 'books-date', cell: (row) => formatDate(`${row.date}T12:00:00`) },
            {
              header: t.vat.over500.supplier,
              title: true,
              cell: (row) => (
                <Link className="table__primary-link" to={`/bills/${row.billId}`}>
                  {row.supplier ?? '–'}
                </Link>
              ),
            },
            { header: t.vat.over500.nui, className: 'table__phone-hide', cell: (row) => row.nui ?? '–' },
            { header: w.type, cell: (row) => `${w.types[row.type] ?? row.type} · ${row.rate}%` },
            { header: w.gross, align: 'end', cell: (row) => formatMoney(row.gross) },
            { header: w.withheld, align: 'end', cell: (row) => formatMoney(row.withheld) },
          ]}
          totals={rows.data.length > 0 ? ['', '', '', '', formatMoney(sum(rows.data, (row) => row.gross)), formatMoney(sum(rows.data, (row) => row.withheld))] : undefined}
        />
      )}
    </Section>
  );
}

/** The year at a glance: one row per month, each opening its return. */
function VatYear({ year: start, month, onPick }: { year: number; month: string; onPick: (month: string) => void }) {
  const t = useT();
  const { language } = useLanguage();
  const w = t.vat.year;
  const [year, setYear] = useState(start);
  const rows = useQuery({ queryKey: ['vat', 'year', year], queryFn: () => vatApi.year(year), placeholderData: keepPreviousData });
  const download = useMutation({ mutationFn: () => vatApi.downloadYear(year, language) });
  const shown = (rows.data ?? []).filter((row) => row.status !== 'future');
  const stamp = (row: VatYearRow) =>
    row.status === 'filed' ? <Badge tone="ok">{t.vat.stamp.filed}</Badge> : <Badge tone="neutral">{t.vat.stamp.open}</Badge>;
  return (
    <Section
      title={w.title(year)}
      description={w.description}
      actions={
        <>
          <Button size="sm" variant="ghost" icon={CaretLeft} aria-label={w.previousYear} title={w.previousYear} onClick={() => setYear(year - 1)} />
          <Button
            size="sm"
            variant="ghost"
            icon={CaretRight}
            aria-label={w.nextYear}
            title={w.nextYear}
            disabled={year >= Number(thisMonth().slice(0, 4))}
            onClick={() => setYear(year + 1)}
          />
          <Button size="sm" variant="ghost" icon={FileXls} loading={download.isPending} onClick={() => download.mutate()}>
            {w.download}
          </Button>
        </>
      }
    >
      {download.isError && (
        <p className="form-error" role="alert">
          {errorMessage(download.error)}
        </p>
      )}
      {rows.isPending && <Loading />}
      {rows.isError && <ErrorNotice error={rows.error} onRetry={() => rows.refetch()} />}
      {rows.data && (
        <DataTable<VatYearRow>
          caption={w.caption(year)}
          rows={shown}
          rowKey={(row) => row.month}
          density="compact"
          rowClassName={(row) => (row.month === month ? 'table__row--selected' : undefined)}
          onRowClick={(row) => onPick(row.month)}
          empty={<EmptyState icon={Receipt} title={t.vat.documents.none} />}
          columns={[
            {
              header: w.month,
              title: true,
              cell: (row) => (
                <button type="button" className="table__primary-link vat-row-button" aria-current={row.month === month ? 'true' : undefined} onClick={() => onPick(row.month)}>
                  {formatMonth(row.month)}
                </button>
              ),
            },
            { header: w.status, cell: stamp },
            { header: w.sales, align: 'end', className: 'table__phone-hide', cell: (row) => formatMoney(row.sales) },
            { header: w.purchases, align: 'end', className: 'table__phone-hide', cell: (row) => formatMoney(row.purchases) },
            { header: w.equipment, align: 'end', className: 'table__phone-hide table__dock-hide', cell: (row) => (row.equipment ? formatMoney(row.equipment) : '–') },
            { header: w.charged, align: 'end', cell: (row) => formatMoney(row.charged) },
            { header: w.claimable, align: 'end', cell: (row) => formatMoney(row.claimable) },
            { header: w.difference, align: 'end', className: 'table__phone-hide', cell: (row) => formatMoney(row.difference) },
            { header: w.carriedOut, align: 'end', cell: (row) => (row.carriedOut ? formatMoney(row.carriedOut) : '–') },
            { header: w.toPay, align: 'end', cell: (row) => (row.toPay ? formatMoney(row.toPay) : '–') },
          ]}
          totals={
            shown.length > 0
              ? [
                  t.vatBooks.totals,
                  '',
                  formatMoney(sum(shown, (row) => row.sales)),
                  formatMoney(sum(shown, (row) => row.purchases)),
                  formatMoney(sum(shown, (row) => row.equipment)),
                  formatMoney(sum(shown, (row) => row.charged)),
                  formatMoney(sum(shown, (row) => row.claimable)),
                  formatMoney(sum(shown, (row) => row.difference)),
                  '',
                  formatMoney(sum(shown, (row) => row.toPay)),
                ]
              : undefined
          }
        />
      )}
    </Section>
  );
}

/* ---------- The sales book and the purchase book ---------- */

export function SalesBookPage() {
  return <VatBookPage kind="sales" />;
}

export function PurchaseBookPage() {
  return <VatBookPage kind="purchases" />;
}

/** ATK's sales or purchase book for a month: the same documents as the return, one row each, one column per box. */
function VatBookPage({ kind }: { kind: BookKind }) {
  const t = useT();
  const { language } = useLanguage();
  const w = t.vatBooks;
  const [month, setMonth] = useMonthParam();
  const [showEmpty, setShowEmpty] = useState(false);
  const vat = useVatMonth(month);
  const items = useMemo(() => bookItems(kind, vat.data?.items ?? []), [kind, vat.data]);
  const boxes = useMemo(() => {
    const all = bookBoxes(kind);
    return showEmpty ? all : all.filter((box) => items.some((item) => (item.boxes[box] ?? 0) !== 0));
  }, [kind, items, showEmpty]);
  const download = useMutation({
    mutationFn: async (format: 'xlsx' | 'pdf' | 'edi') => {
      if (format === 'pdf') {
        const html = await vatApi.bookPage(month, kind, language, showEmpty);
        return printHtml(html, `${kind === 'sales' ? t.nav.tabs.salesBook : t.nav.tabs.purchaseBook} ${formatMonth(month)}`);
      }
      return vatApi.downloadBook(month, kind, format, language, showEmpty);
    },
  });
  const title = kind === 'sales' ? t.nav.tabs.salesBook : t.nav.tabs.purchaseBook;
  const words = (box: number) => {
    const rows = kind === 'sales' ? CHARGED_ROWS : CLAIM_ROWS;
    const row = rows.find((candidate) => candidate.base === box || ('vat' in candidate && candidate.vat === box))!;
    const label = rowWords(t, kind === 'sales' ? 'charged' : 'claim', row.key).label;
    return row.base === box ? label : `${t.vat.vatColumn} · ${label}`;
  };

  return (
    <>
      <PageHeader
        wide
        title={title}
        description={kind === 'sales' ? w.salesDescription(formatMonth(month)) : w.purchaseDescription(formatMonth(month))}
        meta={vat.data && vat.data.month === month && <MonthStamp data={vat.data} />}
      />
      {vat.isPending && <Loading />}
      {vat.isError && <ErrorNotice error={vat.error} onRetry={() => vat.refetch()} />}
      {vat.data && (
        <div aria-busy={vat.isFetching}>
          <DataTable<VatItem>
            caption={w.caption(formatMonth(month))}
            rows={items}
            rowKey={(item) => `${item.kind}:${item.ref}`}
            density="compact"
            toolbar={
              <div className="toolbar">
                <MonthPicker month={month} onChange={setMonth} first={vat.data.firstMonth} />
                <label className="toggle">
                  <input type="checkbox" checked={showEmpty} onChange={(event) => setShowEmpty(event.target.checked)} />
                  {w.showEmpty}
                </label>
                <div className="toolbar__end">
                  <MenuButton
                    label={download.isPending ? t.vat.downloading : t.vat.download}
                    icon={FileXls}
                    loading={download.isPending}
                    items={[
                      { label: w.excel, icon: FileXls, onSelect: () => download.mutate('xlsx') },
                      { label: w.pdf, icon: FilePdf, onSelect: () => download.mutate('pdf') },
                      { label: w.edi, icon: FileCsv, onSelect: () => download.mutate('edi') },
                    ]}
                  />
                </div>
              </div>
            }
            empty={
              <EmptyState icon={Receipt} title={w.empty}>
                {w.emptyHint}
              </EmptyState>
            }
            columns={[
              { header: w.no, className: 'books-date', cell: (item) => items.indexOf(item) + 1 },
              { header: w.date, className: 'books-date', cell: (item) => formatDate(`${item.date}T12:00:00`) },
              {
                header: w.number,
                title: true,
                cell: (item) => {
                  const link = itemLink(item);
                  const name = item.kind === 'till_day' ? w.tillDay : (item.number ?? t.vat.documents.noNumber);
                  return (
                    <>
                      {link ? (
                        <Link className="table__primary-link" to={link}>
                          {name}
                        </Link>
                      ) : (
                        <span className="vat-documents__name">{name}</span>
                      )}
                      {item.lateFrom && <span className="vat-documents__late">{t.vat.documents.late(formatMonth(item.lateFrom))}</span>}
                    </>
                  );
                },
              },
              {
                header: kind === 'sales' ? w.customer : w.supplier,
                cell: (item) => (item.kind === 'till_day' ? t.vat.documents.tillDay(item.count ?? 0) : (item.party ?? '–')),
              },
              { header: w.nui, className: 'table__phone-hide', cell: (item) => item.nui ?? '–' },
              { header: kind === 'sales' ? w.salesTotal : w.purchasesTotal, align: 'end', cell: (item) => formatMoney(bookTotal(kind, item)) },
              ...boxes.map((box) => ({
                header: (
                  <span className="vat-book__head" title={words(box)}>
                    <BoxNumber box={box} />
                    <span className="vat-book__head-words">{words(box)}</span>
                  </span>
                ),
                align: 'end' as const,
                cell: (item: VatItem) => (item.boxes[box] ? formatMoney(item.boxes[box]!) : '–'),
              })),
              { header: w.vat18, align: 'end', cell: (item) => formatMoney(boxSum(item, VAT_18[kind])) },
              { header: w.vat8, align: 'end', cell: (item) => formatMoney(boxSum(item, VAT_8[kind])) },
            ]}
            totals={[
              w.totals,
              '',
              '',
              '',
              '',
              formatMoney(sum(items, (item) => bookTotal(kind, item))),
              ...boxes.map((box) => formatMoney(sum(items, (item) => item.boxes[box] ?? 0))),
              formatMoney(sum(items, (item) => boxSum(item, VAT_18[kind]))),
              formatMoney(sum(items, (item) => boxSum(item, VAT_8[kind]))),
            ]}
          />
          {download.isError && (
            <p className="form-error" role="alert">
              {errorMessage(download.error)}
            </p>
          )}
        </div>
      )}
    </>
  );
}

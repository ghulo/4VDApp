import { ArrowsLeftRight } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Badge, Button, DataTable, EmptyState, Field, PageHeader, Section, Sheet, StatGrid, StatTile } from '../components/ui';
import type { Catalogue } from '../i18n/en';
import { useT } from '../i18n/useT';
import { vatApi } from '../services/api';
import type { TrefinCompare, TrefinCompareRow, TrefinCompareSide } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatDateTime, formatHeadlineMoney, formatMoney } from '../utils/format';
import { CHARGED_ROWS, CLAIM_ROWS, formatMonth, itemLink } from '../utils/vat';
import { rowWords, useMonthParam } from '../utils/vatMonth';
import { MonthPicker } from './VatPages';

type Box = TrefinCompare['boxes'][number];

/** "Sales at 18%", "VAT · Sales at 18%", or a total's own words. */
function boxWords(t: Catalogue, box: number): string {
  if (box === 30) return t.vat.totalCharged;
  if (box === 67) return t.vat.totalClaim;
  if (box >= 68) return t.vat.results[box as 69 | 71 | 72].label;
  for (const [part, rows] of [['charged', CHARGED_ROWS], ['claim', CLAIM_ROWS]] as const) {
    const row = rows.find((candidate) => candidate.base === box || ('vat' in candidate && candidate.vat === box));
    if (row) {
      const label = rowWords(t, part, row.key).label;
      return row.base === box ? label : `${t.vat.vatColumn} · ${label}`;
    }
  }
  return t.vat.boxLabel(box);
}

/** What a row stands for, in a few words: "Till sales", "Bill 3741 · Bravo Group". */
function rowName(t: Catalogue, row: TrefinCompareRow): string {
  const d = t.vat.documents;
  if (row.kind === 'till_day') return t.vatBooks.tillDay;
  const side = row.trefin ?? row.fourVd!;
  const kind = row.kind === 'invoice' ? d.invoice : row.kind === 'return' ? d.return : row.kind === 'credit' ? d.credit : d.bill;
  return `${kind} ${side.number ?? d.noNumber}`;
}

/** €1.00 more or less on 4VD's side. */
const moreOrLess = (c: Catalogue['trefinCompare'], amount: number) => (amount >= 0 ? c.more(formatMoney(amount)) : c.less(formatMoney(-amount)));
const signed = (amount: number) => `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${formatMoney(Math.abs(amount))}`;

function reasonText(t: Catalogue, row: TrefinCompareRow): string {
  const c = t.trefinCompare;
  if (row.status === 'same') return c.status.same;
  if (row.status === 'rounding') return `${c.status.rounding} (${c.vatOf(signed(row.facts.vat ?? 0))})`;
  switch (row.reason) {
    case 'only_trefin':
      return c.reasons.only_trefin;
    case 'only_4vd':
      return c.reasons.only_4vd;
    case 'other_month':
      return c.reasons.other_month(formatMonth(row.facts.month!));
    case 'rate':
      return c.reasons.rate(moreOrLess(c, row.facts.vat ?? 0));
    default: {
      const lines = row.facts.fourVdLines !== undefined && row.facts.trefinLines !== undefined && row.facts.fourVdLines !== row.facts.trefinLines;
      return [c.reasons.amount(moreOrLess(c, row.facts.gross ?? 0), moreOrLess(c, row.facts.vat ?? 0)), lines ? c.reasons.lines(row.facts.fourVdLines!, row.facts.trefinLines!) : ''].filter(Boolean).join(' ');
    }
  }
}

/** One side's figure: the total and its VAT, with a link to 4VD's document. */
function SideCell({ t, row, side, own }: { t: Catalogue; row: TrefinCompareRow; side: TrefinCompareSide | null; own: boolean }) {
  if (!side) return <span className="compare-missing">{t.trefinCompare.missing}</span>;
  const link = own ? itemLink({ kind: row.kind, ref: side.ref, date: row.date, number: side.number, party: side.party, nui: null, boxes: side.boxes }) : null;
  const total = formatMoney(side.gross);
  return (
    <span className="compare-side">
      {link ? <Link to={link}>{total}</Link> : <span>{total}</span>}
      <span className="table__secondary">
        {t.trefinCompare.vatOf(formatMoney(side.vat))}
        {side.count !== null && ` · ${t.trefinCompare.lines(side.count)}`}
      </span>
    </span>
  );
}

/** One VAT month in 4VD next to the same month in TREFIN: the boxes, then every document, each difference explained by a person. */
export function TrefinComparePage() {
  const t = useT();
  const c = t.trefinCompare;
  const queryClient = useQueryClient();
  const [month, setMonth] = useMonthParam();
  const [onlyDifferences, setOnlyDifferences] = useState(true);
  const [explaining, setExplaining] = useState<TrefinCompareRow | null>(null);
  const compare = useQuery({ queryKey: ['vat', 'trefin', month], queryFn: () => vatApi.trefin(month), placeholderData: keepPreviousData });
  const months = useQuery({ queryKey: ['vat', 'trefin', 'months'], queryFn: vatApi.trefinMonths });
  const takeBack = useMutation({
    mutationFn: (key: string) => vatApi.explainTrefin(month, key, null),
    onSuccess: (data) => queryClient.setQueryData(['vat', 'trefin', month], data),
  });
  const data = compare.data?.month === month ? compare.data : undefined;
  const open = data ? data.counts.differs - data.counts.explained : 0;
  const rows = data ? (onlyDifferences ? data.rows.filter((row) => row.status === 'differs') : data.rows) : [];
  const gap = data ? Math.round((data.totals.fourVd.toPay - data.totals.trefin.toPay) * 100) / 100 : 0;

  return (
    <>
      <PageHeader
        wide
        title={t.nav.tabs.trefin}
        description={c.description}
        meta={data?.loaded && (open === 0 ? <Badge tone="ok">{c.stamp.done}</Badge> : <Badge tone="warn">{c.stamp.open(open)}</Badge>)}
      />
      <div className="toolbar">
        <MonthPicker month={month} onChange={setMonth} first={null} />
      </div>
      {compare.isPending && <Loading />}
      {compare.isError && <ErrorNotice error={compare.error} onRetry={() => compare.refetch()} />}
      {data && !data.loaded && (
        <EmptyState icon={ArrowsLeftRight} title={c.notLoaded(formatMonth(month))}>
          <p>{c.notLoadedHow}</p>
          <p>
            <code className="compare-command">{c.command(month)}</code>
          </p>
          {months.data && months.data.length > 0 && (
            <p className="compare-months">
              {c.otherMonths}{' '}
              {months.data.map((loaded) => (
                <Button key={loaded} size="sm" variant="ghost" onClick={() => setMonth(loaded)}>
                  {formatMonth(loaded)}
                </Button>
              ))}
            </p>
          )}
        </EmptyState>
      )}
      {data?.loaded && (
        <div className="compare" aria-busy={compare.isFetching}>
          <p className="compare-loaded">{c.loadedFrom(data.loaded.source ?? 'TREFIN', formatDateTime(data.loaded.at))}</p>
          <StatGrid compact>
            <StatTile label={c.tiles.fourVd} value={formatHeadlineMoney(data.totals.fourVd.toPay)} />
            <StatTile label={c.tiles.trefin} value={formatHeadlineMoney(data.totals.trefin.toPay)} />
            <StatTile label={c.tiles.gap} value={signed(gap)} hint={c.tiles.gapHint} tone={gap === 0 ? 'default' : 'warn'} />
            <StatTile label={c.tiles.explained} value={c.tiles.explainedValue(data.counts.explained, data.counts.differs)} hint={c.tiles.explainedHint(data.counts.same + data.counts.rounding)} tone={open > 0 ? 'warn' : 'default'} />
          </StatGrid>

          <Section title={c.boxes.title} description={c.boxes.description}>
            <DataTable<Box>
              caption={c.boxes.caption}
              rows={data.boxes}
              rowKey={(row) => row.box}
              density="compact"
              rowClassName={(row) => (Math.abs(row.fourVd - row.trefin) >= 0.005 ? 'compare-row--differs' : undefined)}
              empty={<EmptyState title={c.nothing} />}
              columns={[
                {
                  header: c.columns.box,
                  title: true,
                  cell: (row) => (
                    <>
                      <span>{boxWords(t, row.box)}</span>
                      <span className="table__secondary">{t.vat.boxLabel(row.box)}</span>
                    </>
                  ),
                },
                { header: c.columns.fourVd, align: 'end', className: 'compare-money', cell: (row) => formatMoney(row.fourVd) },
                { header: c.columns.trefin, align: 'end', className: 'compare-money', cell: (row) => formatMoney(row.trefin) },
                {
                  header: c.columns.gap,
                  align: 'end',
                  className: 'compare-money',
                  cell: (row) => {
                    const difference = Math.round((row.fourVd - row.trefin) * 100) / 100;
                    return difference === 0 ? '–' : <strong>{signed(difference)}</strong>;
                  },
                },
              ]}
            />
          </Section>

          <Section title={c.documents.title} description={c.documents.description}>
            {takeBack.isError && (
              <p className="form-error" role="alert">
                {errorMessage(takeBack.error)}
              </p>
            )}
            <DataTable<TrefinCompareRow>
              caption={c.documents.caption}
              rows={rows}
              rowKey={(row) => row.key}
              density="compact"
              toolbar={
                <div className="toolbar">
                  <label className="toggle">
                    <input type="checkbox" checked={onlyDifferences} onChange={(event) => setOnlyDifferences(event.target.checked)} />
                    {c.onlyDifferences}
                  </label>
                </div>
              }
              empty={
                <EmptyState title={data.rows.length === 0 ? c.nothing : c.noDifferences}>{data.rows.length > 0 && <p>{c.noDifferencesHint}</p>}</EmptyState>
              }
              columns={[
                { header: c.columns.day, className: 'compare-day', cell: (row) => formatDate(row.date) },
                {
                  header: c.columns.what,
                  title: true,
                  cell: (row) => (
                    <>
                      <span>{rowName(t, row)}</span>
                      {row.kind !== 'till_day' && <span className="table__secondary">{(row.trefin ?? row.fourVd)?.party ?? ''}</span>}
                    </>
                  ),
                },
                { header: c.columns.fourVd, align: 'end', className: 'compare-money', cell: (row) => <SideCell t={t} row={row} side={row.fourVd} own /> },
                { header: c.columns.trefin, align: 'end', className: 'compare-money', cell: (row) => <SideCell t={t} row={row} side={row.trefin} own={false} /> },
                {
                  header: c.columns.why,
                  className: 'compare-why',
                  cell: (row) => (row.status === 'differs' ? reasonText(t, row) : <Badge tone={row.status === 'same' ? 'ok' : 'neutral'}>{reasonText(t, row)}</Badge>),
                },
                {
                  header: c.columns.check,
                  className: 'compare-check',
                  cell: (row) => {
                    if (row.status !== 'differs') return null;
                    const name = `${rowName(t, row)}, ${formatDate(row.date)}`;
                    if (!row.explained)
                      return (
                        <Button size="sm" variant="secondary" onClick={() => setExplaining(row)}>
                          {c.explain}
                          <span className="visually-hidden"> {name}</span>
                        </Button>
                      );
                    return (
                      <span className="compare-explained">
                        <span>{row.explained.note}</span>
                        <span className="table__secondary">{c.explainedBy(row.explained.by ?? '', formatDateTime(row.explained.at))}</span>
                        <Button size="sm" variant="ghost" loading={takeBack.isPending && takeBack.variables === row.key} onClick={() => takeBack.mutate(row.key)}>
                          {c.takeBack}
                          <span className="visually-hidden"> {name}</span>
                        </Button>
                      </span>
                    );
                  },
                },
              ]}
            />
          </Section>
        </div>
      )}
      <Sheet open={explaining !== null} onClose={() => setExplaining(null)} title={c.explainTitle} description={c.explainBody}>
        {explaining && (
          <ExplainForm
            key={explaining.key}
            t={t}
            month={month}
            row={explaining}
            onSaved={(next) => {
              queryClient.setQueryData(['vat', 'trefin', month], next);
              setExplaining(null);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function ExplainForm({ t, month, row, onSaved }: { t: Catalogue; month: string; row: TrefinCompareRow; onSaved: (data: TrefinCompare) => void }) {
  const c = t.trefinCompare;
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const save = useMutation({ mutationFn: (text: string) => vatApi.explainTrefin(month, row.key, text), onSuccess: onSaved });
  const missing = note.trim().length < 3;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!missing) save.mutate(note.trim());
  };
  return (
    <form className="settings-form" onSubmit={submit} noValidate>
      <p className="compare-summary">
        <strong>
          {rowName(t, row)}, {formatDate(row.date)}
        </strong>{' '}
        {reasonText(t, row)}
      </p>
      <Field label={c.note} error={tried && missing ? c.noteShort : undefined}>
        <textarea name="note" autoComplete="off" rows={3} maxLength={500} value={note} placeholder={c.notePlaceholder} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={save.isPending}>
          {c.save}
        </Button>
      </div>
    </form>
  );
}

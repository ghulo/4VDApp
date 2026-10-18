import { Bank, CalendarCheck, FilePdf, FileXls, LockSimple, Printer } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Segmented } from '../components/BillLines';
import { cardPath, formatBookDay } from '../components/BooksParts';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PlaceSelect, placeInSentence } from '../components/MoneyParts';
import { PeriodPicker } from '../components/PeriodPicker';
import {
  Badge,
  BarList,
  Button,
  Card,
  DataTable,
  DateField,
  EmptyState,
  Field,
  MenuButton,
  PageHeader,
  Section,
  Sheet,
  StatGrid,
  StatTile,
  type Tone,
} from '../components/ui';
import { useCurrentUser } from '../auth/useAuth';
import type { Catalogue } from '../i18n/en';
import { useLanguage, useT } from '../i18n/useT';
import { booksApi, moneyApi } from '../services/api';
import {
  type BalanceSheet,
  type BookYear,
  canCloseYear,
  canPayTax,
  type CashFlowStatement,
  type EquityChanges,
  type EquityRow,
  type IncomeStatement,
  type PrintFinish,
  type Quarter,
  type StatementByKind,
  type StatementKind,
  type StatementLine,
  type StatementQuery,
  type StatementSection,
  statementsApi,
} from '../services/statements';
import { todayIso } from '../utils/bills';
import { errorMessage } from '../utils/errors';
import { formatHeadlineMoney, formatMoney, formatPercent } from '../utils/format';
import { BOOKS_PERIOD_KEYS, periodDays } from '../utils/periods';
import { printHtml } from '../utils/printPage';
import { usePeriodParams } from '../utils/usePeriodParams';

type View = 'you' | 'official' | 'bank';
const VIEWS: View[] = ['you', 'official', 'bank'];
const KINDS: StatementKind[] = ['balance', 'income', 'equity', 'cashflow'];
const cents = (amount: number) => Math.round(amount * 100);

/* ---------- Statements ---------- */

/** Which statement, read which way, for which period: all kept in the address, so a link shows the same page. */
function useStatementParams() {
  const [params, setParams] = useSearchParams();
  const view = (VIEWS as string[]).includes(params.get('view') ?? '') ? (params.get('view') as View) : 'you';
  const kind = (KINDS as string[]).includes(params.get('statement') ?? '') ? (params.get('statement') as StatementKind) : 'income';
  const period = usePeriodParams('this-year');
  const set = (key: 'view' | 'statement', value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };
  const days = useMemo(() => periodDays(period.rangeKey), [period.rangeKey]);
  const compareDays = useMemo(() => {
    const { previousStartDate, previousEndDate } = period.comparedRange;
    return previousStartDate && previousEndDate ? periodDays({ startDate: previousStartDate, endDate: previousEndDate }) : null;
  }, [period.comparedRange]);
  const query: StatementQuery = { ...days, ...(compareDays && { compareFrom: compareDays.from, compareTo: compareDays.to }) };
  return { view, kind, setView: (value: View) => set('view', value), setKind: (value: StatementKind) => set('statement', value), period, days, compareDays, query };
}

/** The four financial statements, read for the owner, for the accountant or for the bank. */
export function StatementsPage() {
  const t = useT();
  const w = t.statements;
  const { language } = useLanguage();
  const { view, kind, setView, setKind, period, days, compareDays, query } = useStatementParams();
  // Keep the figures on screen while another period loads, but never show one statement's figures as another's.
  const statement = useQuery({
    queryKey: ['books', 'statement', kind, query],
    queryFn: () => statementsApi.get(kind, query),
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === kind ? previous : undefined),
  });
  const print = useMutation({
    mutationFn: async (finish: PrintFinish) => printHtml(await statementsApi.page(kind, query, finish, language), `${w.kinds[kind]} · ${period.range.label}`),
  });
  const excel = useMutation({ mutationFn: () => statementsApi.downloadXlsx(kind, query, language) });
  const compareLabel = compareDays ? t.periods.range(formatBookDay(compareDays.from), formatBookDay(compareDays.to)) : null;
  // A balance sheet is a picture on one day: the period's last.
  const currentLabel = kind === 'balance' ? w.onDay(formatBookDay(days.to)) : period.range.label;
  const data = statement.data;

  return (
    <>
      <PageHeader
        wide
        title={t.nav.tabs.statements}
        description={w.description[view]}
        actions={
          <>
            <MenuButton
              label={w.downloads.label}
              variant="secondary"
              loading={print.isPending || excel.isPending}
              items={[
                { label: w.downloads.xlsx, icon: FileXls, onSelect: () => excel.mutate() },
                { label: w.downloads.official, icon: FilePdf, onSelect: () => print.mutate('official') },
                { label: w.downloads.bank, icon: Bank, onSelect: () => print.mutate('bank') },
              ]}
            />
            {view === 'bank' && (
              <Button variant="primary" icon={Printer} loading={print.isPending && print.variables === 'bank'} onClick={() => print.mutate('bank')}>
                {w.printBank}
              </Button>
            )}
          </>
        }
      />
      <div className="statements-controls">
        <Segmented label={w.viewLabel} value={view} options={VIEWS.map((value) => ({ value, label: w.views[value] }))} onChange={setView} />
        <div className="segmented segmented--chips" role="radiogroup" aria-label={w.kindLabel}>
          {KINDS.map((value) => (
            <button key={value} type="button" role="radio" aria-checked={kind === value} className="segmented__option" onClick={() => setKind(value)}>
              {w.kinds[value]}
            </button>
          ))}
        </div>
      </div>
      <PeriodPicker
        period={period.period}
        from={period.from}
        to={period.to}
        onChange={period.changePeriod}
        periods={BOOKS_PERIOD_KEYS}
        compare={kind === 'equity' ? undefined : { value: period.compare, onChange: period.changeCompare }}
      />
      {(print.isError || excel.isError) && (
        <p className="form-error" role="alert">
          {errorMessage(print.error ?? excel.error)}
        </p>
      )}
      {statement.isPending && <Loading />}
      {statement.isError && <ErrorNotice error={statement.error} onRetry={() => statement.refetch()} />}
      {data && (
        <div className="statements" aria-busy={statement.isFetching}>
          {'balanced' in data && !data.balanced && (
            <p className="notice notice--warn" role="alert">
              {w.notBalanced}
            </p>
          )}
          {view === 'you' ? (
            <ForYou kind={kind} data={data} currentLabel={currentLabel} compareLabel={compareLabel} days={days} />
          ) : (
            <>
              {view === 'bank' && (
                <p className="statements-note">
                  <Bank size={16} aria-hidden="true" />
                  {w.bankNote}
                </p>
              )}
              <StatementTable kind={kind} data={data} byGroup={view === 'bank'} currentLabel={currentLabel} compareLabel={kind === 'equity' ? null : compareLabel} days={days} />
            </>
          )}
        </div>
      )}
    </>
  );
}

/** "Off by" never shows here; the server's check sits above. Links an account to its card over the same days. */
const accountLink = (accountId: number, days: { from: string; to: string }) => cardPath(accountId, `?period=custom&from=${days.from}&to=${days.to}`);

/** "€600 more than 1 Jan – 18 Oct 2025", or nothing when there is nothing to compare with. */
function changeWords(t: Catalogue, current: number, previous: number | null, label: string | null): string | undefined {
  if (previous === null || label === null) return undefined;
  const difference = current - previous;
  if (cents(difference) === 0) return t.statements.you.same(label);
  return difference > 0 ? t.statements.you.more(formatHeadlineMoney(difference), label) : t.statements.you.less(formatHeadlineMoney(-difference), label);
}

function ForYou({
  kind,
  data,
  currentLabel,
  compareLabel,
  days,
}: {
  kind: StatementKind;
  data: StatementByKind[StatementKind];
  currentLabel: string;
  compareLabel: string | null;
  days: { from: string; to: string };
}) {
  if (kind === 'income') return <IncomeForYou data={data as IncomeStatement} currentLabel={currentLabel} compareLabel={compareLabel} days={days} />;
  if (kind === 'balance') return <BalanceForYou data={data as BalanceSheet} currentLabel={currentLabel} compareLabel={compareLabel} days={days} />;
  if (kind === 'cashflow') return <CashForYou data={data as CashFlowStatement} currentLabel={currentLabel} compareLabel={compareLabel} days={days} />;
  return <EquityForYou data={data as EquityChanges} currentLabel={currentLabel} days={days} />;
}

/** The result in one sentence on raised paper, the way the VAT page says what is due. */
function Outcome({ label, sentence, hint }: { label: string; sentence: string; hint?: string }) {
  return (
    <Card className="vat-outcome statements-outcome">
      <p className="vat-outcome__month">{label}</p>
      <p className="vat-outcome__sentence">{sentence}</p>
      {hint && <p className="vat-outcome__hint">{hint}</p>}
    </Card>
  );
}

const linesOf = (section: StatementSection | undefined) => section?.groups.flatMap((group) => group.lines) ?? [];

function IncomeForYou({ data, currentLabel, compareLabel, days }: { data: IncomeStatement; currentLabel: string; compareLabel: string | null; days: { from: string; to: string } }) {
  const t = useT();
  const w = t.statements.you;
  const { totals } = data;
  const net = totals.netProfit;
  const margin = totals.revenue.amount > 0 ? totals.grossProfit.amount / totals.revenue.amount : null;
  const costs = [...linesOf(data.sections.find((section) => section.key === 'expenses')), ...linesOf(data.sections.find((section) => section.key === 'other_expenses'))]
    .filter((line) => line.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);
  const nothing = data.sections.every((section) => cents(section.amount) === 0);
  if (nothing) return <StatementEmpty />;
  return (
    <>
      <Outcome
        label={currentLabel}
        sentence={net.amount >= 0 ? w.profit(formatHeadlineMoney(net.amount)) : w.loss(formatHeadlineMoney(-net.amount))}
        hint={changeWords(t, net.amount, net.compare, compareLabel)}
      />
      <StatGrid>
        <StatTile label={w.tiles.revenue} value={formatHeadlineMoney(totals.revenue.amount)} hint={changeWords(t, totals.revenue.amount, totals.revenue.compare, compareLabel)} />
        <StatTile label={w.tiles.costOfSales} value={formatHeadlineMoney(totals.costOfSales.amount)} />
        <StatTile label={w.tiles.grossProfit} value={formatHeadlineMoney(totals.grossProfit.amount)} hint={margin === null ? undefined : w.tiles.margin(formatPercent(margin))} />
        <StatTile label={w.tiles.expenses} value={formatHeadlineMoney(totals.expenses.amount + totals.otherExpenses.amount)} />
        <StatTile label={w.tiles.profitTax} value={formatHeadlineMoney(totals.profitTax.amount)} words={cents(totals.profitTax.amount) === 0 ? w.tiles.noTaxYet : undefined} hint={w.tiles.profitTaxHint} />
      </StatGrid>
      {costs.length > 0 && (
        <Section title={w.whereMoneyWent} description={w.whereMoneyWentHint}>
          <Card>
            <BarList label={w.whereMoneyWent} items={costs.map((line) => barOf(line, days))} />
          </Card>
        </Section>
      )}
    </>
  );
}

const barOf = (line: StatementLine, days: { from: string; to: string }) => ({
  key: line.accountId ?? line.name,
  label: line.name,
  value: line.amount,
  display: formatMoney(line.amount),
  to: line.accountId ? accountLink(line.accountId, days) : undefined,
});

function BalanceForYou({ data, currentLabel, compareLabel, days }: { data: BalanceSheet; currentLabel: string; compareLabel: string | null; days: { from: string; to: string } }) {
  const t = useT();
  const w = t.statements.you;
  const { totals } = data;
  const groups = (keys: string[]) =>
    data.sections
      .filter((section) => keys.includes(section.key))
      .flatMap((section) => section.groups)
      .filter((group) => cents(group.amount) !== 0)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .map((group) => ({
        key: group.name,
        label: group.name,
        value: group.amount,
        display: formatMoney(group.amount),
        // A group of one account opens its card; a bigger group is read on the Official view.
        to: group.lines.length === 1 && group.lines[0]!.accountId ? accountLink(group.lines[0]!.accountId, { from: days.from, to: days.to }) : undefined,
      }));
  if (cents(totals.assets.amount) === 0 && cents(totals.liabilitiesAndEquity.amount) === 0) return <StatementEmpty />;
  const owned = groups(['current_assets', 'fixed_assets']);
  const owed = groups(['short_liabilities', 'long_liabilities']);
  return (
    <>
      <Outcome
        label={currentLabel}
        sentence={w.balance(formatHeadlineMoney(totals.assets.amount), formatHeadlineMoney(totals.liabilities.amount), formatHeadlineMoney(totals.equity.amount))}
        hint={changeWords(t, totals.equity.amount, totals.equity.compare, compareLabel)}
      />
      <StatGrid>
        <StatTile label={w.tiles.own} value={formatHeadlineMoney(totals.assets.amount)} hint={w.tiles.ownHint} />
        <StatTile label={w.tiles.owe} value={formatHeadlineMoney(totals.liabilities.amount)} hint={w.tiles.oweHint} />
        <StatTile label={w.tiles.yours} value={formatHeadlineMoney(totals.equity.amount)} hint={w.tiles.yoursHint} />
      </StatGrid>
      <div className="statements-pair">
        {owned.length > 0 && (
          <Section title={w.whatYouOwn}>
            <Card>
              <BarList label={w.whatYouOwn} items={owned} />
            </Card>
          </Section>
        )}
        {owed.length > 0 && (
          <Section title={w.whatYouOwe}>
            <Card>
              <BarList label={w.whatYouOwe} items={owed} />
            </Card>
          </Section>
        )}
      </div>
    </>
  );
}

function CashForYou({ data, currentLabel, compareLabel, days }: { data: CashFlowStatement; currentLabel: string; compareLabel: string | null; days: { from: string; to: string } }) {
  const t = useT();
  const w = t.statements.you;
  const { totals } = data;
  const section = (key: 'operating' | 'investing' | 'financing') => data.sections.find((candidate) => candidate.key === key)!;
  const signed = (amount: number) => (amount > 0 ? `+${formatHeadlineMoney(amount)}` : amount < 0 ? `−${formatHeadlineMoney(-amount)}` : formatHeadlineMoney(0));
  const biggest = linesOf(section('operating'))
    .filter((line) => cents(line.amount) !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 8);
  if (cents(totals.opening.amount) === 0 && cents(totals.closing.amount) === 0 && data.sections.every((candidate) => cents(candidate.amount) === 0)) return <StatementEmpty />;
  return (
    <>
      <Outcome
        label={currentLabel}
        sentence={w.cash(formatHeadlineMoney(totals.opening.amount), formatHeadlineMoney(totals.closing.amount))}
        hint={changeWords(t, totals.net.amount, totals.net.compare, compareLabel)}
      />
      <StatGrid>
        <StatTile label={w.tiles.cashStart} value={formatHeadlineMoney(totals.opening.amount)} />
        <StatTile label={t.statements.sections.operating} value={signed(section('operating').amount)} hint={w.tiles.operatingHint} />
        <StatTile label={t.statements.sections.investing} value={signed(section('investing').amount)} words={cents(section('investing').amount) === 0 ? w.tiles.none : undefined} hint={w.tiles.investingHint} />
        <StatTile label={t.statements.sections.financing} value={signed(section('financing').amount)} words={cents(section('financing').amount) === 0 ? w.tiles.none : undefined} hint={w.tiles.financingHint} />
        <StatTile label={w.tiles.cashEnd} value={formatHeadlineMoney(totals.closing.amount)} />
      </StatGrid>
      {biggest.length > 0 && (
        <Section title={w.cashMoves} description={w.cashMovesHint}>
          <Card>
            <BarList label={w.cashMoves} items={biggest.map((line) => barOf(line, days))} />
          </Card>
        </Section>
      )}
    </>
  );
}

function EquityForYou({ data, currentLabel, days }: { data: EquityChanges; currentLabel: string; days: { from: string; to: string } }) {
  const t = useT();
  const w = t.statements.you;
  if (data.rows.length === 0) return <StatementEmpty />;
  return (
    <>
      <Outcome label={currentLabel} sentence={w.equity(formatHeadlineMoney(data.total.start), formatHeadlineMoney(data.total.end))} hint={w.equityHint} />
      <StatGrid>
        <StatTile label={w.tiles.equityStart} value={formatHeadlineMoney(data.total.start)} />
        <StatTile label={data.profit >= 0 ? w.tiles.profit : w.tiles.lossTile} value={formatHeadlineMoney(Math.abs(data.profit))} />
        <StatTile label={w.tiles.equityEnd} value={formatHeadlineMoney(data.total.end)} />
      </StatGrid>
      <EquityTable data={data} days={days} official={false} />
    </>
  );
}

function StatementEmpty() {
  const t = useT();
  return (
    <EmptyState icon={CalendarCheck} title={t.statements.empty}>
      {t.statements.emptyHint}
    </EmptyState>
  );
}

/* ---------- The official and the bank's tables ---------- */

interface Row {
  id: string;
  style: 'heading' | 'group' | 'line' | 'subtotal' | 'total';
  label: string;
  number: string | null;
  accountId: number | null;
  amount: number | null;
  compare: number | null;
}

function sectionRows(t: Catalogue, section: StatementSection, heading: string, byGroup: boolean): Row[] {
  const rows: Row[] = [{ id: `${section.key}`, style: 'heading', label: heading, number: null, accountId: null, amount: null, compare: null }];
  section.groups.forEach((group, groupIndex) => {
    if (byGroup && group.name) {
      rows.push({ id: `${section.key}-${groupIndex}`, style: 'line', label: group.name, number: null, accountId: null, amount: group.amount, compare: group.compare });
      return;
    }
    if (group.name && section.groups.length > 1) rows.push({ id: `${section.key}-${groupIndex}`, style: 'group', label: group.name, number: null, accountId: null, amount: null, compare: null });
    group.lines.forEach((line, lineIndex) =>
      rows.push({
        id: `${section.key}-${groupIndex}-${lineIndex}`,
        style: 'line',
        label: line.key ? t.statements.unclosedProfit : line.name,
        number: line.number,
        accountId: line.accountId,
        amount: line.amount,
        compare: line.compare,
      }),
    );
  });
  rows.push({ id: `${section.key}-total`, style: 'subtotal', label: t.statements.totalOf(heading), number: null, accountId: null, amount: section.amount, compare: section.compare });
  return rows;
}

function rowsOf(t: Catalogue, kind: Exclude<StatementKind, 'equity'>, data: IncomeStatement | BalanceSheet | CashFlowStatement, byGroup: boolean): Row[] {
  const w = t.statements;
  const total = (id: string, label: string, figure: { amount: number; compare: number | null }): Row => ({ id, style: 'total', label, number: null, accountId: null, ...figure });
  const part = (sections: StatementSection[], key: string, heading: string) => sectionRows(t, sections.find((section) => section.key === key)!, heading, byGroup);
  if (kind === 'income') {
    const { sections, totals } = data as IncomeStatement;
    return [
      ...part(sections, 'revenue', w.sections.revenue),
      ...part(sections, 'cost_of_sales', w.sections.cost_of_sales),
      total('gross', w.totals.grossProfit, totals.grossProfit),
      ...part(sections, 'expenses', w.sections.expenses),
      total('operating', w.totals.operatingProfit, totals.operatingProfit),
      ...part(sections, 'other_income', w.sections.other_income),
      ...part(sections, 'other_expenses', w.sections.other_expenses),
      total('before-tax', w.totals.profitBeforeTax, totals.profitBeforeTax),
      ...part(sections, 'profit_tax', w.sections.profit_tax),
      total('net', w.totals.netProfit, totals.netProfit),
    ];
  }
  if (kind === 'balance') {
    const { sections, totals } = data as BalanceSheet;
    return [
      ...part(sections, 'current_assets', w.sections.current_assets),
      ...part(sections, 'fixed_assets', w.sections.fixed_assets),
      total('assets', w.totals.totalAssets, totals.assets),
      ...part(sections, 'short_liabilities', w.sections.short_liabilities),
      ...part(sections, 'long_liabilities', w.sections.long_liabilities),
      ...part(sections, 'equity', w.sections.equity),
      total('liabilities-equity', w.totals.totalLiabilitiesAndEquity, totals.liabilitiesAndEquity),
    ];
  }
  const { sections, totals } = data as CashFlowStatement;
  return [
    total('opening', w.totals.opening, totals.opening),
    ...sections.flatMap((section) => sectionRows(t, section, w.sections[section.key], false)),
    total('net', w.totals.net, totals.net),
    total('closing', w.totals.closing, totals.closing),
  ];
}

function StatementTable({
  kind,
  data,
  byGroup,
  currentLabel,
  compareLabel,
  days,
}: {
  kind: StatementKind;
  data: StatementByKind[StatementKind];
  byGroup: boolean;
  currentLabel: string;
  compareLabel: string | null;
  days: { from: string; to: string };
}) {
  const t = useT();
  const w = t.statements;
  if (kind === 'equity') return <EquityTable data={data as EquityChanges} days={days} official={!byGroup} />;
  const rows = rowsOf(t, kind, data as IncomeStatement | BalanceSheet | CashFlowStatement, byGroup);
  const money = (amount: number | null) => (amount === null ? '' : formatMoney(amount));
  return (
    <DataTable<Row>
      caption={w.caption(w.kinds[kind], currentLabel)}
      rows={rows}
      rowKey={(row) => row.id}
      density="compact"
      rowClassName={(row) => `statement-row statement-row--${row.style}`}
      columns={[
        {
          header: w.account,
          title: true,
          cell: (row) =>
            row.accountId && !byGroup ? (
              <Link className="table__primary-link" to={accountLink(row.accountId, days)}>
                <span className="books-number">{row.number}</span> {row.label}
              </Link>
            ) : (
              row.label
            ),
        },
        { header: currentLabel, label: currentLabel, align: 'end', cell: (row) => money(row.amount) },
        ...(compareLabel ? [{ header: compareLabel, label: compareLabel, align: 'end' as const, className: 'table__phone-hide', cell: (row: Row) => money(row.compare) }] : []),
      ]}
    />
  );
}

function EquityTable({ data, days, official }: { data: EquityChanges; days: { from: string; to: string }; official: boolean }) {
  const t = useT();
  const w = t.statements;
  const label = (row: EquityRow) => (row.key ? w.unclosedProfit : row.name);
  return (
    <DataTable<EquityRow>
      caption={w.caption(w.kinds.equity, t.periods.range(formatBookDay(data.period.from), formatBookDay(data.period.to)))}
      rows={data.rows}
      rowKey={(row) => row.accountId ?? row.key ?? row.name}
      density="compact"
      empty={<StatementEmpty />}
      columns={[
        {
          header: w.account,
          title: true,
          cell: (row) =>
            row.accountId ? (
              <Link className="table__primary-link" to={accountLink(row.accountId, days)}>
                {official && <span className="books-number">{row.number}</span>} {label(row)}
              </Link>
            ) : (
              label(row)
            ),
        },
        { header: w.start, align: 'end', cell: (row) => formatMoney(row.start) },
        { header: w.increase, align: 'end', cell: (row) => (cents(row.increase) ? formatMoney(row.increase) : '–') },
        { header: w.decrease, align: 'end', cell: (row) => (cents(row.decrease) ? formatMoney(row.decrease) : '–') },
        { header: w.end, align: 'end', cell: (row) => formatMoney(row.end) },
      ]}
      totals={[w.total, formatMoney(data.total.start), formatMoney(data.total.increase), formatMoney(data.total.decrease), formatMoney(data.total.end)]}
    />
  );
}

/* ---------- The year: profit tax by quarter, and closing it ---------- */

const MONTHS_OF = (quarter: Quarter, language: string) => {
  const format = (day: string) => new Intl.DateTimeFormat(language === 'sq' ? 'sq-AL' : 'en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
  return `${format(quarter.from)} – ${format(quarter.to)}`;
};

const STATUS_TONE: Record<Quarter['status'], Tone> = { later: 'neutral', running: 'info', due: 'warn', late: 'danger', paid: 'ok', nothing: 'neutral' };

/** Which year the page shows: from the address, else this one. */
function useYearParam(): [number, (year: number) => void] {
  const [params, setParams] = useSearchParams();
  const thisYear = Number(todayIso().slice(0, 4));
  const asked = Number(params.get('year'));
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= thisYear + 1 ? asked : thisYear;
  return [
    year,
    (next: number) => {
      const nextParams = new URLSearchParams(params);
      nextParams.set('year', String(next));
      setParams(nextParams, { replace: true });
    },
  ];
}

/** The year's four profit tax instalments (TM), and closing the year once it's over. */
export function YearPage() {
  const t = useT();
  const w = t.year;
  const { role } = useCurrentUser();
  const [year, setYear] = useYearParam();
  const settings = useQuery({ queryKey: ['books', 'settings'], queryFn: booksApi.settings });
  const view = useQuery({ queryKey: ['books', 'year', year], queryFn: () => statementsApi.year(year), placeholderData: keepPreviousData });
  const [paying, setPaying] = useState<Quarter | null>(null);
  const thisYear = Number(todayIso().slice(0, 4));
  const firstYear = Math.min(thisYear - 1, Number(settings.data?.startDay?.slice(0, 4) ?? thisYear));
  const years = Array.from({ length: thisYear - firstYear + 1 }, (_, index) => firstYear + index);

  return (
    <>
      <PageHeader wide title={t.nav.tabs.year} description={w.description} />
      <div className="segmented segmented--chips statements-years" role="radiogroup" aria-label={w.yearLabel}>
        {years.map((value) => (
          <button key={value} type="button" role="radio" aria-checked={year === value} className="segmented__option" onClick={() => setYear(value)}>
            {value}
          </button>
        ))}
      </div>
      {view.isPending && <Loading />}
      {view.isError && <ErrorNotice error={view.error} onRetry={() => view.refetch()} />}
      {view.data && (
        <div className="year-page" aria-busy={view.isFetching}>
          <Section title={w.tm.title} description={w.tm.description(formatPercent(view.data.rate))}>
            {view.data.startsInYear && (
              <p className="notice" role="note">
                {w.tm.startsLate(formatBookDay(view.data.startsInYear))}
              </p>
            )}
            <div className="year-quarters">
              {view.data.quarters.map((quarter) => (
                <QuarterCard key={quarter.quarter} year={view.data.year} quarter={quarter} canPay={canPayTax(role) && !view.data.close.closed} onPay={() => setPaying(quarter)} />
              ))}
            </div>
          </Section>
          <CloseYear data={view.data} canClose={canCloseYear(role)} />
        </div>
      )}
      <Sheet open={paying !== null} onClose={() => setPaying(null)} title={paying ? w.pay.title(paying.quarter, year) : w.tm.title} description={w.pay.description}>
        {paying && <PayForm year={year} quarter={paying} onDone={() => setPaying(null)} />}
      </Sheet>
    </>
  );
}

function QuarterCard({ year, quarter, canPay, onPay }: { year: number; quarter: Quarter; canPay: boolean; onPay: () => void }) {
  const t = useT();
  const w = t.year.tm;
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const undo = useMutation({
    mutationFn: () => statementsApi.undo(quarter.instalment!.id),
    onSuccess: (data) => {
      queryClient.setQueryData(['books', 'year', year], data);
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['attention'] });
      setConfirming(false);
    },
  });
  const status =
    quarter.status === 'due' ? w.status.due(formatBookDay(quarter.due)) : quarter.status === 'late' ? w.status.late(formatBookDay(quarter.due)) : w.status[quarter.status];
  const toPay = quarter.instalment ? quarter.instalment.amount : quarter.suggested;
  return (
    <Card
      className={`year-quarter year-quarter--${quarter.status}`}
      title={w.quarter(quarter.quarter)}
      description={MONTHS_OF(quarter, language)}
      actions={<Badge tone={STATUS_TONE[quarter.status]}>{status}</Badge>}
    >
      {quarter.status === 'later' ? (
        <p className="year-quarter__words">{w.startsOn(formatBookDay(quarter.from))}</p>
      ) : (
        <>
          <dl className="year-quarter__figures">
            <div>
              <dt>{quarter.status === 'running' ? w.profitSoFar : w.profit}</dt>
              <dd>{formatMoney(quarter.profit ?? 0)}</dd>
            </div>
            <div>
              <dt>{w.tax}</dt>
              <dd>{formatMoney(quarter.tax ?? 0)}</dd>
            </div>
            {quarter.paidBefore > 0 && (
              <div>
                <dt>{w.paidBefore}</dt>
                <dd>−{formatMoney(quarter.paidBefore)}</dd>
              </div>
            )}
          </dl>
          <p className="year-quarter__total">
            <span>{quarter.instalment ? w.paid : quarter.status === 'running' ? w.soFar : w.toPay}</span>
            <strong>{formatMoney(toPay ?? 0)}</strong>
          </p>
          <p className="year-quarter__due">{w.dueBy(formatBookDay(quarter.due))}</p>
        </>
      )}
      {quarter.instalment && (
        <div className="year-quarter__paid">
          <p>
            {w.paidOn(formatBookDay(quarter.instalment.paidOn), placeInSentence(t, quarter.instalment.place))}
            {quarter.instalment.by && ` · ${quarter.instalment.by}`}
          </p>
          {quarter.instalment.note && <p className="year-quarter__note">{quarter.instalment.note}</p>}
          <div className="year-quarter__actions">
            {quarter.instalment.entryId && <Link to={`/books/journal?entry=${quarter.instalment.entryId}&period=custom&from=${quarter.instalment.paidOn}&to=${quarter.instalment.paidOn}`}>{w.openEntry}</Link>}
            {canPay &&
              (confirming ? (
                <span className="year-quarter__confirm">
                  <Button size="sm" variant="danger" loading={undo.isPending} onClick={() => undo.mutate()}>
                    {w.takeBackConfirm}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                    {t.common.cancel}
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="danger-text" onClick={() => setConfirming(true)}>
                  {w.takeBack}
                </Button>
              ))}
          </div>
          {undo.isError && (
            <p className="form-error" role="alert">
              {errorMessage(undo.error)}
            </p>
          )}
        </div>
      )}
      {!quarter.instalment && canPay && (quarter.status === 'due' || quarter.status === 'late' || quarter.status === 'nothing') && (
        <Button size="sm" onClick={onPay}>
          {w.markPaid}
        </Button>
      )}
    </Card>
  );
}

function PayForm({ year, quarter, onDone }: { year: number; quarter: Quarter; onDone: () => void }) {
  const t = useT();
  const w = t.year.pay;
  const queryClient = useQueryClient();
  const places = useQuery({ queryKey: ['money', 'places'], queryFn: moneyApi.places });
  const inBooks = (places.data ?? []).filter((place) => place.inBooks && !place.archived);
  const [amount, setAmount] = useState(quarter.suggested ? String(quarter.suggested) : '');
  const [day, setDay] = useState(todayIso());
  const [placeId, setPlaceId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const chosen = placeId ?? inBooks.find((place) => place.kind === 'bank' && place.isDefault)?.id ?? null;
  const place = inBooks.find((candidate) => candidate.id === chosen) ?? null;
  const save = useMutation({
    mutationFn: () => statementsApi.pay(year, { quarter: quarter.quarter, amount: Number(amount), day, placeId: chosen!, note: note.trim() || null }),
    onSuccess: (data) => {
      queryClient.setQueryData(['books', 'year', year], data);
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['money'] });
      queryClient.invalidateQueries({ queryKey: ['attention'] });
      onDone();
    },
  });
  const value = Number(amount);
  const ready = value > 0 && day !== '' && chosen !== null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (ready) save.mutate();
  }

  if (places.isPending) return <Loading />;
  if (places.isError) return <ErrorNotice error={places.error} onRetry={() => places.refetch()} />;
  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <Field label={w.amount} hint={quarter.suggested !== null ? w.amountHint(formatMoney(quarter.suggested)) : undefined}>
        <input type="number" inputMode="decimal" min={0.01} step={0.01} required value={amount} onChange={(event) => setAmount(event.target.value)} />
      </Field>
      <div className="field-row">
        <Field label={w.day}>
          <DateField value={day} max={todayIso()} onChange={setDay} />
        </Field>
        <Field label={w.place}>
          <PlaceSelect places={inBooks} value={chosen} onChange={setPlaceId} required />
        </Field>
      </div>
      <Field label={w.note} hint={w.noteHint}>
        <input maxLength={300} autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {ready && place && <p className="statements-sentence">{w.sentence(formatMoney(value), placeInSentence(t, place), quarter.quarter, year)}</p>}
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!ready || save.isPending} loading={save.isPending}>
          {w.save}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}

function CloseYear({ data, canClose }: { data: BookYear; canClose: boolean }) {
  const t = useT();
  const w = t.year.close;
  const queryClient = useQueryClient();
  const { close, year } = data;
  const [tax, setTax] = useState(String(close.suggestedTax));
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState(false);
  const refresh = (next: BookYear) => {
    queryClient.setQueryData(['books', 'year', year], next);
    queryClient.invalidateQueries({ queryKey: ['books'] });
    queryClient.invalidateQueries({ queryKey: ['attention'] });
  };
  const closeYear = useMutation({
    mutationFn: () => statementsApi.close(year, Number(tax) || 0),
    onSuccess: (next) => {
      refresh(next);
      setConfirming(false);
    },
  });
  const taxValue = Number(tax) || 0;
  const left = taxValue - data.paid;
  const net = close.profitBeforeTax - taxValue;

  if (close.closed) {
    return (
      <Card
        className="year-close year-close--closed"
        title={w.title(year)}
        actions={
          <Badge tone="ok">
            <LockSimple size={12} aria-hidden="true" /> {w.closedStamp}
          </Badge>
        }
      >
        <p>{w.closedLine(formatBookDay(close.closed.at.slice(0, 10)), close.closed.by)}</p>
        <dl className="year-close__figures">
          <div>
            <dt>{w.profitBeforeTax}</dt>
            <dd>{formatMoney(close.closed.profit)}</dd>
          </div>
          <div>
            <dt>{w.tax(formatPercent(data.rate))}</dt>
            <dd>{formatMoney(close.closed.tax)}</dd>
          </div>
          <div>
            <dt>{w.intoRetained}</dt>
            <dd>{formatMoney(close.closed.profit - close.closed.tax)}</dd>
          </div>
        </dl>
        <div className="year-close__actions">
          {close.closed.closeEntryId && <Link to={`/books/journal?entry=${close.closed.closeEntryId}&period=custom&from=${year}-12-31&to=${year}-12-31`}>{w.openEntry}</Link>}
          {close.canReopen && (
            <Button size="sm" onClick={() => setReopening(true)}>
              {w.reopen}
            </Button>
          )}
        </div>
        <Sheet open={reopening} onClose={() => setReopening(false)} title={w.reopenTitle(year)} description={w.reopenHint}>
          {reopening && <ReopenForm year={year} onDone={(next) => { if (next) refresh(next); setReopening(false); }} />}
        </Sheet>
      </Card>
    );
  }

  const blocker = close.blockers[0];
  const blockedWords =
    blocker === 'not_over' ? w.blockers.not_over(year) : blocker === 'earlier_open' ? w.blockers.earlier_open(close.earlierOpen ?? year - 1) : blocker === 'empty' ? w.blockers.empty(year) : null;
  return (
    <Card className="year-close" title={w.title(year)} description={w.description}>
      <dl className="year-close__figures">
        <div>
          <dt>{w.profitBeforeTax}</dt>
          <dd>{formatMoney(close.profitBeforeTax)}</dd>
        </div>
        <div>
          <dt>
            <label htmlFor="year-close-tax">{w.tax(formatPercent(data.rate))}</label>
          </dt>
          <dd>
            {canClose && !blocker ? (
              <input id="year-close-tax" className="year-close__tax" type="number" inputMode="decimal" min={0} step={0.01} value={tax} aria-describedby="year-close-tax-hint" onChange={(event) => setTax(event.target.value)} />
            ) : (
              formatMoney(close.suggestedTax)
            )}
          </dd>
        </div>
        <div>
          <dt>{w.paidTm}</dt>
          <dd>−{formatMoney(data.paid)}</dd>
        </div>
        <div className="year-close__strong">
          <dt>{left >= 0 ? w.leftToPay : w.overpaid}</dt>
          <dd>{formatMoney(Math.abs(left))}</dd>
        </div>
        <div className="year-close__strong">
          <dt>{w.intoRetained}</dt>
          <dd>{formatMoney(net)}</dd>
        </div>
      </dl>
      {canClose && !blocker && (
        <p id="year-close-tax-hint" className="field__hint">
          {w.taxHint}
        </p>
      )}
      <ul className="year-close__what">
        {w.what(year).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {close.unfiledMonths.length > 0 && (
        <p className="notice notice--warn" role="status">
          {w.unfiled(close.unfiledMonths.length)}
        </p>
      )}
      {closeYear.isError && (
        <p className="form-error" role="alert">
          {errorMessage(closeYear.error)}
        </p>
      )}
      <div className="year-close__actions">
        {!canClose ? (
          <p className="year-close__why">{w.onlyRoles}</p>
        ) : confirming ? (
          <div className="year-close__confirm" role="group" aria-label={w.confirmTitle(year)}>
            <p>{w.confirmText(year)}</p>
            <span>
              <Button variant="primary" loading={closeYear.isPending} onClick={() => closeYear.mutate()}>
                {w.confirm(year)}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t.common.cancel}
              </Button>
            </span>
          </div>
        ) : (
          <>
            <Button variant={blocker ? 'secondary' : 'primary'} disabled={Boolean(blocker)} onClick={() => setConfirming(true)} aria-describedby={blockedWords ? 'year-close-why' : undefined}>
              {w.button(year)}
            </Button>
            {blockedWords && (
              <p id="year-close-why" className="year-close__why">
                {blockedWords}
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function ReopenForm({ year, onDone }: { year: number; onDone: (next: BookYear | null) => void }) {
  const t = useT();
  const w = t.year.close;
  const [reason, setReason] = useState('');
  const reopen = useMutation({ mutationFn: () => statementsApi.reopen(year, reason), onSuccess: (next) => onDone(next) });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    reopen.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <Field label={w.reason} hint={w.reasonHint}>
        <textarea required minLength={3} maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {reopen.isError && (
        <p className="form-error" role="alert">
          {errorMessage(reopen.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="danger" disabled={reason.trim().length < 3 || reopen.isPending} loading={reopen.isPending}>
          {w.reopenButton(year)}
        </Button>
        <Button variant="ghost" onClick={() => onDone(null)}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}

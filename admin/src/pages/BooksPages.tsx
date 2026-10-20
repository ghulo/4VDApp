import { Books, LockSimple, Plus, PencilSimple } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useCallback, useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { canManage, canWriteEntries } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import {
  BalanceFigure,
  BooksDownload,
  BooksDownloads,
  cardPath,
  EntryBadges,
  EntryById,
  formatBalance,
  formatBookDay,
  kindLabel,
  linkLabel,
  warningText,
} from '../components/BooksParts';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { PeriodPicker } from '../components/PeriodPicker';
import { SearchInput } from '../components/SearchInput';
import { SourceFilter, sourceFrom, TrefinTag } from '../components/TrefinParts';
import {
  Badge,
  Button,
  ButtonLink,
  DataTable,
  DateField,
  EmptyState,
  Field,
  Inspector,
  InspectorLayout,
  PageHeader,
  Sheet,
  StatGrid,
  StatTile,
  useNewSheet,
} from '../components/ui';
import { useT } from '../i18n/useT';
import { booksApi, customersApi, suppliersApi, vatApi } from '../services/api';
import {
  ACCOUNT_CLASSES,
  CASH_FLOW_ACTIVITIES,
  type AccountClass,
  type AccountInput,
  type AccountLinkKey,
  type CardLine,
  type CashFlowActivity,
  type LedgerAccount,
  type LedgerEntry,
  type RecordSource,
  type TrialBalanceRow,
} from '../services/types';
import { todayIso } from '../utils/bills';
import { errorMessage } from '../utils/errors';
import { formatHeadlineMoney, formatMoney } from '../utils/format';
import { BOOKS_PERIOD_KEYS, periodDays } from '../utils/periods';
import { usePeriodParams } from '../utils/usePeriodParams';
import { useWarnBeforeLeaving } from '../utils/useWarnBeforeLeaving';

const CLASS_ORDER = (accountClass: AccountClass) => ACCOUNT_CLASSES.indexOf(accountClass);
const cents = (amount: number) => Math.round(amount * 100);
/** Lines per page on an account card: a busy till account has thousands a year. */
const CARD_PAGE = 100;

/** The period the books pages show, as first and last day. */
function useBooksPeriod() {
  const params = usePeriodParams('this-month');
  const days = useMemo(() => periodDays(params.rangeKey), [params.rangeKey]);
  return { ...params, days };
}

function useAccounts() {
  return useQuery({ queryKey: ['books', 'accounts'], queryFn: booksApi.accounts });
}

/** The id of the account a kind of movement goes to. */
const linkedAccount = (accounts: LedgerAccount[] | undefined, key: AccountLinkKey) => accounts?.find((account) => account.links.includes(key));

/**
 * One entry opened from a list, by its number: beside the list on a wide screen,
 * in a sheet otherwise. The row it came from stays marked.
 */
function useEntryInspector(initial: number | null = null) {
  const t = useT();
  const [openId, setOpenId] = useState<number | null>(initial);
  // The title stays while the sheet slides out.
  const [shownId, setShownId] = useState<number | null>(initial);
  const open = useCallback((id: number) => {
    setOpenId(id);
    setShownId(id);
  }, []);
  const inspector = (
    <Inspector open={openId !== null} onClose={() => setOpenId(null)} title={shownId ? (shownId < 0 ? t.fromTrefin.entryTitle : t.books.entryTitle(shownId)) : t.books.title}>
      {openId !== null && <EntryById key={openId} id={openId} onOpen={open} />}
    </Inspector>
  );
  return { open, openId, inspector };
}

/** The VAT months filed with ATK ("2026-09"); nothing dated in them can change. */
function useFiledMonths() {
  const filed = useQuery({ queryKey: ['vat', 'filed'], queryFn: vatApi.filed, staleTime: 60_000 });
  return useMemo(() => new Set(filed.data ?? []), [filed.data]);
}

/** A small lock stamp on something dated in a filed VAT month. */
function FiledStamp() {
  const t = useT();
  return (
    <span className="books-filed" title={t.vat.filedNote}>
      <LockSimple size={12} aria-hidden="true" />
      <span className="visually-hidden">{t.vat.stamp.filed}</span>
    </span>
  );
}

/** Marks the row whose entry is open, and steps back corrections. */
const rowClass = (selected: boolean, ...rest: Array<string | false | undefined>) =>
  [selected && 'table__row--selected', ...rest].filter(Boolean).join(' ') || undefined;

/* ---------- Balances ---------- */

/** What each account held in a period: the trial balance, with the figures that matter on top. */
export function BooksBalancesPage() {
  const t = useT();
  const { search } = useLocation();
  const { period, from, to, range, days, changePeriod } = useBooksPeriod();
  const balances = useQuery({ queryKey: ['books', 'trial-balance', days], queryFn: () => booksApi.trialBalance(days), placeholderData: keepPreviousData });
  const accounts = useAccounts();
  const settings = useQuery({ queryKey: ['books', 'settings'], queryFn: booksApi.settings });

  const rows = useMemo(
    () =>
      [...(balances.data?.rows ?? [])].sort((a, b) => CLASS_ORDER(a.accountClass) - CLASS_ORDER(b.accountClass) || a.number.localeCompare(b.number)),
    [balances.data],
  );
  const debits = rows.reduce((sum, row) => sum + row.debit, 0);
  const credits = rows.reduce((sum, row) => sum + row.credit, 0);
  const startDay = settings.data?.startDay;

  return (
    <>
      <PageHeader title={t.nav.items.books} description={t.books.description(range.label)} />
      {balances.isPending && <Loading />}
      {balances.isError && <ErrorNotice error={balances.error} onRetry={() => balances.refetch()} />}
      {balances.data && (
        <>
          <BalanceTiles rows={balances.data.rows} accounts={accounts.data} search={search} />
          {balances.data.warnings.map((warning) => (
            <div key={warning.warning} className="notice notice--warn" role="status">
              <span>{warning.warning === 'no_vat' ? t.books.warnings.no_vat(warning.items) : t.books.warnings.no_cost(warning.items)}</span>
              <ButtonLink size="sm" to={warning.warning === 'no_vat' ? '/bills' : '/products'}>
                {t.books.warningAction[warning.warning]}
              </ButtonLink>
            </div>
          ))}
          <DataTable<TrialBalanceRow>
            caption={t.books.caption(range.label)}
            rows={rows}
            rowKey={(row) => row.accountId}
            density="compact"
            toolbar={
              <div className="toolbar">
                <PeriodPicker compact period={period} from={from} to={to} onChange={changePeriod} periods={BOOKS_PERIOD_KEYS} />
                <div className="toolbar__end">
                  <BooksDownloads
                    period={days}
                    items={[
                      { what: 'trial-balance', label: t.books.downloads['trial-balance'] },
                      { what: 'ledger', label: t.books.downloads.ledger },
                    ]}
                  />
                </div>
              </div>
            }
            group={(row) => ({ key: row.accountClass, heading: t.books.classes[row.accountClass] })}
            empty={
              <EmptyState icon={Books} title={t.books.empty}>
                {startDay ? t.books.emptyHint(formatBookDay(startDay)) : t.books.emptyNoStart}
              </EmptyState>
            }
            columns={[
              {
                header: t.books.account,
                title: true,
                cell: (row) => (
                  <Link className="table__primary-link" to={cardPath(row.accountId, search)}>
                    <span className="books-number">{row.number}</span> {row.name}
                  </Link>
                ),
              },
              { header: t.books.opening, align: 'end', className: 'table__phone-hide', cell: (row) => formatBalance(t, row.opening) },
              { header: t.books.debit, align: 'end', cell: (row) => (row.debit ? formatMoney(row.debit) : '–') },
              { header: t.books.credit, align: 'end', cell: (row) => (row.credit ? formatMoney(row.credit) : '–') },
              { header: t.books.closing, align: 'end', cell: (row) => formatBalance(t, row.closing) },
            ]}
            totals={[
              <span key="stamp" className="books-totals-label">
                {t.books.totals}
                <BalanceStamp debits={debits} credits={credits} />
              </span>,
              '',
              formatMoney(debits),
              formatMoney(credits),
              '',
            ]}
            footer={
              rows.length > 0 &&
              cents(debits) !== cents(credits) && (
                <p className="books-total books-total--off" role="alert">
                  {t.books.unbalanced(formatMoney(Math.abs(debits - credits)))}
                </p>
              )
            }
          />
        </>
      )}
    </>
  );
}

/** The stamp under a trial balance: debits and credits agree, or by how much they don't. */
function BalanceStamp({ debits, credits }: { debits: number; credits: number }) {
  const t = useT();
  return cents(debits) === cents(credits) ? (
    <Badge tone="ok">{t.books.stamp.balanced}</Badge>
  ) : (
    <Badge tone="danger">{t.books.stamp.off(formatMoney(Math.abs(debits - credits)))}</Badge>
  );
}

/** Cash, stock, what is owed each way, and the period's VAT, each linking to its account. */
function BalanceTiles({ rows, accounts, search }: { rows: TrialBalanceRow[]; accounts: LedgerAccount[] | undefined; search: string }) {
  const t = useT();
  const row = (key: AccountLinkKey) => {
    const account = linkedAccount(accounts, key);
    return { account, row: account ? rows.find((candidate) => candidate.accountId === account.id) : undefined };
  };
  const closing = (key: AccountLinkKey) => row(key).row?.closing ?? 0;
  const to = (key: AccountLinkKey) => {
    const account = row(key).account;
    return account ? cardPath(account.id, search) : undefined;
  };
  const vatOut = row('vat_out').row;
  const vatIn = row('vat_in').row;
  const vatDue = (vatOut ? vatOut.credit - vatOut.debit : 0) - (vatIn ? vatIn.debit - vatIn.credit : 0);
  // Every till, safe and bank account sits under 1110 or 1120.
  const cashAndBank = rows.filter((candidate) => /^11[12]/.test(candidate.number)).reduce((sum, candidate) => sum + candidate.closing, 0);

  return (
    <StatGrid compact>
      <StatTile label={t.books.tiles.cashAndBank} value={formatHeadlineMoney(cashAndBank)} to="/money" />
      <StatTile label={t.books.tiles.stock} value={formatHeadlineMoney(closing('stock'))} to={to('stock')} />
      <StatTile label={t.books.tiles.suppliers} value={formatHeadlineMoney(0 - closing('payables'))} to={to('payables')} />
      <StatTile label={t.books.tiles.customers} value={formatHeadlineMoney(closing('receivables'))} to={to('receivables')} />
      <StatTile
        label={t.books.tiles.vat}
        value={formatHeadlineMoney(vatDue)}
        words={vatDue < 0 && t.books.tiles.vatBack(formatMoney(-vatDue))}
        hint={t.books.tiles.vatHint}
        to={to('vat_out')}
      />
    </StatGrid>
  );
}

/* ---------- Entries ---------- */

/** Every entry in a period, newest first, with writing one by hand. */
export function BooksJournalPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const search = params.get('q') ?? '';
  const corrections = params.get('corrections') === '1';
  const source = sourceFrom(params);
  const { period, from, to, range, days, changePeriod } = useBooksPeriod();
  const entries = useQuery({
    queryKey: ['books', 'journal', { ...days, page, search, corrections, source }],
    queryFn: () => booksApi.journal({ ...days, page, search: search || undefined, corrections, source }),
    placeholderData: keepPreviousData,
  });
  const settings = useQuery({ queryKey: ['books', 'settings'], queryFn: booksApi.settings });
  const [adding, setAdding] = useNewSheet();
  // A link from a question in To do opens its entry (?entry=40).
  const { open, openId, inspector } = useEntryInspector(Number(params.get('entry')) || null);
  const filed = useFiledMonths();

  const update = useCallback(
    (changes: Record<string, string>) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (!('page' in changes)) next.delete('page');
        return next;
      }),
    [setParams],
  );
  const onSearch = useCallback((value: string) => update({ q: value }), [update]);
  const startDay = settings.data?.startDay;

  return (
    <>
      <PageHeader
        title={t.nav.tabs.journal}
        description={t.books.journalDescription(range.label)}
        actions={
          <>
            {canWriteEntries(role) && (
              <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
                {t.books.newEntry}
              </Button>
            )}
          </>
        }
      />
      {entries.isPending && <Loading />}
      {entries.isError && <ErrorNotice error={entries.error} onRetry={() => entries.refetch()} />}
      {entries.data && (
        <InspectorLayout open={openId !== null}>
          <div className="inspector-layout__list">
            <DataTable<LedgerEntry>
              caption={t.books.entryCaption}
              rows={entries.data.items}
              rowKey={(entry) => entry.id}
              density="compact"
              onRowClick={(entry) => open(entry.id)}
              rowClassName={(entry) => rowClass(entry.id === openId, (entry.reversed || entry.kind === 'reversal') && 'books-row--old')}
              toolbar={
                <div className="toolbar">
                  <PeriodPicker compact period={period} from={from} to={to} onChange={changePeriod} periods={BOOKS_PERIOD_KEYS} />
                  <SearchInput value={search} onChange={onSearch} label={t.books.searchPlaceholder} />
                  <SourceFilter value={source} onChange={(next) => update({ source: next ?? '' })} />
                  <label className="toggle" title={t.books.correctionsHint}>
                    <input type="checkbox" checked={corrections} onChange={(event) => update({ corrections: event.target.checked ? '1' : '' })} />
                    {t.books.corrections}
                  </label>
                  <div className="toolbar__end">
                    <BooksDownload what="journal" period={days} label={t.books.downloads.journal} />
                  </div>
                </div>
              }
              empty={
                <EmptyState icon={Books} title={t.books.empty}>
                  {startDay ? t.books.emptyHint(formatBookDay(startDay)) : t.books.emptyNoStart}
                </EmptyState>
              }
              columns={[
                {
                  header: t.books.date,
                  className: 'books-date',
                  cell: (entry) => (
                    <>
                      {formatBookDay(entry.date)}
                      {!entry.trefin && filed.has(entry.date.slice(0, 7)) && <FiledStamp />}
                    </>
                  ),
                },
                {
                  header: t.books.what,
                  title: true,
                  className: 'books-kind',
                  cell: (entry) => (
                    <>
                      {kindLabel(t, entry)}
                      {entry.trefin && <> <TrefinTag /></>}
                    </>
                  ),
                },
                { header: t.books.descriptionColumn, className: 'books-description', cell: (entry) => entry.description },
                {
                  header: t.nav.tabs.accounts,
                  className: 'table__phone-hide table__dock-hide books-accounts',
                  cell: (entry) => [...new Set(entry.lines.map((line) => line.accountNumber))].join(', '),
                },
                {
                  header: <span className="visually-hidden">{t.books.correction}</span>,
                  cell: (entry) => <EntryBadges entry={entry} />,
                },
                { header: t.books.amount, align: 'end', cell: (entry) => formatMoney(entry.total) },
                {
                  header: <span className="visually-hidden">{t.books.openColumn}</span>,
                  align: 'end',
                  cell: (entry) =>
                    entry.trefin ? (
                      <Button size="sm" variant="ghost" aria-label={t.fromTrefin.open} onClick={() => open(entry.id)}>
                        {t.fromTrefin.openShort}
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" aria-label={t.books.open(entry.id)} onClick={() => open(entry.id)}>
                        #{entry.id}
                      </Button>
                    ),
                },
              ]}
              footer={<Pagination meta={entries.data.meta} onPageChange={(next) => update({ page: String(next) })} itemLabel={t.books.entriesWord} />}
            />
          </div>
          {inspector}
        </InspectorLayout>
      )}
      <Sheet open={adding} onClose={() => setAdding(false)} title={t.books.newEntry}>
        <ManualEntryForm
          startDay={startDay ?? null}
          onSaved={(entry) => {
            setAdding(false);
            open(entry.id);
          }}
        />
      </Sheet>
    </>
  );
}

interface LineDraft {
  key: number;
  accountId: string;
  debit: string;
  credit: string;
  party: string;
  memo: string;
}

const emptyLine = (key: number): LineDraft => ({ key, accountId: '', debit: '', credit: '', party: '', memo: '' });

/** An entry written by hand: lines that must balance, checked while typing. */
function ManualEntryForm({ startDay, onSaved }: { startDay: string | null; onSaved: (entry: LedgerEntry) => void }) {
  const t = useT();
  const f = t.books.entryForm;
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list });
  const [date, setDate] = useState(() => (startDay && startDay > todayIso() ? startDay : todayIso()));
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine(1), emptyLine(2)]);

  const save = useMutation({
    mutationFn: () =>
      booksApi.addEntry({
        date,
        description: description.trim(),
        lines: filled.map((line) => ({
          accountId: Number(line.accountId),
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          supplierId: line.party.startsWith('supplier:') ? Number(line.party.split(':')[1]) : null,
          customerId: line.party.startsWith('customer:') ? Number(line.party.split(':')[1]) : null,
          memo: line.memo.trim() || null,
        })),
      }),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      onSaved(entry);
    },
  });

  const setLine = (key: number, patch: Partial<LineDraft>) => {
    save.reset();
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };
  const bothSides = (line: LineDraft) => Number(line.debit) > 0 && Number(line.credit) > 0;
  const hasAmount = (line: LineDraft) => Number(line.debit) > 0 || Number(line.credit) > 0;
  useWarnBeforeLeaving((description.trim() !== '' || lines.some((line) => hasAmount(line) || line.accountId !== '')) && !save.isPending && !save.isSuccess);
  const filled = lines.filter((line) => line.accountId !== '' && hasAmount(line) && !bothSides(line));
  const debits = filled.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
  const credits = filled.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
  const gap = cents(debits) - cents(credits);
  const missingAccount = lines.some((line) => line.accountId === '' && hasAmount(line));
  const isValid =
    description.trim() !== '' && date !== '' && filled.length >= 2 && gap === 0 && !lines.some(bothSides) && !missingAccount;

  const open = (accounts.data ?? []).filter((account) => !account.archived);
  const byClass = ACCOUNT_CLASSES.map((accountClass) => ({ accountClass, accounts: open.filter((account) => account.accountClass === accountClass) })).filter(
    (group) => group.accounts.length > 0,
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isValid) save.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <Field label={f.description}>
        <input required maxLength={300} autoComplete="off" placeholder={f.descriptionPlaceholder} value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <Field label={t.books.date} narrow>
        <DateField required min={startDay ?? undefined} value={date} onChange={(value) => setDate(value)} />
      </Field>
      {accounts.isError && <ErrorNotice error={accounts.error} onRetry={() => accounts.refetch()} />}
      {lines.map((line, index) => (
        <fieldset key={line.key} className="books-line">
          <legend className="books-line__legend">{f.line(index + 1)}</legend>
          <Field label={f.account} error={line.accountId === '' && hasAmount(line) ? f.pickAccount : undefined}>
            <select value={line.accountId} onChange={(event) => setLine(line.key, { accountId: event.target.value })}>
              <option value="">{f.pickAccount}</option>
              {byClass.map((group) => (
                <optgroup key={group.accountClass} label={t.books.classes[group.accountClass]}>
                  {group.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.number} {account.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <div className="field-row">
            <Field label={t.books.debit} error={bothSides(line) ? f.oneSide : undefined}>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                autoComplete="off"
                aria-invalid={bothSides(line)}
                value={line.debit}
                onChange={(event) => setLine(line.key, { debit: event.target.value })}
              />
            </Field>
            <Field label={t.books.credit}>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                autoComplete="off"
                aria-invalid={bothSides(line)}
                value={line.credit}
                onChange={(event) => setLine(line.key, { credit: event.target.value })}
              />
            </Field>
          </div>
          <div className="field-row">
            <Field label={f.partner}>
              <select value={line.party} onChange={(event) => setLine(line.key, { party: event.target.value })}>
                <option value="">{f.none}</option>
                {suppliers.data && suppliers.data.length > 0 && (
                  <optgroup label={f.suppliers}>
                    {suppliers.data.map((supplier) => (
                      <option key={supplier.id} value={`supplier:${supplier.id}`}>
                        {supplier.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {customers.data && customers.data.length > 0 && (
                  <optgroup label={f.customers}>
                    {customers.data.map((customer) => (
                      <option key={customer.id} value={`customer:${customer.id}`}>
                        {customer.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Field>
            <Field label={f.memo}>
              <input maxLength={300} autoComplete="off" value={line.memo} onChange={(event) => setLine(line.key, { memo: event.target.value })} />
            </Field>
          </div>
          {lines.length > 2 && (
            <Button variant="danger-text" size="sm" onClick={() => setLines((current) => current.filter((other) => other.key !== line.key))}>
              {f.removeLine(index + 1)}
            </Button>
          )}
        </fieldset>
      ))}
      <Button variant="ghost" icon={Plus} onClick={() => setLines((current) => [...current, emptyLine(Math.max(...current.map((line) => line.key)) + 1)])}>
        {f.addLine}
      </Button>
      <div className={gap === 0 && debits > 0 ? 'books-check books-check--ok' : 'books-check'} role="status">
        <span>{f.totals(formatMoney(debits), formatMoney(credits))}</span>
        <span>
          {filled.length < 2
            ? f.needTwo
            : gap === 0
              ? f.balancedPreview(formatMoney(debits))
              : f.short(formatMoney(Math.abs(gap) / 100), gap > 0 ? 'credit' : 'debit')}
        </span>
      </div>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={!isValid || save.isPending} loading={save.isPending}>
        {f.save}
      </Button>
    </form>
  );
}

/* ---------- Accounts ---------- */

/** The chart of accounts, grouped by kind, with adding one. */
export function BooksAccountsPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const { search: query } = useLocation();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const showArchived = params.get('archived') === '1';
  const accounts = useAccounts();
  const [adding, setAdding] = useNewSheet();

  const setParam = useCallback(
    (key: string, value: string) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      }),
    [setParams],
  );
  const onSearch = useCallback((value: string) => setParam('q', value), [setParam]);

  const rows = useMemo(() => {
    const words = search.toLocaleLowerCase();
    return (accounts.data ?? [])
      .filter((account) => showArchived || !account.archived)
      .filter((account) => !words || account.number.startsWith(words) || account.name.toLocaleLowerCase().includes(words))
      .sort((a, b) => CLASS_ORDER(a.accountClass) - CLASS_ORDER(b.accountClass) || a.number.localeCompare(b.number));
  }, [accounts.data, search, showArchived]);

  return (
    <>
      <PageHeader
        title={t.nav.tabs.accounts}
       
        actions={
          canManage(role) && (
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              {t.books.accounts.add}
            </Button>
          )
        }
      />
      {accounts.isPending && <Loading />}
      {accounts.isError && <ErrorNotice error={accounts.error} onRetry={() => accounts.refetch()} />}
      {accounts.data && (
        <DataTable<LedgerAccount>
          caption={t.nav.tabs.accounts}
          rows={rows}
          rowKey={(account) => account.id}
          density="compact"
          group={(account) => ({ key: account.accountClass, heading: t.books.classes[account.accountClass] })}
          toolbar={
            <div className="toolbar">
              <SearchInput value={search} onChange={onSearch} label={t.books.accounts.searchPlaceholder} />
              <label className="toggle">
                <input type="checkbox" checked={showArchived} onChange={(event) => setParam('archived', event.target.checked ? '1' : '')} />
                {t.books.accounts.showArchived}
              </label>
            </div>
          }
          empty={
            <EmptyState icon={Books} title={t.books.accounts.noMatch}>
              {t.books.accounts.noMatchHint}
            </EmptyState>
          }
          columns={[
            {
              header: t.books.account,
              title: true,
              cell: (account) => (
                <>
                  <Link className="table__primary-link" to={cardPath(account.id, query.includes('period') ? query : '')}>
                    <span className="books-number">{account.number}</span> {account.name}
                  </Link>
                  <span className="table__secondary">{account.group}</span>
                </>
              ),
            },
            {
              header: t.books.accounts.postsHere,
              className: 'table__phone-hide',
              cell: (account) =>
                account.links.length > 0 || account.archived ? (
                  <span className="books-links">
                    {account.archived && <Badge tone="neutral">{t.books.accounts.archived}</Badge>}
                    {account.links.map((key) => (
                      <Badge key={key} tone="info">
                        {linkLabel(t, key)}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  ''
                ),
            },
            {
              header: t.books.balance,
              align: 'end',
              cell: (account) => (account.used ? formatMoney(account.balance) : <span className="table__secondary">{t.books.accounts.noEntries}</span>),
            },
          ]}
        />
      )}
      <Sheet open={adding} onClose={() => setAdding(false)} title={t.books.accounts.add} description={t.books.accounts.numberHint}>
        <AccountForm accounts={accounts.data ?? []} onSaved={() => setAdding(false)} />
      </Sheet>
    </>
  );
}

/** The kind of account its first digit usually means, as in TREFIN's chart. */
function classFromNumber(number: string): AccountClass | null {
  const byDigit: Record<string, AccountClass> = { '1': 'asset', '2': 'liability', '3': 'equity', '4': 'revenue', '5': 'cost_of_sales', '6': 'expense' };
  return byDigit[number[0] ?? ''] ?? null;
}

/** Adding an account, or changing one: its number and kind stay once it has entries. */
function AccountForm({ accounts, account, onSaved }: { accounts: LedgerAccount[]; account?: LedgerAccount; onSaved: () => void }) {
  const t = useT();
  const a = t.books.accounts;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AccountInput>(() =>
    account
      ? { number: account.number, name: account.name, accountClass: account.accountClass, type: account.type, group: account.group, cashFlow: account.cashFlow }
      : { number: '', name: '', accountClass: 'expense', type: '', group: '', cashFlow: 'operating' },
  );
  const [classPicked, setClassPicked] = useState(Boolean(account));
  const locked = Boolean(account?.used);

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['books'] });
    queryClient.invalidateQueries({ queryKey: ['activity'] });
  };
  const save = useMutation({
    mutationFn: () =>
      account
        ? booksApi.updateAccount(account.id, locked ? { name: draft.name, type: draft.type, group: draft.group, cashFlow: draft.cashFlow } : draft)
        : booksApi.addAccount(draft),
    onSuccess: () => {
      done();
      onSaved();
    },
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => booksApi.updateAccount(account!.id, { archived }),
    onSuccess: () => {
      done();
      onSaved();
    },
  });

  const set = (patch: Partial<AccountInput>) => {
    save.reset();
    setDraft((current) => ({ ...current, ...patch }));
  };
  const numberTaken = !locked && accounts.some((other) => other.number === draft.number && other.id !== account?.id);
  const numberOk = /^[0-9]{3,10}$/.test(draft.number);
  const isValid = numberOk && !numberTaken && draft.name.trim() !== '';
  const groups = [...new Set(accounts.filter((other) => other.accountClass === draft.accountClass).map((other) => other.group))].sort();
  const types = [...new Set(accounts.map((other) => other.type).filter(Boolean))].sort();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isValid) save.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      {locked && <p className="field-hint">{a.locked}</p>}
      <div className="field-row">
        <Field label={a.number} error={draft.number !== '' && !numberOk ? a.numberHint : numberTaken ? a.taken(draft.number) : undefined}>
          <input
            required
            disabled={locked}
            inputMode="numeric"
            maxLength={10}
            autoComplete="off"
            value={draft.number}
            aria-invalid={(draft.number !== '' && !numberOk) || numberTaken}
            onChange={(event) => {
              const number = event.target.value.replace(/\D/g, '');
              const guessed = classPicked ? null : classFromNumber(number);
              set({ number, ...(guessed ? { accountClass: guessed } : {}) });
            }}
          />
        </Field>
        <Field label={a.kind}>
          <select
            disabled={locked}
            value={draft.accountClass}
            onChange={(event) => {
              setClassPicked(true);
              set({ accountClass: event.target.value as AccountClass });
            }}
          >
            {ACCOUNT_CLASSES.map((accountClass) => (
              <option key={accountClass} value={accountClass}>
                {t.books.classes[accountClass]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={a.name}>
        <input required maxLength={200} autoComplete="off" value={draft.name} onChange={(event) => set({ name: event.target.value })} />
      </Field>
      <div className="field-row">
        <Field label={a.group}>
          <input list="books-groups" maxLength={200} autoComplete="off" value={draft.group} onChange={(event) => set({ group: event.target.value })} />
          <datalist id="books-groups">
            {groups.map((group) => (
              <option key={group} value={group} />
            ))}
          </datalist>
        </Field>
        <Field label={a.type}>
          <input list="books-types" maxLength={200} autoComplete="off" value={draft.type} onChange={(event) => set({ type: event.target.value })} />
          <datalist id="books-types">
            {types.map((type) => (
              <option key={type} value={type} />
            ))}
          </datalist>
        </Field>
      </div>
      <Field label={a.cashFlow}>
        <select value={draft.cashFlow} onChange={(event) => set({ cashFlow: event.target.value as CashFlowActivity })}>
          {CASH_FLOW_ACTIVITIES.map((activity) => (
            <option key={activity} value={activity}>
              {t.books.cashFlow[activity]}
            </option>
          ))}
        </select>
      </Field>
      {(save.isError || archive.isError) && (
        <p className="form-error" role="alert">
          {errorMessage(save.error ?? archive.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!isValid || save.isPending} loading={save.isPending}>
          {a.save}
        </Button>
        {account && (
          <Button variant={account.archived ? 'secondary' : 'danger-text'} loading={archive.isPending} disabled={archive.isPending} onClick={() => archive.mutate(!account.archived)}>
            {account.archived ? a.unarchive : a.archive}
          </Button>
        )}
      </div>
      {account && !account.archived && <p className="field-hint">{a.archiveHint}</p>}
    </form>
  );
}

/* ---------- Account card ---------- */

type CardRow = CardLine & { opening?: true };

/** Every movement on one account in a period, with the balance after each. */
export function AccountCardPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const { id } = useParams();
  const accountId = Number(id);
  const { search } = useLocation();
  const [params, setParams] = useSearchParams();
  const corrections = params.get('corrections') === '1';
  const page = Number(params.get('page') ?? 1);
  const source = sourceFrom(params);
  const { period, from, to, days, changePeriod } = useBooksPeriod();
  const card = useQuery({
    queryKey: ['books', 'card', accountId, days, corrections, source],
    queryFn: () => booksApi.card(accountId, days, corrections, source),
    placeholderData: keepPreviousData,
  });
  const accounts = useAccounts();
  const [editing, setEditing] = useState(false);
  const { open, openId, inspector } = useEntryInspector();

  if (card.isPending) return <Loading />;
  if (card.isError) return <ErrorNotice error={card.error} onRetry={() => card.refetch()} />;
  const { account } = card.data;
  const keptSearch = search.replace(/[?&](corrections|page|source)=[^&]*/g, '').replace(/^&/, '?');
  const setSource = (next: RecordSource | undefined) =>
    setParams((current) => {
      const updated = new URLSearchParams(current);
      if (next) updated.set('source', next);
      else updated.delete('source');
      updated.delete('page');
      return updated;
    });
  // With both, the balances on top are 4VD's, so TREFIN's lines show none of their own.
  const mixed = source === undefined;
  const pageLines = card.data.lines.slice((page - 1) * CARD_PAGE, page * CARD_PAGE);
  const opening: CardRow[] = [
    {
      entryId: 0,
      date: days.from,
      kind: 'manual',
      source: null,
      description: t.books.card.openingRow,
      warning: null,
      party: null,
      memo: null,
      debit: 0,
      credit: 0,
      balance: card.data.opening,
      correction: false,
      target: null,
      opening: true,
    },
  ];
  // The balance before the period heads the first page; each line carries its own running balance.
  const rows = page === 1 ? [...opening, ...pageLines] : pageLines;
  const setPage = (next: number) =>
    setParams((current) => {
      const updated = new URLSearchParams(current);
      if (next > 1) updated.set('page', String(next));
      else updated.delete('page');
      return updated;
    });

  return (
    <>
      <PageHeader
        title={`${account.number} ${account.name}`}
        description={`${t.books.classes[account.accountClass]} · ${account.group}`}
        crumbs={[
          { label: t.nav.items.books, to: `/books${keptSearch}` },
          { label: t.nav.tabs.accounts, to: '/books/accounts' },
        ]}
        meta={
          <>
            {account.archived && <Badge tone="neutral">{t.books.accounts.archived}</Badge>}
            {account.links.map((key) => (
              <Badge key={key} tone="info">
                {linkLabel(t, key)}
              </Badge>
            ))}
          </>
        }
        actions={
          canManage(role) && (
            <Button icon={PencilSimple} onClick={() => setEditing(true)}>
              {t.books.accounts.edit}
            </Button>
          )
        }
      />
      <StatGrid compact>
        <StatTile label={t.books.opening} value={<BalanceFigure balance={card.data.opening} />} />
        <StatTile label={t.books.debit} value={formatMoney(card.data.debit)} />
        <StatTile label={t.books.credit} value={formatMoney(card.data.credit)} />
        <StatTile label={t.books.closing} value={<BalanceFigure balance={card.data.closing} />} />
      </StatGrid>
      <InspectorLayout open={openId !== null}>
        <div className="inspector-layout__list">
          <DataTable<CardRow>
            caption={t.books.card.caption(`${account.number} ${account.name}`)}
            rows={rows}
            rowKey={(row) => (row.opening ? 'opening' : `${row.entryId}-${row.debit}-${row.credit}-${row.party?.id ?? row.memo ?? ''}`)}
            density="compact"
            onRowClick={(row) => !row.opening && open(row.entryId)}
            rowClassName={(row) => rowClass(!row.opening && row.entryId === openId, row.opening ? 'books-row--opening' : row.correction && 'books-row--old')}
            toolbar={
              <div className="toolbar">
                <PeriodPicker compact period={period} from={from} to={to} onChange={changePeriod} periods={BOOKS_PERIOD_KEYS} />
                <SourceFilter value={source} onChange={setSource} />
                <label className="toggle" title={t.books.correctionsHint}>
                  <input
                    type="checkbox"
                    checked={corrections}
                    onChange={(event) =>
                      setParams((current) => {
                        const next = new URLSearchParams(current);
                        if (event.target.checked) next.set('corrections', '1');
                        else next.delete('corrections');
                        next.delete('page');
                        return next;
                      })
                    }
                  />
                  {t.books.corrections}
                </label>
                <div className="toolbar__end">
                  <BooksDownload what={{ account: account.id }} period={days} label={t.books.downloads.card} />
                </div>
              </div>
            }
            columns={[
              { header: t.books.date, className: 'books-date', cell: (row) => formatBookDay(row.date) },
              {
                header: t.books.what,
                title: true,
                className: 'books-kind table__dock-hide',
                cell: (row) =>
                  !row.opening && (
                    <>
                      {kindLabel(t, row)}
                      {row.trefin && <> <TrefinTag /></>}
                    </>
                  ),
              },
              {
                header: t.books.descriptionColumn,
                className: 'books-description',
                cell: (row) =>
                  row.opening ? (
                    <span className="books-entry__kind">{row.description}</span>
                  ) : (
                    <>
                      {[row.description, row.party?.name ?? row.memo].filter(Boolean).join(' · ')}
                      {row.warning && <span className="table__secondary books-warning">{warningText(t, row.warning)}</span>}
                    </>
                  ),
              },
              { header: t.books.debit, align: 'end', cell: (row) => (row.debit ? formatMoney(row.debit) : '') },
              { header: t.books.credit, align: 'end', cell: (row) => (row.credit ? formatMoney(row.credit) : '') },
              { header: t.books.balance, align: 'end', cell: (row) => (mixed && row.trefin ? '' : formatBalance(t, row.balance)) },
              {
                header: <span className="visually-hidden">{t.books.openColumn}</span>,
                align: 'end',
                cell: (row) =>
                  row.opening ? (
                    ''
                  ) : row.trefin ? (
                    <Button size="sm" variant="ghost" aria-label={t.fromTrefin.open} onClick={() => open(row.entryId)}>
                      {t.fromTrefin.openShort}
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" aria-label={t.books.open(row.entryId)} onClick={() => open(row.entryId)}>
                      #{row.entryId}
                    </Button>
                  ),
              },
            ]}
            totals={
              card.data.lines.length > 0
                ? [t.books.totals, '', '', formatMoney(card.data.debit), formatMoney(card.data.credit), formatBalance(t, card.data.closing), '']
                : undefined
            }
            footer={
              card.data.lines.length === 0 ? (
                <p className="books-total">{t.books.card.none}</p>
              ) : (
                card.data.lines.length > CARD_PAGE && (
                  <Pagination meta={{ page, limit: CARD_PAGE, total: card.data.lines.length }} onPageChange={setPage} itemLabel={t.books.lines.toLocaleLowerCase()} />
                )
              )
            }
          />
        </div>
        {inspector}
      </InspectorLayout>
      <Sheet open={editing} onClose={() => setEditing(false)} title={`${account.number} ${account.name}`}>
        <AccountForm accounts={accounts.data ?? []} account={account} onSaved={() => setEditing(false)} />
      </Sheet>
    </>
  );
}


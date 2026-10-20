import { ArrowsLeftRight, Bank, CashRegister, CheckCircle, FileXls, PencilSimple, Plus, Vault } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, type ReactNode, useId, useMemo, useState } from 'react';
import { Link, NavLink, useParams, useSearchParams } from 'react-router';
import { canOversee } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { formatBookDay } from '../components/BooksParts';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Segmented } from '../components/BillLines';
import { MoveForm, PlaceSelect, placeInSentence, placeName, useMoneyRefresh, usePlaces } from '../components/MoneyParts';
import { Pagination } from '../components/Pagination';
import { SourceFilter, TrefinTag } from '../components/TrefinParts';
import { PeriodPicker } from '../components/PeriodPicker';
import {
  Badge,
  Button,
  Card,
  DataTable,
  DateField,
  EmptyState,
  Field,
  Inspector,
  InspectorLayout,
  PageHeader,
  Section,
  Sheet,
  StatGrid,
  StatTile,
  useNewSheet,
} from '../components/ui';
import type { Catalogue } from '../i18n/en';
import { useLanguage, useT } from '../i18n/useT';
import { moneyApi } from '../services/api';
import {
  EXPENSE_CATEGORIES,
  type BankLine,
  type BankLineStatus,
  type BankRule,
  type BankRuleAction,
  type ExpenseCategory,
  type LineAction,
  type MatchReason,
  type MatchSuggestion,
  type MoneyPlace,
  type MoneyPlaceKind,
  type PlaceBookLine,
  type RecordSource,
  type TrefinMoneyLine,
  type StatementLayout,
} from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatHeadlineMoney, formatMoney } from '../utils/format';
import { BOOKS_PERIOD_KEYS, periodDays } from '../utils/periods';
import { usePeriodParams } from '../utils/usePeriodParams';

const KIND_ICON = { till: CashRegister, safe: Vault, bank: Bank } satisfies Record<MoneyPlaceKind, unknown>;
const KINDS: MoneyPlaceKind[] = ['till', 'safe', 'bank'];
/** Lines per page in a place's book. */
const BOOK_PAGE = 100;

/* ---------- Money: every place ---------- */

/** Every place the shop's money is kept, each with what is in it, and the one form that moves money between them. */
export function MoneyPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const places = usePlaces();
  const [moving, setMoving] = useNewSheet('move');
  const [adding, setAdding] = useState(false);
  const writes = canOversee(role);

  if (places.isPending) return <Loading />;
  if (places.isError) return <ErrorNotice error={places.error} onRetry={() => places.refetch()} />;
  const open = places.data.filter((place) => !place.archived);
  const closed = places.data.filter((place) => place.archived);
  const total = open.reduce((sum, place) => sum + place.balance, 0);

  return (
    <>
      <PageHeader
        title={t.nav.items.money}
       
        meta={<span className="money-total">{t.money.altogether(formatMoney(total))}</span>}
        actions={
          writes && (
            <>
              <Button icon={Plus} onClick={() => setAdding(true)}>
                {t.money.addPlace}
              </Button>
              <Button variant="primary" icon={ArrowsLeftRight} onClick={() => setMoving(true)}>
                {t.money.move.title}
              </Button>
            </>
          )
        }
      />
      {KINDS.map((kind) => {
        const group = open.filter((place) => place.kind === kind);
        if (group.length === 0) return null;
        return (
          <Section key={kind} title={t.money.groups[kind]} description={t.money.groupHints[kind]}>
            <StatGrid>
              {group.map((place) => (
                <PlaceTile key={place.id} place={place} />
              ))}
            </StatGrid>
          </Section>
        );
      })}
      {closed.length > 0 && (
        <Section title={t.money.closedPlaces}>
          <StatGrid compact>
            {closed.map((place) => (
              <PlaceTile key={place.id} place={place} />
            ))}
          </StatGrid>
        </Section>
      )}
      <RulesCard places={places.data} writes={writes} />
      <Sheet open={moving} onClose={() => setMoving(false)} title={t.money.move.title} description={t.money.move.hint}>
        {moving && <MoveForm places={places.data} onDone={() => setMoving(false)} />}
      </Sheet>
      <Sheet open={adding} onClose={() => setAdding(false)} title={t.money.addPlace} description={t.money.addPlaceHint}>
        {adding && <PlaceForm onDone={() => setAdding(false)} />}
      </Sheet>
    </>
  );
}

function PlaceTile({ place }: { place: MoneyPlace }) {
  const t = useT();
  const words = place.archived
    ? t.money.closed
    : place.openLines > 0
      ? t.money.linesToMatch(place.openLines)
      : !place.inBooks
        ? t.money.outsideBooks
        : place.isDefault && place.kind !== 'till'
          ? t.money.main
          : undefined;
  const hint = [words, place.account?.number, place.iban && formatIban(place.iban)].filter(Boolean).join(' · ') || undefined;
  return (
    <StatTile
      named
      label={placeName(t, place)}
      value={formatHeadlineMoney(place.balance)}
      hint={hint}
      icon={KIND_ICON[place.kind]}
      tone={place.balance < -0.005 ? 'danger' : place.openLines > 0 ? 'warn' : 'default'}
      to={place.openLines > 0 ? `/money/${place.id}/statement` : `/money/${place.id}`}
    />
  );
}

/** "XK051212012345678906" as people read it: "XK05 1212 0123 4567 8906". */
const formatIban = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim();

/* ---------- Adding and changing a place ---------- */

function PlaceForm({ place, onDone }: { place?: MoneyPlace; onDone: () => void }) {
  const t = useT();
  const refresh = useMoneyRefresh();
  const [kind, setKind] = useState<'bank' | 'safe'>(place?.kind === 'safe' ? 'safe' : 'bank');
  const [name, setName] = useState(place?.name ?? '');
  const [bankName, setBankName] = useState(place?.bankName ?? '');
  const [iban, setIban] = useState(place?.iban ? formatIban(place.iban) : '');
  const [openingBalance, setOpeningBalance] = useState(place ? String(place.openingBalance) : '0');
  const [openingDay, setOpeningDay] = useState(place?.openingDay ?? '');
  const till = place?.kind === 'till';
  const save = useMutation({
    mutationFn: () => {
      const fields = {
        name: name.trim(),
        bankName: kind === 'bank' ? bankName.trim() || null : null,
        iban: kind === 'bank' ? iban.trim() || null : null,
        openingBalance: Number(openingBalance) || 0,
        openingDay: openingDay || null,
      };
      if (!place) return moneyApi.addPlace({ kind, ...fields });
      return moneyApi.updatePlace(place.id, till ? { name: fields.name } : fields);
    },
    onSuccess: () => {
      refresh();
      onDone();
    },
  });
  const change = useMutation({
    mutationFn: (changes: { makeDefault?: boolean; archived?: boolean }) => moneyApi.updatePlace(place!.id, changes),
    onSuccess: () => {
      refresh();
      onDone();
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      {!place && <Segmented label={t.money.placeKind} value={kind} options={(['bank', 'safe'] as const).map((value) => ({ value, label: t.money.newKinds[value] }))} onChange={setKind} />}
      <Field label={t.money.name} hint={till ? t.money.tillNameHint : kind === 'bank' ? t.money.bankNameHint : undefined}>
        <input required={!till} maxLength={100} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      {!till && kind === 'bank' && (
        <div className="field-row">
          <Field label={t.money.bank}>
            <input maxLength={100} autoComplete="off" value={bankName} onChange={(event) => setBankName(event.target.value)} />
          </Field>
          <Field label={t.money.iban}>
            <input maxLength={42} autoComplete="off" spellCheck={false} value={iban} onChange={(event) => setIban(event.target.value)} placeholder="XK05 1212 0123 4567 8906…" />
          </Field>
        </div>
      )}
      {!till && (
        <div className="field-row">
          <Field label={t.money.openingBalance} hint={t.money.openingHint}>
            <input type="number" inputMode="decimal" step={0.01} value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} />
          </Field>
          <Field label={t.money.openingDay}>
            <DateField value={openingDay} onChange={setOpeningDay} />
          </Field>
        </div>
      )}
      {(save.isError || change.isError) && (
        <p className="form-error" role="alert">
          {errorMessage(save.error ?? change.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={save.isPending || (!till && name.trim() === '')} loading={save.isPending}>
          {place ? t.common.save : t.money.addPlace}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
      {place && !till && (
        <div className="money-place-extra">
          {!place.isDefault && !place.archived && (
            <Button size="sm" loading={change.isPending && change.variables?.makeDefault} disabled={change.isPending} onClick={() => change.mutate({ makeDefault: true })}>
              {t.money.makeMain(t.money.kinds[place.kind])}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={change.isPending} onClick={() => change.mutate({ archived: !place.archived })}>
            {place.archived ? t.money.reopenPlace : t.money.closePlace}
          </Button>
          {!place.archived && <span className="field__hint">{t.money.closeHint}</span>}
        </div>
      )}
    </form>
  );
}

/* ---------- One place: its header and tabs ---------- */

function usePlace() {
  const id = Number(useParams().id);
  const places = usePlaces();
  const place = places.data?.find((candidate) => candidate.id === id);
  return { id, places, place };
}

function PlaceHeader({ place, places, view }: { place: MoneyPlace; places: MoneyPlace[]; view: 'book' | 'statement' }) {
  const t = useT();
  const { role } = useCurrentUser();
  const [moving, setMoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const writes = canOversee(role) && !place.archived;
  const description = [t.money.kinds[place.kind], place.bankName, place.account && `${place.account.number} ${place.account.name}`, place.iban && formatIban(place.iban)]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <PageHeader
        title={placeName(t, place)}
        description={description}
        crumbs={[{ label: t.nav.items.money, to: '/money' }]}
        meta={
          <>
            {place.isDefault && place.kind !== 'till' && <Badge tone="info">{t.money.main}</Badge>}
            {!place.inBooks && <Badge tone="neutral">{t.money.outsideBooks}</Badge>}
            {place.archived && <Badge tone="neutral">{t.money.closed}</Badge>}
          </>
        }
        actions={
          canOversee(role) && (
            <>
              <Button icon={PencilSimple} onClick={() => setEditing(true)}>
                {t.money.edit}
              </Button>
              {writes && (
                <Button variant="primary" icon={ArrowsLeftRight} onClick={() => setMoving(true)}>
                  {t.money.move.title}
                </Button>
              )}
            </>
          )
        }
      />
      {place.kind === 'bank' && (
        <nav className="section-tabs" aria-label={placeName(t, place)}>
          <NavLink to={`/money/${place.id}`} end className="section-tabs__tab" aria-current={view === 'book' ? 'page' : undefined}>
            {t.money.tabs.book}
          </NavLink>
          <NavLink to={`/money/${place.id}/statement`} end className="section-tabs__tab" aria-current={view === 'statement' ? 'page' : undefined}>
            {place.openLines > 0 ? t.money.tabs.statementCount(place.openLines) : t.money.tabs.statement}
          </NavLink>
        </nav>
      )}
      <Sheet open={moving} onClose={() => setMoving(false)} title={t.money.move.title} description={t.money.move.hint}>
        {moving && <MoveForm places={places} from={place.id} to={place.kind === 'bank' ? null : undefined} onDone={() => setMoving(false)} />}
      </Sheet>
      <Sheet open={editing} onClose={() => setEditing(false)} title={placeName(t, place)}>
        {editing && <PlaceForm place={place} onDone={() => setEditing(false)} />}
      </Sheet>
    </>
  );
}

/* ---------- One place's book ---------- */

/** A line of the book; TREFIN's payments ride along with `trefin` set and count in no balance. */
type BookRow = PlaceBookLine & { opening?: boolean; trefin?: TrefinMoneyLine };

const trefinRow = (line: TrefinMoneyLine): BookRow => ({
  day: line.day,
  kind: 'takings',
  refId: line.id,
  amount: line.amount,
  balance: 0,
  party: null,
  otherPlace: null,
  detail: null,
  bills: null,
  billId: null,
  note: null,
  count: null,
  trefin: line,
});

/** Every movement in and out of one place, with a running balance: the cash book of a till, the safe or a bank account. */
export function PlaceBookPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const { language } = useLanguage();
  const { id, places, place } = usePlace();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const { period, from, to, rangeKey, changePeriod } = usePeriodParams('this-month');
  const days = useMemo(() => periodDays(rangeKey), [rangeKey]);
  const book = useQuery({ queryKey: ['money', 'book', id, days], queryFn: () => moneyApi.book(id, days), placeholderData: keepPreviousData, enabled: Boolean(place) });
  const refresh = useMoneyRefresh();
  const [confirming, setConfirming] = useState<number | null>(null);
  const [source, setSource] = useState<RecordSource | undefined>();
  const remove = useMutation({ mutationFn: (moveId: number) => moneyApi.voidMove(moveId), onSuccess: () => { setConfirming(null); refresh(); } });
  const download = useMutation({ mutationFn: () => moneyApi.downloadBook(id, days, language) });

  if (places.isPending) return <Loading />;
  if (places.isError) return <ErrorNotice error={places.error} onRetry={() => places.refetch()} />;
  if (!place) return <EmptyState title={t.money.notFound} action={<Link to="/money">{t.money.back}</Link>} />;
  const writes = canOversee(role);
  const trefinLines = book.data?.trefin ?? [];
  const lines: BookRow[] = [...(source === 'trefin' ? [] : (book.data?.lines ?? [])), ...(source === '4vd' ? [] : trefinLines.map(trefinRow))].sort((a, b) => a.day.localeCompare(b.day));
  const opening: BookRow = {
    day: book.data?.from ?? days.from,
    kind: 'takings',
    refId: null,
    amount: 0,
    balance: book.data?.opening ?? 0,
    party: null,
    otherPlace: null,
    detail: null,
    bills: null,
    billId: null,
    note: null,
    count: null,
    opening: true,
  };
  const pageLines = lines.slice((page - 1) * BOOK_PAGE, page * BOOK_PAGE);
  const rows: BookRow[] = page === 1 && source !== 'trefin' ? [opening, ...pageLines] : pageLines;
  const setPage = (next: number) =>
    setParams((current) => {
      const updated = new URLSearchParams(current);
      if (next > 1) updated.set('page', String(next));
      else updated.delete('page');
      return updated;
    });

  return (
    <>
      <PlaceHeader place={place} places={places.data} view="book" />
      {book.isError && <ErrorNotice error={book.error} onRetry={() => book.refetch()} />}
      <StatGrid compact>
        <StatTile label={t.money.atStart} value={book.data ? formatMoney(book.data.opening) : '–'} />
        <StatTile label={t.money.moneyIn} value={book.data ? formatMoney(book.data.moneyIn) : '–'} />
        <StatTile label={t.money.moneyOut} value={book.data ? formatMoney(book.data.moneyOut) : '–'} />
        <StatTile label={t.money.atEnd} value={book.data ? formatMoney(book.data.closing) : '–'} tone={book.data && book.data.closing < -0.005 ? 'danger' : 'default'} />
      </StatGrid>
      {place.openingDay && <p className="money-note">{t.money.startsOn(formatDate(place.openingDay), formatMoney(place.openingBalance))}</p>}
      <DataTable<BookRow>
        caption={t.money.bookCaption(placeName(t, place))}
        rows={book.isPending ? [] : rows}
        rowKey={(row) => (row.opening ? 'opening' : row.trefin ? `trefin-${row.trefin.id}` : `${row.kind}-${row.refId ?? row.day}-${row.amount}`)}
        density="compact"
        rowClassName={(row) => (row.opening ? 'books-row--opening' : row.kind === 'count' ? 'money-row--count' : undefined)}
        toolbar={
          <div className="toolbar">
            <PeriodPicker compact period={period} from={from} to={to} onChange={changePeriod} periods={BOOKS_PERIOD_KEYS} />
            {(trefinLines.length > 0 || source) && <SourceFilter value={source} onChange={setSource} />}
            <div className="toolbar__end">
              <Button variant="ghost" size="sm" icon={FileXls} loading={download.isPending} disabled={download.isPending} onClick={() => download.mutate()}>
                {download.isPending ? t.common.downloading : t.money.downloadBook}
              </Button>
            </div>
          </div>
        }
        empty={<EmptyState title={book.isPending ? t.common.loading : t.money.nothingMoved} />}
        columns={[
          { header: t.money.date, className: 'books-date', cell: (row) => formatBookDay(row.day) },
          { header: t.money.what, title: true, className: 'books-kind table__dock-hide', cell: (row) =>
              row.opening ? '' : row.trefin ? (
                <>
                  {t.fromTrefin.moneyKinds[row.trefin.kind]} <TrefinTag />
                </>
              ) : row.kind === 'supplier' && !row.party ? (
                t.money.expenseKind
              ) : (
                t.money.lineKinds[row.kind]
              ),
          },
          { header: t.money.details, className: 'books-description', cell: (row) =>
              row.opening ? <span className="books-entry__kind">{t.money.openingRow}</span> : row.trefin ? <TrefinLineDetails line={row.trefin} /> : <LineDetails row={row} />,
          },
          { header: t.money.moneyIn, align: 'end', cell: (row) => (row.amount > 0 ? formatMoney(row.amount) : '') },
          { header: t.money.moneyOut, align: 'end', cell: (row) => (row.amount < 0 ? formatMoney(-row.amount) : '') },
          { header: t.money.balance, align: 'end', cell: (row) => ((row.kind === 'count' && !row.opening) || row.trefin ? '' : formatMoney(row.balance)) },
          {
            header: <span className="visually-hidden">{t.money.actions}</span>,
            align: 'end',
            cell: (row) =>
              writes && row.kind === 'move' && row.refId !== null && !row.opening && !row.trefin ? (
                confirming === row.refId ? (
                  <span className="money-confirm">
                    <Button size="sm" variant="danger" loading={remove.isPending} disabled={remove.isPending} onClick={() => remove.mutate(row.refId!)}>
                      {t.money.removeMove}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      {t.money.keep}
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" aria-label={`${t.money.remove}: ${formatBookDay(row.day)}, ${formatMoney(Math.abs(row.amount))}`} onClick={() => setConfirming(row.refId)}>
                    {t.money.remove}
                  </Button>
                )
              ) : (
                ''
              ),
          },
        ]}
        totals={book.data && (book.data.lines.length > 0) && source !== 'trefin' ? [t.money.totals, '', '', formatMoney(book.data.moneyIn), formatMoney(book.data.moneyOut), formatMoney(book.data.closing), ''] : undefined}
        footer={
          <>
            {(remove.isError || download.isError) && (
              <p className="form-error" role="alert">
                {errorMessage(remove.error ?? download.error)}
              </p>
            )}
            {lines.length > BOOK_PAGE && <Pagination meta={{ page, limit: BOOK_PAGE, total: lines.length }} onPageChange={setPage} itemLabel={t.money.linesWord} />}
          </>
        }
      />
    </>
  );
}

/** Who TREFIN paid or was paid by, and for what. */
function TrefinLineDetails({ line }: { line: TrefinMoneyLine }) {
  const t = useT();
  const name = line.customer ? (
    <Link to={`/customers/${line.customer.id}`}>{line.customer.name}</Link>
  ) : line.supplier ? (
    <Link to={`/suppliers/${line.supplier.id}`}>{line.supplier.name}</Link>
  ) : (
    line.partyName
  );
  const what = line.document ?? line.description;
  return (
    <>
      {name}
      {name && what && ' · '}
      {what}
      {(line.number || line.account) && (
        <span className="table__secondary">{[line.number, line.account && t.fromTrefin.account(line.account), line.bankName].filter(Boolean).join(' · ')}</span>
      )}
    </>
  );
}

function LineDetails({ row }: { row: PlaceBookLine }) {
  const t = useT();
  let main: ReactNode = null;
  if (row.kind === 'move') main = row.amount > 0 ? t.money.fromPlace(placeInSentence(t, row.otherPlace)) : t.money.toPlace(placeInSentence(t, row.otherPlace));
  else if (row.kind === 'count' && row.count) {
    const difference = row.count.difference;
    main = [t.money.counted(formatMoney(row.count.counted)), difference !== null && Math.abs(difference) >= 0.01 ? (difference > 0 ? t.money.over(formatMoney(difference)) : t.money.short(formatMoney(-difference))) : null]
      .filter(Boolean)
      .join(' · ');
  } else if (row.party) {
    const name = row.kind === 'customer' ? <Link to={`/customers/${row.party.id}`}>{row.party.name}</Link> : row.party.name;
    const what = row.bills ? t.money.billsCount(row.bills) : row.detail ? t.money.billNumber(row.detail) : null;
    main = (
      <>
        {name}
        {what && (row.billId ? <> · <Link to={`/bills/${row.billId}`}>{what}</Link></> : <> · {what}</>)}
      </>
    );
  } else if (row.billId) main = <Link to={`/bills/${row.billId}`}>{row.detail ? t.money.billNumber(row.detail) : row.kind === 'supplier' ? t.money.theExpense : t.money.theBill}</Link>;
  else if (row.detail) main = row.detail;
  return (
    <>
      {main}
      {row.note && <span className="table__secondary">{row.note}</span>}
    </>
  );
}

/* ---------- A bank account's statement ---------- */

const STATUS_FILTERS: Array<BankLineStatus | 'all'> = ['open', 'done', 'skipped', 'all'];

/** Upload the bank's statement and say what each line is, with 4VD's suggestions. */
export function StatementPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const { id, places, place } = usePlace();
  const [params, setParams] = useSearchParams();
  const status = (params.get('show') as BankLineStatus | 'all' | null) ?? 'open';
  const writes = canOversee(role) && !place?.archived;
  const lines = useQuery({ queryKey: ['money', 'lines', id, status], queryFn: () => moneyApi.lines(id, status), enabled: place?.kind === 'bank', placeholderData: keepPreviousData });
  const statements = useQuery({ queryKey: ['money', 'statements', id], queryFn: () => moneyApi.statements(id), enabled: place?.kind === 'bank' });
  const refresh = useMoneyRefresh();
  const [openLine, setOpenLine] = useState<number | null>(null);
  const confirm = useMutation({ mutationFn: ({ line, suggestion }: { line: BankLine; suggestion: MatchSuggestion }) => moneyApi.confirm(line.id, { action: suggestion.action, ruleId: suggestion.ruleId }), onSuccess: refresh });
  const confirmSure = useMutation({ mutationFn: () => moneyApi.confirmSure(id), onSuccess: refresh });

  if (places.isPending) return <Loading />;
  if (places.isError) return <ErrorNotice error={places.error} onRetry={() => places.refetch()} />;
  if (!place || place.kind !== 'bank') return <EmptyState title={t.money.notFound} action={<Link to="/money">{t.money.back}</Link>} />;
  const byId = new Map(places.data.map((candidate) => [candidate.id, candidate]));
  const rows = lines.data ?? [];
  const sureCount = status === 'open' || status === 'all' ? rows.filter((line) => line.status === 'open' && line.suggestions[0]?.sure).length : 0;
  const shown = rows.find((line) => line.id === openLine) ?? null;
  const latest = statements.data?.[0];
  const setStatus = (next: BankLineStatus | 'all') =>
    setParams((current) => {
      const updated = new URLSearchParams(current);
      if (next === 'open') updated.delete('show');
      else updated.set('show', next);
      return updated;
    });

  return (
    <>
      <PlaceHeader place={place} places={places.data} view="statement" />
      {writes && <UploadCard place={place} />}
      {latest && <BalanceCheck statement={latest} />}
      <InspectorLayout open={shown !== null}>
        <div className="inspector-layout__list">
          <DataTable<BankLine>
            caption={t.money.statement.caption(placeName(t, place))}
            rows={rows}
            rowKey={(line) => line.id}
            density="compact"
            onRowClick={(line) => setOpenLine(line.id)}
            rowClassName={(line) => [line.id === openLine && 'table__row--selected', line.status !== 'open' && 'money-row--settled'].filter(Boolean).join(' ') || undefined}
            toolbar={
              <div className="toolbar">
                <div className="chip-row" role="radiogroup" aria-label={t.money.statement.show}>
                  {STATUS_FILTERS.map((option) => (
                    <button key={option} type="button" role="radio" aria-checked={status === option} className="chip" onClick={() => setStatus(option)}>
                      {option === 'open' && place.openLines > 0 ? t.money.statement.filtersCount(place.openLines) : t.money.statement.filters[option]}
                    </button>
                  ))}
                </div>
                {writes && sureCount > 0 && (
                  <div className="toolbar__end">
                    <Button variant="primary" size="sm" icon={CheckCircle} loading={confirmSure.isPending} disabled={confirmSure.isPending} onClick={() => confirmSure.mutate()}>
                      {t.money.statement.confirmSure(sureCount)}
                    </Button>
                  </div>
                )}
              </div>
            }
            empty={
              <EmptyState title={lines.isPending ? t.common.loading : status === 'open' ? t.money.statement.allMatched : t.money.statement.noLines}>
                {!lines.isPending && status === 'open' && (statements.data?.length ? t.money.statement.allMatchedHint : t.money.statement.uploadFirst)}
              </EmptyState>
            }
            columns={[
              { header: t.money.date, className: 'books-date', cell: (line) => formatBookDay(line.day) },
              { header: t.money.statement.text, title: true, className: 'books-description', cell: (line) => line.text },
              { header: t.money.moneyIn, align: 'end', cell: (line) => (line.amount > 0 ? formatMoney(line.amount) : '') },
              { header: t.money.moneyOut, align: 'end', cell: (line) => (line.amount < 0 ? formatMoney(-line.amount) : '') },
              {
                header: t.money.statement.whatItIs,
                className: 'money-match',
                cell: (line) => <LineState line={line} byId={byId} />,
              },
              {
                header: <span className="visually-hidden">{t.money.actions}</span>,
                align: 'end',
                cell: (line) =>
                  writes && line.status === 'open' && line.suggestions[0]?.sure ? (
                    <Button
                      size="sm"
                      aria-label={t.money.statement.openLine(t.money.statement.confirm, line.text)}
                      loading={confirm.isPending && confirm.variables?.line.id === line.id}
                      disabled={confirm.isPending}
                      onClick={(event) => {
                        event.stopPropagation();
                        confirm.mutate({ line, suggestion: line.suggestions[0]! });
                      }}
                    >
                      {t.money.statement.confirm}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t.money.statement.openLine(line.status === 'open' ? t.money.statement.choose : t.money.statement.view, line.text)}
                      onClick={() => setOpenLine(line.id)}
                    >
                      {line.status === 'open' ? t.money.statement.choose : t.money.statement.view}
                    </Button>
                  ),
              },
            ]}
            footer={
              <>
                {confirmSure.data && <p className="money-note" role="status">{t.money.statement.confirmedSure(confirmSure.data.confirmed, confirmSure.data.failed)}</p>}
                {(confirm.isError || confirmSure.isError || lines.isError) && (
                  <p className="form-error" role="alert">
                    {errorMessage(confirm.error ?? confirmSure.error ?? lines.error)}
                  </p>
                )}
              </>
            }
          />
        </div>
        <Inspector open={shown !== null} onClose={() => setOpenLine(null)} title={shown ? `${formatMoney(Math.abs(shown.amount))} · ${formatBookDay(shown.day)}` : t.money.statement.line}>
          {shown && <LineInspector key={shown.id} line={shown} place={place} places={places.data} writes={writes} />}
        </Inspector>
      </InspectorLayout>
    </>
  );
}

/** The bank's closing balance beside 4VD's, and the difference in plain words. */
function BalanceCheck({ statement }: { statement: NonNullable<ReturnType<typeof moneyApi.statements> extends Promise<infer R> ? R : never>[number] }) {
  const t = useT();
  const difference = statement.difference;
  return (
    <section className="money-balance" aria-label={t.money.statement.balances}>
      <StatGrid compact>
        <StatTile
          label={statement.lastDay ? t.money.statement.bankSays(formatDate(statement.lastDay)) : t.money.statement.bankSaysNoDay}
          value={statement.closingBalance === null ? '–' : formatMoney(statement.closingBalance)}
        />
        <StatTile label={t.money.statement.weSay} value={statement.ourBalance === null ? '–' : formatMoney(statement.ourBalance)} />
        <StatTile
          label={t.money.statement.difference}
          value={difference === null ? '–' : formatMoney(Math.abs(difference))}
          tone={difference !== null && Math.abs(difference) >= 0.01 ? 'warn' : 'default'}
        />
      </StatGrid>
      <p className="money-note">
        {difference === null
          ? t.money.statement.noBalance
          : Math.abs(difference) < 0.01
            ? t.money.statement.agree
            : difference > 0
              ? t.money.statement.bankMore(formatMoney(difference))
              : t.money.statement.bankLess(formatMoney(-difference))}
      </p>
    </section>
  );
}

/** "Pay bill 2026/0457 from Viva Fresh": what confirming a suggestion does. */
function suggestionText(t: Catalogue, suggestion: MatchSuggestion, moneyIn: boolean, byId: Map<number, MoneyPlace>): string {
  const { action, label } = suggestion;
  const place = (id: number | null | undefined) => (id === null || id === undefined ? null : (byId.get(id) ?? null));
  switch (action.kind) {
    case 'payBills':
      return action.bills.length === 1
        ? label.numbers?.[0]
          ? t.money.suggestions.payBill(label.numbers[0], label.supplier ?? '')
          : t.money.suggestions.payBillOf(label.supplier ?? '')
        : t.money.suggestions.payBills(action.bills.length, label.supplier ?? '');
    case 'linkPayment':
      return t.money.suggestions.linkPayment(label.supplier ?? '', label.numbers?.[0] ?? null);
    case 'linkGroup':
      return t.money.suggestions.linkGroup(label.supplier ?? '');
    case 'receive':
      return label.numbers && label.numbers.length > 0 ? t.money.suggestions.receiveInvoices(label.customer ?? '', label.numbers.join(', ')) : t.money.suggestions.receive(label.customer ?? '');
    case 'linkReceipt':
      return t.money.suggestions.linkReceipt(label.customer ?? '');
    case 'linkMove':
      return moneyIn ? t.money.suggestions.linkMoveFrom(placeInSentence(t, place(label.placeId))) : t.money.suggestions.linkMoveTo(placeInSentence(t, place(label.placeId)));
    case 'move':
      if (action.otherPlaceId === null) return moneyIn ? t.money.suggestions.ownerIn : t.money.suggestions.ownerOut;
      return moneyIn ? t.money.suggestions.moveFrom(placeInSentence(t, place(action.otherPlaceId))) : t.money.suggestions.moveTo(placeInSentence(t, place(action.otherPlaceId)));
    case 'expense':
      return t.money.suggestions.expense(t.expenses.categories[action.category]);
  }
}

function reasonText(t: Catalogue, reason: MatchReason): string {
  switch (reason.key) {
    case 'sameAmount':
      return t.money.reasons.sameAmount;
    case 'sumOfBills':
      return t.money.reasons.sumOfBills(reason.count);
    case 'nameInText':
      return t.money.reasons.nameInText(reason.name);
    case 'numberInText':
      return t.money.reasons.numberInText(reason.number);
    case 'daysApart':
      return t.money.reasons.daysApart(reason.days);
    case 'rule':
      return t.money.reasons.rule(reason.contains);
    case 'depositWords':
      return t.money.reasons.depositWords;
  }
}

const reasonsText = (t: Catalogue, suggestion: MatchSuggestion) => suggestion.reasons.map((reason) => reasonText(t, reason)).join(' · ');

/** What a line is in the list: its best suggestion, what it became, or that it was left out. */
function LineState({ line, byId }: { line: BankLine; byId: Map<number, MoneyPlace> }) {
  const t = useT();
  if (line.status === 'skipped') return <Badge tone="neutral">{t.money.statement.leftOut}</Badge>;
  if (line.status === 'done' && line.done) {
    return (
      <span className="money-match__text">
        <Badge tone="ok">{t.money.statement.matched}</Badge> {t.money.doneKinds[line.done.kind]}
        <span className="table__secondary">{line.done.madeRecord ? t.money.statement.made : t.money.statement.found}</span>
      </span>
    );
  }
  const best = line.suggestions[0];
  if (!best) return <span className="table__secondary">{t.money.statement.noSuggestion}</span>;
  return (
    <span className="money-match__text">
      {best.sure && <Badge tone="ok">{t.money.statement.sure}</Badge>} {suggestionText(t, best, line.amount > 0, byId)}
      <span className="table__secondary">{reasonsText(t, best)}</span>
    </span>
  );
}

type OtherChoice = 'expense' | 'move' | 'owner';

/** One line opened: every suggestion, something else it could be, leaving it out, or taking a match back. */
function LineInspector({ line, place, places, writes }: { line: BankLine; place: MoneyPlace; places: MoneyPlace[]; writes: boolean }) {
  const t = useT();
  const refresh = useMoneyRefresh();
  const byId = new Map(places.map((candidate) => [candidate.id, candidate]));
  const moneyIn = line.amount > 0;
  const confirm = useMutation({
    mutationFn: (input: { action: LineAction; ruleId?: number | null; rule?: { contains: string } | null }) => moneyApi.confirm(line.id, input),
    onSuccess: refresh,
  });
  const undo = useMutation({ mutationFn: () => moneyApi.undo(line.id), onSuccess: refresh });
  const skip = useMutation({ mutationFn: (skipped: boolean) => moneyApi.skip(line.id, skipped), onSuccess: refresh });
  const error = confirm.error ?? undo.error ?? skip.error;

  return (
    <div className="money-line">
      <p className="money-line__text">{line.text}</p>
      <p className="table__secondary">
        {moneyIn ? t.money.statement.cameIn(formatMoney(line.amount)) : t.money.statement.wentOut(formatMoney(-line.amount))}
        {line.balance !== null && ` · ${t.money.statement.balanceAfter(formatMoney(line.balance))}`}
      </p>

      {line.status === 'done' && line.done && (
        <div className="money-line__block">
          <p>
            <Badge tone="ok">{t.money.statement.matched}</Badge> {t.money.doneKinds[line.done.kind]}
            {line.done.billId && (
              <>
                {' · '}
                <Link to={`/bills/${line.done.billId}`}>{t.money.theBill}</Link>
              </>
            )}
            {line.done.customerId && (
              <>
                {' · '}
                <Link to={`/customers/${line.done.customerId}`}>{t.money.theCustomer}</Link>
              </>
            )}
          </p>
          <p className="table__secondary">
            {[line.done.madeRecord ? t.money.statement.made : t.money.statement.found, line.done.by, line.done.at && formatDate(line.done.at)].filter(Boolean).join(' · ')}
          </p>
          {writes && (
            <>
              <Button size="sm" loading={undo.isPending} disabled={undo.isPending} onClick={() => undo.mutate()}>
                {t.money.statement.takeBack}
              </Button>
              <p className="field__hint">{line.done.madeRecord ? t.money.statement.takeBackMade : t.money.statement.takeBackFound}</p>
            </>
          )}
        </div>
      )}

      {line.status === 'skipped' && (
        <div className="money-line__block">
          <p>
            <Badge tone="neutral">{t.money.statement.leftOut}</Badge>
          </p>
          {writes && (
            <Button size="sm" loading={skip.isPending} disabled={skip.isPending} onClick={() => skip.mutate(false)}>
              {t.money.statement.bringBack}
            </Button>
          )}
        </div>
      )}

      {line.status === 'open' && (
        <>
          <h3 className="money-line__heading">{t.money.statement.suggestions}</h3>
          {line.suggestions.length === 0 ? (
            <p className="table__secondary">{t.money.statement.noSuggestionLong}</p>
          ) : (
            <ul className="money-suggestions">
              {line.suggestions.map((suggestion, index) => (
                <li key={index} className="money-suggestion">
                  <div>
                    {suggestion.sure && <Badge tone="ok">{t.money.statement.sure}</Badge>} {suggestionText(t, suggestion, moneyIn, byId)}
                    <span className="table__secondary">{reasonsText(t, suggestion)}</span>
                  </div>
                  {writes && (
                    <Button
                      size="sm"
                      variant={index === 0 ? 'primary' : undefined}
                      aria-label={t.money.statement.openLine(t.money.statement.confirm, suggestionText(t, suggestion, moneyIn, byId))}
                      loading={confirm.isPending && confirm.variables?.action === suggestion.action}
                      disabled={confirm.isPending}
                      onClick={() => confirm.mutate({ action: suggestion.action, ruleId: suggestion.ruleId })}
                    >
                      {t.money.statement.confirm}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {writes && <SomethingElse line={line} place={place} places={places} onConfirm={(input) => confirm.mutate(input)} pending={confirm.isPending} />}
          {writes && (
            <div className="money-line__block">
              <Button size="sm" variant="ghost" loading={skip.isPending} disabled={skip.isPending} onClick={() => skip.mutate(true)}>
                {t.money.statement.leaveOut}
              </Button>
              <p className="field__hint">{t.money.statement.leaveOutHint}</p>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {errorMessage(error)}
        </p>
      )}
    </div>
  );
}

/** A first word of three letters or more from the line's text, to start a rule with. */
const ruleWord = (text: string) => text.split(/[^\p{L}\p{N}]+/u).find((word) => word.length >= 3 && !/^\d+$/.test(word)) ?? '';

function SomethingElse({
  line,
  place,
  places,
  onConfirm,
  pending,
}: {
  line: BankLine;
  place: MoneyPlace;
  places: MoneyPlace[];
  onConfirm: (input: { action: LineAction; rule?: { contains: string } | null }) => void;
  pending: boolean;
}) {
  const t = useT();
  const moneyIn = line.amount > 0;
  const choices: OtherChoice[] = moneyIn ? ['move', 'owner'] : ['expense', 'move', 'owner'];
  const [choice, setChoice] = useState<OtherChoice>(choices[0]!);
  const [category, setCategory] = useState<ExpenseCategory>('bank_fees');
  const [other, setOther] = useState<number | null>(places.find((candidate) => candidate.id !== place.id && !candidate.archived && candidate.kind === 'till')?.id ?? null);
  const [saveRule, setSaveRule] = useState(false);
  const [contains, setContains] = useState(ruleWord(line.text));
  const [submitted, setSubmitted] = useState(false);
  const categoryId = useId();
  const otherId = useId();
  const action: LineAction | null =
    choice === 'expense' ? { kind: 'expense', category, supplierId: null } : choice === 'owner' ? { kind: 'move', otherPlaceId: null } : other === null ? null : { kind: 'move', otherPlaceId: other };
  const ruleOk = !saveRule || contains.trim().length >= 3;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!action || !ruleOk) return;
    setSubmitted(true);
    onConfirm({ action, rule: saveRule ? { contains: contains.trim() } : null });
  }

  return (
    <form className="money-line__block settings-form" onSubmit={handleSubmit}>
      <h3 className="money-line__heading">{t.money.statement.somethingElse}</h3>
      <Segmented
        label={t.money.statement.itIs}
        value={choice}
        options={choices.map((value) => ({ value, label: moneyIn ? t.money.statement.choicesIn[value as 'move' | 'owner'] : t.money.statement.choicesOut[value] }))}
        onChange={setChoice}
        size="sm"
      />
      {choice === 'expense' && (
        <div className="field">
          <label className="field__label" htmlFor={categoryId}>
            {t.money.statement.expenseFor}
          </label>
          <select id={categoryId} value={category} onChange={(event: ChangeEvent<HTMLSelectElement>) => setCategory(event.target.value as ExpenseCategory)}>
            {EXPENSE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t.expenses.categories[value]}
              </option>
            ))}
          </select>
        </div>
      )}
      {choice === 'move' && (
        <div className="field">
          <label className="field__label" htmlFor={otherId}>
            {moneyIn ? t.money.statement.cameFrom : t.money.statement.wentTo}
          </label>
          <PlaceSelect id={otherId} places={places.filter((candidate) => candidate.id !== place.id)} value={other} onChange={setOther} required />
        </div>
      )}
      <label className="toggle">
        <input type="checkbox" checked={saveRule} onChange={(event) => setSaveRule(event.target.checked)} />
        {t.money.statement.saveRule}
      </label>
      {saveRule && (
        <Field label={t.money.statement.ruleContains} hint={t.money.statement.ruleHint}>
          <input required minLength={3} maxLength={100} value={contains} onChange={(event) => setContains(event.target.value)} />
        </Field>
      )}
      <div className="form-actions">
        <Button type="submit" disabled={!action || !ruleOk || pending} loading={pending && submitted}>
          {t.money.statement.record}
        </Button>
      </div>
    </form>
  );
}

/* ---------- Uploading a statement ---------- */

/** A file as base64 without the data: prefix, the way the API takes it. */
function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function UploadCard({ place }: { place: MoneyPlace }) {
  const t = useT();
  const refresh = useMoneyRefresh();
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [asking, setAsking] = useState<{ preview: string[][]; guess: StatementLayout | null } | null>(null);
  const upload = useMutation({
    mutationFn: (input: { name: string; data: string; layout?: StatementLayout }) => moneyApi.upload(place.id, { fileName: input.name, data: input.data, layout: input.layout }),
    onSuccess: (result) => {
      if (result.needsLayout) {
        setAsking({ preview: result.preview, guess: result.guess });
        return;
      }
      setAsking(null);
      setFile(null);
      refresh();
    },
  });

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;
    const next = { name: chosen.name, data: await toBase64(chosen) };
    setFile(next);
    setAsking(null);
    upload.mutate(next);
  }

  const done = upload.data && !upload.data.needsLayout ? upload.data : null;
  return (
    <Card title={t.money.statement.uploadTitle} description={t.money.statement.uploadHint}>
      <Field label={t.money.statement.chooseFile} hint={upload.isPending ? t.money.statement.reading : file?.name}>
        <input type="file" accept=".xlsx,.csv,.txt,.pdf,application/pdf,text/csv" disabled={upload.isPending} onChange={handleFile} />
      </Field>
      {done && (
        <p className="money-note" role="status">
          {t.money.statement.uploaded(done.added, done.skipped)}
        </p>
      )}
      {upload.isError && (
        <p className="form-error" role="alert">
          {errorMessage(upload.error)}
        </p>
      )}
      {asking && file && <LayoutPicker preview={asking.preview} guess={asking.guess} pending={upload.isPending} onRead={(layout) => upload.mutate({ ...file, layout })} />}
    </Card>
  );
}

const columnLetter = (index: number) => String.fromCharCode(65 + (index % 26));

/** When 4VD can't tell which column is which: the person says so once, and it is remembered for this account. */
function LayoutPicker({ preview, guess, pending, onRead }: { preview: string[][]; guess: StatementLayout | null; pending: boolean; onRead: (layout: StatementLayout) => void }) {
  const t = useT();
  const width = Math.max(...preview.map((row) => row.length), 1);
  const [headerRow, setHeaderRow] = useState(guess?.headerRow ?? 0);
  const [date, setDate] = useState(guess?.date ?? 0);
  const [text, setText] = useState(guess && guess.text >= 0 ? guess.text : Math.min(1, width - 1));
  const [twoColumns, setTwoColumns] = useState(guess ? guess.amount === null : true);
  const [moneyIn, setMoneyIn] = useState(guess?.moneyIn ?? Math.min(3, width - 1));
  const [moneyOut, setMoneyOut] = useState(guess?.moneyOut ?? Math.min(2, width - 1));
  const [amount, setAmount] = useState(guess?.amount ?? Math.min(2, width - 1));
  const [balance, setBalance] = useState<number | null>(guess?.balance ?? null);
  const header = preview[headerRow] ?? [];
  const columns = Array.from({ length: width }, (_, index) => ({ value: index, label: `${columnLetter(index)}${header[index] ? ` – ${header[index]}` : ''}` }));
  const ids = { header: useId(), date: useId(), text: useId(), in: useId(), out: useId(), amount: useId(), balance: useId() };

  const select = (id: string, label: string, value: number | null, onChange: (value: number | null) => void, optional = false) => (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value === null ? '' : String(value)} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}>
        {optional && <option value="">{t.money.layout.none}</option>}
        {columns.map((column) => (
          <option key={column.value} value={column.value}>
            {column.label}
          </option>
        ))}
      </select>
    </div>
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onRead({
      headerRow,
      date,
      text,
      party: null,
      moneyIn: twoColumns ? moneyIn : null,
      moneyOut: twoColumns ? moneyOut : null,
      amount: twoColumns ? null : amount,
      balance,
      headers: header,
    });
  }

  return (
    <form className="settings-form money-layout" onSubmit={handleSubmit}>
      <p className="money-note">{t.money.layout.intro}</p>
      <div className="data-table__scroll">
        <table className="table table--compact money-layout__preview">
          <caption className="visually-hidden">{t.money.layout.previewCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.money.layout.row}</th>
              {columns.map((column) => (
                <th key={column.value} scope="col">
                  {columnLetter(column.value)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.slice(0, 10).map((row, index) => (
              <tr key={index} className={index === headerRow ? 'table__row--selected' : undefined}>
                <th scope="row">{index + 1}</th>
                {columns.map((column) => (
                  <td key={column.value}>{row[column.value] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.header}>
          {t.money.layout.headerRow}
        </label>
        <select id={ids.header} value={headerRow} onChange={(event) => setHeaderRow(Number(event.target.value))}>
          {preview.map((row, index) => (
            <option key={index} value={index}>
              {t.money.layout.rowOption(index + 1, row.filter(Boolean).slice(0, 3).join(' · '))}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        {select(ids.date, t.money.layout.date, date, (value) => setDate(value ?? 0))}
        {select(ids.text, t.money.layout.text, text, (value) => setText(value ?? 0))}
      </div>
      <Segmented
        label={t.money.layout.money}
        value={twoColumns ? 'two' : 'one'}
        options={[
          { value: 'two', label: t.money.layout.twoColumns },
          { value: 'one', label: t.money.layout.oneColumn },
        ]}
        onChange={(value) => setTwoColumns(value === 'two')}
        size="sm"
      />
      <div className="field-row">
        {twoColumns ? (
          <>
            {select(ids.in, t.money.layout.moneyIn, moneyIn, (value) => setMoneyIn(value ?? 0))}
            {select(ids.out, t.money.layout.moneyOut, moneyOut, (value) => setMoneyOut(value ?? 0))}
          </>
        ) : (
          select(ids.amount, t.money.layout.amount, amount, (value) => setAmount(value ?? 0))
        )}
        {select(ids.balance, t.money.layout.balance, balance, setBalance, true)}
      </div>
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={pending} disabled={pending}>
          {t.money.layout.read}
        </Button>
      </div>
    </form>
  );
}

/* ---------- Rules for bank lines ---------- */

function ruleText(t: Catalogue, rule: BankRule, byId: Map<number, MoneyPlace>): string {
  if (rule.action === 'expense') return t.money.suggestions.expense(rule.category ? t.expenses.categories[rule.category] : '');
  if (rule.action === 'owner') return rule.direction === 'in' ? t.money.suggestions.ownerIn : t.money.suggestions.ownerOut;
  const other = rule.otherPlaceId === null ? null : (byId.get(rule.otherPlaceId) ?? null);
  return rule.direction === 'in' ? t.money.suggestions.moveFrom(placeInSentence(t, other)) : t.money.suggestions.moveTo(placeInSentence(t, other));
}

function RulesCard({ places, writes }: { places: MoneyPlace[]; writes: boolean }) {
  const t = useT();
  const rules = useQuery({ queryKey: ['money', 'rules'], queryFn: moneyApi.rules });
  const [editing, setEditing] = useState<BankRule | 'new' | null>(null);
  const byId = new Map(places.map((place) => [place.id, place]));
  return (
    <Card
      title={t.money.rules.title}
      description={t.money.rules.hint}
      flush
      actions={
        writes && (
          <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>
            {t.money.rules.add}
          </Button>
        )
      }
    >
      {rules.isError && <ErrorNotice error={rules.error} onRetry={() => rules.refetch()} />}
      <DataTable<BankRule>
        caption={t.money.rules.title}
        rows={rules.data ?? []}
        rowKey={(rule) => rule.id}
        empty={<EmptyState title={rules.isPending ? t.common.loading : t.money.rules.none}>{!rules.isPending && t.money.rules.noneHint}</EmptyState>}
        columns={[
          { header: t.money.rules.contains, title: true, cell: (rule) => <strong>“{rule.contains}”</strong> },
          { header: t.money.rules.direction, cell: (rule) => t.money.rules.directions[rule.direction] },
          { header: t.money.rules.becomes, cell: (rule) => ruleText(t, rule, byId) },
          {
            header: t.money.rules.where,
            cell: (rule) => (rule.placeId === null ? t.money.rules.everyAccount : placeName(t, byId.get(rule.placeId) ?? { kind: 'bank', name: null })),
          },
          {
            header: <span className="visually-hidden">{t.money.actions}</span>,
            align: 'end',
            cell: (rule) =>
              writes ? (
                <Button size="sm" variant="ghost" icon={PencilSimple} aria-label={`${t.money.edit}: “${rule.contains}”`} onClick={() => setEditing(rule)}>
                  {t.money.edit}
                </Button>
              ) : (
                ''
              ),
          },
        ]}
      />
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? t.money.rules.add : t.money.rules.edit}>
        {editing !== null && <RuleForm rule={editing === 'new' ? null : editing} places={places} onDone={() => setEditing(null)} />}
      </Sheet>
    </Card>
  );
}

function RuleForm({ rule, places, onDone }: { rule: BankRule | null; places: MoneyPlace[]; onDone: () => void }) {
  const t = useT();
  const refresh = useMoneyRefresh();
  const [contains, setContains] = useState(rule?.contains ?? '');
  const [direction, setDirection] = useState<'in' | 'out'>(rule?.direction ?? 'out');
  const [action, setAction] = useState<BankRuleAction>(rule?.action ?? 'expense');
  const [category, setCategory] = useState<ExpenseCategory>(rule?.category ?? 'bank_fees');
  const [other, setOther] = useState<number | null>(rule?.otherPlaceId ?? null);
  const [placeId, setPlaceId] = useState<number | null>(rule?.placeId ?? null);
  const ids = { category: useId(), other: useId(), place: useId() };
  const [removing, setRemoving] = useState(false);
  const banks = places.filter((place) => place.kind === 'bank' && !place.archived);
  const effective: BankRuleAction = direction === 'in' && action === 'expense' ? 'transfer' : action;
  const save = useMutation({
    mutationFn: () => {
      const input = {
        placeId,
        contains: contains.trim(),
        direction,
        action: effective,
        category: effective === 'expense' ? category : null,
        supplierId: null,
        otherPlaceId: effective === 'transfer' ? other : null,
      };
      return rule ? moneyApi.updateRule(rule.id, input) : moneyApi.addRule(input);
    },
    onSuccess: () => {
      refresh();
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: () => moneyApi.removeRule(rule!.id),
    onSuccess: () => {
      refresh();
      onDone();
    },
  });
  const valid = contains.trim().length >= 3 && (effective !== 'transfer' || other !== null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (valid) save.mutate();
  }

  const actions: BankRuleAction[] = direction === 'out' ? ['expense', 'transfer', 'owner'] : ['transfer', 'owner'];
  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <Field label={t.money.rules.contains} hint={t.money.statement.ruleHint}>
        <input required minLength={3} maxLength={100} value={contains} onChange={(event) => setContains(event.target.value)} />
      </Field>
      <Segmented label={t.money.rules.direction} value={direction} options={(['out', 'in'] as const).map((value) => ({ value, label: t.money.rules.directions[value] }))} onChange={setDirection} />
      <Segmented
        label={t.money.rules.becomes}
        value={effective}
        options={actions.map((value) => ({ value, label: direction === 'out' ? t.money.rules.actionsOut[value] : t.money.rules.actionsIn[value as 'transfer' | 'owner'] }))}
        onChange={setAction}
      />
      {effective === 'expense' && (
        <div className="field">
          <label className="field__label" htmlFor={ids.category}>
            {t.money.statement.expenseFor}
          </label>
          <select id={ids.category} value={category} onChange={(event) => setCategory(event.target.value as ExpenseCategory)}>
            {EXPENSE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t.expenses.categories[value]}
              </option>
            ))}
          </select>
        </div>
      )}
      {effective === 'transfer' && (
        <div className="field">
          <label className="field__label" htmlFor={ids.other}>
            {direction === 'in' ? t.money.statement.cameFrom : t.money.statement.wentTo}
          </label>
          <PlaceSelect id={ids.other} places={places.filter((place) => place.kind !== 'bank' || place.id !== placeId)} value={other} onChange={setOther} required />
        </div>
      )}
      {banks.length > 1 && (
        <div className="field">
          <label className="field__label" htmlFor={ids.place}>
            {t.money.rules.where}
          </label>
          <select id={ids.place} value={placeId === null ? '' : String(placeId)} onChange={(event) => setPlaceId(event.target.value === '' ? null : Number(event.target.value))}>
            <option value="">{t.money.rules.everyAccount}</option>
            {banks.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {placeName(t, bank)}
              </option>
            ))}
          </select>
        </div>
      )}
      {(save.isError || remove.isError) && (
        <p className="form-error" role="alert">
          {errorMessage(save.error ?? remove.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!valid || save.isPending} loading={save.isPending}>
          {t.common.save}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
        {rule &&
          (removing ? (
            <span className="money-confirm money-actions__end">
              <Button variant="danger" loading={remove.isPending} disabled={remove.isPending} onClick={() => remove.mutate()}>
                {t.money.removeMove}
              </Button>
              <Button variant="ghost" onClick={() => setRemoving(false)}>
                {t.money.keep}
              </Button>
            </span>
          ) : (
            <Button variant="danger" className="money-actions__end" onClick={() => setRemoving(true)}>
              {t.money.rules.remove}
            </Button>
          ))}
      </div>
    </form>
  );
}

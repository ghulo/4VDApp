import { ArrowSquareOut, FileXls } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { canManage, canOversee } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import type { Catalogue } from '../i18n/en';
import { useLanguage, useT } from '../i18n/useT';
import { booksApi } from '../services/api';
import { EXPENSE_CATEGORIES, type AccountLinkKey, type BooksPeriod, type EntrySource, type EntryTarget, type LedgerEntry } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateWith, formatMoney } from '../utils/format';
import { ErrorNotice, Loading } from './Feedback';
import { Badge, Button, ButtonLink, DataTable, MenuButton, Section } from './ui';

/** "4 Oct 2026" for a "2026-10-04" day, without any time zone moving it. */
export const formatBookDay = (day: string) =>
  formatDateWith(new Date(`${day}T00:00:00Z`), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** What wrote an entry, in words: "Sale", "Supplier bill", "Written by hand". */
export function kindLabel(t: Catalogue, entry: { kind: string; source: string | null }): string {
  if (entry.kind === 'reversal') return t.books.kinds.reversal;
  if (entry.kind === 'manual' || entry.source === null) return t.books.kinds.manual;
  const kind = entry.source.split(':')[0] as keyof Catalogue['books']['kinds'];
  return t.books.kinds[kind] ?? t.books.kinds.manual;
}

/** What an account is linked to, in words: "Cash in the till", "Expense: Rent". */
export function linkLabel(t: Catalogue, key: AccountLinkKey): string {
  if (key.startsWith('expense:')) {
    const category = key.slice('expense:'.length) as (typeof EXPENSE_CATEGORIES)[number];
    return t.books.expenseLink(t.expenses.categories[category]);
  }
  if (key.startsWith('asset:')) {
    const category = key.slice('asset:'.length) as keyof Catalogue['bills']['equipmentCategories'];
    return t.books.assetLink(t.bills.equipmentCategories[category]);
  }
  return t.books.links[key as keyof Catalogue['books']['links']];
}

/** "€120.00 Dr": a balance with the side it sits on; debits minus credits come in. */
export function formatBalance(t: Catalogue, balance: number): string {
  if (Math.abs(balance) < 0.005) return formatMoney(0);
  return `${formatMoney(Math.abs(balance))} ${balance > 0 ? t.books.dr : t.books.cr}`;
}

/** A balance as a headline figure, the side it sits on in small type after it. */
export function BalanceFigure({ balance }: { balance: number }) {
  const t = useT();
  if (Math.abs(balance) < 0.005) return <>{formatMoney(0)}</>;
  return (
    <>
      {formatMoney(Math.abs(balance))} <span className="books-side">{balance > 0 ? t.books.dr : t.books.cr}</span>
    </>
  );
}

/** The page that shows the document behind an entry. */
export function targetPath(target: EntryTarget, day: string): string {
  const onTheDay = `period=custom&from=${day}&to=${day}`;
  switch (target.page) {
    case 'document':
      return `/documents/${target.id}`;
    case 'bill':
      return `/bills/${target.id}`;
    case 'count':
      return `/counts/${target.id}`;
    case 'customer':
      return `/customers/${target.id}`;
    case 'product':
      return `/products/${target.id}`;
    case 'expenses':
      return `/expenses?${onTheDay}`;
    case 'sales':
      return `/sales?${onTheDay}${target.search ? `&search=${encodeURIComponent(target.search)}` : ''}`;
  }
}

/** The account card for a line, keeping the period picked. */
export const cardPath = (accountId: number, search = '') => `/books/accounts/${accountId}${search}`;

/** What an entry's warning means, in a sentence. */
export function warningText(t: Catalogue, warning: string): string {
  if (warning === 'no_vat') return t.books.entryWarning.no_vat;
  return t.books.entryWarning.no_cost(Number(warning.split(':')[1]) || 1);
}

/** An entry's lines: each account with what went in and out, and the totals under them. */
export function EntryLines({ entry }: { entry: LedgerEntry }) {
  const t = useT();
  return (
    <DataTable
      density="compact"
      caption={t.books.lines}
      rows={entry.lines}
      rowKey={(line) => `${line.accountId}-${line.party?.kind ?? ''}${line.party?.id ?? ''}-${line.debit}-${line.credit}`}
      columns={[
        {
          header: t.books.account,
          title: true,
          cell: (line) => (
            <>
              <Link className="table__primary-link" to={cardPath(line.accountId)}>
                <span className="books-number">{line.accountNumber}</span> {line.accountName}
              </Link>
              {(line.party || line.memo) && <span className="table__secondary">{line.party?.name ?? line.memo}</span>}
            </>
          ),
        },
        { header: t.books.debit, align: 'end', cell: (line) => (line.debit ? formatMoney(line.debit) : '') },
        { header: t.books.credit, align: 'end', cell: (line) => (line.credit ? formatMoney(line.credit) : '') },
      ]}
      totals={[t.books.totals, formatMoney(entry.total), formatMoney(entry.total)]}
    />
  );
}

/** Corrections and warnings on an entry, as badges. */
export function EntryBadges({ entry }: { entry: Pick<LedgerEntry, 'kind' | 'reversed' | 'reversesId' | 'warning'> }) {
  const t = useT();
  return (
    <>
      {entry.reversed && <Badge tone="neutral">{t.books.reversed}</Badge>}
      {entry.reversesId !== null && <Badge tone="neutral">{t.books.cancels(entry.reversesId)}</Badge>}
      {entry.warning && <Badge tone="warn">{entry.warning === 'no_vat' ? t.books.warningAction.no_vat : t.books.warningAction.no_cost}</Badge>}
    </>
  );
}

/** One entry in full: what wrote it, the lines, the document behind it, and (for one written by hand) reversing it. */
export function EntryView({ entry, onReversed }: { entry: LedgerEntry; onReversed?: (reversal: LedgerEntry) => void }) {
  const t = useT();
  const { role } = useCurrentUser();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const reverse = useMutation({
    mutationFn: () => booksApi.reverseEntry(entry.id),
    onSuccess: (reversal) => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setConfirming(false);
      onReversed?.(reversal);
    },
  });
  const canReverse = entry.kind === 'manual' && !entry.reversed && canManage(role);

  return (
    <div className="books-entry">
      <p className="books-entry__head">
        <span className="books-entry__kind">{kindLabel(t, entry)}</span>
        <span className="table__secondary">{formatBookDay(entry.date)}</span>
        <EntryBadges entry={entry} />
      </p>
      <p className="books-entry__what">{entry.description}</p>
      {entry.warning && <p className="notice notice--warn">{warningText(t, entry.warning)}</p>}
      <EntryLines entry={entry} />
      {entry.target && (
        <ButtonLink variant="ghost" size="sm" icon={ArrowSquareOut} to={targetPath(entry.target, entry.date)}>
          {t.books.openDocument}
        </ButtonLink>
      )}
      <p className="field-hint">{entry.kind === 'auto' ? t.books.autoHint : entry.createdBy && t.books.writtenBy(entry.createdBy)}</p>
      {canReverse && (
        <div className="books-entry__reverse">
          <p className="field-hint">{t.books.reverseHint}</p>
          <div className="form-actions">
            {confirming ? (
              <>
                <Button variant="danger" loading={reverse.isPending} disabled={reverse.isPending} onClick={() => reverse.mutate()}>
                  {t.books.confirmReverse}
                </Button>
                <Button variant="ghost" disabled={reverse.isPending} onClick={() => setConfirming(false)}>
                  {t.books.keep}
                </Button>
              </>
            ) : (
              <Button variant="danger-text" onClick={() => setConfirming(true)}>
                {t.books.reverse}
              </Button>
            )}
          </div>
          {reverse.isError && (
            <p className="form-error" role="alert">
              {errorMessage(reverse.error)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** One entry by its number, loaded for a panel. */
export function EntryById({ id, onOpen }: { id: number; onOpen: (id: number) => void }) {
  const entry = useQuery({ queryKey: ['books', 'entry', id], queryFn: () => booksApi.entry(id) });
  if (entry.isPending) return <Loading />;
  if (entry.isError) return <ErrorNotice error={entry.error} onRetry={() => entry.refetch()} />;
  return <EntryView entry={entry.data} onReversed={(reversal) => onOpen(reversal.id)} />;
}

/** An Excel download of the books for a period, in the language the dashboard is in. */
export function BooksDownload({ what, period, label }: { what: DownloadWhat; period: BooksPeriod; label: string }) {
  const t = useT();
  const { language } = useLanguage();
  const download = useMutation({ mutationFn: () => booksApi.download(what, period, language) });
  return (
    <>
      <Button variant="ghost" size="sm" icon={FileXls} loading={download.isPending} disabled={download.isPending} onClick={() => download.mutate()}>
        {download.isPending ? t.books.downloading : label}
      </Button>
      {download.isError && (
        <p className="form-error" role="alert">
          {errorMessage(download.error)}
        </p>
      )}
    </>
  );
}

type DownloadWhat = 'trial-balance' | 'journal' | 'ledger' | { account: number };

/** Several Excel downloads of the books behind one key, for a page with more than one. */
export function BooksDownloads({ items, period }: { items: { what: DownloadWhat; label: string }[]; period: BooksPeriod }) {
  const t = useT();
  const { language } = useLanguage();
  const download = useMutation({ mutationFn: (what: DownloadWhat) => booksApi.download(what, period, language) });
  return (
    <>
      <MenuButton
        label={download.isPending ? t.books.downloading : t.books.download}
        icon={FileXls}
        loading={download.isPending}
        items={items.map((item) => ({ label: item.label, icon: FileXls, onSelect: () => download.mutate(item.what) }))}
      />
      {download.isError && (
        <p className="form-error" role="alert">
          {errorMessage(download.error)}
        </p>
      )}
    </>
  );
}

/** What a document wrote in the books, on its own page. Only for those who oversee the business. */
export function EntriesPanel({ source, id }: { source: EntrySource; id: number }) {
  const { role } = useCurrentUser();
  if (!canOversee(role)) return null;
  return <EntriesPanelBody source={source} id={id} />;
}

function EntriesPanelBody({ source, id }: { source: EntrySource; id: number }) {
  const t = useT();
  const entries = useQuery({ queryKey: ['books', 'for', source, id], queryFn: () => booksApi.entriesFor(source, id) });
  return (
    <Section title={t.books.panel.title} description={t.books.panel.description}>
      {entries.isPending && <Loading />}
      {entries.isError && <ErrorNotice error={entries.error} onRetry={() => entries.refetch()} />}
      {entries.data?.length === 0 && (
        <p className="field-hint">
          {t.books.panel.none} {t.books.panel.noneHint}
        </p>
      )}
      {entries.data && entries.data.length > 0 && (
        <ol className="books-panel">
          {entries.data.map((entry) => (
            <li key={entry.id} className={entry.reversed || entry.kind === 'reversal' ? 'books-panel__entry books-panel__entry--old' : 'books-panel__entry'}>
              <p className="books-entry__head">
                <span className="books-entry__kind">{kindLabel(t, entry)}</span>
                <span className="table__secondary">
                  {formatBookDay(entry.date)} · #{entry.id}
                </span>
                <EntryBadges entry={entry} />
              </p>
              {entry.warning && <p className="notice notice--warn">{warningText(t, entry.warning)}</p>}
              <EntryLines entry={entry} />
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

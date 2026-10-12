import { AddressBook, PencilSimple, Plus, Printer, WhatsappLogo } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { businessApi, customersApi, documentsApi } from '../services/api';
import type { Customer, CustomerDetail, CustomerKind, TabEntry } from '../services/types';
import { cleanNui, isNui, NuiInput } from '../components/NuiInput';
import { SearchInput } from '../components/SearchInput';
import { errorMessage } from '../utils/errors';
import { formatDate, formatDateTime, formatHeadlineMoney, formatMoney } from '../utils/format';
import {
  Badge,
  BarList,
  Button,
  ButtonLink,
  buttonClass,
  Card,
  DataTable,
  EmptyState,
  Field,
  PageHeader,
  Sheet,
  StatGrid,
  StatTile,
  useNewSheet,
} from '../components/ui';
import { HistoryCard } from '../components/HistoryCard';

/** Same as the server: tabs unpaid this long need a reminder. */
const OVERDUE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const isOverdue = (customer: Customer) =>
  customer.owingSince !== null && Date.now() - Date.parse(customer.owingSince) >= OVERDUE_DAYS * MS_PER_DAY;

const FILTERS = ['all', 'owes', 'overdue', 'business'] as const;
type Filter = (typeof FILTERS)[number];
const matches: Record<Filter, (customer: Customer) => boolean> = {
  all: () => true,
  owes: (customer) => customer.balance > 0,
  overdue: isOverdue,
  business: (customer) => customer.kind === 'business',
};

const SORTS = ['owed', 'recent', 'spent', 'name'] as const;
type Sort = (typeof SORTS)[number];
const byName = (a: Customer, b: Customer) => a.name.localeCompare(b.name);
const compare: Record<Sort, (a: Customer, b: Customer) => number> = {
  owed: (a, b) => b.balance - a.balance || byName(a, b),
  recent: (a, b) => (b.lastPurchaseAt ?? '').localeCompare(a.lastPurchaseAt ?? '') || byName(a, b),
  spent: (a, b) => b.spentThisYear - a.spentThisYear || byName(a, b),
  name: byName,
};

/**
 * A WhatsApp chat with the message already written, or null when the number
 * can't be read. Local Kosovo numbers ("044 123 456") get the +383 prefix.
 */
function whatsappLink(phone: string, text: string): string | null {
  let digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `383${digits.slice(1)}`;
  if (!/^\d{8,15}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Old tab links (/tabs?customer=7) open the customer's own page. */
export function TabsRedirect() {
  const [params] = useSearchParams();
  const customerId = Number(params.get('customer')) || null;
  return <Navigate to={customerId ? `/customers/${customerId}` : '/customers'} replace />;
}

/** The registered few: who owes what, who buys, and how much. Every other sale stays anonymous. */
export function CustomersPage() {
  const t = useT();
  const navigate = useNavigate();
  const [adding, setAdding] = useNewSheet();
  const [params, setParams] = useSearchParams();
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list });
  // The first moment of this month, fixed when the page opens.
  const [monthStart] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  });
  const search = (params.get('search') ?? '').trim().toLowerCase();
  const filter: Filter = FILTERS.find((key) => key === params.get('show')) ?? 'all';
  const sort: Sort = SORTS.find((key) => key === params.get('sort')) ?? 'owed';

  function updateParams(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }
  const filterLink = (key: Filter) => {
    const next = new URLSearchParams(params);
    if (key === 'all' || key === filter) next.delete('show');
    else next.set('show', key);
    return `/customers?${next}`;
  };

  const all = customers.data ?? [];
  const count = (key: Filter) => all.filter(matches[key]).length;
  const owing = all.filter(matches.owes);
  const withCredit = all.filter((customer) => customer.balance < 0);
  const boughtThisMonth = all.filter((customer) => customer.lastPurchaseAt !== null && customer.lastPurchaseAt >= monthStart).length;
  const rows = all
    .filter(matches[filter])
    .filter((row) => !search || [row.name, row.phone, row.nui].some((value) => value?.toLowerCase().includes(search)))
    .sort(compare[sort]);

  return (
    <>
      <PageHeader
        title={t.customers.title}
        description={t.customers.description}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            {t.customers.add}
          </Button>
        }
      />

      <Sheet open={adding} onClose={() => setAdding(false)} title={t.customers.add} description={t.customers.addHint}>
        <CustomerForm />
      </Sheet>

      {all.length > 0 && (
        <StatGrid>
          <StatTile
            label={t.tabs.totalOwed}
            value={formatHeadlineMoney(owing.reduce((sum, customer) => sum + customer.balance, 0))}
            hint={owing.length > 0 ? t.customers.owingCount(owing.length) : undefined}
            to={filterLink('owes')}
          />
          <StatTile
            label={t.tabs.overdue(OVERDUE_DAYS)}
            value={count('overdue')}
            tone={count('overdue') > 0 ? 'warn' : 'default'}
            to={filterLink('overdue')}
          />
          <StatTile label={t.customers.boughtThisMonth} value={boughtThisMonth} hint={t.customers.boughtThisMonthHint} />
          <StatTile
            label={t.customers.creditHeld}
            value={formatHeadlineMoney(-withCredit.reduce((sum, customer) => sum + customer.balance, 0))}
            hint={withCredit.length > 0 ? t.customers.creditCount(withCredit.length) : undefined}
          />
        </StatGrid>
      )}

      {customers.isPending && <Loading />}
      {customers.isError && <ErrorNotice error={customers.error} onRetry={() => customers.refetch()} />}
      {customers.data && (
        <DataTable<Customer>
          caption={t.customers.title}
          rows={rows}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/customers/${row.id}`)}
          toolbar={
            all.length > 0 && (
              <>
                <SearchInput value={params.get('search') ?? ''} onChange={(value) => updateParams({ search: value })} label={t.customers.search} />
                <div className="segmented segmented--small" role="radiogroup" aria-label={t.customers.show}>
                  {FILTERS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={filter === key}
                      className="segmented__option"
                      onClick={() => updateParams({ show: key === 'all' ? null : key })}
                    >
                      {t.customers.filters[key]}
                      {key !== 'all' && <span className="segmented__count">{count(key)}</span>}
                    </button>
                  ))}
                </div>
                <select aria-label={t.customers.sortBy} value={sort} onChange={(event) => updateParams({ sort: event.target.value === 'owed' ? null : event.target.value })}>
                  {SORTS.map((key) => (
                    <option key={key} value={key}>
                      {t.customers.sorts[key]}
                    </option>
                  ))}
                </select>
              </>
            )
          }
          empty={
            all.length === 0 ? (
              <EmptyState
                icon={AddressBook}
                title={t.customers.none}
                action={
                  <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
                    {t.customers.add}
                  </Button>
                }
              >
                {t.customers.noneHint}
              </EmptyState>
            ) : (
              <EmptyState title={t.customers.noMatch} />
            )
          }
          columns={[
            {
              header: t.tabs.name,
              title: true,
              cell: (row) => (
                <>
                  <Link to={`/customers/${row.id}`} className="table__primary-link" aria-label={t.tabs.see(row.name)}>
                    {row.name}
                  </Link>
                  <span className="table__secondary">
                    {[row.kind === 'business' && (row.nui ? t.nui.short(row.nui) : t.customers.firm), row.phone].filter(Boolean).join(' · ')}
                  </span>
                </>
              ),
            },
            { header: t.customers.spentThisYear, align: 'end', cell: (row) => (row.spentThisYear !== 0 ? formatMoney(row.spentThisYear) : '–') },
            { header: t.customers.lastPurchase, cell: (row) => (row.lastPurchaseAt ? formatDate(row.lastPurchaseAt) : '–') },
            {
              header: t.tabs.owingSince,
              cell: (row) =>
                row.owingSince === null ? '–' : isOverdue(row) ? <Badge tone="warn">{formatDate(row.owingSince)}</Badge> : formatDate(row.owingSince),
            },
            {
              header: t.customers.owes,
              align: 'end',
              cell: (row) =>
                row.balance > 0 ? (
                  <strong>{formatMoney(row.balance)}</strong>
                ) : row.balance < 0 ? (
                  <Badge tone="ok">{t.tabs.credit(formatMoney(-row.balance))}</Badge>
                ) : (
                  '–'
                ),
            },
          ]}
        />
      )}
    </>
  );
}

const KINDS: CustomerKind[] = ['person', 'business'];

/** Registers a customer, or with `customer` changes their details. A business has to give its NUI. */
function CustomerForm({ customer, onSaved }: { customer?: Customer; onSaved?: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [kind, setKind] = useState<CustomerKind>(customer?.kind ?? 'person');
  const [name, setName] = useState(customer?.name ?? '');
  const [nui, setNui] = useState(customer?.nui ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [note, setNote] = useState(customer?.note ?? '');
  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        kind,
        nui: kind === 'business' ? cleanNui(nui) : null,
        phone: phone.trim() || null,
        note: note.trim() || null,
      };
      return customer ? customersApi.update(customer.id, input) : customersApi.create(input);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      if (customer) onSaved?.();
      else navigate(`/customers/${saved.id}`);
    },
  });
  const isValid = name.trim() !== '' && (kind === 'person' || isNui(nui));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <div className="segmented" role="radiogroup" aria-label={t.tabs.kind}>
        {KINDS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={kind === option}
            className="segmented__option"
            onClick={() => setKind(option)}
          >
            {t.tabs.kinds[option]}
          </button>
        ))}
      </div>
      <Field label={kind === 'business' ? t.tabs.businessName : t.tabs.name}>
        <input required maxLength={120} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      {kind === 'business' && (
        <Field label={t.nui.label} hint={t.nui.hint}>
          <NuiInput required value={nui} onChange={(event) => setNui(event.target.value)} />
        </Field>
      )}
      <Field label={t.tabs.phone}>
        <input type="tel" maxLength={40} autoComplete="off" value={phone} onChange={(event) => setPhone(event.target.value)} />
      </Field>
      <Field label={t.tabs.note}>
        <input maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={!isValid || save.isPending}>
        {save.isPending ? t.tabs.saving : customer ? t.tabs.saveDetails : t.customers.add}
      </Button>
    </form>
  );
}

export function CustomerDetailPage() {
  const t = useT();
  const id = Number(useParams().id);
  const { role } = useCurrentUser();
  const [editing, setEditing] = useNewSheet('edit');
  const customer = useQuery({ queryKey: ['customers', id], queryFn: () => customersApi.detail(id) });
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });

  if (customer.isPending) return <Loading />;
  if (customer.isError) return <ErrorNotice error={customer.error} onRetry={() => customer.refetch()} />;
  const data = customer.data;
  const reminder =
    data.phone && data.balance > 0 && business.data
      ? whatsappLink(data.phone, t.customers.reminderText(data.name, formatMoney(data.balance), business.data.name))
      : null;

  return (
    <>
      <PageHeader
        title={data.name}
        description={[data.kind === 'business' && (data.nui ? t.nui.short(data.nui) : t.customers.firm), data.phone, data.note].filter(Boolean).join(' · ') || undefined}
        crumbs={[{ label: t.nav.items.customers, to: '/customers' }]}
        actions={
          <>
            {reminder && (
              <a href={reminder} target="_blank" rel="noreferrer" className={buttonClass()}>
                <WhatsappLogo aria-hidden="true" />
                {t.customers.remind}
              </a>
            )}
            <ButtonLink to={`/customers/${data.id}/statement`} icon={Printer}>
              {t.customers.statement}
            </ButtonLink>
            {canManage(role) && (
              <Button icon={PencilSimple} onClick={() => setEditing(true)}>
                {t.customers.edit}
              </Button>
            )}
          </>
        }
      />

      {canManage(role) && (
        <Sheet open={editing} onClose={() => setEditing(false)} title={t.customers.edit} description={t.customers.editHint}>
          <CustomerForm key={data.id} customer={data} onSaved={() => setEditing(false)} />
        </Sheet>
      )}

      <StatGrid>
        <StatTile
          label={t.customers.owes}
          value={data.balance > 0 ? formatMoney(data.balance) : data.balance < 0 ? t.tabs.credit(formatMoney(-data.balance)) : t.tabs.settled}
          hint={data.owingSince ? `${t.tabs.owingSince}: ${formatDate(data.owingSince)}` : undefined}
          tone={isOverdue(data) ? 'warn' : 'default'}
        />
        <StatTile label={t.customers.spentThisYear} value={formatHeadlineMoney(data.spentThisYear)} hint={t.customers.spentInAll(formatMoney(data.spent))} />
        <StatTile
          label={t.customers.purchases}
          value={data.purchases}
          hint={data.purchases > 0 ? t.customers.average(formatMoney(data.spent / data.purchases)) : undefined}
        />
        <StatTile label={t.customers.lastPurchase} value={data.lastPurchaseAt ? formatDate(data.lastPurchaseAt) : '–'} />
      </StatGrid>

      <div className="split">
        <TabCard customer={data} />
        <Card title={t.customers.whatTheyBuy}>
          {data.topProducts.length === 0 ? (
            <EmptyState title={t.customers.noInvoices} />
          ) : (
            <BarList
              label={t.customers.whatTheyBuyLabel}
              items={data.topProducts.map((product) => ({
                key: product.productId,
                label: product.name,
                value: product.total,
                display: formatMoney(product.total),
                detail: t.customers.pieces(product.quantity),
                to: `/inventory/${product.productId}`,
              }))}
            />
          )}
        </Card>
      </div>

      <InvoicesCard customerId={data.id} />

      {canManage(role) && data.balance === 0 && !data.archived && <CloseTab customer={data} />}
      <HistoryCard entityType="customer" entityId={data.id} />
    </>
  );
}

/** What they owe on the tab: take a payment, and every charge and payment. */
function TabCard({ customer }: { customer: CustomerDetail }) {
  const t = useT();
  return (
    <Card title={t.customers.tab} flush>
      <div className="tab-card__pay">
        {customer.balance > 0 ? <PaymentForm customer={customer} /> : <p className="field-hint">{t.customers.tabSettled}</p>}
      </div>
      <DataTable
        caption={t.tabs.historyCaption}
        rows={customer.entries}
        rowKey={(row) => row.id}
        rowClassName={(row) => (row.undone ? 'table__row--muted' : undefined)}
        empty={<EmptyState title={t.statement.empty} />}
        columns={[
          {
            header: t.tabs.what,
            title: true,
            cell: (row) => (
              <>
                <EntryWhat entry={row} />
                <span className="table__secondary">
                  {[formatDateTime(row.at), row.by && (row.kind === 'payment' ? t.tabs.takenBy(row.by) : row.kind === 'refund' ? t.tabs.refundedBy(row.by) : t.tabs.addedBy(row.by))]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </>
            ),
          },
          {
            header: t.tabs.amount,
            align: 'end',
            cell: (row) => (row.kind === 'charge' ? formatMoney(row.amount) : `−${formatMoney(row.amount)}`),
          },
        ]}
      />
    </Card>
  );
}

function EntryWhat({ entry }: { entry: TabEntry }) {
  const t = useT();
  return (
    <>
      {entry.kind === 'payment' ? (
        <Badge tone="ok">{t.tabs.payment}</Badge>
      ) : entry.kind === 'refund' ? (
        <Badge tone="ok">{t.tabs.refund}</Badge>
      ) : (
        <Badge tone="neutral">{t.tabs.charge}</Badge>
      )}
      {entry.note && <span className="table__secondary">{entry.note}</span>}
      {entry.undone && <span className="table__secondary">{t.tabs.undone}</span>}
    </>
  );
}

function PaymentForm({ customer }: { customer: Customer }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const pay = useMutation({
    mutationFn: () => customersApi.pay(customer.id, { amount: Number(amount), note: note.trim() || null }),
    onSuccess: () => {
      for (const key of ['customers', 'activity', 'cash', 'reports']) queryClient.invalidateQueries({ queryKey: [key] });
      setAmount('');
      setNote('');
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    pay.mutate();
  }

  const value = Number(amount);
  const isValid = value > 0 && value <= customer.balance;

  return (
    <form className="settings-form" onSubmit={handleSubmit} aria-label={t.tabs.takePayment}>
      <div className="field-row">
        <Field label={t.tabs.amount} narrow>
          <input
            type="number"
            inputMode="decimal"
            required
            min={0.01}
            max={customer.balance}
            step={0.01}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field label={t.tabs.note}>
          <input maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
      {pay.isError && (
        <p className="form-error" role="alert">
          {errorMessage(pay.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!isValid || pay.isPending}>
          {pay.isPending ? t.tabs.paying : t.tabs.payButton}
        </Button>
        <Button variant="ghost" onClick={() => setAmount(String(customer.balance))}>
          {t.tabs.paidAll}
        </Button>
      </div>
    </form>
  );
}

function CloseTab({ customer }: { customer: Customer }) {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const close = useMutation({
    mutationFn: () => customersApi.archive(customer.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      navigate('/customers');
    },
  });
  return (
    <Card title={t.tabs.close} description={t.tabs.closeHint}>
      {close.isError && (
        <p className="form-error" role="alert">
          {errorMessage(close.error)}
        </p>
      )}
      <Button variant="danger" disabled={close.isPending} onClick={() => close.mutate()}>
        {close.isPending ? t.tabs.closing : t.tabs.close}
      </Button>
    </Card>
  );
}

/** Everything bought under their name, paid at the till or on the tab, and the credit notes, newest first. */
function InvoicesCard({ customerId }: { customerId: number }) {
  const t = useT();
  const documents = useQuery({
    queryKey: ['documents', { customerId }],
    queryFn: () => documentsApi.list({ page: 1, customerId }),
  });
  return (
    <Card title={t.customers.invoices} flush actions={<Link to="/documents">{t.customers.allInvoices}</Link>}>
      {documents.isError && <ErrorNotice error={documents.error} onRetry={() => documents.refetch()} />}
      <DataTable
        caption={t.customers.invoices}
        rows={documents.data?.items ?? []}
        rowKey={(row) => row.id}
        empty={<EmptyState title={documents.isPending ? t.common.loading : t.customers.noInvoices} />}
        columns={[
          {
            header: t.documents.number,
            title: true,
            cell: (row) => (
              <Link to={`/documents/${row.id}`} className="table__primary-link">
                {row.number}
                <span className="table__secondary">{t.documents.kinds[row.kind]}</span>
              </Link>
            ),
          },
          { header: t.documents.issued, cell: (row) => formatDate(row.issuedAt) },
          {
            header: t.customers.howPaid,
            cell: (row) =>
              row.kind === 'invoice' ? <Badge tone={row.paymentMethod === 'account' ? 'info' : 'neutral'}>{t.customers.paidAt[row.paymentMethod]}</Badge> : '–',
          },
          { header: t.documents.total, align: 'end', cell: (row) => (row.kind === 'credit_note' ? `−${formatMoney(row.total)}` : formatMoney(row.total)) },
        ]}
      />
    </Card>
  );
}

/** Tab entries oldest first, undone ones left out, each with the balance after it. */
function withRunningBalance(entries: TabEntry[]): Array<TabEntry & { balance: number }> {
  const lines: Array<TabEntry & { balance: number }> = [];
  let balance = 0;
  for (const entry of [...entries].reverse()) {
    if (entry.undone) continue;
    balance = Math.round((balance + (entry.kind === 'charge' ? entry.amount : -entry.amount)) * 100) / 100;
    lines.push({ ...entry, balance });
  }
  return lines;
}

/**
 * A statement of account to print or save as PDF and send: every tab charge,
 * payment and return, oldest first, with the balance after each.
 */
export function CustomerStatementPage() {
  const t = useT();
  const id = Number(useParams().id);
  const customer = useQuery({ queryKey: ['customers', id], queryFn: () => customersApi.detail(id) });
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });
  const [printedAt] = useState(() => new Date().toISOString());

  if (customer.isPending || business.isPending) return <Loading />;
  if (customer.isError) return <ErrorNotice error={customer.error} onRetry={() => customer.refetch()} />;
  if (business.isError) return <ErrorNotice error={business.error} onRetry={() => business.refetch()} />;
  const data = customer.data;
  const shop = business.data;

  const lines = withRunningBalance(data.entries);

  const sheet = (
    <article className="statement">
      <header className="statement__head">
        <div>
          <p className="statement__shop">{shop.name}</p>
          <p className="statement__muted">{[shop.address, shop.phone, shop.nui && t.nui.short(shop.nui)].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="statement__title">
          <h2>{t.statement.title}</h2>
          <p className="statement__muted">{t.statement.asOf(formatDate(printedAt))}</p>
        </div>
      </header>
      <p className="statement__to">
        <span className="statement__muted">{t.statement.to}</span> <strong>{data.name}</strong>
        {[data.nui && t.nui.short(data.nui), data.phone].filter(Boolean).map((part) => ` · ${part}`)}
      </p>
      {lines.length === 0 ? (
        <p className="statement__muted">{t.statement.empty}</p>
      ) : (
        <table className="statement__table">
          <caption className="visually-hidden">{t.statement.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.statement.date}</th>
              <th scope="col">{t.statement.what}</th>
              <th scope="col" className="statement__number">
                {t.statement.amount}
              </th>
              <th scope="col" className="statement__number">
                {t.statement.balance}
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td>{formatDate(line.at)}</td>
                <td>{[t.statement[line.kind], line.note].filter(Boolean).join(': ')}</td>
                <td className="statement__number">{line.kind === 'charge' ? formatMoney(line.amount) : `−${formatMoney(line.amount)}`}</td>
                <td className="statement__number">{formatMoney(line.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="statement__total">
        <span>{data.balance > 0 ? t.statement.due : data.balance < 0 ? t.statement.credit : t.statement.settled}</span>
        <strong>{formatMoney(Math.abs(data.balance))}</strong>
      </p>
      {shop.iban && <p className="statement__muted">{[shop.bankName, shop.iban].filter(Boolean).join(' · ')}</p>}
    </article>
  );

  return (
    <>
      <PageHeader
        title={t.statement.title}
        description={t.statement.hint}
        crumbs={[
          { label: t.nav.items.customers, to: '/customers' },
          { label: data.name, to: `/customers/${data.id}` },
        ]}
        actions={
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>
            {t.statement.print}
          </Button>
        }
      />
      <Card>{sheet}</Card>
      {/* A copy straight on the page body, so printing starts at the top of the paper, away from the app's layout. */}
      {createPortal(
        <div className="print-root" aria-hidden="true">
          {sheet}
        </div>,
        document.body,
      )}
    </>
  );
}

import { Notebook } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { customersApi } from '../services/api';
import type { Customer, CustomerKind, TabEntry } from '../services/types';
import { cleanNui, isNui, NuiInput } from '../components/NuiInput';
import { errorMessage } from '../utils/errors';
import { formatDate, formatDateTime, formatMoney } from '../utils/format';
import { Badge, Button, Card, DataTable, EmptyState, Field, PageHeader, StatGrid, StatTile } from '../components/ui';

/** Same as the server: tabs unpaid this long need a reminder. */
const OVERDUE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const isOverdue = (customer: Customer) =>
  customer.owingSince !== null && Date.now() - Date.parse(customer.owingSince) >= OVERDUE_DAYS * MS_PER_DAY;

/** Who owes what. One customer's tab opens on the same page (?customer=). */
export function TabsPage() {
  const [params] = useSearchParams();
  const customerId = Number(params.get('customer')) || null;
  return customerId ? <CustomerTab id={customerId} /> : <AllTabs />;
}

function AllTabs() {
  const t = useT();
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list });
  const owing = customers.data?.filter((customer) => customer.balance > 0) ?? [];

  return (
    <>
      <PageHeader title={t.tabs.title} description={t.tabs.description} />

      {customers.data && (
        <StatGrid>
          <StatTile label={t.tabs.totalOwed} value={formatMoney(owing.reduce((sum, customer) => sum + customer.balance, 0))} />
          <StatTile label={t.tabs.customers} value={owing.length} />
          <StatTile
            label={t.tabs.overdue(OVERDUE_DAYS)}
            value={owing.filter(isOverdue).length}
            tone={owing.some(isOverdue) ? 'warn' : 'default'}
          />
        </StatGrid>
      )}

      <Card title={t.tabs.open}>
        <CustomerForm />
      </Card>

      {customers.isPending && <Loading />}
      {customers.isError && <ErrorNotice error={customers.error} onRetry={() => customers.refetch()} />}
      {customers.data && (
        <Card title={t.tabs.list} flush>
          <DataTable
            caption={t.tabs.caption}
            rows={customers.data}
            rowKey={(row) => row.id}
            empty={<EmptyState icon={Notebook} title={t.tabs.none}>{t.tabs.noneHint}</EmptyState>}
            columns={[
              {
                header: t.tabs.name,
                title: true,
                cell: (row) => (
                  <>
                    <Link to={`/tabs?customer=${row.id}`} className="table__primary-link" aria-label={t.tabs.see(row.name)}>
                      {row.name}
                    </Link>
                    {(row.nui || row.phone) && (
                      <span className="table__secondary">{[row.nui && t.nui.short(row.nui), row.phone].filter(Boolean).join(' · ')}</span>
                    )}
                  </>
                ),
              },
              {
                header: t.tabs.owes,
                align: 'end',
                cell: (row) => (row.balance > 0 ? formatMoney(row.balance) : <Badge tone="ok">{t.tabs.settled}</Badge>),
              },
              {
                header: t.tabs.owingSince,
                cell: (row) =>
                  row.owingSince === null ? '–' : isOverdue(row) ? <Badge tone="warn">{formatDate(row.owingSince)}</Badge> : formatDate(row.owingSince),
              },
              { header: t.tabs.lastPayment, cell: (row) => (row.lastPaymentAt ? formatDate(row.lastPaymentAt) : '–') },
            ]}
          />
        </Card>
      )}
    </>
  );
}

const KINDS: CustomerKind[] = ['person', 'business'];

/** Opens a tab, or with `customer` changes its details. A business has to give its NUI. */
function CustomerForm({ customer, onSaved }: { customer?: Customer; onSaved?: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [, setParams] = useSearchParams();
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
      else setParams({ customer: String(saved.id) });
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
      <div className="field-row">
        <Field label={kind === 'business' ? t.tabs.businessName : t.tabs.name}>
          <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        {kind === 'business' && (
          <Field label={t.nui.label} hint={t.nui.hint}>
            <NuiInput required value={nui} onChange={(event) => setNui(event.target.value)} />
          </Field>
        )}
      </div>
      <div className="field-row">
        <Field label={t.tabs.phone}>
          <input type="tel" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} />
        </Field>
        <Field label={t.tabs.note}>
          <input maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={!isValid || save.isPending}>
        {save.isPending ? t.tabs.saving : customer ? t.tabs.saveDetails : t.tabs.openButton}
      </Button>
    </form>
  );
}

function CustomerTab({ id }: { id: number }) {
  const t = useT();
  const { role } = useCurrentUser();
  const customer = useQuery({ queryKey: ['customers', id], queryFn: () => customersApi.detail(id) });

  if (customer.isPending) return <Loading />;
  if (customer.isError) return <ErrorNotice error={customer.error} onRetry={() => customer.refetch()} />;
  const data = customer.data;

  return (
    <>
      <PageHeader
        title={data.name}
        description={[data.nui && t.nui.short(data.nui), data.phone, data.note].filter(Boolean).join(' · ') || undefined}
        crumbs={[{ label: t.tabs.back, to: '/tabs' }]}
      />
      <StatGrid>
        <StatTile label={t.tabs.owes} value={data.balance > 0 ? formatMoney(data.balance) : t.tabs.settled} tone={isOverdue(data) ? 'warn' : 'default'} />
        <StatTile label={t.tabs.owingSince} value={data.owingSince ? formatDate(data.owingSince) : '–'} />
        <StatTile label={t.tabs.lastPayment} value={data.lastPaymentAt ? formatDate(data.lastPaymentAt) : '–'} />
      </StatGrid>

      {data.balance > 0 && (
        <Card title={t.tabs.takePayment}>
          <PaymentForm customer={data} />
        </Card>
      )}

      <Card title={t.tabs.history} flush>
        <DataTable
          caption={t.tabs.historyCaption}
          rows={data.entries}
          rowKey={(row) => row.id}
          rowClassName={(row) => (row.undone ? 'table__row--muted' : undefined)}
          columns={[
            { header: t.tabs.when, title: true, cell: (row) => formatDateTime(row.at) },
            { header: t.tabs.what, cell: (row) => <EntryWhat entry={row} /> },
            {
              header: t.tabs.amount,
              align: 'end',
              cell: (row) => (row.kind === 'payment' ? `−${formatMoney(row.amount)}` : formatMoney(row.amount)),
            },
            { header: t.tabs.by, cell: (row) => row.by ?? '–' },
          ]}
        />
      </Card>

      {canManage(role) && <EditDetails customer={data} />}

      {canManage(role) && data.balance === 0 && !data.archived && <CloseTab customer={data} />}
    </>
  );
}

/** Managers fix a name or phone, or turn a person's tab into a business's. Folded away until needed. */
function EditDetails({ customer }: { customer: Customer }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  return (
    <Card title={t.tabs.details}>
      {editing ? (
        <CustomerForm key={customer.id} customer={customer} onSaved={() => setEditing(false)} />
      ) : (
        <Button variant="ghost" onClick={() => setEditing(true)}>
          {t.tabs.editDetails}
        </Button>
      )}
    </Card>
  );
}

function EntryWhat({ entry }: { entry: TabEntry }) {
  const t = useT();
  return (
    <>
      {entry.kind === 'payment' ? <Badge tone="ok">{t.tabs.payment}</Badge> : <Badge tone="neutral">{t.tabs.charge}</Badge>}
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
    <form className="settings-form" onSubmit={handleSubmit}>
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
  const [, setParams] = useSearchParams();
  const close = useMutation({
    mutationFn: () => customersApi.archive(customer.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setParams({});
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

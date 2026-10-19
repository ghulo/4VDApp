import { AddressBook, CaretRight } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorNotice, Loading } from '../../components/Feedback';
import { SearchInput } from '../../components/SearchInput';
import { Badge, Button, Card, EmptyState, Field, PageHeader } from '../../components/ui';
import { useT } from '../../i18n/useT';
import { customersApi } from '../../services/api';
import { errorMessage } from '../../utils/errors';
import { formatDate, formatDateTime, formatMoney } from '../../utils/format';

const toNumber = (value: string) => Number(value.replace(',', '.'));

/** Who owes the shop, most owed first; each opens their tab. */
export function StaffTabsPage() {
  const t = useT();
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list });
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const rows = (customers.data ?? [])
    .filter((customer) => !customer.archived && (!query || customer.name.toLowerCase().includes(query) || (customer.phone ?? '').includes(query)))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title={t.staff.tabs.title} description={t.staff.tabs.intro} crumbs={[{ label: t.staff.nav.home, to: '/' }]} />
      <div className="staff-page">
        <SearchInput value={search} onChange={setSearch} label={t.staff.tabs.search} />
        {customers.isPending && <Loading />}
        {customers.isError && <ErrorNotice error={customers.error} onRetry={() => customers.refetch()} />}
        {customers.data && rows.length === 0 && (
          <EmptyState icon={AddressBook} title={t.staff.tabs.none}>
            {t.staff.tabs.noneHint}
          </EmptyState>
        )}
        {rows.length > 0 && (
          <ul className="staff-rows">
            {rows.map((customer) => (
              <li key={customer.id}>
                <Link to={`/tabs/${customer.id}`} className="staff-row">
                  <span className="staff-row__text staff-row__grow">
                    <span className="staff-row__title">{customer.name}</span>
                    {customer.owingSince && <span className="staff-row__hint">{t.staff.tabs.since(formatDate(customer.owingSince))}</span>}
                  </span>
                  {customer.balance > 0 ? <Badge tone="warn">{t.staff.tabs.owes(formatMoney(customer.balance))}</Badge> : <span className="staff-row__hint">{t.staff.tabs.settled}</span>}
                  <CaretRight size={18} aria-hidden="true" className="staff-row__caret" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** One customer's tab: what they owe, taking a payment, and every charge and payment. */
export function StaffTabPage() {
  const t = useT();
  const { id } = useParams();
  const customerId = Number(id);
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['customers', customerId], queryFn: () => customersApi.detail(customerId), enabled: Number.isInteger(customerId) });
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [paid, setPaid] = useState<string | null>(null);
  const value = toNumber(amount);
  const owed = detail.data?.balance ?? 0;
  const valid = amount.trim() !== '' && Number.isFinite(value) && value > 0 && value <= owed;

  const pay = useMutation({
    mutationFn: () => customersApi.pay(customerId, { amount: value, note: note.trim() || null }),
    onSuccess: () => {
      for (const key of ['customers', 'cash', 'activity', 'attention']) queryClient.invalidateQueries({ queryKey: [key] });
      setPaid(t.staff.tabs.paid(formatMoney(value)));
      setAmount('');
      setNote('');
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setPaid(null);
    pay.mutate();
  }

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorNotice error={detail.error} onRetry={() => detail.refetch()} />;
  const customer = detail.data;

  return (
    <>
      <PageHeader title={customer.name} crumbs={[{ label: t.staff.tabs.back, to: '/tabs' }]} />
      <div className="staff-page">
        <Card>
          <p className="staff-figure">{owed > 0 ? t.staff.tabs.owes(formatMoney(owed)) : t.staff.tabs.settled}</p>
          {customer.owingSince && <p className="staff-muted">{t.staff.tabs.since(formatDate(customer.owingSince))}</p>}
        </Card>

        {paid && (
          <p className="form-success" role="status">
            {paid}
          </p>
        )}
        {owed > 0 && (
          <Card title={t.staff.tabs.pay}>
            <form className="settings-form" onSubmit={submit}>
              <div className="field-row">
                <Field label={t.staff.tabs.amount} narrow>
                  <input type="text" inputMode="decimal" placeholder={String(owed)} value={amount} onChange={(event) => setAmount(event.target.value)} />
                </Field>
                <Field label={t.staff.tabs.note}>
                  <input type="text" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
                </Field>
              </div>
              {pay.isError && (
                <p className="form-error" role="alert">
                  {errorMessage(pay.error)}
                </p>
              )}
              <Button type="submit" variant="primary" disabled={!valid} loading={pay.isPending}>
                {t.staff.tabs.savePayment(valid ? formatMoney(value) : '')}
              </Button>
            </form>
          </Card>
        )}

        <section className="staff-section">
          <h2 className="staff-section__title">{t.staff.tabs.history}</h2>
          {customer.entries.length === 0 ? (
            <p className="staff-muted">{t.staff.tabs.noHistory}</p>
          ) : (
            <ul className="staff-rows">
              {customer.entries.map((entry) => (
                <li key={entry.id} className={entry.undone ? 'staff-row staff-row--undone' : 'staff-row'}>
                  <span className="staff-row__text staff-row__grow">
                    <span className="staff-row__title">{t.staff.tabs.kinds[entry.kind]}</span>
                    <span className="staff-row__hint">
                      {formatDateTime(entry.at)}
                      {entry.by ? ` · ${t.staff.tabs.by(entry.by)}` : ''}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </span>
                  </span>
                  <span className="staff-row__value">{entry.kind === 'charge' ? formatMoney(entry.amount) : `−${formatMoney(entry.amount)}`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

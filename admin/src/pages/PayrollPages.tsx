import { DownloadSimple, PencilSimple, Plus, Printer } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ChipChoice } from '../components/ChipChoice';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PlaceSelect, placeName } from '../components/MoneyParts';
import {
  Badge,
  Button,
  Card,
  DataTable,
  DateField,
  EmptyState,
  Field,
  MenuButton,
  PageHeader,
  RemoveButton,
  Section,
  Sheet,
  StatGrid,
  StatTile,
  useNewSheet,
  useToast,
} from '../components/ui';
import { useLanguage, useT } from '../i18n/useT';
import { moneyApi } from '../services/api';
import {
  type Contract,
  type Employee,
  type EmployeeDetail,
  type EmployeeInput,
  type LeaveBalance,
  type LineChange,
  type LineWarning,
  type PayLine,
  type PayrollMonthDetail,
  type PayslipRef,
  PAYROLL_KEY,
  payrollApi,
  type StaffPlace,
} from '../services/payroll';
import { errorMessage } from '../utils/errors';
import { formatDateTime, formatDateWith, formatHeadlineMoney, formatMoney } from '../utils/format';
import { printHtml } from '../utils/printPage';
import { thisMonth, formatMonth } from '../utils/vat';
import { useMonthParam } from '../utils/vatMonth';
import { useWarnBeforeLeaving } from '../utils/useWarnBeforeLeaving';
import { MonthPicker } from './VatPages';

/** "2026-10-04": today on this computer's calendar. */
const today = () => new Date().toLocaleDateString('en-CA');

/** "4 Oct 2026" for a "2026-10-04" day, without any time zone moving it. */
const formatDay = (day: string) => formatDateWith(new Date(`${day}T00:00:00Z`), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "15 November" for the day ATK wants the money. */
const formatDueDay = (day: string) => formatDateWith(new Date(`${day}T00:00:00Z`), { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** Typed amounts take a comma or a point. */
const amountOf = (text: string) => Number(text.replace(',', '.'));

/** Days of leave: whole days plain, part days with one decimal. */
const formatDays = (days: number) => (Number.isInteger(days) ? String(days) : days.toFixed(1));

/** The Kosovo minimum wage the forms warn below (backend payrollRules.ts keeps the dated rule). */
const MINIMUM_WAGE = 350;

/** What a month costs the business for this person, roughly, from their contract: gross plus the employer's pension share. */
const monthlyCost = (employee: Employee) =>
  employee.monthlyGross === null ? 0 : employee.monthlyGross * (1 + (employee.nonResident ? 0 : 5 + employee.extraPensionEmployer) / 100);

const invalidatePayroll = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: PAYROLL_KEY });
  queryClient.invalidateQueries({ queryKey: ['books'] });
  queryClient.invalidateQueries({ queryKey: ['money'] });
  queryClient.invalidateQueries({ queryKey: ['attention'] });
};

/** Opens a payslip in the print dialog (print it or save it as a PDF). */
function usePrintPayslip() {
  const { language } = useLanguage();
  const title = useT().payroll.person.payslips;
  return useMutation({
    mutationFn: async ({ monthId, employeeId }: { monthId: number; employeeId: number }) =>
      printHtml(await payrollApi.payslipHtml(monthId, employeeId, language), title),
  });
}

type Filter = 'current' | 'left' | 'all';

/** Team → Payroll → People: everyone paid, their contract pay and the leave they have left. */
export function PayrollPeoplePage() {
  const t = useT();
  const w = t.payroll;
  const [params, setParams] = useSearchParams();
  const filter: Filter = params.get('show') === 'left' || params.get('show') === 'all' ? (params.get('show') as Filter) : 'current';
  const employees = useQuery({ queryKey: [...PAYROLL_KEY, 'employees'], queryFn: payrollApi.employees });
  const [adding, setAdding] = useNewSheet();
  const linkUserId = params.get('user') ?? undefined;
  const closeAdding = () =>
    setParams((current) => {
      const updated = new URLSearchParams(current);
      updated.delete('new');
      updated.delete('user');
      return updated;
    });

  const all = employees.data ?? [];
  const working = all.filter((employee) => !employee.gone);
  const shown = filter === 'current' ? working : filter === 'left' ? all.filter((employee) => employee.gone) : all;
  const gross = working.reduce((sum, employee) => sum + (employee.monthlyGross ?? 0), 0);
  const cost = working.reduce((sum, employee) => sum + monthlyCost(employee), 0);
  const leave = working.reduce((sum, employee) => sum + employee.leave.balance, 0);

  function choose(next: Filter) {
    const nextParams = new URLSearchParams(params);
    if (next === 'current') nextParams.delete('show');
    else nextParams.set('show', next);
    setParams(nextParams, { replace: true });
  }

  return (
    <>
      <PageHeader
        title={w.title}
        description={w.description}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            {w.add}
          </Button>
        }
      />
      {employees.isPending && <Loading />}
      {employees.isError && <ErrorNotice error={employees.error} onRetry={() => employees.refetch()} />}
      {employees.data && (
        <>
          <StatGrid compact>
            <StatTile label={w.tiles.people} value={String(working.length)} />
            <StatTile label={w.tiles.gross} value={formatHeadlineMoney(gross)} />
            <StatTile label={w.tiles.cost} value={formatHeadlineMoney(Math.round(cost * 100) / 100)} />
            <StatTile label={w.tiles.leave} value={w.days(Math.round(leave * 10) / 10)} />
          </StatGrid>
          <DataTable
            caption={w.caption}
            rows={shown}
            rowKey={(row) => row.id}
            toolbar={
              <div className="toolbar">
                <ChipChoice label={w.show} value={filter} options={(['current', 'left', 'all'] as const).map((value) => ({ value, label: w.filters[value] }))} onChange={choose} />
              </div>
            }
            empty={<EmptyState title={w.none}>{w.noneHint}</EmptyState>}
            columns={[
              {
                header: w.name,
                title: true,
                cell: (row) => (
                  <>
                    <Link to={`/payroll/people/${row.id}`}>{row.name}</Link>
                    <span className="table__secondary">{employeeTags(row, w).join(' · ')}</span>
                  </>
                ),
              },
              { header: w.started, cell: (row) => formatDay(row.startedOn), className: 'table__phone-hide' },
              { header: w.pay, cell: (row) => (row.payBasis === 'net' ? w.net(formatMoney(row.payAmount)) : w.gross(formatMoney(row.payAmount))), align: 'end' },
              { header: w.leaveLeft, cell: (row) => w.days(Number(formatDays(row.leave.balance))), align: 'end' },
              { header: w.status, cell: (row) => <EmployeeStatus employee={row} />, className: 'table__phone-hide' },
            ]}
          />
        </>
      )}
      <Sheet open={adding} onClose={closeAdding} title={w.add}>
        <EmployeeForm linkUserId={linkUserId} onSaved={closeAdding} />
      </Sheet>
    </>
  );
}

/** "Cashier · Fixed-term · Carwash": the short facts under a name. */
function employeeTags(employee: Employee, w: ReturnType<typeof useT>['payroll']): string[] {
  return [
    employee.jobTitle,
    w.contracts[employee.contract],
    employee.place === 'carwash' ? w.carwash : null,
    employee.secondary ? w.secondJob : null,
    employee.nonResident ? w.nonResident : null,
  ].filter((tag): tag is string => Boolean(tag));
}

function EmployeeStatus({ employee }: { employee: Employee }) {
  const w = useT().payroll;
  if (employee.leftOn) return <Badge tone="neutral">{w.leftOn(formatDay(employee.leftOn))}</Badge>;
  if (employee.contractEndsOn) return <span>{w.endsOn(formatDay(employee.contractEndsOn))}</span>;
  return <Badge tone="ok">{w.filters.current}</Badge>;
}

interface FormState {
  userId: string;
  name: string;
  personalNumber: string;
  jobTitle: string;
  contract: Contract;
  startedOn: string;
  contractEndsOn: string;
  leftOn: string;
  payBasis: 'gross' | 'net';
  payAmount: string;
  secondary: boolean;
  nonResident: boolean;
  extraEmployee: string;
  extraEmployer: string;
  bankAccount: string;
  bankName: string;
  phone: string;
  email: string;
  address: string;
  birthDate: string;
  place: StaffPlace;
  leaveDays: string;
  note: string;
}

/** Adding someone to the payroll, or changing their contract. */
function EmployeeForm({ employee, linkUserId, onSaved }: { employee?: EmployeeDetail; /** Opened from a team member's page: link that account. */ linkUserId?: string; onSaved: () => void }) {
  const t = useT();
  const w = t.payroll.form;
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const team = useQuery({ queryKey: [...PAYROLL_KEY, 'team'], queryFn: payrollApi.team });
  const employees = useQuery({ queryKey: [...PAYROLL_KEY, 'employees'], queryFn: payrollApi.employees });
  const [form, setForm] = useState<FormState>(() => ({
    userId: employee?.userId ? String(employee.userId) : (linkUserId ?? ''),
    name: employee?.name ?? '',
    personalNumber: employee?.personalNumber ?? '',
    jobTitle: employee?.jobTitle ?? '',
    contract: employee?.contract ?? 'open',
    startedOn: employee?.startedOn ?? today(),
    contractEndsOn: employee?.contractEndsOn ?? '',
    leftOn: employee?.leftOn ?? '',
    payBasis: employee?.payBasis ?? 'gross',
    payAmount: employee ? String(employee.payAmount) : '',
    secondary: employee?.secondary ?? false,
    nonResident: employee?.nonResident ?? false,
    extraEmployee: employee ? String(employee.extraPensionEmployee) : '0',
    extraEmployer: employee ? String(employee.extraPensionEmployer) : '0',
    bankAccount: employee?.bankAccount ?? '',
    bankName: employee?.bankName ?? '',
    phone: employee?.phone ?? '',
    email: employee?.email ?? '',
    address: employee?.address ?? '',
    birthDate: employee?.birthDate ?? '',
    place: employee?.place ?? 'shop',
    leaveDays: employee ? String(employee.leaveDays) : '20',
    note: employee?.note ?? '',
  }));
  const [touched, setTouched] = useState(false);
  const change = (patch: Partial<FormState>) => {
    setTouched(true);
    setForm((now) => ({ ...now, ...patch }));
  };

  // Picking their account fills in what it knows, without overwriting what is typed.
  const fillFrom = (userId: string) => (now: FormState): FormState => {
    const user = (team.data ?? []).find((one) => String(one.id) === userId);
    if (!user) return { ...now, userId };
    return {
      ...now,
      userId,
      name: now.name.trim() === '' ? user.name : now.name,
      phone: now.phone.trim() === '' ? (user.phone ?? '') : now.phone,
      email: now.email.trim() === '' ? user.email : now.email,
    };
  };
  const linkAccount = (userId: string) => {
    setTouched(true);
    setForm(fillFrom(userId));
  };
  // Opened from a team member's page: fill in from that account once the list is here.
  const filled = useRef(false);
  useEffect(() => {
    if (filled.current || employee || !linkUserId || !team.data) return;
    filled.current = true;
    setForm(fillFrom(linkUserId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.data]);

  const amount = amountOf(form.payAmount);
  const extraEmployee = amountOf(form.extraEmployee || '0');
  const extraEmployer = amountOf(form.extraEmployer || '0');
  const leaveDays = Number(form.leaveDays);
  const problems = {
    name: form.name.trim() === '' ? w.nameError : null,
    personalNumber: form.personalNumber.trim() !== '' && !/^\d+$/.test(form.personalNumber.trim()) ? w.personalNumberError : null,
    payAmount: !(amount > 0) ? w.payAmountError : null,
    email: form.email.trim() !== '' && !/^[^s@]+@[^s@]+.[^s@]+$/.test(form.email.trim()) ? w.emailError : null,
    birthDate: form.birthDate !== '' && form.birthDate > today() ? w.birthDateError : null,
    extraEmployee: !(extraEmployee >= 0 && extraEmployee <= 10) ? w.extraError : null,
    extraEmployer: !(extraEmployer >= 0 && extraEmployer <= 10) ? w.extraError : null,
    contractEndsOn: form.contractEndsOn !== '' && form.contractEndsOn < form.startedOn ? w.datesError : null,
    leftOn: form.leftOn !== '' && form.leftOn < form.startedOn ? w.datesError : null,
    leaveDays: !(Number.isInteger(leaveDays) && leaveDays >= 20 && leaveDays <= 60) ? w.leaveDaysHint : null,
  };
  const valid = form.startedOn !== '' && Object.values(problems).every((problem) => problem === null);
  const belowMinimum = form.payBasis === 'gross' && amount > 0 && amount < MINIMUM_WAGE && !form.secondary && form.contract !== 'part_time';
  // Accounts already linked to someone else can't be linked twice.
  const taken = new Set((employees.data ?? []).filter((one) => one.id !== employee?.id && one.userId).map((one) => one.userId));

  const save = useMutation({
    mutationFn: () => {
      const input: EmployeeInput = {
        userId: form.userId ? Number(form.userId) : null,
        name: form.name.trim(),
        personalNumber: form.personalNumber.trim() || null,
        jobTitle: form.jobTitle.trim() || null,
        contract: form.contract,
        startedOn: form.startedOn,
        contractEndsOn: form.contract === 'fixed' ? form.contractEndsOn || null : null,
        leftOn: employee ? form.leftOn || null : null,
        payBasis: form.payBasis,
        payAmount: amount,
        secondary: form.secondary,
        nonResident: form.nonResident,
        extraPensionEmployee: form.nonResident ? 0 : extraEmployee,
        extraPensionEmployer: form.nonResident ? 0 : extraEmployer,
        bankAccount: form.bankAccount.trim() || null,
        bankName: form.bankName.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        birthDate: form.birthDate || null,
        place: form.place,
        leaveDays,
        note: form.note.trim() || null,
      };
      return employee ? payrollApi.update(employee.id, input) : payrollApi.create(input);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData([...PAYROLL_KEY, 'employee', saved.id], saved);
      invalidatePayroll(queryClient);
      toast({ title: employee ? w.saved(saved.name) : w.added(saved.name) });
      setTouched(false);
      onSaved();
      if (!employee) navigate(`/payroll/people/${saved.id}`);
    },
  });
  // Not while saving or once saved: moving on to the saved record isn't leaving work behind.
  useWarnBeforeLeaving(touched && !save.isPending && !save.isSuccess);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (valid) save.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit} noValidate>
      <h3 className="subheading">{w.who}</h3>
      <Field label={w.account} hint={w.accountHint}>
        <select value={form.userId} onChange={(event) => linkAccount(event.target.value)}>
          <option value="">{w.noAccount}</option>
          {(team.data ?? [])
            .filter((user) => !taken.has(user.id) || String(user.id) === form.userId)
            .map((user) => (
              <option key={user.id} value={user.id}>
                {`${user.name} · ${t.common.roles[user.role as keyof typeof t.common.roles] ?? user.role}`}
              </option>
            ))}
        </select>
      </Field>
      <Field label={w.name} error={touched ? (problems.name ?? undefined) : undefined}>
        <input required autoComplete="off" maxLength={200} value={form.name} onChange={(event) => change({ name: event.target.value })} />
      </Field>
      <div className="field-row">
        <Field label={w.personalNumber} hint={w.personalNumberHint} error={problems.personalNumber ?? undefined}>
          <input inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={20} value={form.personalNumber} onChange={(event) => change({ personalNumber: event.target.value })} />
        </Field>
        <Field label={w.jobTitle}>
          <input autoComplete="off" maxLength={100} value={form.jobTitle} onChange={(event) => change({ jobTitle: event.target.value })} />
        </Field>
      </div>
      <div className="field-row">
        <Field label={w.phone}>
          <input type="tel" autoComplete="off" maxLength={40} value={form.phone} onChange={(event) => change({ phone: event.target.value })} />
        </Field>
        <Field label={w.email} error={touched ? (problems.email ?? undefined) : undefined}>
          <input type="email" autoComplete="off" spellCheck={false} maxLength={200} value={form.email} onChange={(event) => change({ email: event.target.value })} />
        </Field>
      </div>
      <div className="field-row">
        <Field label={w.birthDate} error={problems.birthDate ?? undefined}>
          <DateField max={today()} value={form.birthDate} onChange={(birthDate) => change({ birthDate })} />
        </Field>
        <Field label={w.address}>
          <input autoComplete="off" maxLength={300} value={form.address} onChange={(event) => change({ address: event.target.value })} />
        </Field>
      </div>
      <div className="field">
        <span className="field__label" aria-hidden="true">{w.place}</span>
        <ChipChoice label={w.place} value={form.place} options={(['shop', 'carwash'] as const).map((value) => ({ value, label: w.places[value] }))} onChange={(place) => change({ place })} />
        {form.place === 'carwash' && <span className="field__hint">{w.carwashHint}</span>}
      </div>

      <h3 className="subheading">{w.contract}</h3>
      <Field label={w.contractType}>
        <select value={form.contract} onChange={(event) => change({ contract: event.target.value as Contract })}>
          {(['open', 'fixed', 'part_time'] as const).map((contract) => (
            <option key={contract} value={contract}>
              {t.payroll.contracts[contract]}
            </option>
          ))}
        </select>
      </Field>
      <div className="field-row">
        <Field label={w.startedOn}>
          <DateField required value={form.startedOn} onChange={(startedOn) => change({ startedOn })} />
        </Field>
        {form.contract === 'fixed' && (
          <Field label={w.contractEndsOn} error={problems.contractEndsOn ?? undefined}>
            <DateField min={form.startedOn} value={form.contractEndsOn} onChange={(contractEndsOn) => change({ contractEndsOn })} />
          </Field>
        )}
      </div>
      {employee && (
        <Field label={w.leftOn} hint={w.leftOnHint} error={problems.leftOn ?? undefined}>
          <DateField min={form.startedOn} value={form.leftOn} onChange={(leftOn) => change({ leftOn })} />
        </Field>
      )}
      <Field label={w.leaveDays} hint={w.leaveDaysHint} error={touched && problems.leaveDays ? problems.leaveDays : undefined}>
        <input inputMode="numeric" value={form.leaveDays} onChange={(event) => change({ leaveDays: event.target.value })} />
      </Field>

      <h3 className="subheading">{w.pay}</h3>
      <div className="field-row">
        <div className="field">
          <span className="field__label" aria-hidden="true">{w.payBasis}</span>
          <ChipChoice
            label={w.payBasis}
            value={form.payBasis}
            options={[
              { value: 'gross', label: w.gross },
              { value: 'net', label: w.netBasis },
            ]}
            onChange={(payBasis) => change({ payBasis })}
          />
          <span className="field__hint">{form.payBasis === 'net' ? w.netHint : w.grossHint}</span>
        </div>
        <Field label={w.payAmount} error={touched ? (problems.payAmount ?? undefined) : undefined}>
          <input inputMode="decimal" required value={form.payAmount} onChange={(event) => change({ payAmount: event.target.value })} />
        </Field>
      </div>
      {belowMinimum && (
        <p className="notice notice--warn" role="status">
          {w.belowMinimum(formatMoney(MINIMUM_WAGE))}
        </p>
      )}
      <label className="toggle">
        <input type="checkbox" checked={form.secondary} onChange={(event) => change({ secondary: event.target.checked })} />
        {w.secondary}
      </label>
      {form.secondary && <p className="field-hint">{w.secondaryHint}</p>}
      <label className="toggle">
        <input type="checkbox" checked={form.nonResident} onChange={(event) => change({ nonResident: event.target.checked })} />
        {w.nonResident}
      </label>
      {!form.nonResident && (
        <div className="field-row">
          <Field label={w.extraEmployee} hint={w.extraHint} error={problems.extraEmployee ?? undefined}>
            <input inputMode="decimal" value={form.extraEmployee} onChange={(event) => change({ extraEmployee: event.target.value })} />
          </Field>
          <Field label={w.extraEmployer} error={problems.extraEmployer ?? undefined}>
            <input inputMode="decimal" value={form.extraEmployer} onChange={(event) => change({ extraEmployer: event.target.value })} />
          </Field>
        </div>
      )}
      <div className="field-row">
        <Field label={w.bankAccount}>
          <input autoComplete="off" spellCheck={false} maxLength={40} value={form.bankAccount} onChange={(event) => change({ bankAccount: event.target.value })} />
        </Field>
        <Field label={w.bankName}>
          <input autoComplete="off" maxLength={80} value={form.bankName} onChange={(event) => change({ bankName: event.target.value })} />
        </Field>
      </div>
      <Field label={w.note}>
        <input autoComplete="off" maxLength={500} value={form.note} onChange={(event) => change({ note: event.target.value })} />
      </Field>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={save.isPending} loading={save.isPending}>
          {employee ? w.save : t.payroll.add}
        </Button>
      </div>
    </form>
  );
}

/** One line of a person's facts: what it is on the left, the value on the right. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** One person on the payroll: their contract, their leave and their payslips. */
export function PayrollPersonPage() {
  const t = useT();
  const w = t.payroll;
  const { id } = useParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useNewSheet();
  const [recording, setRecording] = useState(false);
  const employee = useQuery({ queryKey: [...PAYROLL_KEY, 'employee', Number(id)], queryFn: () => payrollApi.employee(Number(id)) });
  const removeLeave = useMutation({
    mutationFn: payrollApi.removeLeave,
    onSuccess: (saved) => {
      queryClient.setQueryData([...PAYROLL_KEY, 'employee', saved.id], saved);
      queryClient.invalidateQueries({ queryKey: [...PAYROLL_KEY, 'employees'] });
      toast({ title: w.person.leaveRemoved });
    },
  });

  if (employee.isPending) return <Loading />;
  if (employee.isError) return <ErrorNotice error={employee.error} onRetry={() => employee.refetch()} />;
  const e = employee.data;

  return (
    <>
      <PageHeader
        title={e.name}
        crumbs={[{ to: '/payroll', label: w.title }]}
        description={employeeTags(e, w).join(' · ')}
        actions={
          <>
            <EmployeeStatus employee={e} />
            <Button variant="secondary" icon={PencilSimple} onClick={() => setEditing(true)}>
              {w.edit}
            </Button>
          </>
        }
      />
      {e.leftOn && e.leave.balance > 0 && (
        <p className="notice notice--warn" role="status">
          {w.person.leftNotice(Number(formatDays(e.leave.balance)))}
        </p>
      )}
      <LeaveTiles leave={e.leave} />
      <Card title={w.person.facts}>
        <dl className="partner-facts">
          <Fact label={w.form.startedOn}>{formatDay(e.startedOn)}</Fact>
          {e.contractEndsOn && <Fact label={w.form.contractEndsOn}>{formatDay(e.contractEndsOn)}</Fact>}
          {e.leftOn && <Fact label={w.form.leftOn}>{formatDay(e.leftOn)}</Fact>}
          <Fact label={w.pay}>{e.payBasis === 'net' ? w.net(formatMoney(e.payAmount)) : w.gross(formatMoney(e.payAmount))}</Fact>
          {e.monthlyGross !== null && e.payBasis === 'net' && <Fact label={w.person.monthly}>{w.gross(formatMoney(e.monthlyGross))}</Fact>}
          {(e.extraPensionEmployee > 0 || e.extraPensionEmployer > 0) && (
            <Fact label={w.form.extraEmployee}>{`${e.extraPensionEmployee}% · ${e.extraPensionEmployer}%`}</Fact>
          )}
          <Fact label={w.form.personalNumber}>{e.personalNumber ?? '–'}</Fact>
          {e.birthDate && <Fact label={w.form.birthDate}>{formatDay(e.birthDate)}</Fact>}
          {e.phone && <Fact label={w.form.phone}><a href={`tel:${e.phone}`}>{e.phone}</a></Fact>}
          {e.email && <Fact label={w.form.email}><a href={`mailto:${e.email}`}>{e.email}</a></Fact>}
          {e.address && <Fact label={w.form.address}>{e.address}</Fact>}
          {(e.bankAccount || e.bankName) && <Fact label={w.form.bankAccount}>{[e.bankAccount, e.bankName].filter(Boolean).join(' · ')}</Fact>}
          {e.userName && <Fact label={w.form.account}>{e.userName}</Fact>}
          {e.note && <Fact label={w.form.note}>{e.note}</Fact>}
        </dl>
      </Card>
      <Section
        title={w.person.leave}
        description={w.person.leaveHint}
        actions={
          <Button variant="secondary" icon={Plus} onClick={() => setRecording(true)}>
            {w.person.recordLeave}
          </Button>
        }
      >
        <DataTable
          caption={w.person.leaveCaption}
          rows={e.leaveEntries}
          rowKey={(row) => row.id}
          empty={<EmptyState title={w.person.noLeave}>{w.person.noLeaveHint}</EmptyState>}
          columns={[
            {
              header: w.person.kind,
              title: true,
              cell: (row) => (
                <>
                  {w.person.kinds[row.kind]}
                  {row.note && <span className="table__secondary">{row.note}</span>}
                </>
              ),
            },
            { header: w.person.from, cell: (row) => formatDay(row.from) },
            { header: w.person.to, cell: (row) => formatDay(row.to), className: 'table__phone-hide' },
            { header: w.person.daysLabel, cell: (row) => formatDays(row.days), align: 'end' },
            {
              header: <span className="visually-hidden">{w.person.remove}</span>,
              align: 'end',
              cell: (row) => (
                <RemoveButton
                  aria-label={w.person.removeLeave(formatDay(row.from))}
                  confirm={t.common.yesRemove}
                  pending={removeLeave.isPending && removeLeave.variables === row.id}
                  onConfirm={() => removeLeave.mutate(row.id)}
                >
                  {w.person.remove}
                </RemoveButton>
              ),
            },
          ]}
        />
        {removeLeave.isError && (
          <p className="form-error" role="alert">
            {errorMessage(removeLeave.error)}
          </p>
        )}
      </Section>
      <Section title={w.person.payslips}>
        <PayslipTable employeeId={e.id} payslips={e.payslips} />
      </Section>
      <Sheet open={editing} onClose={() => setEditing(false)} title={e.name}>
        <EmployeeForm employee={e} onSaved={() => setEditing(false)} />
      </Sheet>
      <Sheet open={recording} onClose={() => setRecording(false)} title={w.person.recordLeave}>
        <LeaveForm employee={e} onSaved={() => setRecording(false)} />
      </Sheet>
    </>
  );
}

/** Leave in four figures: a year's days, earned so far, taken, and left. */
function LeaveTiles({ leave }: { leave: LeaveBalance }) {
  const w = useT().payroll.person;
  return (
    <StatGrid compact>
      <StatTile label={w.yearly} value={formatDays(leave.yearly)} />
      <StatTile label={w.earned} value={formatDays(leave.earned)} hint={leave.adjusted ? `${w.adjusted}: ${formatDays(leave.adjusted)}` : undefined} />
      <StatTile label={w.taken} value={formatDays(leave.taken)} />
      <StatTile label={w.balance} value={formatDays(leave.balance)} tone={leave.balance < 0 ? 'warn' : 'default'} />
    </StatGrid>
  );
}

/** Each confirmed month's payslip, with a button to print it. */
function PayslipTable({ employeeId, payslips }: { employeeId: number; payslips: PayslipRef[] }) {
  const t = useT();
  const w = t.payroll.person;
  const print = usePrintPayslip();
  return (
    <>
      <DataTable
        caption={w.payslipsCaption}
        rows={payslips}
        rowKey={(row) => row.monthId}
        empty={<EmptyState title={w.noPayslips}>{w.noPayslipsHint}</EmptyState>}
        columns={[
          { header: w.month, title: true, cell: (row) => formatMonth(row.month.slice(0, 7)) },
          { header: w.grossCol, cell: (row) => formatMoney(row.gross), align: 'end' },
          { header: w.netCol, cell: (row) => formatMoney(row.net), align: 'end' },
          {
            header: <span className="visually-hidden">{w.print}</span>,
            align: 'end',
            cell: (row) => (
              <Button
                size="sm"
                variant="ghost"
                icon={Printer}
                aria-label={w.printPayslip(formatMonth(row.month.slice(0, 7)))}
                loading={print.isPending && print.variables?.monthId === row.monthId}
                onClick={() => print.mutate({ monthId: row.monthId, employeeId })}
              >
                {w.print}
              </Button>
            ),
          },
        ]}
      />
      {print.isError && (
        <p className="form-error" role="alert">
          {errorMessage(print.error)}
        </p>
      )}
    </>
  );
}

/** Days off taken, or a correction to the balance. */
function LeaveForm({ employee, onSaved }: { employee: EmployeeDetail; onSaved: () => void }) {
  const t = useT();
  const w = t.payroll.person;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'taken' | 'adjust'>('taken');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');
  const typed = days.trim() === '' ? null : amountOf(days);
  const valid = from !== '' && (kind === 'adjust' ? typed !== null && typed !== 0 && Number.isFinite(typed) : to >= from && (typed === null || typed > 0));

  const save = useMutation({
    mutationFn: () => payrollApi.addLeave(employee.id, { kind, from, to: kind === 'adjust' ? from : to, days: typed, note: note.trim() || null }),
    onSuccess: (saved) => {
      queryClient.setQueryData([...PAYROLL_KEY, 'employee', saved.id], saved);
      queryClient.invalidateQueries({ queryKey: [...PAYROLL_KEY, 'employees'] });
      toast({ title: w.leaveSaved });
      onSaved();
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (valid) save.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <ChipChoice label={w.kind} value={kind} options={(['taken', 'adjust'] as const).map((value) => ({ value, label: w.kinds[value] }))} onChange={setKind} />
      <div className="field-row">
        <Field label={w.from}>
          <DateField required min={employee.startedOn} value={from} onChange={setFrom} />
        </Field>
        {kind === 'taken' && (
          <Field label={w.to}>
            <DateField required min={from} value={to} onChange={setTo} />
          </Field>
        )}
      </div>
      <Field label={w.daysLabel} hint={kind === 'adjust' ? w.adjustHint : w.daysHint}>
        <input inputMode="decimal" required={kind === 'adjust'} value={days} onChange={(event) => setDays(event.target.value)} />
      </Field>
      <Field label={t.payroll.form.note}>
        <input autoComplete="off" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!valid || save.isPending} loading={save.isPending}>
          {t.payroll.form.save}
        </Button>
      </div>
    </form>
  );
}

/** Team → Payroll → Months: work out a month, confirm it into the books, pay the wages and ATK, download the declaration. */
export function PayrollMonthsPage() {
  const t = useT();
  const [month, setMonth] = useMonthParam();
  const months = useQuery({ queryKey: [...PAYROLL_KEY, 'months'], queryFn: payrollApi.months });
  const confirmed = months.data?.find((one) => one.month.slice(0, 7) === month);

  return (
    <>
      <PageHeader title={t.payroll.title} description={t.payroll.description} />
      <div className="toolbar">
        <MonthPicker month={month} onChange={setMonth} first="2024-09" />
      </div>
      {months.isPending && <Loading />}
      {months.isError && <ErrorNotice error={months.error} onRetry={() => months.refetch()} />}
      {months.data && (confirmed ? <ConfirmedMonth key={confirmed.id} id={confirmed.id} /> : <MonthPreview key={month} month={month} />)}
      {months.data && <HistorySection />}
    </>
  );
}

/** The figures behind a line's tax: each band, or the flat second-job rate, or no pension for a non-resident. */
function TaxWorking({ line }: { line: PayLine }) {
  const w = useT().payroll.months;
  const parts = line.secondary
    ? [w.flat(line.taxParts[0]?.rate ?? 10)]
    : line.taxParts.filter((part) => part.base > 0).map((part) => w.band(part.rate, formatMoney(part.base)));
  return (
    <span className="table__secondary">
      {[...parts, line.nonResident ? w.noPension : null, line.payBasis === 'net' ? w.fromNet : null].filter(Boolean).join(' · ')}
    </span>
  );
}

function WarningList({ warnings }: { warnings: LineWarning[] }) {
  const w = useT().payroll.months.warnings;
  if (warnings.length === 0) return null;
  return (
    <span className="payroll-warnings">
      {warnings.map((warning) => (
        <Badge key={warning.key} tone="warn">
          {warning.key === 'belowMinimum'
            ? w.belowMinimum(formatMoney(warning.minimum))
            : warning.key === 'leaveOwed'
              ? w.leaveOwed(Number(formatDays(warning.days)))
              : warning.key === 'partMonth'
                ? w.partMonth
                : w.noPersonalNumber}
        </Badge>
      ))}
    </span>
  );
}

/** The month's lines: gross, the pension and tax taken off, net, and the employer's share. */
function LinesTable({
  month,
  lines,
  action,
  footer,
}: {
  month: string;
  lines: PayLine[];
  action?: (line: PayLine) => ReactNode;
  footer?: ReactNode;
}) {
  const t = useT();
  const w = t.payroll.months;
  const sum = (pick: (line: PayLine) => number) => formatMoney(Math.round(lines.reduce((total, line) => total + pick(line), 0) * 100) / 100);
  return (
    <DataTable
      caption={w.caption(formatMonth(month))}
      rows={lines}
      rowKey={(row) => row.employeeId}
      empty={<EmptyState title={w.none}>{w.noneHint}</EmptyState>}
      columns={[
        {
          header: w.person,
          title: true,
          cell: (row) => (
            <>
              <Link to={`/payroll/people/${row.employeeId}`}>{row.name}</Link>
              <TaxWorking line={row} />
              {row.changedReason && <span className="table__secondary">{row.changedReason}</span>}
              <WarningList warnings={row.warnings} />
            </>
          ),
        },
        { header: w.gross, cell: (row) => formatMoney(row.gross), align: 'end' },
        { header: w.employeePension, cell: (row) => formatMoney(row.employeePension), align: 'end', className: 'table__phone-hide' },
        { header: w.tax, cell: (row) => formatMoney(row.tax), align: 'end', className: 'table__phone-hide' },
        { header: w.net, cell: (row) => formatMoney(row.net), align: 'end' },
        { header: w.employerPension, cell: (row) => formatMoney(row.employerPension), align: 'end', className: 'table__phone-hide' },
        ...(action ? [{ header: <span className="visually-hidden">{w.change}</span>, align: 'end' as const, cell: action }] : []),
      ]}
      totals={[
        t.common.total,
        sum((line) => line.gross),
        sum((line) => line.employeePension),
        sum((line) => line.tax),
        sum((line) => line.net),
        sum((line) => line.employerPension),
        ...(action ? [''] : []),
      ]}
      footer={footer}
    />
  );
}

/** What the owner cares about: the month's cost to the business, and what goes to ATK by the 15th. */
function MonthFooter({ cost, toAtk, dueOn }: { cost: number; toAtk: number; dueOn: string }) {
  const w = useT().payroll.months;
  return (
    <div className="payroll-footer">
      <p>
        <strong>{w.footerCost(formatMoney(cost))}</strong>
        <span className="field-hint">{w.footerCostHint}</span>
      </p>
      <p>
        <strong>{w.footerAtk(formatMoney(toAtk), formatDueDay(dueOn))}</strong>
        <span className="field-hint">{w.footerAtkHint}</span>
      </p>
    </div>
  );
}

/** A month not confirmed yet: the worked-out lines, any gross changed for this month only, then Confirm. */
function MonthPreview({ month }: { month: string }) {
  const t = useT();
  const w = t.payroll.months;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [changes, setChanges] = useState<LineChange[]>([]);
  const [changing, setChanging] = useState<PayLine | null>(null);
  useWarnBeforeLeaving(changes.length > 0);
  const future = month > thisMonth();
  // 4VD knows the wage rules from September 2024 (backend payrollRules.ts).
  const tooEarly = month < '2024-09';
  const preview = useQuery({
    queryKey: [...PAYROLL_KEY, 'preview', month, changes],
    queryFn: () => payrollApi.preview(`${month}-01`, changes),
    placeholderData: keepPreviousData,
    enabled: !future && !tooEarly,
  });
  const confirm = useMutation({
    mutationFn: () => payrollApi.confirm(`${month}-01`, changes),
    onSuccess: () => {
      setChanges([]);
      invalidatePayroll(queryClient);
      toast({ title: w.confirmed(formatMonth(month)) });
    },
  });

  if (future) return <p className="notice">{w.notStarted}</p>;
  if (tooEarly) return <p className="notice">{w.noRules}</p>;
  if (preview.isPending) return <Loading />;
  if (preview.isError) return <ErrorNotice error={preview.error} onRetry={() => preview.refetch()} />;
  const p = preview.data;
  const changed = (line: PayLine) => changes.some((one) => one.employeeId === line.employeeId);

  return (
    <>
      <LinesTable
        month={month}
        lines={p.lines}
        action={(line) =>
          changed(line) ? (
            <Button size="sm" variant="ghost" onClick={() => setChanges((now) => now.filter((one) => one.employeeId !== line.employeeId))}>
              {w.undoChange}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" icon={PencilSimple} aria-label={w.changeGross(line.name)} onClick={() => setChanging(line)}>
              {w.change}
            </Button>
          )
        }
        footer={p.lines.length > 0 && <MonthFooter cost={p.totals.cost} toAtk={p.totals.toAtk} dueOn={p.dueOn} />}
      />
      {p.lines.length > 0 && (
        <div className="payroll-actions">
          <p className="field-hint">{w.confirmHint}</p>
          <Button variant="primary" loading={confirm.isPending} disabled={confirm.isPending || preview.isFetching} onClick={() => confirm.mutate()}>
            {w.confirm(formatMonth(month))}
          </Button>
        </div>
      )}
      {confirm.isError && (
        <p className="form-error" role="alert">
          {errorMessage(confirm.error)}
        </p>
      )}
      <Sheet open={changing !== null} onClose={() => setChanging(null)} title={changing ? w.changeGross(changing.name) : w.change}>
        {changing && (
          <ChangeGrossForm
            line={changing}
            onSaved={(change) => {
              setChanges((now) => [...now.filter((one) => one.employeeId !== change.employeeId), change]);
              setChanging(null);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

/** This month only: a different gross (a part month, a bonus, leave paid out) and why. */
function ChangeGrossForm({ line, onSaved }: { line: PayLine; onSaved: (change: LineChange) => void }) {
  const t = useT();
  const w = t.payroll.months;
  const [gross, setGross] = useState(String(line.gross));
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const amount = amountOf(gross);
  const valid = amount >= 0 && gross.trim() !== '' && reason.trim() !== '';

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (valid) onSaved({ employeeId: line.employeeId, gross: amount, reason: reason.trim() });
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit} noValidate>
      <Field label={w.gross} hint={t.payroll.gross(formatMoney(line.contractGross))}>
        <input inputMode="decimal" required value={gross} onChange={(event) => setGross(event.target.value)} />
      </Field>
      <Field label={w.reason} error={tried && reason.trim() === '' ? w.reasonError : undefined}>
        <input required autoComplete="off" maxLength={200} placeholder={w.reasonPlaceholder} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <div className="form-actions">
        <Button type="submit" variant="primary">
          {t.common.save}
        </Button>
      </div>
    </form>
  );
}

/** A confirmed month: what is still to pay, the payments, the declaration and each payslip. */
function ConfirmedMonth({ id }: { id: number }) {
  const t = useT();
  const w = t.payroll.months;
  const { language } = useLanguage();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState<'wages' | 'atk' | null>(null);
  const detail = useQuery({ queryKey: [...PAYROLL_KEY, 'month', id], queryFn: () => payrollApi.month(id) });
  const places = useQuery({ queryKey: ['money', 'places'], queryFn: moneyApi.places });
  const print = usePrintPayslip();
  const download = useMutation({ mutationFn: (format: 'xlsx' | 'csv') => payrollApi.declaration(id, format, language) });
  const onSaved = (saved: PayrollMonthDetail) => {
    queryClient.setQueryData([...PAYROLL_KEY, 'month', id], saved);
    invalidatePayroll(queryClient);
  };
  const undo = useMutation({
    mutationFn: () => payrollApi.undo(id),
    onSuccess: () => {
      invalidatePayroll(queryClient);
      toast({ title: w.undone(formatMonth(detail.data?.month.slice(0, 7) ?? '')) });
    },
  });
  const undoPayment = useMutation({
    mutationFn: payrollApi.undoPayment,
    onSuccess: (saved) => {
      onSaved(saved);
      toast({ title: w.paymentRemoved });
    },
  });

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorNotice error={detail.error} onRetry={() => detail.refetch()} />;
  const d = detail.data;
  const month = d.month.slice(0, 7);
  const atkLeft = Math.round((d.taxLeft + d.pensionLeft) * 100) / 100;
  const error = undo.error ?? undoPayment.error ?? download.error ?? print.error;

  return (
    <>
      <p className="field-hint">{w.confirmedBy(d.confirmedBy ?? '–', formatDateTime(d.confirmedAt))}</p>
      <StatGrid compact>
        <StatTile label={w.tiles.cost} value={formatMoney(d.totals.cost)} />
        <StatTile label={w.tiles.wages} value={formatMoney(d.wagesLeft)} words={d.wagesLeft === 0 ? w.paidUp : undefined} />
        <StatTile label={w.tiles.atk} value={formatMoney(atkLeft)} words={atkLeft === 0 ? w.paidUp : undefined} tone={atkLeft > 0 && today() > d.dueOn ? 'warn' : 'default'} />
        <StatTile label={w.tiles.due} value={formatDueDay(d.dueOn)} />
      </StatGrid>
      <div className="toolbar">
        <Button variant={d.wagesLeft > 0 ? 'primary' : 'secondary'} disabled={d.wagesLeft === 0} onClick={() => setPaying('wages')}>
          {w.payWages}
        </Button>
        <Button variant={d.wagesLeft === 0 && atkLeft > 0 ? 'primary' : 'secondary'} disabled={atkLeft === 0} onClick={() => setPaying('atk')}>
          {w.payAtk}
        </Button>
        <div className="toolbar__end">
          <MenuButton
            label={download.isPending ? t.common.downloading : w.download}
            icon={DownloadSimple}
            items={[
              { label: w.downloadXlsx, onSelect: () => download.mutate('xlsx') },
              { label: w.downloadCsv, onSelect: () => download.mutate('csv') },
            ]}
          />
          <RemoveButton
            confirm={w.yesUndo}
            pending={undo.isPending}
            disabled={d.payments.length > 0}
            onConfirm={() => undo.mutate()}
          >
            {w.undo}
          </RemoveButton>
        </div>
      </div>
      <p className="field-hint">{d.payments.length > 0 ? `${w.downloadHint} ${w.undoBlocked}` : w.downloadHint}</p>
      {error && (
        <p className="form-error" role="alert">
          {errorMessage(error)}
        </p>
      )}
      <LinesTable
        month={month}
        lines={d.lines}
        action={(line) => (
          <Button
            size="sm"
            variant="ghost"
            icon={Printer}
            aria-label={t.payroll.person.printPayslip(`${line.name}, ${formatMonth(month)}`)}
            loading={print.isPending && print.variables?.employeeId === line.employeeId}
            onClick={() => print.mutate({ monthId: d.id, employeeId: line.employeeId })}
          >
            {t.payroll.person.print}
          </Button>
        )}
        footer={<MonthFooter cost={d.totals.cost} toAtk={d.totals.toAtk} dueOn={d.dueOn} />}
      />
      <Section title={w.payments}>
        <DataTable
          caption={w.paymentsCaption}
          rows={d.payments}
          rowKey={(row) => row.id}
          empty={<EmptyState title={w.noPayments}>{w.noPaymentsHint}</EmptyState>}
          columns={[
            {
              header: w.what,
              title: true,
              cell: (row) => (
                <>
                  {w.kinds[row.kind]}
                  <span className="table__secondary">{[row.kind === 'wages' ? w.people(row.employeeIds.length) : null, row.note].filter(Boolean).join(' · ')}</span>
                </>
              ),
            },
            { header: w.paidOn, cell: (row) => formatDay(row.paidOn) },
            {
              header: w.from,
              cell: (row) => {
                const place = places.data?.find((one) => one.id === row.placeId);
                return place ? placeName(t, place) : (row.placeName ?? '–');
              },
              className: 'table__phone-hide',
            },
            { header: w.amount, cell: (row) => formatMoney(row.amount), align: 'end' },
            {
              header: <span className="visually-hidden">{w.undo}</span>,
              align: 'end',
              cell: (row) => (
                <RemoveButton
                  aria-label={w.removePayment(w.kinds[row.kind])}
                  confirm={w.yesUndo}
                  pending={undoPayment.isPending && undoPayment.variables === row.id}
                  onConfirm={() => undoPayment.mutate(row.id)}
                >
                  {w.undo}
                </RemoveButton>
              ),
            },
          ]}
        />
      </Section>
      <Sheet open={paying === 'wages'} onClose={() => setPaying(null)} title={w.payWages}>
        {paying === 'wages' && (
          <PayForm
            detail={d}
            kind="wages"
            onSaved={(saved) => {
              onSaved(saved);
              setPaying(null);
            }}
          />
        )}
      </Sheet>
      <Sheet open={paying === 'atk'} onClose={() => setPaying(null)} title={w.payAtk}>
        {paying === 'atk' && (
          <PayForm
            detail={d}
            kind="atk"
            onSaved={(saved) => {
              onSaved(saved);
              setPaying(null);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

/** Paying the wages (who, from where, which day), or ATK (the tax and the pension as two payments). */
function PayForm({ detail, kind, onSaved }: { detail: PayrollMonthDetail; kind: 'wages' | 'atk'; onSaved: (saved: PayrollMonthDetail) => void }) {
  const t = useT();
  const w = t.payroll.payForm;
  const toast = useToast();
  const places = useQuery({ queryKey: ['money', 'places'], queryFn: moneyApi.places });
  const [pickedPlaceId, setPlaceId] = useState<number | null>(null);
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<Set<number>>(() => new Set(detail.unpaid.map((one) => one.employeeId)));
  // The business bank account until something else is picked: wages and ATK are usually paid by bank.
  const placeId =
    pickedPlaceId ??
    places.data?.find((place) => place.kind === 'bank' && place.isDefault && !place.archived)?.id ??
    places.data?.find((place) => place.kind === 'bank' && !place.archived)?.id ??
    null;
  const names = new Map(detail.lines.map((line) => [line.employeeId, line.name]));
  const total =
    kind === 'wages'
      ? detail.unpaid.filter((one) => picked.has(one.employeeId)).reduce((sum, one) => sum + one.amount, 0)
      : detail.taxLeft + detail.pensionLeft;
  const valid = placeId !== null && paidOn !== '' && (kind === 'atk' || picked.size > 0);

  const save = useMutation({
    mutationFn: () => {
      const base = { placeId: placeId!, paidOn, note: note.trim() || null };
      if (kind === 'atk') return payrollApi.payAtk(detail.id, base);
      const everyone = picked.size === detail.unpaid.length;
      return payrollApi.payWages(detail.id, { ...base, employeeIds: everyone ? null : [...picked] });
    },
    onSuccess: (saved) => {
      toast({ title: w.saved });
      onSaved(saved);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (valid) save.mutate();
  }

  const toggle = (employeeId: number, on: boolean) =>
    setPicked((now) => {
      const next = new Set(now);
      if (on) next.add(employeeId);
      else next.delete(employeeId);
      return next;
    });

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <Field label={w.place}>
        {places.data ? <PlaceSelect places={places.data} value={placeId} onChange={setPlaceId} required /> : <Loading />}
      </Field>
      <Field label={w.day}>
        <DateField required max={today()} value={paidOn} onChange={setPaidOn} />
      </Field>
      {kind === 'wages' && (
        <fieldset className="payroll-pick">
          <legend>{w.who}</legend>
          <p className="field-hint">{w.whoHint}</p>
          {detail.unpaid.map((one) => (
            <label key={one.employeeId} className="toggle">
              <input type="checkbox" checked={picked.has(one.employeeId)} onChange={(event) => toggle(one.employeeId, event.target.checked)} />
              <span className="payroll-pick__name">{names.get(one.employeeId) ?? `#${one.employeeId}`}</span>
              <span className="payroll-pick__amount">{formatMoney(one.amount)}</span>
            </label>
          ))}
          {picked.size === 0 && <p className="form-error" role="alert">{w.nobody}</p>}
        </fieldset>
      )}
      {kind === 'atk' && <p className="notice">{w.atkParts(formatMoney(detail.taxLeft), formatMoney(detail.pensionLeft))}</p>}
      <Field label={w.note}>
        <input autoComplete="off" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!valid || save.isPending} loading={save.isPending}>
          {`${w.save} · ${w.total(formatMoney(Math.round(total * 100) / 100))}`}
        </Button>
      </div>
    </form>
  );
}

/** Confirmed months, newest first, with what is still to pay on each. */
function HistorySection() {
  const t = useT();
  const w = t.payroll.months;
  const months = useQuery({ queryKey: [...PAYROLL_KEY, 'months'], queryFn: payrollApi.months });
  const rows = months.data ?? [];
  return (
    <Section title={w.history}>
      <DataTable
        caption={w.historyCaption}
        rows={rows}
        rowKey={(row) => row.id}
        empty={<EmptyState title={w.noHistory}>{w.noHistoryHint}</EmptyState>}
        columns={[
          {
            header: w.pick,
            title: true,
            cell: (row) => (
              <Link to={`/payroll/months?month=${row.month.slice(0, 7)}`}>{formatMonth(row.month.slice(0, 7))}</Link>
            ),
          },
          { header: t.payroll.tiles.people, cell: (row) => String(row.totals.people), align: 'end', className: 'table__phone-hide' },
          { header: w.gross, cell: (row) => formatMoney(row.totals.gross), align: 'end' },
          { header: w.tiles.cost, cell: (row) => formatMoney(row.totals.cost), align: 'end', className: 'table__phone-hide' },
          {
            header: w.toPay,
            align: 'end',
            cell: (row) => {
              const left = Math.round((row.wagesLeft + row.taxLeft + row.pensionLeft) * 100) / 100;
              return left === 0 ? <Badge tone="ok">{w.paidUp}</Badge> : formatMoney(left);
            },
          },
        ]}
      />
    </Section>
  );
}

/** Account → Pay and leave: your own leave and payslips (shown only to someone on the payroll). */
export function MyPayPanel() {
  const t = useT();
  const w = t.payroll.mine;
  const mine = useQuery({ queryKey: [...PAYROLL_KEY, 'mine'], queryFn: payrollApi.mine });
  if (mine.isPending) return <Loading />;
  if (mine.isError) return <ErrorNotice error={mine.error} onRetry={() => mine.refetch()} />;
  if (!mine.data) return null;
  const { leave } = mine.data;
  return (
    <>
      <Card title={w.leave} description={w.detail(Number(formatDays(leave.taken)), Number(formatDays(leave.yearly)))}>
        <LeaveTiles leave={leave} />
      </Card>
      <Card title={w.payslips}>
        <PayslipTable employeeId={mine.data.employeeId} payslips={mine.data.payslips} />
      </Card>
    </>
  );
}

/** Whether to show Account → Pay and leave: only to someone on the payroll. */
export function useOnPayroll(): boolean {
  const mine = useQuery({ queryKey: [...PAYROLL_KEY, 'mine'], queryFn: payrollApi.mine, staleTime: 5 * 60_000 });
  return Boolean(mine.data);
}

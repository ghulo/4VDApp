import { ClockCounterClockwise, Plus, UsersThree } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useCurrentUser } from '../auth/useAuth';
import { ActivityFeed } from '../components/activity/ActivityFeed';
import { Avatar } from '../components/Avatar';
import { DeviceList } from '../components/DeviceList';
import { ErrorNotice, Loading, SavedToast } from '../components/Feedback';
import { HistoryCard } from '../components/HistoryCard';
import { activityApi, cashApi, invitesApi, reportsApi, usersApi, writeOffsApi } from '../services/api';
import { useT } from '../i18n/useT';
import type { TeamMember, UserRole } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatHeadlineMoney, formatMoney, formatTime, localDay } from '../utils/format';
import { resolvePeriod } from '../utils/periods';
import { Badge, Button, ButtonLink, Card, DataTable, EmptyState, Field, PageHeader, SettingRow, Sheet, StatGrid, StatTile } from '../components/ui';
import { assignableRoles, canHandOut, canManage, canOversee } from '../auth/roles';
import type { Language } from '../services/types';

const MIN_PASSWORD_LENGTH = 8;
const RUNS_THE_SHOP: UserRole[] = ['developer', 'admin', 'owner'];

const FILTERS = ['all', 'running', 'accountant', 'employee', 'family', 'blocked'] as const;
type Filter = (typeof FILTERS)[number];
const matches: Record<Filter, (person: TeamMember) => boolean> = {
  all: (person) => person.isActive,
  running: (person) => person.isActive && RUNS_THE_SHOP.includes(person.role),
  accountant: (person) => person.isActive && person.role === 'accountant',
  employee: (person) => person.isActive && person.role === 'employee',
  family: (person) => person.isActive && person.role === 'family',
  blocked: (person) => !person.isActive,
};

/** This month so far, in the browser's time zone, as the reports read it. */
function useThisMonth() {
  const t = useT();
  const [range] = useState(() => {
    const period = resolvePeriod('this-month', undefined, new Date(), t);
    return { startDate: period.startDate, endDate: period.endDate };
  });
  return range;
}

/** Today's local day, fixed when the page opens. */
function useToday() {
  const [today] = useState(() => localDay(new Date().toISOString()));
  return today;
}

/** "Today, 09:46", "3 Oct 2026", or "Never". */
function lastActive(iso: string | null, today: string, t: ReturnType<typeof useT>): string {
  if (!iso) return t.people.neverActive;
  const day = localDay(iso);
  if (day === today) return t.people.activeToday(formatTime(iso));
  return formatDate(iso);
}

/** Sales against a target as a bar, with the figures beside it. */
function TargetBar({ revenue, target, compact }: { revenue: number; target: number | null; compact?: boolean }) {
  const t = useT();
  if (target === null || target <= 0) return <span className="target-bar__figures">{revenue > 0 ? formatMoney(revenue) : '–'}</span>;
  const share = Math.min(revenue / target, 1);
  return (
    <span className="target-bar">
      <span className="target-bar__figures">
        {compact ? t.people.ofTarget(formatMoney(target)) : formatMoney(revenue)}
        {!compact && <span className="target-bar__target"> / {formatMoney(target)}</span>}
      </span>
      <span
        className={`target-bar__track${revenue >= target ? ' target-bar__track--met' : ''}`}
        role="img"
        aria-label={t.people.targetShare(Math.round((revenue / target) * 100))}
      >
        <span className="target-bar__fill" style={{ width: `${share * 100}%` }} />
      </span>
    </span>
  );
}

/** Who can use the app, how each one's month is going, and inviting someone new. */
export function UsersPage() {
  const t = useT();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const range = useThisMonth();
  const users = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list(1) });
  const team = useQuery({ queryKey: ['reports', 'team', range], queryFn: () => reportsApi.team(range), enabled: canOversee(currentUser.role) });
  const invites = useQuery({ queryKey: ['invites'], queryFn: invitesApi.list, enabled: canManage(currentUser.role) });

  // The launch checklist links here with ?invite=owner or ?invite=employee.
  const inviting = params.has('invite') || params.get('new') === 'invite';
  const setInviting = (open: boolean) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('invite');
      if (open) next.set('new', 'invite');
      else next.delete('new');
      return next;
    });
  const filter: Filter = FILTERS.find((key) => key === params.get('show')) ?? 'all';

  const all = users.data?.items ?? [];
  const sales = new Map(team.data?.map((row) => [row.userId, row]));
  const today = useToday();
  const activeToday = all.filter((person) => person.lastActiveAt && localDay(person.lastActiveAt) === today).length;
  const teamSales = team.data?.reduce((sum, row) => sum + row.revenue, 0) ?? 0;
  const rows = all.filter(matches[filter]).sort((a, b) => Number(b.id === currentUser.id) - Number(a.id === currentUser.id) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title={t.people.title}
        description={t.people.description}
        actions={
          canManage(currentUser.role) && (
            <Button variant="primary" icon={Plus} onClick={() => setInviting(true)}>
              {t.people.invite}
            </Button>
          )
        }
      />

      <Sheet open={inviting} onClose={() => setInviting(false)} title={t.people.invite} description={t.people.inviteHint}>
        <InviteForm />
        <details className="fallback">
          <summary>{t.people.setUpYourself}</summary>
          <AddUserForm />
        </details>
      </Sheet>

      {all.length > 0 && (
        <StatGrid>
          <StatTile label={t.people.tiles.team} value={all.filter(matches.all).length} hint={t.people.tiles.teamHint} />
          <StatTile label={t.people.tiles.activeToday} value={activeToday} hint={t.people.tiles.activeTodayHint} />
          <StatTile
            label={t.people.tiles.waiting}
            value={invites.data?.length ?? 0}
            hint={t.people.tiles.waitingHint}
            tone={(invites.data?.length ?? 0) > 0 ? 'warn' : 'default'}
          />
          {team.data && <StatTile label={t.people.tiles.sales} value={formatHeadlineMoney(teamSales)} hint={t.people.tiles.salesHint} />}
        </StatGrid>
      )}

      {canManage(currentUser.role) && <PendingInvites />}

      {users.isPending && <Loading />}
      {users.isError && <ErrorNotice error={users.error} onRetry={() => users.refetch()} />}
      {users.data && (
        <DataTable<TeamMember>
          caption={t.people.title}
          rows={rows}
          rowKey={(person) => person.id}
          onRowClick={(person) => navigate(`/people/${person.id}`)}
          toolbar={
            <div className="segmented segmented--chips" role="radiogroup" aria-label={t.people.show}>
              {FILTERS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={filter === key}
                  className="segmented__option"
                  onClick={() =>
                    setParams(
                      (current) => {
                        const next = new URLSearchParams(current);
                        if (key === 'all') next.delete('show');
                        else next.set('show', key);
                        return next;
                      },
                      { replace: true },
                    )
                  }
                >
                  {t.people.filters[key]}
                  {key !== 'all' && all.some(matches[key]) && <span className="segmented__count">{all.filter(matches[key]).length}</span>}
                </button>
              ))}
            </div>
          }
          columns={[
            {
              header: t.people.name,
              cell: (person) => (
                <span className="person-cell">
                  <Avatar name={person.name} url={person.avatarUrl} size={36} />
                  <span>
                    <Link to={`/people/${person.id}`} className="table__primary-link">
                      {person.name}
                      {person.id === currentUser.id && t.people.you}
                    </Link>
                    <span className="table__secondary">{person.email}</span>
                  </span>
                </span>
              ),
            },
            {
              header: t.people.role,
              cell: (person) => (
                <span className="person-role">
                  <Badge tone={RUNS_THE_SHOP.includes(person.role) ? 'brand' : 'neutral'}>{t.common.roles[person.role]}</Badge>
                  {!person.isActive && <Badge tone="danger">{t.people.blockedBadge}</Badge>}
                </span>
              ),
            },
            {
              header: t.people.lastActive,
              cell: (person) => lastActive(person.lastActiveAt, today, t),
              className: 'table__nowrap table__phone-hide',
            },
            {
              header: t.people.thisMonth,
              cell: (person) =>
                person.role === 'family' ? (
                  <span className="table__secondary">–</span>
                ) : (
                  <TargetBar revenue={sales.get(person.id)?.revenue ?? 0} target={person.monthlyTarget} />
                ),
              align: 'end',
              className: 'table__phone-hide',
            },
          ]}
          empty={<EmptyState icon={UsersThree} title={t.people.noneHere}>{t.people.noneHereHint}</EmptyState>}
        />
      )}
    </>
  );
}

function InviteForm() {
  const t = useT();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  // The launch checklist links here with ?invite=owner or ?invite=employee.
  const [params] = useSearchParams();
  const asked = params.get('invite');
  const [role, setRole] = useState<UserRole>(asked === 'owner' || asked === 'employee' ? asked : 'employee');
  const [language, setLanguage] = useState<Language>(currentUser.language);

  const invite = useMutation({
    mutationFn: () => invitesApi.create({ email: email.trim(), role, language }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      setEmail('');
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    invite.mutate();
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field">
          <span className="field__label">{t.people.theirEmail}</span>
          <input type="email" required autoComplete="off" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">{t.people.role}</span>
          <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
            {assignableRoles(currentUser.role).map((option) => (
              <option key={option} value={option}>
                {t.common.roles[option]}: {t.people.roleHints[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--narrow">
          <span className="field__label">{t.people.language}</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
            <option value="en" lang="en" translate="no">
              {t.language.english}
            </option>
            <option value="sq" lang="sq" translate="no">
              {t.language.albanian}
            </option>
          </select>
        </label>
      </div>
      <p className="field-hint">{t.people.inviteHint}</p>
      {invite.isError && (
        <p className="form-error" role="alert">
          {errorMessage(invite.error)}
        </p>
      )}
      {invite.isSuccess && (
        <SavedToast message={t.people.inviteSent(invite.data.data.email)} />
      )}
      <Button type="submit" disabled={!email.trim() || invite.isPending} variant="primary" loading={invite.isPending}>
        {t.people.sendInvite}
      </Button>
    </form>
  );
}

function PendingInvites() {
  const t = useT();
  const queryClient = useQueryClient();
  const invites = useQuery({ queryKey: ['invites'], queryFn: invitesApi.list });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['invites'] });
  const resend = useMutation({ mutationFn: invitesApi.resend, onSuccess: refresh });
  const cancel = useMutation({ mutationFn: invitesApi.cancel, onSuccess: refresh });

  if (!invites.data || invites.data.length === 0) return null;
  return (
    <Card title={t.people.waiting}>
      <ul className="category-list">
        {invites.data.map((invite) => (
          <li key={invite.id} className="category-list__row">
            <div>
              <p className="category-list__name">{invite.email}</p>
              <p className="category-list__description">
                {t.people.invited({
                  role: t.common.roles[invite.role],
                  on: formatDate(invite.createdAt),
                  by: invite.invitedBy,
                  until: formatDate(invite.expiresAt),
                })}
              </p>
            </div>
            <span />
            <span className="category-list__actions">
              <Button disabled={resend.isPending} onClick={() => resend.mutate(invite.id)}>
                {t.people.sendAgain}
              </Button>
              <Button variant="danger-text" disabled={cancel.isPending} onClick={() => cancel.mutate(invite.id)}>
                {t.people.cancelInvite}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {(resend.isError || cancel.isError) && (
        <p className="form-error" role="alert">
          {errorMessage(resend.error ?? cancel.error)}
        </p>
      )}
    </Card>
  );
}

function AddUserForm() {
  const t = useT();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('family');
  const [password, setPassword] = useState('');
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: usersApi.create,
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setSavedMessage(t.people.canLogIn(user.name, user.email));
      setName('');
      setEmail('');
      setPassword('');
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSavedMessage(null);
    create.mutate({ name: name.trim(), email: email.trim(), role, password });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field">
          <span className="field__label">{t.people.name}</span>
          <input required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">{t.people.email}</span>
          <input type="email" autoComplete="off" spellCheck={false} required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span className="field__label">{t.people.role}</span>
          <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
            {assignableRoles(currentUser.role).map((option) => (
              <option key={option} value={option}>
                {t.common.roles[option]}: {t.people.roleHints[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{t.people.firstPassword}</span>
          <input
            type="text"
            autoComplete="off"
            minLength={MIN_PASSWORD_LENGTH}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
      </div>
      <p className="field-hint">{t.people.passwordHint(MIN_PASSWORD_LENGTH)}</p>
      {create.isError && (
        <p className="form-error" role="alert">
          {errorMessage(create.error)}
        </p>
      )}
      {savedMessage && (
        <SavedToast message={savedMessage} />
      )}
      <Button type="submit" disabled={create.isPending} variant="primary">
        {t.people.add}
      </Button>
    </form>
  );
}


/** One person: how their month is going, what they did lately, where they're logged in, and managing them. */
export function PersonPage() {
  const t = useT();
  const personId = Number(useParams().id);
  const currentUser = useCurrentUser();
  const range = useThisMonth();
  const today = useToday();
  const oversee = canOversee(currentUser.role);
  const users = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list(1) });
  const team = useQuery({ queryKey: ['reports', 'team', range], queryFn: () => reportsApi.team(range), enabled: oversee });
  const cash = useQuery({ queryKey: ['cash', 'person', range], queryFn: () => cashApi.list(range), enabled: oversee });
  const writeOffs = useQuery({ queryKey: ['write-offs', 'all'], queryFn: () => writeOffsApi.list(), enabled: oversee });
  const activity = useQuery({
    queryKey: ['activity', { userId: personId, page: 1, limit: 8 }],
    queryFn: () => activityApi.list({ page: 1, userId: personId, limit: 8, exclude: 'auth,document.issued' }),
    enabled: oversee,
  });
  const sessions = useQuery({ queryKey: ['users', personId, 'sessions'], queryFn: () => usersApi.sessions(personId), enabled: oversee });

  if (!Number.isInteger(personId)) return <Navigate to="/people" replace />;
  if (users.isPending) return <Loading />;
  if (users.isError) return <ErrorNotice error={users.error} onRetry={() => users.refetch()} />;
  const person = users.data.items.find((member) => member.id === personId);
  if (!person) {
    return (
      <>
        <PageHeader title={t.people.notFound} crumbs={[{ label: t.people.title, to: '/people' }]} />
        <EmptyState icon={UsersThree} title={t.people.notFound}>
          {t.people.notFoundHint}
        </EmptyState>
      </>
    );
  }

  const sells = person.role !== 'family';
  const month = team.data?.find((row) => row.userId === person.id);
  const counts = cash.data?.filter((count) => count.countedById === person.id) ?? [];
  const off = counts.filter((count) => count.difference !== null && Math.abs(count.difference) >= 0.5);
  const offTotal = off.reduce((sum, count) => sum + (count.difference ?? 0), 0);
  const reported = writeOffs.data?.filter((item) => item.requestedBy?.id === person.id && item.requestedAt >= range.startDate) ?? [];

  return (
    <>
      <PageHeader
        title={person.name}
        crumbs={[{ label: t.people.title, to: '/people' }]}
        description={
          <span className="person-head">
            <Badge tone={RUNS_THE_SHOP.includes(person.role) ? 'brand' : 'neutral'}>{t.common.roles[person.role]}</Badge>
            {!person.isActive && <Badge tone="danger">{t.people.blockedBadge}</Badge>}
            <span>{person.email}</span>
            {person.phone && <span>{person.phone}</span>}
            <span>{t.people.lastActiveIs(lastActive(person.lastActiveAt, today, t))}</span>
          </span>
        }
        meta={<Avatar name={person.name} url={person.avatarUrl} size={48} />}
      />

      {oversee && sells && (
        <StatGrid>
          <StatTile
            label={t.people.tiles.monthSales}
            value={formatHeadlineMoney(month?.revenue ?? 0)}
            hint={
              person.monthlyTarget !== null
                ? <TargetBar revenue={month?.revenue ?? 0} target={person.monthlyTarget} compact />
                : t.people.salesCount(month?.salesCount ?? 0)
            }
          />
          <StatTile
            label={t.people.tiles.commission}
            value={month?.commission !== null && month?.commission !== undefined ? formatHeadlineMoney(month.commission) : '–'}
            hint={person.commissionPercent !== null ? t.people.commission(person.commissionPercent) : t.people.noCommission}
          />
          <StatTile
            label={t.people.tiles.refunds}
            value={formatHeadlineMoney(month?.refunds ?? 0)}
            hint={t.people.tiles.refundsHint}
          />
          <StatTile
            label={t.people.tiles.cash}
            value={counts.length}
            tone={off.length > 0 ? 'warn' : 'default'}
            hint={off.length > 0 ? t.people.cashOff(off.length, formatMoney(offTotal)) : t.people.cashAllRight}
            to="/cash"
          />
          <StatTile
            label={t.people.tiles.reported}
            value={reported.length}
            hint={t.people.reportedValue(formatMoney(reported.reduce((sum, item) => sum + (item.value ?? 0), 0)))}
          />
        </StatGrid>
      )}

      <div className="person-grid">
        <div className="person-grid__main">
          {oversee && (
            <Card
              title={t.people.recent}
              flush
              actions={
                <ButtonLink to={`/activity?userId=${person.id}`} size="sm" variant="ghost" icon={ClockCounterClockwise}>
                  {t.people.seeAll}
                </ButtonLink>
              }
            >
              {activity.isPending && <Loading />}
              {activity.isError && <ErrorNotice error={activity.error} onRetry={() => activity.refetch()} />}
              {activity.data && activity.data.items.length === 0 && <p className="card__empty">{t.people.nothingYet}</p>}
              {activity.data && activity.data.items.length > 0 && (
                <div className="person-feed">
                  <ActivityFeed entries={activity.data.items} hidePerson headingLevel="h3" />
                </div>
              )}
            </Card>
          )}
          <HistoryCard entityType="user" entityId={person.id} />
        </div>
        <div className="person-grid__side">
          <ManagePanel person={person} />
          {oversee && (
            <Card title={t.people.devices} description={t.people.devicesHint}>
              {sessions.isPending && <Loading />}
              {sessions.isError && <ErrorNotice error={sessions.error} onRetry={() => sessions.refetch()} />}
              {sessions.data && sessions.data.length === 0 && <p className="card__empty">{t.people.noDevices}</p>}
              {sessions.data && sessions.data.length > 0 && <DeviceList sessions={sessions.data} />}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/** Role, target and commission, password, access and removal: each its own small form. */
function ManagePanel({ person }: { person: TeamMember }) {
  const t = useT();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const isSelf = person.id === currentUser.id;
  // Others with a top role are the developer's to change; your own role is changed by someone else.
  const canEdit = isSelf ? canManage(currentUser.role) : canHandOut(currentUser.role, person.role);
  const sells = person.role !== 'family';
  const firstName = person.name.split(' ')[0] ?? person.name;

  const [target, setTarget] = useState(person.monthlyTarget === null ? '' : String(person.monthlyTarget));
  const [commission, setCommission] = useState(person.commissionPercent === null ? '' : String(person.commissionPercent));
  const [newPassword, setNewPassword] = useState('');
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: (input: Parameters<typeof usersApi.update>[1]) => usersApi.update(person.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setNewPassword('');
    },
  });
  const remove = useMutation({
    mutationFn: () => usersApi.remove(person.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      navigate('/people');
    },
  });

  function save(input: Parameters<typeof usersApi.update>[1], message: string) {
    setSaved(null);
    update.mutate(input, { onSuccess: () => setSaved(message) });
  }

  if (!canEdit) return null;
  const targetChanged =
    (target === '' ? null : Number(target)) !== person.monthlyTarget ||
    (commission === '' ? null : Number(commission)) !== person.commissionPercent;

  return (
    <Card title={t.people.manage} description={t.people.manageHint(firstName)}>
      {!isSelf && (
        <SettingRow title={t.people.role} description={t.people.roleHints[person.role]}>
          <select
            aria-label={t.people.roleFor(person.name)}
            value={person.role}
            disabled={update.isPending}
            onChange={(event) => save({ role: event.target.value as UserRole }, t.people.roleSaved)}
          >
            {assignableRoles(currentUser.role).map((option) => (
              <option key={option} value={option}>
                {t.common.roles[option]}
              </option>
            ))}
          </select>
        </SettingRow>
      )}
      {sells && (
        <form
          className="setting-row setting-row--fields"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save(
              { monthlyTarget: target === '' ? null : Number(target), commissionPercent: commission === '' ? null : Number(commission) },
              t.people.targetSaved,
            );
          }}
        >
          <div className="field-row">
            <Field label={t.people.targetLabel}>
              <span className="unit-input">
                <span aria-hidden="true">€</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={1}
                  placeholder={t.people.none}
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                />
              </span>
            </Field>
            <Field label={t.people.commissionLabel}>
              <span className="unit-input">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step={0.5}
                  placeholder={t.people.none}
                  value={commission}
                  onChange={(event) => setCommission(event.target.value)}
                />
                <span aria-hidden="true">%</span>
              </span>
            </Field>
          </div>
          <Button type="submit" size="sm" variant={targetChanged ? 'primary' : 'secondary'} disabled={!targetChanged || update.isPending}>
            {t.common.save}
          </Button>
        </form>
      )}
      <form
        className="setting-row setting-row--fields"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save({ password: newPassword }, t.people.passwordSaved);
        }}
      >
        <Field label={t.people.newPassword} hint={t.people.passwordHint(MIN_PASSWORD_LENGTH)}>
          <input
            type="text"
            autoComplete="off"
            aria-label={t.people.newPasswordFor(person.name)}
            minLength={MIN_PASSWORD_LENGTH}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
        <Button type="submit" size="sm" disabled={newPassword.length < MIN_PASSWORD_LENGTH || update.isPending}>
          {t.people.setPassword}
        </Button>
      </form>
      {!isSelf && (
        <SettingRow title={t.people.access} description={person.isActive ? t.people.accessOn : t.people.accessOff}>
          <Button
            size="sm"
            disabled={update.isPending}
            onClick={() => save({ isActive: !person.isActive }, person.isActive ? t.people.blockedSaved : t.people.allowedSaved)}
          >
            {person.isActive ? t.people.block : t.people.allow}
          </Button>
        </SettingRow>
      )}
      {!isSelf && (
        <SettingRow title={t.people.remove} description={t.people.removeHint}>
          {confirmingRemove ? (
            <>
              <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {t.people.removeName(firstName)}
              </Button>
              <Button size="sm" onClick={() => setConfirmingRemove(false)}>
                {t.people.keep}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="danger-text" onClick={() => setConfirmingRemove(true)}>
              {t.people.remove}
            </Button>
          )}
        </SettingRow>
      )}
      {(update.isError || remove.isError) && (
        <p className="form-error" role="alert">
          {errorMessage(update.error ?? remove.error)}
        </p>
      )}
      {saved && !update.isError && (
        <SavedToast message={saved} />
      )}
    </Card>
  );
}

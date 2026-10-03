import { CaretDown } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { Link } from 'react-router';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Avatar } from '../components/Avatar';
import { invitesApi, usersApi } from '../services/api';
import { useT } from '../i18n/useT';
import { type User, type UserRole } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';
import { Badge, Button, Card, PageHeader } from '../components/ui';
import { assignableRoles, canHandOut, canManage } from '../auth/roles';
import type { Language } from '../services/types';

const MIN_PASSWORD_LENGTH = 8;

export function UsersPage() {
  const t = useT();
  const currentUser = useCurrentUser();
  const users = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list(1) });

  return (
    <>
      <PageHeader title={t.people.title} description={t.people.description} />

      {canManage(currentUser.role) && (
        <>
          <Card title={t.people.invite}>
            <InviteForm />
            <details className="fallback">
              <summary>{t.people.setUpYourself}</summary>
              <AddUserForm />
            </details>
          </Card>

          <PendingInvites />
        </>
      )}

      {users.isPending && <Loading />}
      {users.isError && <ErrorNotice error={users.error} onRetry={() => users.refetch()} />}
      {users.data && (
        <ul className="category-list">
          {users.data.items.map((user) => (
            <UserRow key={user.id} user={user} />
          ))}
        </ul>
      )}
    </>
  );
}

function InviteForm() {
  const t = useT();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('employee');
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
          <input type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />
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
        <p className="form-success" role="status">
          {t.people.inviteSent(invite.data.data.email)}
        </p>
      )}
      <Button type="submit" disabled={!email.trim() || invite.isPending} variant="primary">
        {invite.isPending ? t.people.sending : t.people.sendInvite}
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
          <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
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
        <p className="form-success" role="status">
          {savedMessage}
        </p>
      )}
      <Button type="submit" disabled={create.isPending} variant="primary">
        {t.people.add}
      </Button>
    </form>
  );
}

function UserRow({ user }: { user: User }) {
  const t = useT();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const [newPassword, setNewPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [isSettingTargets, setIsSettingTargets] = useState(false);
  const [target, setTarget] = useState(user.monthlyTarget === null ? '' : String(user.monthlyTarget));
  const [commission, setCommission] = useState(user.commissionPercent === null ? '' : String(user.commissionPercent));
  const sells = user.role !== 'family';
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [isManaging, setIsManaging] = useState(false);
  const panelId = useId();
  const isSelf = user.id === currentUser.id;
  // Others with a top role are the developer's to change; your own role is changed by someone else.
  const canEdit = isSelf ? canManage(currentUser.role) : canHandOut(currentUser.role, user.role);

  const onDone = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const update = useMutation({
    mutationFn: (input: Parameters<typeof usersApi.update>[1]) => usersApi.update(user.id, input),
    onSuccess: () => {
      onDone();
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      setIsResetting(false);
      setIsSettingTargets(false);
      setNewPassword('');
    },
  });
  const remove = useMutation({ mutationFn: () => usersApi.remove(user.id), onSuccess: onDone });
  const error = update.error ?? remove.error;

  return (
    <li className={`category-list__row user-row${user.isActive ? '' : ' user-row--inactive'}`}>
      <div>
        <p className="category-list__name user-row__name">
          <Avatar name={user.name} url={user.avatarUrl} size={32} />
          <span>
            {user.name}
            {isSelf && t.people.you}
          </span>
        </p>
        <p className="category-list__description">
          {user.email}
          {!user.isActive && t.people.blocked}
        </p>
        <p className="category-list__description">
          <Link to={`/activity?userId=${user.id}`}>{t.activity.seeActivity(user.name.split(' ')[0] ?? user.name)}</Link>
        </p>
        {sells && (user.monthlyTarget !== null || user.commissionPercent !== null) && (
          <p className="category-list__description">
            {[
              user.monthlyTarget !== null && t.people.target(formatMoney(user.monthlyTarget)),
              user.commissionPercent !== null && t.people.commission(user.commissionPercent),
            ]
              .filter(Boolean)
              .join(', ')}
          </p>
        )}
      </div>
      {canEdit && !isSelf ? (
        <select
          aria-label={t.people.roleFor(user.name)}
          value={user.role}
          disabled={update.isPending}
          onChange={(event) => update.mutate({ role: event.target.value as UserRole })}
        >
          {assignableRoles(currentUser.role).map((option) => (
            <option key={option} value={option}>
              {t.common.roles[option]}
            </option>
          ))}
        </select>
      ) : (
        <Badge tone={user.role === 'developer' || user.role === 'owner' ? 'brand' : 'neutral'}>{t.common.roles[user.role]}</Badge>
      )}
      {canEdit ? (
        <Button
          aria-expanded={isManaging}
          aria-controls={panelId}
          className={isManaging ? 'user-row__manage-toggle is-open' : 'user-row__manage-toggle'}
          onClick={() => setIsManaging((open) => !open)}
        >
          {t.people.manage}
          <span className="visually-hidden"> {user.name}</span>
          <CaretDown size={14} weight="bold" aria-hidden="true" className="user-row__caret" />
        </Button>
      ) : (
        <span aria-hidden="true" />
      )}
      {canEdit && isManaging && (
        <div id={panelId} className="user-row__manage">
          <span className="category-list__actions">
            {isSettingTargets ? (
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  update.mutate({
                    monthlyTarget: target === '' ? null : Number(target),
                    commissionPercent: commission === '' ? null : Number(commission),
                  });
                }}
              >
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={1}
                  aria-label={t.people.targetFor(user.name)}
                  placeholder={t.people.targetPlaceholder}
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                />
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step={0.5}
                  aria-label={t.people.commissionFor(user.name)}
                  placeholder={t.people.commissionPlaceholder}
                  value={commission}
                  onChange={(event) => setCommission(event.target.value)}
                />
                <Button type="submit" disabled={update.isPending} variant="primary">
                  {t.common.save}
                </Button>
                <Button onClick={() => setIsSettingTargets(false)}>
                  {t.common.cancel}
                </Button>
              </form>
            ) : isResetting ? (
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  update.mutate({ password: newPassword });
                }}
              >
                <input
                  type="text"
                  aria-label={t.people.newPasswordFor(user.name)}
                  placeholder={t.people.newPassword}
                  autoComplete="off"
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <Button type="submit" variant="primary">
                  {t.people.setPassword}
                </Button>
                <Button onClick={() => setIsResetting(false)}>
                  {t.common.cancel}
                </Button>
              </form>
            ) : (
              <>
                {sells && (
                  <Button onClick={() => setIsSettingTargets(true)}>
                    {t.people.targetAndCommission}
                  </Button>
                )}
                <Button onClick={() => setIsResetting(true)}>
                  {t.people.newPassword}
                </Button>
                {!isSelf && (
                  <Button onClick={() => update.mutate({ isActive: !user.isActive })}>
                    {user.isActive ? t.people.block : t.people.allow}
                  </Button>
                )}
                {!isSelf &&
                  (confirmingRemove ? (
                    <>
                      <Button variant="danger" onClick={() => remove.mutate()}>
                        {t.people.removeName(user.name.split(' ')[0] ?? user.name)}
                      </Button>
                      <Button onClick={() => setConfirmingRemove(false)}>
                        {t.people.keep}
                      </Button>
                    </>
                  ) : (
                    <Button variant="danger-text" onClick={() => setConfirmingRemove(true)}>
                      {t.people.remove}
                    </Button>
                  ))}
              </>
            )}
          </span>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {errorMessage(error)}
        </p>
      )}
    </li>
  );
}

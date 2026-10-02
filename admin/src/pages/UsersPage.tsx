import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading } from '../components/Feedback';
import { usersApi } from '../services/api';
import { type User, type UserRole, USER_ROLES } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney, ROLE_LABEL } from '../utils/format';

const ROLE_HINT: Record<UserRole, string> = {
  admin: 'Everything, including this dashboard',
  employee: 'Browse products and record sales',
  family: 'Browse products and favorites',
};

const MIN_PASSWORD_LENGTH = 8;

export function UsersPage() {
  const users = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list(1) });

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">People</h1>
        <p className="page-intro">Who can use the app, and what they can do.</p>
      </header>

      <section className="panel">
        <h2 className="panel__title">Add a person</h2>
        <AddUserForm />
      </section>

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

function AddUserForm() {
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
      setSavedMessage(`${user.name} can now log in with ${user.email}.`);
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
          <span className="field__label">Name</span>
          <input required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Email</span>
          <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span className="field__label">Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
            {USER_ROLES.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABEL[option]}: {ROLE_HINT[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">First password</span>
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
      <p className="field-hint">At least {MIN_PASSWORD_LENGTH} characters. Share it with them privately.</p>
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
      <button type="submit" className="button button--primary" disabled={create.isPending}>
        Add person
      </button>
    </form>
  );
}

function UserRow({ user }: { user: User }) {
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const [newPassword, setNewPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [isSettingTargets, setIsSettingTargets] = useState(false);
  const [target, setTarget] = useState(user.monthlyTarget === null ? '' : String(user.monthlyTarget));
  const [commission, setCommission] = useState(user.commissionPercent === null ? '' : String(user.commissionPercent));
  const sells = user.role !== 'family';
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const isSelf = user.id === currentUser.id;

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
        <p className="category-list__name">
          {user.name}
          {isSelf && ' (you)'}
        </p>
        <p className="category-list__description">
          {user.email}
          {!user.isActive && ', can’t log in'}
        </p>
        {sells && (user.monthlyTarget !== null || user.commissionPercent !== null) && (
          <p className="category-list__description">
            {[
              user.monthlyTarget !== null && `Target ${formatMoney(user.monthlyTarget)} a month`,
              user.commissionPercent !== null && `${user.commissionPercent}% commission`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </div>
      <select
        aria-label={`Role for ${user.name}`}
        value={user.role}
        disabled={update.isPending}
        onChange={(event) => update.mutate({ role: event.target.value as UserRole })}
      >
        {USER_ROLES.map((option) => (
          <option key={option} value={option}>
            {ROLE_LABEL[option]}
          </option>
        ))}
      </select>
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
              aria-label={`Monthly sales target for ${user.name} in euros`}
              placeholder="Target € / month"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.5}
              aria-label={`Commission for ${user.name} in percent`}
              placeholder="Commission %"
              value={commission}
              onChange={(event) => setCommission(event.target.value)}
            />
            <button type="submit" className="button button--primary" disabled={update.isPending}>
              Save
            </button>
            <button type="button" className="button button--quiet" onClick={() => setIsSettingTargets(false)}>
              Cancel
            </button>
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
              aria-label={`New password for ${user.name}`}
              placeholder="New password"
              autoComplete="off"
              minLength={MIN_PASSWORD_LENGTH}
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <button type="submit" className="button button--primary">
              Set password
            </button>
            <button type="button" className="button button--quiet" onClick={() => setIsResetting(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            {sells && (
              <button type="button" className="button button--quiet" onClick={() => setIsSettingTargets(true)}>
                Target & commission
              </button>
            )}
            <button type="button" className="button button--quiet" onClick={() => setIsResetting(true)}>
              New password
            </button>
            {!isSelf && (
              <button
                type="button"
                className="button button--quiet"
                onClick={() => update.mutate({ isActive: !user.isActive })}
              >
                {user.isActive ? 'Block access' : 'Allow access'}
              </button>
            )}
            {!isSelf &&
              (confirmingRemove ? (
                <>
                  <button type="button" className="button button--danger" onClick={() => remove.mutate()}>
                    Remove {user.name.split(' ')[0]}
                  </button>
                  <button type="button" className="button button--quiet" onClick={() => setConfirmingRemove(false)}>
                    Keep
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button button--quiet button--danger-text"
                  onClick={() => setConfirmingRemove(true)}
                >
                  Remove
                </button>
              ))}
          </>
        )}
      </span>
      {error && (
        <p className="form-error" role="alert">
          {errorMessage(error)}
        </p>
      )}
    </li>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { useAuth, useCurrentUser } from '../auth/useAuth';
import { Avatar } from '../components/Avatar';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PushSettingsPanel } from '../components/PushSettingsPanel';
import { meApi } from '../services/api';
import type { Session, User } from '../services/types';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { errorMessage } from '../utils/errors';
import { formatDateTime, ROLE_LABEL } from '../utils/format';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function Result({ error, success }: { error: unknown; success: string | null }) {
  if (error) {
    return (
      <p className="form-error" role="alert">
        {errorMessage(error)}
      </p>
    );
  }
  return success ? (
    <p className="form-success" role="status">
      {success}
    </p>
  ) : null;
}

/** The signed-in person's own details, look, alerts and security. */
export function ProfilePage() {
  const user = useCurrentUser();
  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Your profile</h1>
        <p className="page-intro">
          {ROLE_LABEL[user.role]} at the shop. What you change here is only about you.
        </p>
      </header>
      <DetailsPanel user={user} />
      <section className="panel">
        <h2 className="panel__title">Look</h2>
        <p className="field-hint">Auto follows your computer's light or dark setting.</p>
        <ThemeSwitch persist />
      </section>
      <PushSettingsPanel />
      <SecurityPanel user={user} />
      <DevicesPanel />
    </>
  );
}

function DetailsPanel({ user }: { user: User }) {
  const { updateUser } = useAuth();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: () => meApi.updateProfile({ name: name.trim(), phone: phone.trim() || null }),
    onSuccess: updateUser,
  });
  const upload = useMutation({ mutationFn: meApi.uploadAvatar, onSuccess: updateUser });
  const remove = useMutation({ mutationFn: meApi.removeAvatar, onSuccess: updateUser });

  function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setPhotoError(null);
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError('That photo is too big. Use one under 5 MB.');
      return;
    }
    upload.mutate(file);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <section className="panel">
      <h2 className="panel__title">You</h2>
      <div className="profile-photo">
        <Avatar name={user.name} url={user.avatarUrl} size={72} />
        <div className="profile-photo__actions">
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickPhoto} />
          <button
            type="button"
            className="button button--quiet"
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {upload.isPending ? 'Uploading…' : user.avatarUrl ? 'Change photo' : 'Add a photo'}
          </button>
          {user.avatarUrl && (
            <button type="button" className="button button--quiet button--danger-text" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Remove
            </button>
          )}
        </div>
      </div>
      {photoError && (
        <p className="form-error" role="alert">
          {photoError}
        </p>
      )}
      <Result error={upload.error ?? remove.error} success={null} />

      <form className="settings-form" onSubmit={handleSubmit}>
        <div className="field-row">
          <label className="field">
            <span className="field__label">Name</span>
            <input required maxLength={255} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Phone (optional)</span>
            <input type="tel" maxLength={50} autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </label>
        </div>
        <Result error={save.error} success={save.isSuccess ? 'Saved.' : null} />
        <button type="submit" className="button button--primary" disabled={!name.trim() || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </form>
    </section>
  );
}

function SecurityPanel({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const security = useQuery({ queryKey: ['me', 'security'], queryFn: meApi.security });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const changePassword = useMutation({
    mutationFn: () =>
      meApi.changePassword({ currentPassword: security.data?.hasPassword ? currentPassword : undefined, newPassword }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const changeEmail = useMutation({
    mutationFn: () => meApi.changeEmail({ newEmail: newEmail.trim(), password: security.data?.hasPassword ? emailPassword : undefined }),
    onSuccess: () => setEmailPassword(''),
  });

  const unlink = useMutation({
    mutationFn: meApi.unlinkGoogle,
    onSuccess: (data) => queryClient.setQueryData(['me', 'security'], data),
  });

  return (
    <section className="panel">
      <h2 className="panel__title">Logging in</h2>
      {security.isPending && <Loading />}
      {security.isError && <ErrorNotice error={security.error} onRetry={() => security.refetch()} />}
      {security.data && (
        <div className="security">
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              changePassword.mutate();
            }}
          >
            <h3 className="subheading">{security.data.hasPassword ? 'Change your password' : 'Set a password'}</h3>
            {security.data.hasPassword && (
              <label className="field">
                <span className="field__label">Current password</span>
                <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
              </label>
            )}
            <label className="field">
              <span className="field__label">New password</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <span className="field-hint">At least {MIN_PASSWORD_LENGTH} characters. Your other devices will be logged out.</span>
            </label>
            <Result error={changePassword.error} success={changePassword.isSuccess ? 'Password changed.' : null} />
            <button
              type="submit"
              className="button button--primary"
              disabled={newPassword.length < MIN_PASSWORD_LENGTH || changePassword.isPending}
            >
              {security.data.hasPassword ? 'Change password' : 'Set password'}
            </button>
          </form>

          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              changeEmail.mutate();
            }}
          >
            <h3 className="subheading">Your email</h3>
            <p className="field-hint">
              You log in with <strong>{user.email}</strong>. A new address has to be confirmed before it's used.
            </p>
            <label className="field">
              <span className="field__label">New email</span>
              <input type="email" autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
            </label>
            {security.data.hasPassword && (
              <label className="field">
                <span className="field__label">Your password</span>
                <input type="password" autoComplete="current-password" value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} />
              </label>
            )}
            <Result
              error={changeEmail.error}
              success={changeEmail.isSuccess ? `We sent a link to ${newEmail.trim()}. Click it to switch.` : null}
            />
            <button type="submit" className="button button--quiet" disabled={!newEmail.trim() || changeEmail.isPending}>
              Send confirmation link
            </button>
          </form>

          <div className="settings-form">
            <h3 className="subheading">Google</h3>
            {security.data.googleEmail ? (
              <>
                <p className="field-hint">
                  You can log in with Google as <strong>{security.data.googleEmail}</strong>.
                </p>
                <Result error={unlink.error} success={null} />
                <button type="button" className="button button--quiet button--danger-text" disabled={unlink.isPending} onClick={() => unlink.mutate()}>
                  Stop using Google to log in
                </button>
              </>
            ) : (
              <p className="field-hint">
                Not linked. Use "Sign in with Google" on the login page once, with a Google account that has this email, and it links by
                itself.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function DevicesPanel() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ['me', 'sessions'], queryFn: meApi.sessions });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me', 'sessions'] });
  const endOne = useMutation({ mutationFn: meApi.endSession, onSuccess: refresh });
  const endOthers = useMutation({ mutationFn: meApi.endOtherSessions, onSuccess: refresh });
  const others = sessions.data?.filter((session) => !session.current).length ?? 0;

  return (
    <section className="panel">
      <div className="panel__header">
        <h2 className="panel__title">Where you're logged in</h2>
        {others > 0 && (
          <button type="button" className="button button--quiet" disabled={endOthers.isPending} onClick={() => endOthers.mutate()}>
            Log out everywhere else
          </button>
        )}
      </div>
      {sessions.isPending && <Loading />}
      {sessions.isError && <ErrorNotice error={sessions.error} onRetry={() => sessions.refetch()} />}
      <Result error={endOne.error ?? endOthers.error} success={null} />
      {sessions.data && (
        <ul className="device-list">
          {sessions.data.map((session) => (
            <DeviceRow key={session.id} session={session} onEnd={() => endOne.mutate(session.id)} busy={endOne.isPending} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DeviceRow({ session, onEnd, busy }: { session: Session; onEnd: () => void; busy: boolean }) {
  return (
    <li className="device-list__row">
      <span>
        <span className="device-list__name">{session.device}</span>
        <span className="device-list__meta">
          {session.current ? 'This device' : `Last used ${session.lastUsedAt ? formatDateTime(session.lastUsedAt) : 'a while ago'}`}
        </span>
      </span>
      {!session.current && (
        <button type="button" className="button button--quiet" disabled={busy} onClick={onEnd}>
          Log out
        </button>
      )}
    </li>
  );
}

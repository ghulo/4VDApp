import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { useAuth, useCurrentUser } from '../auth/useAuth';
import { Avatar } from '../components/Avatar';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PushSettingsPanel } from '../components/PushSettingsPanel';
import { Badge, Button, Card, Field, PageHeader, SettingRow } from '../components/ui';
import { meApi } from '../services/api';
import type { Session, User } from '../services/types';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { errorMessage } from '../utils/errors';
import { formatDateTime, ROLE_LABEL } from '../utils/format';
import { canOversee } from '../auth/roles';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** A save result for a card's footer strip. */
function Result({ error, success }: { error: unknown; success: string | null }) {
  if (error) {
    return (
      <span className="form-error" role="alert">
        {errorMessage(error)}
      </span>
    );
  }
  return success ? (
    <span className="form-success" role="status">
      {success}
    </span>
  ) : null;
}

/** The signed-in person's own details, look, alerts and security. */
export function ProfilePage() {
  const user = useCurrentUser();
  return (
    <>
      <PageHeader
        title="Your profile"
        description={`${ROLE_LABEL[user.role]} at the shop. What you change here is only about you.`}
      />
      <DetailsPanel user={user} />
      <Card title="Look">
        <SettingRow title="Theme" description="Auto follows your computer's light or dark setting.">
          <ThemeSwitch persist />
        </SettingRow>
      </Card>
      <PushSettingsPanel />
      {canOversee(user.role) && <EmailsPanel user={user} />}
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

  const photoProblem = photoError ?? (upload.error || remove.error ? errorMessage(upload.error ?? remove.error) : null);

  return (
    <form onSubmit={handleSubmit}>
      <Card
        title="You"
        description="Your team sees your name and photo."
        footer={
          <>
            <Result error={save.error} success={save.isSuccess ? 'Saved.' : null} />
            <Button type="submit" variant="primary" disabled={!name.trim() || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <SettingRow
          title="Photo"
          description={
            photoProblem ? (
              <span className="form-error" role="alert">
                {photoProblem}
              </span>
            ) : (
              'A JPG, PNG or WebP under 5 MB.'
            )
          }
        >
          <Avatar name={user.name} url={user.avatarUrl} size={48} />
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickPhoto} />
          <Button disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
            {upload.isPending ? 'Uploading…' : user.avatarUrl ? 'Change' : 'Add a photo'}
          </Button>
          {user.avatarUrl && (
            <Button variant="danger-text" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Remove
            </Button>
          )}
        </SettingRow>
        <div className="setting-row setting-row--fields">
          <div className="field-row">
            <Field label="Name">
              <input required maxLength={255} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Phone (optional)">
              <input type="tel" maxLength={50} autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
            </Field>
          </div>
        </div>
      </Card>
    </form>
  );
}

function EmailsPanel({ user }: { user: User }) {
  const { updateUser } = useAuth();
  const toggle = useMutation({
    mutationFn: (on: boolean) => meApi.updateProfile({ emailWeeklyReport: on }),
    onSuccess: updateUser,
  });
  return (
    <Card title="Emails">
      <SettingRow
        title="Weekly report"
        description={
          toggle.isError ? (
            <Result error={toggle.error} success={null} />
          ) : (
            "Every Monday evening: last week's sales, best sellers and anything that needs you."
          )
        }
      >
        <input
          type="checkbox"
          role="switch"
          className="switch"
          aria-label="Weekly report email"
          checked={user.emailWeeklyReport}
          disabled={toggle.isPending}
          onChange={(event) => toggle.mutate(event.target.checked)}
        />
      </SettingRow>
    </Card>
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

  if (security.isPending) return <Loading />;
  if (security.isError) return <ErrorNotice error={security.error} onRetry={() => security.refetch()} />;
  const { hasPassword, googleEmail } = security.data;

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          changePassword.mutate();
        }}
      >
        <Card
          title={hasPassword ? 'Password' : 'Set a password'}
          description={`At least ${MIN_PASSWORD_LENGTH} characters. Your other devices will be logged out.`}
          footer={
            <>
              <Result error={changePassword.error} success={changePassword.isSuccess ? 'Password changed.' : null} />
              <Button type="submit" variant="primary" disabled={newPassword.length < MIN_PASSWORD_LENGTH || changePassword.isPending}>
                {hasPassword ? 'Change password' : 'Set password'}
              </Button>
            </>
          }
        >
          <div className="field-row">
            {hasPassword && (
              <Field label="Current password">
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </Field>
            )}
            <Field label="New password">
              <input
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </Field>
          </div>
        </Card>
      </form>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          changeEmail.mutate();
        }}
      >
        <Card
          title="Email"
          description={
            <>
              You log in with <strong>{user.email}</strong>. A new address has to be confirmed before it's used.
            </>
          }
          footer={
            <>
              <Result
                error={changeEmail.error}
                success={changeEmail.isSuccess ? `We sent a link to ${newEmail.trim()}. Click it to switch.` : null}
              />
              <Button type="submit" disabled={!newEmail.trim() || changeEmail.isPending}>
                Send confirmation link
              </Button>
            </>
          }
        >
          <div className="field-row">
            <Field label="New email">
              <input type="email" autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
            </Field>
            {hasPassword && (
              <Field label="Your password">
                <input
                  type="password"
                  autoComplete="current-password"
                  value={emailPassword}
                  onChange={(event) => setEmailPassword(event.target.value)}
                />
              </Field>
            )}
          </div>
        </Card>
      </form>

      <Card title="Google">
        <SettingRow
          title={googleEmail ? 'Linked' : 'Not linked'}
          description={
            unlink.isError ? (
              <Result error={unlink.error} success={null} />
            ) : googleEmail ? (
              <>
                You can log in with Google as <strong>{googleEmail}</strong>.
              </>
            ) : (
              'Use "Sign in with Google" on the login page once, with a Google account that has this email, and it links by itself.'
            )
          }
        >
          {googleEmail && (
            <Button variant="danger-text" disabled={unlink.isPending} onClick={() => unlink.mutate()}>
              Unlink Google
            </Button>
          )}
        </SettingRow>
      </Card>
    </>
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
    <Card
      title="Where you're logged in"
      actions={
        others > 0 && (
          <Button size="sm" disabled={endOthers.isPending} onClick={() => endOthers.mutate()}>
            Log out everywhere else
          </Button>
        )
      }
    >
      {sessions.isPending && <Loading />}
      {sessions.isError && <ErrorNotice error={sessions.error} onRetry={() => sessions.refetch()} />}
      {(endOne.isError || endOthers.isError) && (
        <p>
          <Result error={endOne.error ?? endOthers.error} success={null} />
        </p>
      )}
      {sessions.data && (
        <ul className="device-list">
          {sessions.data.map((session) => (
            <DeviceRow key={session.id} session={session} onEnd={() => endOne.mutate(session.id)} busy={endOne.isPending} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function DeviceRow({ session, onEnd, busy }: { session: Session; onEnd: () => void; busy: boolean }) {
  return (
    <li className="device-list__row">
      <span>
        <span className="device-list__name">
          {session.device} {session.current && <Badge tone="ok">This device</Badge>}
        </span>
        {!session.current && (
          <span className="device-list__meta">
            {session.lastUsedAt ? `Last used ${formatDateTime(session.lastUsedAt)}` : 'Logged in before 4VD tracked devices'}
          </span>
        )}
      </span>
      {!session.current && (
        <Button size="sm" disabled={busy} onClick={onEnd}>
          Log out
        </Button>
      )}
    </li>
  );
}

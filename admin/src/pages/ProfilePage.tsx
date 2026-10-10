import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { useAuth, useCurrentUser } from '../auth/useAuth';
import { Avatar } from '../components/Avatar';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PushSettingsPanel } from '../components/PushSettingsPanel';
import { ReportSettingsPanel } from '../components/ReportSettingsPanel';
import { Badge, Button, Card, Field, PageHeader, SettingRow, SettingsLayout } from '../components/ui';
import { meApi } from '../services/api';
import { useT } from '../i18n/useT';
import type { Session, User } from '../services/types';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { errorMessage } from '../utils/errors';
import { formatDateTime } from '../utils/format';
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
  const t = useT();
  const user = useCurrentUser();
  return (
    <>
      <PageHeader
        title={t.profile.title}
        description={t.profile.description(t.common.roles[user.role])}
      />
      <SettingsLayout
        sections={[
          { id: 'you', label: t.profile.you, content: <DetailsPanel user={user} /> },
          {
            id: 'look',
            label: t.profile.look,
            content: (
              <Card title={t.profile.look}>
                <SettingRow title={t.theme.label} description={t.profile.themeHint}>
                  <ThemeSwitch persist />
                </SettingRow>
                <SettingRow title={t.language.label} description={t.language.description}>
                  <LanguageSwitch persist />
                </SettingRow>
              </Card>
            ),
          },
          { id: 'alerts', label: t.push.title, content: <PushSettingsPanel /> },
          ...(canOversee(user.role) ? [{ id: 'reports', label: t.reportSettings.title, content: <ReportSettingsPanel /> }] : []),
          { id: 'security', label: t.profile.security, content: <SecurityPanel user={user} /> },
          { id: 'devices', label: t.profile.devices, content: <DevicesPanel /> },
        ]}
      />
    </>
  );
}

function DetailsPanel({ user }: { user: User }) {
  const t = useT();
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
      setPhotoError(t.profile.photoTooBig);
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
        title={t.profile.you}
        description={t.profile.youHint}
        footer={
          <>
            <Result error={save.error} success={save.isSuccess ? t.profile.saved : null} />
            <Button type="submit" variant="primary" disabled={!name.trim() || save.isPending}>
              {save.isPending ? t.auth.saving : t.common.save}
            </Button>
          </>
        }
      >
        <SettingRow
          title={t.profile.photo}
          description={
            photoProblem ? (
              <span className="form-error" role="alert">
                {photoProblem}
              </span>
            ) : (
              t.profile.photoHint
            )
          }
        >
          <Avatar name={user.name} url={user.avatarUrl} size={48} />
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickPhoto} />
          <Button disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
            {upload.isPending ? t.profile.uploading : user.avatarUrl ? t.profile.change : t.profile.addPhoto}
          </Button>
          {user.avatarUrl && (
            <Button variant="danger-text" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t.profile.remove}
            </Button>
          )}
        </SettingRow>
        <div className="setting-row setting-row--fields">
          <div className="field-row">
            <Field label={t.profile.name}>
              <input required maxLength={255} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label={t.profile.phone}>
              <input type="tel" maxLength={50} autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
            </Field>
          </div>
        </div>
      </Card>
    </form>
  );
}

function SecurityPanel({ user }: { user: User }) {
  const t = useT();
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
          title={hasPassword ? t.profile.password : t.profile.setPasswordTitle}
          description={t.profile.passwordHint(MIN_PASSWORD_LENGTH)}
          footer={
            <>
              <Result error={changePassword.error} success={changePassword.isSuccess ? t.profile.passwordChanged : null} />
              <Button type="submit" variant="primary" disabled={newPassword.length < MIN_PASSWORD_LENGTH || changePassword.isPending}>
                {hasPassword ? t.profile.changePassword : t.profile.setPassword}
              </Button>
            </>
          }
        >
          <div className="field-row">
            {hasPassword && (
              <Field label={t.profile.currentPassword}>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </Field>
            )}
            <Field label={t.profile.newPassword}>
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
          title={t.profile.email}
          description={
            <>
              {t.profile.emailHintBefore} <strong>{user.email}</strong>. {t.profile.emailHintAfter}
            </>
          }
          footer={
            <>
              <Result
                error={changeEmail.error}
                success={changeEmail.isSuccess ? t.profile.linkSent(newEmail.trim()) : null}
              />
              <Button type="submit" disabled={!newEmail.trim() || changeEmail.isPending}>
                {t.profile.sendConfirmation}
              </Button>
            </>
          }
        >
          <div className="field-row">
            <Field label={t.profile.newEmail}>
              <input type="email" autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
            </Field>
            {hasPassword && (
              <Field label={t.profile.yourPassword}>
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
          title={googleEmail ? t.profile.linked : t.profile.notLinked}
          description={
            unlink.isError ? (
              <Result error={unlink.error} success={null} />
            ) : googleEmail ? (
              <>
                {t.profile.googleAs} <strong>{googleEmail}</strong>.
              </>
            ) : (
              t.profile.googleHowTo
            )
          }
        >
          {googleEmail && (
            <Button variant="danger-text" disabled={unlink.isPending} onClick={() => unlink.mutate()}>
              {t.profile.unlinkGoogle}
            </Button>
          )}
        </SettingRow>
      </Card>
    </>
  );
}

const DEVICES_SHOWN = 5;

function DevicesPanel() {
  const t = useT();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ['me', 'sessions'], queryFn: meApi.sessions });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me', 'sessions'] });
  const endOne = useMutation({ mutationFn: meApi.endSession, onSuccess: refresh });
  const endOthers = useMutation({ mutationFn: meApi.endOtherSessions, onSuccess: refresh });
  const [showAll, setShowAll] = useState(false);
  const others = sessions.data?.filter((session) => !session.current).length ?? 0;
  // This device first; long lists (every browser ever used) stay short until asked.
  const ordered = sessions.data ? [...sessions.data].sort((a, b) => Number(b.current) - Number(a.current)) : [];
  const shown = showAll ? ordered : ordered.slice(0, DEVICES_SHOWN);

  return (
    <Card
      title={t.profile.devices}
      actions={
        others > 0 && (
          <Button size="sm" disabled={endOthers.isPending} onClick={() => endOthers.mutate()}>
            {t.profile.logOutElsewhere}
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
        <ul id="device-list" className="device-list">
          {shown.map((session) => (
            <DeviceRow key={session.id} session={session} onEnd={() => endOne.mutate(session.id)} busy={endOne.isPending} />
          ))}
        </ul>
      )}
      {ordered.length > DEVICES_SHOWN && (
        <p className="form-actions--spaced">
          <Button size="sm" variant="ghost" aria-expanded={showAll} aria-controls="device-list" onClick={() => setShowAll(!showAll)}>
            {showAll ? t.profile.showFewerDevices : t.profile.showAllDevices(ordered.length)}
          </Button>
        </p>
      )}
    </Card>
  );
}

function DeviceRow({ session, onEnd, busy }: { session: Session; onEnd: () => void; busy: boolean }) {
  const t = useT();
  return (
    <li className="device-list__row">
      <span>
        <span className="device-list__name">
          {session.device} {session.current && <Badge tone="ok">{t.profile.thisDevice}</Badge>}
        </span>
        {!session.current && (
          <span className="device-list__meta">
            {session.lastUsedAt ? t.profile.lastUsed(formatDateTime(session.lastUsedAt)) : t.profile.untracked}
          </span>
        )}
      </span>
      {!session.current && (
        <Button size="sm" disabled={busy} onClick={onEnd}>
          {t.profile.logOut}
        </Button>
      )}
    </li>
  );
}

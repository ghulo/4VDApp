import { useMutation, useQuery } from '@tanstack/react-query';
import { useFinishSignIn } from '../auth/finishSignIn';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { announceSwitch } from '../auth/businessSwitch';
import { forgetViewAs } from '../auth/viewAs';
import { AuthShell } from '../components/AuthShell';
import { Loading } from '../components/Feedback';
import { GoogleButton } from '../components/GoogleButton';
import { accountApi } from '../services/api';
import { useLanguage, useT } from '../i18n/useT';
import { hasSavedLanguage } from '../i18n/language';
import { errorMessage } from '../utils/errors';
import { Button, PasswordField } from '../components/ui';
import { showBrand } from '../theme/applyBrand';

const MIN_PASSWORD_LENGTH = 8;
function BackToLogin() {
  const t = useT();
  return (
    <p className="auth__links">
      <Link to="/login" className="text-link">
        {t.auth.backToLogin}
      </Link>
    </p>
  );
}

function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="form-error" role="alert">
      {errorMessage(error)}
    </p>
  );
}

// ---------- Forgot password ----------

export function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const send = useMutation({ mutationFn: () => accountApi.forgotPassword(email.trim()) });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    send.mutate();
  }

  return (
    <AuthShell title={t.auth.forgot} subtitle={t.auth.forgotSubtitle}>
      {send.isSuccess ? (
        <p className="form-success" role="status">
          {t.auth.forgotSent}
        </p>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span className="field__label">{t.auth.email}</span>
            <input type="email" autoComplete="email" spellCheck={false} required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <FormError error={send.error} />
          <Button type="submit" disabled={!email.trim() || send.isPending} variant="primary" wide loading={send.isPending}>
            {t.auth.emailMeLink}
          </Button>
        </form>
      )}
      <BackToLogin />
    </AuthShell>
  );
}

// ---------- Reset password ----------

export function ResetPasswordPage() {
  const t = useT();
  const { token = '' } = useParams();
  const [password, setPassword] = useState('');
  const reset = useMutation({ mutationFn: () => accountApi.resetPassword(token, password) });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    reset.mutate();
  }

  return (
    <AuthShell title={t.auth.newPasswordTitle} subtitle={t.auth.newPasswordSubtitle(MIN_PASSWORD_LENGTH)}>
      {reset.isSuccess ? (
        <>
          <p className="form-success" role="status">
            {t.auth.passwordChanged}
          </p>
          <Link to="/login" className="button button--primary button--wide">
            {t.auth.logIn}
          </Link>
        </>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <PasswordField
            label={t.auth.newPassword}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <FormError error={reset.error} />
          <Button type="submit"
           
            disabled={password.length < MIN_PASSWORD_LENGTH || reset.isPending} variant="primary" wide loading={reset.isPending}>
            {t.auth.saveNewPassword}
          </Button>
        </form>
      )}
      <BackToLogin />
    </AuthShell>
  );
}

// ---------- Email links that just need a click ----------

/** Runs the link's action once on arrival, then shows how it went. */
function LinkActionPage({ title, action, done }: { title: string; action: (token: string) => Promise<unknown>; done: string }) {
  const t = useT();
  const { token = '' } = useParams();
  const run = useMutation({ mutationFn: () => action(token) });
  const started = useRef(false);

  useEffect(() => {
    // Once only, even when React runs effects twice in development: the link is single use.
    if (started.current) return;
    started.current = true;
    run.mutate();
  }, [run]);

  return (
    <AuthShell title={title}>
      {run.isPending && <Loading label={t.auth.checkingLink} />}
      {run.isSuccess && (
        <>
          <p className="form-success" role="status">
            {done}
          </p>
          <Link to="/login" className="button button--primary button--wide">
            {t.auth.logIn}
          </Link>
        </>
      )}
      <FormError error={run.error} />
      {run.isError && <BackToLogin />}
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const t = useT();
  return <LinkActionPage title={t.auth.confirmingEmail} action={accountApi.verifyEmail} done={t.auth.emailConfirmed} />;
}

export function ConfirmEmailChangePage() {
  const t = useT();
  return <LinkActionPage title={t.auth.switchingEmail} action={accountApi.confirmEmailChange} done={t.auth.emailSwitched} />;
}

// ---------- Accept an invite ----------

export function AcceptInvitePage() {
  const t = useT();
  const { token = '' } = useParams();
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => accountApi.invitePreview(token), retry: false });
  // The invite page wears the inviting business's colours (shown, not remembered).
  const inviteBrand = invite.data?.brand;
  useEffect(() => showBrand(inviteBrand), [inviteBrand]);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const { finish, noAccess } = useFinishSignIn();
  const { language, setLanguage } = useLanguage();
  const { state: auth, logout } = useAuth();

  // An account that already exists joins as it is; the app opens again in the business joined.
  const join = useMutation({
    mutationFn: () => accountApi.joinInvite(token),
    onSuccess: () => {
      forgetViewAs();
      announceSwitch(0);
      window.location.assign('/');
    },
  });
  const accept = useMutation({
    // The account starts in the language this page is shown in.
    mutationFn: () => accountApi.acceptInvite(token, { name: name.trim(), password, language }),
    onSuccess: finish,
  });
  const google = useMutation({
    mutationFn: (credential: string) => accountApi.acceptInviteWithGoogle(token, credential, language),
    onSuccess: finish,
  });

  // Open in the language the invite was sent in, unless this browser already has a choice.
  const inviteLanguage = invite.data?.language;
  useEffect(() => {
    if (inviteLanguage && !hasSavedLanguage()) setLanguage(inviteLanguage);
  }, [inviteLanguage, setLanguage]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    accept.mutate();
  }

  if (invite.isPending) {
    return (
      <AuthShell title={t.auth.openingInvite}>
        <Loading />
      </AuthShell>
    );
  }
  if (invite.isError) {
    return (
      <AuthShell title={t.auth.inviteBroken}>
        <FormError error={invite.error} />
        <BackToLogin />
      </AuthShell>
    );
  }

  const { shopName, invitedBy, role, email, hasAccount, brand } = invite.data;
  if (hasAccount) {
    const signedInAs = auth.status === 'signedIn' ? auth.user.email.toLowerCase() : null;
    return (
      <AuthShell brand={brand} title={t.auth.join(shopName)} subtitle={t.auth.invitedAs({ by: invitedBy, email, role: t.common.roles[role] })}>
        {signedInAs === email.toLowerCase() ? (
          <>
            <p className="field-hint">{t.auth.hasAccount(email)}</p>
            <FormError error={join.error} />
            <Button variant="primary" wide loading={join.isPending} disabled={join.isPending} onClick={() => join.mutate()}>
              {t.auth.joinWithAccount(shopName)}
            </Button>
          </>
        ) : signedInAs ? (
          <>
            <p className="field-hint">{t.auth.signedInAsOther({ email, other: signedInAs })}</p>
            <Button variant="primary" wide onClick={() => void logout()}>
              {t.auth.logOutToJoin(email)}
            </Button>
          </>
        ) : (
          <>
            <p className="field-hint">{t.auth.hasAccount(email)}</p>
            <Link to="/login" state={{ from: `/invite/${token}` }} className="button button--primary button--wide">
              {t.auth.logInToJoin}
            </Link>
          </>
        )}
      </AuthShell>
    );
  }
  return (
    <AuthShell
      brand={brand}
      title={t.auth.join(shopName)}
      subtitle={t.auth.invitedAs({ by: invitedBy, email, role: t.common.roles[role] })}
    >
      {noAccess ? (
        <p className="form-error" role="alert">
          {t.auth.noAccess}
        </p>
      ) : (
        <>
          <form onSubmit={handleSubmit} noValidate>
            <label className="field">
              <span className="field__label">{t.auth.yourName}</span>
              <input autoComplete="name" required maxLength={255} autoFocus value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <PasswordField
              label={t.auth.choosePassword}
              hint={t.auth.atLeast(MIN_PASSWORD_LENGTH)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <FormError error={accept.error ?? google.error} />
            <Button type="submit"
             
              disabled={!name.trim() || password.length < MIN_PASSWORD_LENGTH || accept.isPending} variant="primary" wide loading={accept.isPending}>
              {t.auth.joinButton}
            </Button>
          </form>
          <GoogleButton onCredential={(credential) => google.mutate(credential)} />
        </>
      )}
    </AuthShell>
  );
}


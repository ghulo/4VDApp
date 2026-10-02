import { useMutation, useQuery } from '@tanstack/react-query';
import { TEAM_APP_URL, useFinishSignIn } from '../auth/finishSignIn';
import { OpenTheApp } from '../components/OpenTheApp';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { AuthShell } from '../components/AuthShell';
import { Loading } from '../components/Feedback';
import { GoogleButton } from '../components/GoogleButton';
import { accountApi } from '../services/api';
import { errorMessage } from '../utils/errors';
import { ROLE_LABEL } from '../utils/format';

const MIN_PASSWORD_LENGTH = 8;
function BackToLogin() {
  return (
    <p className="login__links">
      <Link to="/login" className="text-link">
        Back to log in
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
  const [email, setEmail] = useState('');
  const send = useMutation({ mutationFn: () => accountApi.forgotPassword(email.trim()) });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    send.mutate();
  }

  return (
    <AuthShell title="Forgot your password?" subtitle="We'll email you a link to choose a new one.">
      {send.isSuccess ? (
        <p className="form-success" role="status">
          If that email has an account, we sent it a link. Check the inbox (and spam).
        </p>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span className="field__label">Email</span>
            <input type="email" autoComplete="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <FormError error={send.error} />
          <button type="submit" className="button button--primary button--wide" disabled={!email.trim() || send.isPending}>
            {send.isPending ? 'Sending…' : 'Email me a link'}
          </button>
        </form>
      )}
      <BackToLogin />
    </AuthShell>
  );
}

// ---------- Reset password ----------

export function ResetPasswordPage() {
  const { token = '' } = useParams();
  const [password, setPassword] = useState('');
  const reset = useMutation({ mutationFn: () => accountApi.resetPassword(token, password) });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    reset.mutate();
  }

  return (
    <AuthShell title="Choose a new password" subtitle={`At least ${MIN_PASSWORD_LENGTH} characters. Every device will be logged out.`}>
      {reset.isSuccess ? (
        <>
          <p className="form-success" role="status">
            Password changed. Log in with your new password.
          </p>
          <Link to="/login" className="button button--primary button--wide">
            Log in
          </Link>
        </>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span className="field__label">New password</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <FormError error={reset.error} />
          <button
            type="submit"
            className="button button--primary button--wide"
            disabled={password.length < MIN_PASSWORD_LENGTH || reset.isPending}
          >
            {reset.isPending ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      )}
      <BackToLogin />
    </AuthShell>
  );
}

// ---------- Email links that just need a click ----------

/** Runs the link's action once on arrival, then shows how it went. */
function LinkActionPage({ title, action, done }: { title: string; action: (token: string) => Promise<unknown>; done: string }) {
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
      {run.isPending && <Loading label="Checking the link…" />}
      {run.isSuccess && (
        <>
          <p className="form-success" role="status">
            {done}
          </p>
          <Link to="/login" className="button button--primary button--wide">
            Log in
          </Link>
          <p className="field-hint">
            Staff: <a href={TEAM_APP_URL}>open the 4VD app</a> and log in there.
          </p>
        </>
      )}
      <FormError error={run.error} />
      {run.isError && <BackToLogin />}
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  return <LinkActionPage title="Confirming your email" action={accountApi.verifyEmail} done="Email confirmed. You can log in now." />;
}

export function ConfirmEmailChangePage() {
  return (
    <LinkActionPage
      title="Switching your email"
      action={accountApi.confirmEmailChange}
      done="Done. Log in with your new email from now on."
    />
  );
}

// ---------- Accept an invite ----------

export function AcceptInvitePage() {
  const { token = '' } = useParams();
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => accountApi.invitePreview(token), retry: false });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const { finish, sentToApp } = useFinishSignIn();

  const accept = useMutation({
    mutationFn: () => accountApi.acceptInvite(token, { name: name.trim(), password }),
    onSuccess: finish,
  });
  const google = useMutation({
    mutationFn: (credential: string) => accountApi.acceptInviteWithGoogle(token, credential),
    onSuccess: finish,
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    accept.mutate();
  }

  if (invite.isPending) {
    return (
      <AuthShell title="Opening your invite">
        <Loading />
      </AuthShell>
    );
  }
  if (invite.isError) {
    return (
      <AuthShell title="This invite doesn't work">
        <FormError error={invite.error} />
        <BackToLogin />
      </AuthShell>
    );
  }

  const { shopName, invitedBy, role, email } = invite.data;
  return (
    <AuthShell
      title={`Join ${shopName}`}
      subtitle={`${invitedBy ?? 'The owner'} invited ${email} as ${ROLE_LABEL[role].toLowerCase()}.`}
    >
      {sentToApp ? (
        <OpenTheApp />
      ) : (
        <>
          <form onSubmit={handleSubmit} noValidate>
            <label className="field">
              <span className="field__label">Your name</span>
              <input autoComplete="name" required maxLength={255} autoFocus value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">Choose a password</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <span className="field-hint">At least {MIN_PASSWORD_LENGTH} characters.</span>
            </label>
            <FormError error={accept.error ?? google.error} />
            <button
              type="submit"
              className="button button--primary button--wide"
              disabled={!name.trim() || password.length < MIN_PASSWORD_LENGTH || accept.isPending}
            >
              {accept.isPending ? 'Setting up…' : 'Join'}
            </button>
          </form>
          <GoogleButton onCredential={(credential) => google.mutate(credential)} />
        </>
      )}
    </AuthShell>
  );
}


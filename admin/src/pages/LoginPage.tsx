import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { AuthShell } from '../components/AuthShell';
import { GoogleButton } from '../components/GoogleButton';
import { accountApi } from '../services/api';
import { ApiError } from '../services/apiClient';
import { errorMessage } from '../utils/errors';
import { useFinishSignIn } from '../auth/finishSignIn';
import { OpenTheApp } from '../components/OpenTheApp';
import { Button, PasswordField } from '../components/ui';
import { activeCatalogue, useT } from '../i18n/useT';

/** The last email that signed in on this device, so the shop PC only asks for the password. */
const LAST_EMAIL_KEY = '4vd.lastEmail';
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function savedEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberEmail(email: string) {
  try {
    localStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    // Private windows may refuse storage; the email is just typed again next time.
  }
}

/** The server's sign-in errors in the reader's language. */
function signInMessage(error: unknown): string {
  const t = activeCatalogue().auth;
  if (error instanceof ApiError) {
    if (error.code === 'NETWORK') return navigator.onLine ? t.unreachable : t.offline;
    if (error.code === 'EMAIL_NOT_CONFIRMED') return t.notConfirmed;
    if (error.status === 401) return t.wrongLogin;
  }
  return errorMessage(error);
}

type FieldErrors = { email?: string; password?: string };

export function LoginPage() {
  const { state, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';
  const { finish, sentToApp } = useFinishSignIn(redirectTo);
  const t = useT();

  const [email, setEmail] = useState(savedEmail);
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const google = useMutation({ mutationFn: accountApi.googleSignIn, onSuccess: finish });
  const resend = useMutation({ mutationFn: () => accountApi.resendVerification(email.trim()) });
  const busy = isSubmitting || google.isPending;
  const notConfirmed = error instanceof ApiError && error.code === 'EMAIL_NOT_CONFIRMED';

  if (state.status === 'signedIn') return <Navigate to={redirectTo} replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const trimmed = email.trim();
    const problems: FieldErrors = {
      email: !trimmed ? t.auth.enterEmail : EMAIL_SHAPE.test(trimmed) ? undefined : t.auth.badEmail,
      password: password ? undefined : t.auth.enterPassword,
    };
    setFieldErrors(problems);
    if (problems.email || problems.password) {
      (problems.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setIsSubmitting(true);
    try {
      await login(trimmed, password);
      rememberEmail(trimmed);
      navigate(redirectTo, { replace: true });
    } catch (loginError) {
      setError(loginError);
      // Ready to type the password again at once.
      if (loginError instanceof ApiError && loginError.status === 401 && loginError.code !== 'EMAIL_NOT_CONFIRMED') {
        passwordRef.current?.focus();
        passwordRef.current?.select();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (sentToApp) {
    return (
      <AuthShell title={t.auth.signedIn}>
        <OpenTheApp />
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t.auth.logIn} subtitle={t.auth.loginSubtitle}>
      <form onSubmit={handleSubmit} noValidate aria-busy={busy || undefined}>
        <label className="field">
          <span className="field__label">{t.auth.email}</span>
          <input
            ref={emailRef}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setFieldErrors((now) => ({ ...now, email: undefined }));
            }}
            readOnly={busy}
            required
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
            // A remembered email goes straight to the password instead.
            autoFocus={!email}
          />
          {fieldErrors.email && (
            <span className="field__error" id="login-email-error">
              {fieldErrors.email}
            </span>
          )}
        </label>
        <PasswordField
          ref={passwordRef}
          label={t.auth.password}
          aside={
            <Link to="/forgot-password" className="text-link">
              {t.auth.forgot}
            </Link>
          }
          error={fieldErrors.password}
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setFieldErrors((now) => ({ ...now, password: undefined }));
          }}
          readOnly={busy}
          required
          autoFocus={Boolean(email)}
        />

        {Boolean(error) && (
          <p className="form-error" role="alert">
            {signInMessage(error)}
          </p>
        )}
        {notConfirmed && (
          <p className="field-hint">
            {resend.isSuccess ? (
              t.auth.resent
            ) : (
              <button type="button" className="text-button" disabled={resend.isPending} onClick={() => resend.mutate()}>
                {t.auth.sendAgain}
              </button>
            )}
          </p>
        )}
        {google.isError && (
          <p className="form-error" role="alert">
            {signInMessage(google.error)}
          </p>
        )}

        <Button type="submit" loading={busy} variant="primary" wide>
          {busy ? t.auth.loggingIn : t.auth.logIn}
        </Button>
      </form>
      <GoogleButton label="signin_with" onCredential={(credential) => google.mutate(credential)} />
    </AuthShell>
  );
}

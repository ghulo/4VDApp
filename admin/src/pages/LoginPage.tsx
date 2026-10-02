import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { AuthShell } from '../components/AuthShell';
import { GoogleButton } from '../components/GoogleButton';
import { accountApi } from '../services/api';
import { errorMessage } from '../utils/errors';
import { useFinishSignIn } from '../auth/finishSignIn';
import { OpenTheApp } from '../components/OpenTheApp';

const NOT_CONFIRMED = 'Confirm your email first';

export function LoginPage() {
  const { state, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';
  const { finish, sentToApp } = useFinishSignIn();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const google = useMutation({ mutationFn: accountApi.googleSignIn, onSuccess: finish });
  const resend = useMutation({ mutationFn: () => accountApi.resendVerification(email.trim()) });

  if (state.status === 'signedIn') return <Navigate to={redirectTo} replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate(redirectTo, { replace: true });
    } catch (loginError) {
      setError(errorMessage(loginError));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (sentToApp) {
    return (
      <AuthShell title="You're signed in">
        <OpenTheApp />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Log in" subtitle="Use the email your account was set up with.">
      <form onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span className="field__label">Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="field">
          <span className="field__label">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {error?.startsWith(NOT_CONFIRMED) && (
          <p className="field-hint">
            {resend.isSuccess ? (
              'We sent a new link. Check your inbox.'
            ) : (
              <button type="button" className="text-button" disabled={resend.isPending} onClick={() => resend.mutate()}>
                Send the link again
              </button>
            )}
          </p>
        )}
        {google.isError && (
          <p className="form-error" role="alert">
            {errorMessage(google.error)}
          </p>
        )}

        <button type="submit" className="button button--primary button--wide" disabled={isSubmitting}>
          {isSubmitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <GoogleButton label="signin_with" onCredential={(credential) => google.mutate(credential)} />
      <p className="login__links">
        <Link to="/forgot-password" className="text-link">
          Forgot your password?
        </Link>
      </p>
    </AuthShell>
  );
}

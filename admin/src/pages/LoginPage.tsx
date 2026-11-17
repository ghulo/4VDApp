import { Fingerprint } from '@phosphor-icons/react';
import { browserSupportsWebAuthnAutofill, startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { AuthShell } from '../components/AuthShell';
import { GoogleButton } from '../components/GoogleButton';
import { accountApi, authApi, passkeyApi } from '../services/api';
import { passkeyCancelled, passkeyMessage, usePasskeysHere } from '../auth/passkeys';
import type { LoginResult, SignInStep, TwoStepSetup } from '../services/types';
import { CopyButton, QrCode } from '../components/TwoStepCard';
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
    if (error.code === 'WRONG_CODE') return t.wrongCode;
    if (error.code === 'TOO_MANY_CODES' || error.status === 429) return t.tooManyCodes;
    if (error.code === 'TWO_STEP_EXPIRED') return t.codeExpired;
    if (error.code === 'TWO_STEP_SETUP_NEEDED') return t.setupNeeded;
    if (error.code?.startsWith('PASSKEY_')) return passkeyMessage(error);
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

  // Two-step sign-in: after the password (or Google), the code from the app.
  const [challenge, setChallenge] = useState<string | null>(null);
  // A manager asked them to set two-step sign-in up again: that comes before the session.
  const [setupChallenge, setSetupChallenge] = useState<string | null>(null);
  /** No session yet: show the code step or the setup. */
  const nextStep = (step: SignInStep) => ('setupChallenge' in step ? setSetupChallenge(step.setupChallenge) : setChallenge(step.challenge));
  const afterGoogle = (result: LoginResult | SignInStep) => ('user' in result ? finish(result) : nextStep(result));
  const google = useMutation({ mutationFn: accountApi.googleSignIn, onSuccess: afterGoogle });
  const resend = useMutation({ mutationFn: () => accountApi.resendVerification(email.trim()) });
  // Passkeys: offered in the email field's autofill where the browser can, and always as a key.
  const passkeysHere = usePasskeysHere();
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });
  /** A passkey skips the code step, but not the setup a manager asked for. */
  const afterPasskey = (result: LoginResult | TwoStepSetup) => ('user' in result ? finishRef.current(result) : setSetupChallenge(result.setupChallenge));
  const afterPasskeyRef = useRef(afterPasskey);
  useEffect(() => {
    afterPasskeyRef.current = afterPasskey;
  });
  const [autofillRound, setAutofillRound] = useState(0);
  const passkey = useMutation({
    mutationFn: async () => passkeyApi.signIn(await startAuthentication({ optionsJSON: await passkeyApi.signInOptions() })),
    onSuccess: (result) => afterPasskeyRef.current(result),
    // Listen in the email field again (the key's prompt replaced that one).
    onSettled: () => setAutofillRound((round) => round + 1),
  });
  useEffect(() => {
    if (!passkeysHere || challenge || setupChallenge) return;
    let live = true;
    void (async () => {
      try {
        if (!(await browserSupportsWebAuthnAutofill())) return;
        const optionsJSON = await passkeyApi.signInOptions();
        if (!live) return;
        const result = await passkeyApi.signIn(await startAuthentication({ optionsJSON, useBrowserAutofill: true }));
        if (live) await afterPasskeyRef.current(result);
      } catch (autofillError) {
        if (live && !passkeyCancelled(autofillError)) setError(autofillError);
      }
    })();
    return () => {
      live = false;
      WebAuthnAbortService.cancelCeremony();
    };
  }, [passkeysHere, challenge, setupChallenge, autofillRound]);
  const busy = isSubmitting || google.isPending || passkey.isPending;
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
      const needsCode = await login(trimmed, password);
      rememberEmail(trimmed);
      if (needsCode) {
        setPassword('');
        nextStep(needsCode);
        return;
      }
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

  if (setupChallenge) {
    return (
      <SetupStep
        setupChallenge={setupChallenge}
        onDone={finish}
        onBack={() => {
          setSetupChallenge(null);
          setError(null);
        }}
      />
    );
  }

  if (challenge) {
    return (
      <AuthShell title={t.auth.codeTitle} subtitle={t.auth.codeSubtitle}>
        <CodeStep
          challenge={challenge}
          onDone={finish}
          onBack={() => {
            setChallenge(null);
            setError(null);
          }}
        />
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
            autoComplete="username webauthn"
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
      {passkeysHere && (
        <div className="passkey-sign-in">
          <p className="google-sign-in__divider">{t.common.or}</p>
          <Button variant="secondary" wide icon={Fingerprint} loading={passkey.isPending} disabled={busy && !passkey.isPending} onClick={() => passkey.mutate()}>
            {t.passkeys.signIn}
          </Button>
          {passkey.isError && !passkeyCancelled(passkey.error) && (
            <p className="form-error" role="alert">
              {passkeyMessage(passkey.error)}
            </p>
          )}
        </div>
      )}
      <GoogleButton label="signin_with" onCredential={(credential) => google.mutate(credential)} />
    </AuthShell>
  );
}

/** The second step: a six-digit code from the app, or a backup code. */
function CodeStep({ challenge, onDone, onBack }: { challenge: string; onDone: (result: LoginResult) => Promise<void>; onBack: () => void }) {
  const t = useT();
  const [code, setCode] = useState('');
  const [missing, setMissing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const check = useMutation({
    mutationFn: () => authApi.twoStep(challenge, code.trim()),
    onSuccess: onDone,
    onError: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  });
  const expired = check.error instanceof ApiError && check.error.code === 'TWO_STEP_EXPIRED';
  // Someone with a passkey can use it instead of the code (not on the Counter).
  const passkeysHere = usePasskeysHere();
  const offer = useQuery({
    queryKey: ['auth', 'two-step-passkey', challenge],
    queryFn: async () => (await passkeyApi.twoStepOptions(challenge)) !== null,
    enabled: passkeysHere,
    staleTime: Infinity,
    retry: false,
  });
  const passkeyStep = useMutation({
    mutationFn: async () => {
      const optionsJSON = await passkeyApi.twoStepOptions(challenge);
      if (!optionsJSON) throw new ApiError('No passkey', 401, 'PASSKEY_UNKNOWN');
      return passkeyApi.twoStep(challenge, await startAuthentication({ optionsJSON }));
    },
    onSuccess: onDone,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (code.trim().length < 6) {
      setMissing(true);
      inputRef.current?.focus();
      return;
    }
    check.mutate();
  }

  return (
    <form onSubmit={submit} noValidate aria-busy={check.isPending || undefined}>
      <label className="field">
        <span className="field__label">{t.auth.code}</span>
        <input
          ref={inputRef}
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={20}
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setMissing(false);
          }}
          readOnly={check.isPending}
          aria-invalid={missing || check.isError ? true : undefined}
          aria-describedby={check.isError ? 'login-code-hint login-code-error' : 'login-code-hint'}
          autoFocus
        />
        <span className="field-hint" id="login-code-hint">
          {missing ? t.auth.enterCode : t.auth.codeHint}
        </span>
      </label>
      {check.isError && (
        <p className="form-error" role="alert" id="login-code-error">
          {signInMessage(check.error)}
        </p>
      )}
      <Button type="submit" loading={check.isPending} variant="primary" wide disabled={expired || passkeyStep.isPending}>
        {check.isPending ? t.auth.checkingCode : t.auth.checkCode}
      </Button>
      {offer.data && (
        <div className="code-step__passkey">
          <Button variant="secondary" wide icon={Fingerprint} loading={passkeyStep.isPending} disabled={expired || check.isPending} onClick={() => passkeyStep.mutate()}>
            {t.passkeys.instead}
          </Button>
          {passkeyStep.isError && !passkeyCancelled(passkeyStep.error) && (
            <p className="form-error" role="alert">
              {passkeyMessage(passkeyStep.error)}
            </p>
          )}
        </div>
      )}
      <p className="field-hint">
        <button type="button" className="text-button" onClick={onBack}>
          {t.auth.useOtherAccount}
        </button>
      </p>
    </form>
  );
}

/**
 * A manager asked them to set two-step sign-in up again (lost phone and codes):
 * a new QR code, the first code, then the new backup codes, shown here once
 * and only to them. The session starts with the first code, but the page moves
 * on only once they say the codes are saved.
 */
function SetupStep({ setupChallenge, onDone, onBack }: { setupChallenge: string; onDone: (result: LoginResult) => Promise<void>; onBack: () => void }) {
  const t = useT();
  const [code, setCode] = useState('');
  const [missing, setMissing] = useState(false);
  const [session, setSession] = useState<(LoginResult & { backupCodes: string[] }) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const codesRef = useRef<HTMLUListElement>(null);
  const qr = useQuery({
    queryKey: ['auth', 'two-step-setup', setupChallenge],
    queryFn: () => accountApi.setupStart(setupChallenge),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const confirm = useMutation({
    mutationFn: () => accountApi.setupConfirm(setupChallenge, code.trim()),
    onSuccess: (result) => {
      setCode('');
      setSession(result);
    },
    onError: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  });
  const leaving = useMutation({ mutationFn: (result: LoginResult) => onDone(result) });
  useEffect(() => {
    if (session) codesRef.current?.focus();
  }, [session]);
  const expired = confirm.error instanceof ApiError && confirm.error.code === 'TWO_STEP_EXPIRED';

  if (session) {
    const { backupCodes, ...result } = session;
    return (
      <AuthShell title={t.profile.twoStepCodesTitle} subtitle={t.auth.setupCodesSubtitle}>
        <div className="two-step two-step-setup">
          <ul ref={codesRef} tabIndex={-1} className="two-step__codes" aria-label={t.profile.twoStepCodesTitle}>
            {backupCodes.map((backup) => (
              <li key={backup}>{backup}</li>
            ))}
          </ul>
          <div className="two-step-setup__buttons">
            <CopyButton text={backupCodes.join('\n')} />
            <Button variant="primary" loading={leaving.isPending} onClick={() => leaving.mutate(result)}>
              {t.auth.setupContinue}
            </Button>
          </div>
          {leaving.isError && (
            <p className="form-error" role="alert">
              {signInMessage(leaving.error)}
            </p>
          )}
        </div>
      </AuthShell>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (code.trim().length < 6) {
      setMissing(true);
      inputRef.current?.focus();
      return;
    }
    confirm.mutate();
  }

  return (
    <AuthShell title={t.auth.setupTitle} subtitle={t.auth.setupSubtitle}>
      <form onSubmit={submit} noValidate aria-busy={confirm.isPending || qr.isPending || undefined} className="two-step two-step-setup">
        {qr.isPending ? (
          <p className="field-hint" role="status">
            {t.auth.setupLoading}
          </p>
        ) : qr.isError ? (
          <p className="form-error" role="alert">
            {signInMessage(qr.error)}
          </p>
        ) : (
          <div className="two-step__steps">
            <p className="field-hint">{t.profile.twoStepScan}</p>
            <QrCode url={qr.data.url} label={t.profile.twoStepQrAlt} />
            <p className="field-hint">
              {t.profile.twoStepKey} <span className="two-step__key">{qr.data.secret.replace(/(.{4})/g, '$1 ').trim()}</span>
            </p>
            <label className="field">
              <span className="field__label">{t.auth.code}</span>
              <input
                ref={inputRef}
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={20}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  setMissing(false);
                }}
                readOnly={confirm.isPending}
                aria-invalid={missing || confirm.isError ? true : undefined}
                aria-describedby={confirm.isError ? 'setup-code-hint setup-code-error' : 'setup-code-hint'}
                autoFocus
              />
              <span className="field-hint" id="setup-code-hint">
                {missing ? t.auth.enterCode : t.auth.setupCodeHint}
              </span>
            </label>
            {confirm.isError && (
              <p className="form-error" role="alert" id="setup-code-error">
                {signInMessage(confirm.error)}
              </p>
            )}
          </div>
        )}
        <Button type="submit" loading={confirm.isPending} variant="primary" wide disabled={!qr.isSuccess || expired}>
          {confirm.isPending ? t.auth.checkingCode : t.auth.setupConfirm}
        </Button>
        <p className="field-hint">
          <button type="button" className="text-button" onClick={onBack}>
            {t.auth.useOtherAccount}
          </button>
        </p>
      </form>
    </AuthShell>
  );
}

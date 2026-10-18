import { CashRegister, Desktop, type Icon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { counterOnly } from '../auth/roles';
import { AuthShell } from '../components/AuthShell';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Badge, Button, ButtonLink } from '../components/ui';
import { desktopBridge, useDesktopSetup, useSaveDesktopSetup } from '../desktop/desktopSetup';
import { useT } from '../i18n/useT';

type Step = 'hello' | 'role' | 'printer' | 'start';
const STEPS: Step[] = ['hello', 'role', 'printer', 'start'];
const WELCOME = '/welcome';

/**
 * The Windows app's first run, shown once: welcome, sign in (the dashboard's own
 * sign-in page), what this computer is, a printer check for the counter, and
 * whether 4VD starts with Windows. Each step keeps its own address (?step=), so
 * sign-in can bring the person back to the right one.
 */
export function WelcomePage() {
  const t = useT().desktop.welcome;
  const [params] = useSearchParams();
  const requested = params.get('step') as Step | null;
  const step: Step = requested && STEPS.includes(requested) ? requested : 'hello';
  const { state } = useAuth();
  const setup = useDesktopSetup();

  if (!desktopBridge()) {
    return (
      <AuthShell title={t.hello.title} subtitle={t.notApp}>
        <ButtonLink to="/download" variant="primary">
          {t.notAppAction}
        </ButtonLink>
      </AuthShell>
    );
  }
  // Every step after the welcome needs someone signed in.
  if (step !== 'hello' && state.status === 'signedOut') {
    return <Navigate to="/login" replace state={{ from: `${WELCOME}?step=${step}` }} />;
  }
  if (setup.isPending || state.status === 'loading') {
    return (
      <AuthShell title={t.hello.title}>
        <Loading />
      </AuthShell>
    );
  }
  if (setup.isError) {
    return (
      <AuthShell title={t.hello.title}>
        <ErrorNotice error={setup.error} onRetry={() => setup.refetch()} />
      </AuthShell>
    );
  }
  const counter = setup.data.role === 'counter';
  // The printer check is only for the counter.
  const steps: Array<Step | 'signIn'> = ['hello', 'signIn', 'role', ...(counter ? (['printer'] as const) : []), 'start'];
  if (step === 'printer' && !counter) return <Navigate to={`${WELCOME}?step=start`} replace />;

  const progress = <StepDots steps={steps} current={step} />;
  if (step === 'role') return <RoleStep progress={progress} current={setup.data} />;
  if (step === 'printer') return <PrinterStep progress={progress} />;
  if (step === 'start') return <StartStep progress={progress} current={setup.data} />;
  return <HelloStep progress={progress} />;
}

/** "Step 2 of 5" and a row of dots: done ones filled, the current one long and clay. */
function StepDots({ steps, current }: { steps: Array<Step | 'signIn'>; current: Step }) {
  const t = useT().desktop.welcome;
  const at = steps.indexOf(current);
  return (
    <div className="welcome__progress">
      <ol className="welcome__dots" aria-hidden="true">
        {steps.map((step, index) => (
          <li key={step} className={index === at ? 'is-current' : index < at ? 'is-done' : undefined} />
        ))}
      </ol>
      <p className="welcome__count">
        <span className="visually-hidden">{t.steps}: </span>
        {t.step(at + 1, steps.length)}
      </p>
    </div>
  );
}

function Shell({ progress, title, subtitle, children }: { progress: ReactNode; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <AuthShell title={title} subtitle={subtitle}>
      {/* The steps sit above the title visually, but come after it for a screen reader. */}
      <div className="welcome">
        {progress}
        {children}
      </div>
    </AuthShell>
  );
}

function HelloStep({ progress }: { progress: ReactNode }) {
  const t = useT().desktop.welcome;
  const { state } = useAuth();
  const navigate = useNavigate();
  const next = `${WELCOME}?step=role`;
  return (
    <Shell progress={progress} title={t.hello.title} subtitle={t.hello.subtitle}>
      {state.status === 'signedIn' && <p className="welcome__note">{t.signIn.signedInAs(state.user.name)}</p>}
      <div className="welcome__actions">
        <Button
          variant="primary"
          onClick={() => (state.status === 'signedIn' ? navigate(next) : navigate('/login', { state: { from: next } }))}
        >
          {t.hello.start}
        </Button>
      </div>
    </Shell>
  );
}

const ROLES: Array<{ value: DesktopSetup['role']; icon: Icon }> = [
  { value: 'counter', icon: CashRegister },
  { value: 'office', icon: Desktop },
];

function RoleStep({ progress, current }: { progress: ReactNode; current: DesktopSetup }) {
  const t = useT().desktop.welcome;
  const { state } = useAuth();
  const navigate = useNavigate();
  const save = useSaveDesktopSetup();
  // A first run for someone who only sells starts on the counter.
  const suggested = !current.done && state.status === 'signedIn' && counterOnly(state.user.role) ? 'counter' : current.role;
  const [role, setRole] = useState<DesktopSetup['role']>(suggested);
  const words = { counter: { title: t.role.counter, hint: t.role.counterHint }, office: { title: t.role.office, hint: t.role.officeHint } };

  function next() {
    save.mutate({ role }, { onSuccess: () => navigate(`${WELCOME}?step=${role === 'counter' ? 'printer' : 'start'}`) });
  }

  return (
    <Shell progress={progress} title={t.role.title} subtitle={t.role.subtitle}>
      <fieldset className="choice-cards">
        <legend className="visually-hidden">{t.role.title}</legend>
        {ROLES.map(({ value, icon: RoleIcon }) => (
          <label key={value} className="choice-card">
            <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} />
            <span className="choice-card__icon" aria-hidden="true">
              <RoleIcon size={20} />
            </span>
            <span className="choice-card__text">
              <span className="choice-card__title">{words[value].title}</span>
              <span className="choice-card__hint">{words[value].hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {save.isError && (
        <p className="form-error" role="alert">
          {t.saveFailed}
        </p>
      )}
      <div className="welcome__actions">
        <ButtonLink to={WELCOME} variant="secondary">
          {t.back}
        </ButtonLink>
        <Button variant="primary" loading={save.isPending} onClick={next}>
          {t.next}
        </Button>
      </div>
    </Shell>
  );
}

function PrinterStep({ progress }: { progress: ReactNode }) {
  const t = useT().desktop.welcome;
  const navigate = useNavigate();
  const bridge = desktopBridge();
  const status = useQuery({ queryKey: ['fiscal-status'], queryFn: () => bridge!.fiscalStatus!(), enabled: Boolean(bridge?.fiscalStatus) });
  const ready = Boolean(status.data?.folder && status.data.flink);
  const next = () => navigate(`${WELCOME}?step=start`);

  return (
    <Shell progress={progress} title={t.printer.title} subtitle={t.printer.subtitle}>
      {status.isError ? (
        <ErrorNotice error={status.error} onRetry={() => status.refetch()} />
      ) : (
        <ul className="printer-check" aria-live="polite" aria-busy={status.isFetching}>
          <PrinterRow
            label={t.printer.folder}
            detail={status.data?.path}
            state={status.isFetching ? null : status.data?.folder}
            yes={t.printer.found}
            no={t.printer.missing}
            hint={status.data && t.printer.folderHint(status.data.path)}
          />
          <PrinterRow
            label={t.printer.flink}
            state={status.isFetching ? null : status.data && status.data.folder && status.data.flink}
            yes={t.printer.running}
            no={t.printer.notRunning}
            hint={t.printer.flinkHint}
          />
        </ul>
      )}
      <p className="welcome__note">{ready ? t.printer.ready : t.printer.settingHint}</p>
      <div className="welcome__actions">
        <ButtonLink to={`${WELCOME}?step=role`} variant="secondary">
          {t.back}
        </ButtonLink>
        {ready ? (
          <Button variant="primary" onClick={next}>
            {t.next}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={next}>
              {t.printer.skip}
            </Button>
            <Button variant="primary" loading={status.isFetching} onClick={() => status.refetch()}>
              {t.printer.checkAgain}
            </Button>
          </>
        )}
      </div>
    </Shell>
  );
}

function PrinterRow({
  label,
  detail,
  state,
  yes,
  no,
  hint,
}: {
  label: string;
  detail?: string;
  /** null while checking. */
  state: boolean | null | undefined;
  yes: string;
  no: string;
  hint?: string;
}) {
  const t = useT().desktop.welcome;
  return (
    <li className="printer-check__row">
      <span className="printer-check__label">
        {label}
        {detail && <span className="printer-check__detail">{detail}</span>}
      </span>
      {state == null ? (
        <span className="printer-check__checking">{t.printer.checking}</span>
      ) : (
        <Badge tone={state ? 'ok' : 'danger'}>{state ? yes : no}</Badge>
      )}
      {state === false && hint && <span className="printer-check__hint">{hint}</span>}
    </li>
  );
}

function StartStep({ progress, current }: { progress: ReactNode; current: DesktopSetup }) {
  const words = useT().desktop;
  const t = words.welcome;
  const navigate = useNavigate();
  const save = useSaveDesktopSetup();
  const counter = current.role === 'counter';
  // The counter PC should come back by itself after a power cut; a back-office PC keeps what it had.
  const [openAtLogin, setOpenAtLogin] = useState(current.canOpenAtLogin && (counter || current.openAtLogin));
  useEffect(() => {
    if (!current.canOpenAtLogin) setOpenAtLogin(false);
  }, [current.canOpenAtLogin]);

  function open() {
    save.mutate(
      { openAtLogin, done: true },
      { onSuccess: () => navigate(counter ? '/counter' : '/', { replace: true }) },
    );
  }

  return (
    <Shell progress={progress} title={t.start.title} subtitle={t.start.subtitle}>
      <div className="setting-row welcome__setting">
        <div className="setting-row__text">
          <p className="setting-row__title" id="welcome-start-title">
            {t.start.withWindows}
          </p>
          <p className="setting-row__description" id="welcome-start-hint">
            {current.canOpenAtLogin ? t.start.withWindowsHint : words.thisComputer.withWindowsUnavailable}
          </p>
        </div>
        <div className="setting-row__control">
          <input
            type="checkbox"
            role="switch"
            className="switch"
            aria-labelledby="welcome-start-title"
            aria-describedby="welcome-start-hint"
            checked={openAtLogin}
            disabled={!current.canOpenAtLogin}
            onChange={(event) => setOpenAtLogin(event.target.checked)}
          />
        </div>
      </div>
      {save.isError && (
        <p className="form-error" role="alert">
          {t.saveFailed}
        </p>
      )}
      <div className="welcome__actions">
        <ButtonLink to={`${WELCOME}?step=${counter ? 'printer' : 'role'}`} variant="secondary">
          {t.back}
        </ButtonLink>
        <Button variant="primary" loading={save.isPending} onClick={open}>
          {t.start.open}
        </Button>
      </div>
    </Shell>
  );
}

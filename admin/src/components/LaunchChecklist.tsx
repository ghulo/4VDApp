import { CheckCircle, Circle, Question } from '@phosphor-icons/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { settingsApi } from '../services/api';
import type { LaunchStep } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate } from '../utils/format';
import { ErrorNotice, Loading } from './Feedback';
import { Button, ButtonLink, Card } from './ui';

/** What's left before the real shop starts. Worked out on the server, so it ticks off by itself. */
export function LaunchChecklist() {
  const t = useT();
  const steps = useQuery({ queryKey: ['settings', 'launch-checklist'], queryFn: settingsApi.launchChecklist });

  if (steps.isPending) return <Loading />;
  if (steps.isError) return <ErrorNotice error={steps.error} onRetry={() => steps.refetch()} />;
  const done = steps.data.filter((step) => step.done).length;

  return (
    <Card
      title={t.launch.title}
      description={t.launch.progress(done, steps.data.length)}
      actions={<ProgressRing done={done} total={steps.data.length} />}
      flush
    >
      <ol className="checklist">
        {steps.data.map((step) => {
          const state = step.done === null ? 'yourself' : step.done ? 'done' : 'todo';
          const StateIcon = state === 'done' ? CheckCircle : state === 'todo' ? Circle : Question;
          return (
            <li key={step.key} className={`checklist__row checklist__row--${state}`}>
              <StateIcon size={22} weight={state === 'done' ? 'fill' : 'regular'} className="checklist__icon" aria-hidden="true" />
              <span className="checklist__text">
                <span className="checklist__title">
                  {t.launch.steps[step.key]}
                  <span className="visually-hidden">
                    {' '}
                    ({state === 'done' ? t.launch.done : state === 'todo' ? t.launch.toDo : t.launch.checkYourself})
                  </span>
                </span>
                <span className="checklist__how">{how(step, t)}</span>
              </span>
              {!step.done && <span className="checklist__action">{action(step, t)}</span>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** How far along, as a ring that fills with each step done. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 20;
  const length = 2 * Math.PI * radius;
  const share = total === 0 ? 0 : done / total;
  return (
    <span className="progress-ring" aria-hidden="true">
      <svg width="52" height="52" viewBox="0 0 52 52">
        <circle className="progress-ring__track" cx="26" cy="26" r={radius} />
        <circle
          className="progress-ring__fill"
          cx="26"
          cy="26"
          r={radius}
          strokeDasharray={length}
          strokeDashoffset={length * (1 - share)}
        />
      </svg>
      <span className="progress-ring__label">
        {done}/{total}
      </span>
    </span>
  );
}

/** The one click that moves a step forward, when there is one. */
function action(step: LaunchStep, t: ReturnType<typeof useT>): ReactNode {
  switch (step.key) {
    case 'wiped':
      return (
        <ButtonLink to="/settings/wipe" variant="secondary" size="sm">
          {t.launch.actions.wipe}
        </ButtonLink>
      );
    case 'shopDetails':
      return (
        <ButtonLink to="/settings" variant="secondary" size="sm">
          {t.launch.actions.shop}
        </ButtonLink>
      );
    case 'owner':
      return (
        <ButtonLink to="/people?invite=owner" variant="secondary" size="sm">
          {t.launch.actions.inviteOwner}
        </ButtonLink>
      );
    case 'team':
      return (
        <ButtonLink to="/people?invite=employee" variant="secondary" size="sm">
          {t.launch.actions.inviteTeam}
        </ButtonLink>
      );
    case 'emails':
      return <TestEmail />;
    default:
      return null;
  }
}

/** Sends the developer a real email, so Resend's answer (or complaint) is on screen. */
function TestEmail() {
  const t = useT();
  const test = useMutation({ mutationFn: settingsApi.testEmail });
  return (
    <>
      <Button size="sm" disabled={test.isPending} onClick={() => test.mutate()} loading={test.isPending}>
        {t.launch.actions.testEmail}
      </Button>
      {test.isError && (
        <p className="form-error" role="alert">
          {errorMessage(test.error)}
        </p>
      )}
      {test.data &&
        (test.data.sent ? (
          <p className="form-success" role="status">
            {t.launch.actions.testEmailSent(test.data.to)}
          </p>
        ) : (
          <p className="form-error" role="alert">
            {test.data.reason}
          </p>
        ))}
    </>
  );
}

function how(step: LaunchStep, t: ReturnType<typeof useT>): string {
  const facts = step.facts ?? {};
  switch (step.key) {
    case 'wiped':
      return facts.wipedAt ? t.launch.wipedAt(formatDate(facts.wipedAt)) : t.launch.wipeHow({ products: facts.products ?? 0, sales: facts.sales ?? 0 });
    case 'shopDetails':
      return t.launch.shopDetailsHow;
    case 'owner':
      return t.launch.ownerHow;
    case 'team':
      return facts.employees ? t.launch.teamCount(facts.employees) : t.launch.teamHow;
    case 'reports':
      return t.launch.reportsHow;
    case 'emails':
      return t.launch.emailsHow;
    case 'phoneAlerts':
      return t.launch.phoneAlertsHow;
    case 'backups':
      return facts.lastBackupAt ? t.launch.backupLast(formatDate(facts.lastBackupAt)) : t.launch.backupsHow;
  }
}

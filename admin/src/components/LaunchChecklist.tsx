import { useMutation, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { settingsApi } from '../services/api';
import type { LaunchStep } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate } from '../utils/format';
import { ErrorNotice, Loading } from './Feedback';
import { Badge, Button, ButtonLink, Card, SettingRow } from './ui';

/** Scrolls to a card further down Settings. */
const goTo = (id: string) => () => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });

/** What's left before the real shop starts. Worked out on the server, so it ticks off by itself. */
export function LaunchChecklist() {
  const t = useT();
  const steps = useQuery({ queryKey: ['settings', 'launch-checklist'], queryFn: settingsApi.launchChecklist });

  if (steps.isPending) return <Loading />;
  if (steps.isError) return <ErrorNotice error={steps.error} onRetry={() => steps.refetch()} />;
  const done = steps.data.filter((step) => step.done).length;

  return (
    <Card title={t.launch.title} description={t.launch.progress(done, steps.data.length)}>
      {steps.data.map((step) => (
        <SettingRow key={step.key} title={t.launch.steps[step.key]} description={how(step, t)}>
          {step.done === null ? (
            <Badge tone="neutral">{t.launch.checkYourself}</Badge>
          ) : step.done ? (
            <Badge tone="ok">{t.launch.done}</Badge>
          ) : (
            <Badge tone="warn">{t.launch.toDo}</Badge>
          )}
          {!step.done && action(step, t)}
        </SettingRow>
      ))}
    </Card>
  );
}

/** The one click that moves a step forward, when there is one. */
function action(step: LaunchStep, t: ReturnType<typeof useT>): ReactNode {
  switch (step.key) {
    case 'wiped':
      return <Button onClick={goTo('wipe-data')}>{t.launch.actions.wipe}</Button>;
    case 'shopDetails':
      return <Button onClick={goTo('shop')}>{t.launch.actions.shop}</Button>;
    case 'owner':
      return (
        <ButtonLink to="/users?invite=owner" variant="secondary">
          {t.launch.actions.inviteOwner}
        </ButtonLink>
      );
    case 'team':
      return (
        <ButtonLink to="/users?invite=employee" variant="secondary">
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
      <Button disabled={test.isPending} onClick={() => test.mutate()}>
        {test.isPending ? t.launch.actions.sending : t.launch.actions.testEmail}
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

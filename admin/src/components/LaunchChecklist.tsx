import { useQuery } from '@tanstack/react-query';
import { useT } from '../i18n/useT';
import { settingsApi } from '../services/api';
import type { LaunchStep } from '../services/types';
import { formatDate } from '../utils/format';
import { ErrorNotice, Loading } from './Feedback';
import { Badge, Card, SettingRow } from './ui';

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
        </SettingRow>
      ))}
    </Card>
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
    case 'weeklyEmail':
      return t.launch.weeklyEmailHow;
    case 'emails':
      return t.launch.emailsHow;
    case 'phoneAlerts':
      return t.launch.phoneAlertsHow;
    case 'backups':
      return t.launch.backupsHow;
  }
}

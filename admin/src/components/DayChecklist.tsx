import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { dayApi } from '../services/api';
import type { DayStep, ShopDay } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { carwashLabel } from '../utils/useCarwashes';
import { Badge, Button, ButtonLink, Card, SettingRow } from './ui';

/**
 * The close-the-day steps as the server defines them (the team app's End your
 * shift reads the same list): each drawer counted, each carwash entered, the
 * day's expenses added, requests answered. Each step still to do carries the
 * one click that does it. Nothing is ever locked.
 */
export function DayChecklist({ day, onCountDrawer }: { day: ShopDay; onCountDrawer: (drawer: string) => void }) {
  const t = useT();
  const { role } = useCurrentUser();
  const queryClient = useQueryClient();
  const isToday = day.day === day.today;
  const none = useMutation({
    mutationFn: (value: boolean) => dayApi.setNoExpenses(value, day.day),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash', 'day'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
  const several = day.steps.filter((step) => step.kind === 'carwash').length > 1;
  const placeName = (step: Extract<DayStep, { kind: 'drawer' | 'carwash' }>) =>
    step.kind === 'drawer' && step.place === 'shop' ? t.cash.places.shop : carwashLabel(t.cash.places.carwash, step.name, several);

  return (
    <Card title={t.dayClose.title} description={day.allDone ? t.dayClose.dayDone : t.dayClose.progress(day.done, day.total)}>
      {day.steps.map((step) => {
        switch (step.kind) {
          case 'drawer':
            return (
              <Item
                key={step.key}
                title={t.dayClose.drawer(placeName(step))}
                done={step.done}
                description={step.done ? t.dayClose.countedBy(step.countedBy) : t.dayClose.notCounted}
              >
                {/* Drawers are counted on the day itself. */}
                {isToday && <Button onClick={() => onCountDrawer(step.key)}>{t.dayClose.countDrawer}</Button>}
              </Item>
            );
          case 'carwash':
            return (
              <Item
                key={step.key}
                title={t.dayClose.carwash(placeName(step))}
                done={step.done}
                description={step.done ? t.dayClose.carwashEntered : t.dayClose.carwashMissing}
              >
                {canManage(role) && (
                  <ButtonLink to={`/carwash?carwash=${step.carwashId}&day=${day.day}`} variant="secondary">
                    {t.dayClose.enterCarwash}
                  </ButtonLink>
                )}
              </Item>
            );
          case 'expenses':
            return (
              <Item
                key={step.key}
                title={t.dayClose.expenses}
                done={step.done}
                description={
                  <>
                    {step.count > 0
                      ? t.dayClose.expensesAdded(step.count, formatMoney(step.total))
                      : step.noneMarked
                        ? t.dayClose.expensesNone(step.noneMarkedBy)
                        : t.dayClose.expensesMissing}
                    {none.isError && (
                      <span className="form-error" role="alert">
                        {' '}
                        {errorMessage(none.error)}
                      </span>
                    )}
                  </>
                }
                // Only managers add expenses, so only they say there were none.
                showAction={canManage(role)}
              >
                {step.count === 0 &&
                  (step.noneMarked ? (
                    <Button variant="ghost" disabled={none.isPending} onClick={() => none.mutate(false)}>
                      {t.dayClose.takeBack}
                    </Button>
                  ) : (
                    <Button disabled={none.isPending} onClick={() => none.mutate(true)}>
                      {t.dayClose.noExpenses}
                    </Button>
                  ))}
                {!step.noneMarked && (
                  <ButtonLink to={`/expenses?new=1&day=${day.day}`} variant="secondary">
                    {t.dayClose.addExpense}
                  </ButtonLink>
                )}
              </Item>
            );
          case 'requests':
            return (
              <Item
                key={step.key}
                title={t.dayClose.approvals}
                done={step.done}
                description={step.done ? t.dayClose.approvalsDone : t.dayClose.approvalsWaiting(step.waiting)}
              >
                <ButtonLink to="/inbox" variant="secondary">
                  {t.dayClose.openInbox}
                </ButtonLink>
              </Item>
            );
        }
      })}
    </Card>
  );
}

interface ItemProps {
  title: string;
  done: boolean;
  description: ReactNode;
  /** The fix. Shown while the step is open (or always, with `showAction`). */
  children: ReactNode;
  showAction?: boolean;
}

function Item({ title, done, description, children, showAction }: ItemProps) {
  const t = useT();
  const actionShown = showAction ?? !done;
  return (
    <SettingRow
      title={
        <span className="setting-row__title-line">
          {title}
          {done ? <Badge tone="ok">{t.dayClose.done}</Badge> : <Badge tone="warn">{t.dayClose.toDo}</Badge>}
        </span>
      }
      description={description}
    >
      {actionShown && children}
    </SettingRow>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { dayApi } from '../services/api';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { carwashLabel } from '../utils/useCarwashes';
import { checklistProgress, DAY_CHECKLIST_KEY, useDayChecklist } from '../utils/useDayChecklist';
import { ErrorNotice, Loading } from './Feedback';
import { Badge, Button, ButtonLink, Card, SettingRow } from './ui';

/**
 * The end-of-day checklist: cash counted, carwash entered, today's expenses
 * added, requests answered, each with the one click that fixes it. Not a Z
 * report: it never locks anything.
 */
export function DayChecklist({ onCountDrawer }: { onCountDrawer: () => void }) {
  const t = useT();
  const { role } = useCurrentUser();
  const queryClient = useQueryClient();
  const day = useDayChecklist();
  const none = useMutation({
    mutationFn: dayApi.setNoExpenses,
    onSuccess: (data) => {
      queryClient.setQueryData(DAY_CHECKLIST_KEY, data);
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });

  if (day.isPending) return <Loading />;
  if (day.isError) return <ErrorNotice error={day.error} onRetry={() => day.refetch()} />;
  const { cash, carwash, expenses, approvals } = day.data;
  const progress = checklistProgress(day.data);
  const several = (carwash?.carwashes.length ?? 0) > 1;
  const drawerName = (drawer: (typeof cash.drawers)[number]) =>
    drawer.place === 'shop' ? t.cash.places.shop : carwashLabel(t.cash.places.carwash, drawer.name, several);

  return (
    <Card
      title={t.dayClose.title}
      description={day.data.done ? t.dayClose.allDone : t.dayClose.progress(progress.done, progress.total)}
    >
      <Item
        title={t.dayClose.cash}
        done={cash.done}
        description={
          cash.done
            ? t.dayClose.cashAll
            : t.dayClose.cashMissing(cash.drawers.filter((drawer) => !drawer.countedAt).map(drawerName).join(', '))
        }
      >
        <Button onClick={onCountDrawer}>{t.dayClose.countDrawer}</Button>
      </Item>

      {carwash && (
        <Item
          title={t.dayClose.carwash}
          done={carwash.done}
          description={
            carwash.done
              ? t.dayClose.carwashAll
              : several
                ? t.dayClose.carwashSome(carwash.carwashes.filter((place) => !place.entered).map((place) => place.name).join(', '))
                : t.dayClose.carwashMissing
          }
        >
          <ButtonLink to="/carwash" variant="secondary">
            {t.dayClose.enterCarwash}
          </ButtonLink>
        </Item>
      )}

      <Item
        title={t.dayClose.expenses}
        done={expenses.done}
        description={
          <>
            {expenses.count > 0
              ? t.dayClose.expensesAdded(expenses.count, formatMoney(expenses.total))
              : expenses.noneMarked
                ? t.dayClose.expensesNone(expenses.noneMarkedBy)
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
        {expenses.count === 0 &&
          (expenses.noneMarked ? (
            <Button variant="ghost" disabled={none.isPending} onClick={() => none.mutate(false)}>
              {t.dayClose.takeBack}
            </Button>
          ) : (
            <Button disabled={none.isPending} onClick={() => none.mutate(true)}>
              {t.dayClose.noExpenses}
            </Button>
          ))}
        {!expenses.noneMarked && (
          <ButtonLink to="/expenses" variant="secondary">
            {t.dayClose.addExpense}
          </ButtonLink>
        )}
      </Item>

      <Item
        title={t.dayClose.approvals}
        done={approvals.done}
        description={approvals.done ? t.dayClose.approvalsDone : t.dayClose.approvalsWaiting(approvals.waiting)}
      >
        <ButtonLink to="/inbox" variant="secondary">
          {t.dayClose.openInbox}
        </ButtonLink>
      </Item>
    </Card>
  );
}

interface ItemProps {
  title: string;
  done: boolean;
  description: ReactNode;
  /** The fix. Shown while the item is open (or always, with `showAction`). */
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

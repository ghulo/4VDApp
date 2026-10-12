import {
  AddressBook,
  Archive,
  CalendarX,
  ChartLineUp,
  type Icon,
  MagnifyingGlass,
  Money,
  MoonStars,
  Package,
  Receipt,
  Scan,
  SignOut,
  Tray,
  TrendDown,
  WarningCircle,
} from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useT } from '../i18n/useT';
import { cashApi } from '../services/api';
import type { TodoItem } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ATTENTION_KEY } from '../utils/useAttention';
import { Button, ButtonLink } from './ui';

/** What each kind of item is about, at a glance. */
const ICONS: Record<string, Icon> = {
  sold_out: Package,
  running_out: Package,
  expiring: CalendarX,
  missing_stock: MagnifyingGlass,
  unusual_sale: ChartLineUp,
  below_cost: TrendDown,
  dead_stock: Archive,
  tab_overdue: AddressBook,
  bill_overdue: Receipt,
  bill_due_soon: Receipt,
  cash_difference: Money,
  close_day: MoonStars,
  end_shift: SignOut,
  bill_scan: Scan,
  requests: Tray,
};

/**
 * To do items, most urgent first: an icon for what it's about, a line that
 * names the thing, a line on what to do, and one button that goes straight to
 * fixing it. Where the list is already split by severity, the stamp is left out.
 */
export function TodoList({ items, showSeverity = true }: { items: TodoItem[]; showSeverity?: boolean }) {
  return (
    <ul className="todo-list">
      {items.map((item) => (
        <TodoRow key={item.key} item={item} showSeverity={showSeverity} />
      ))}
    </ul>
  );
}

function TodoRow({ item, showSeverity }: { item: TodoItem; showSeverity: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const check = useMutation({
    mutationFn: () => cashApi.check(item.cashCountId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ATTENTION_KEY });
      queryClient.invalidateQueries({ queryKey: ['cash'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
  const KindIcon = ICONS[item.kind] ?? WarningCircle;
  return (
    <li className={`todo-row todo-row--${item.severity}`}>
      <span className="todo-row__icon" aria-hidden="true">
        <KindIcon size={20} />
      </span>
      <span className="todo-row__text">
        <span className="todo-row__title">
          {showSeverity ? (
            <span className="todo-row__severity">{t.todo.severity[item.severity]}</span>
          ) : (
            <span className="visually-hidden">{t.todo.severity[item.severity]}: </span>
          )}
          {item.title}
        </span>
        <span className="todo-row__detail">{item.detail}</span>
        {check.isError && (
          <span className="form-error" role="alert">
            {errorMessage(check.error)}
          </span>
        )}
      </span>
      <span className="todo-row__actions">
        {item.verb === 'markChecked' ? (
          <>
            <ButtonLink to={item.to} variant="ghost" size="sm" aria-label={`${t.todo.openDay}: ${item.title}`}>
              {t.todo.openDay}
            </ButtonLink>
            <Button size="sm" disabled={check.isPending} aria-label={`${t.todo.verbs.markChecked}: ${item.title}`} onClick={() => check.mutate()}>
              {check.isPending ? t.todo.checking : t.todo.verbs.markChecked}
            </Button>
          </>
        ) : (
          <ButtonLink to={item.to} variant="secondary" size="sm" aria-label={`${t.todo.verbs[item.verb]}: ${item.title}`}>
            {t.todo.verbs[item.verb]}
          </ButtonLink>
        )}
      </span>
    </li>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useT } from '../i18n/useT';
import { cashApi } from '../services/api';
import type { TodoItem } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ATTENTION_KEY } from '../utils/useAttention';
import { Button, ButtonLink } from './ui';

/**
 * To do items, most urgent first: a severity stamp, a line that names the
 * thing, a line on what to do, and one button that goes straight to fixing it.
 */
export function TodoList({ items }: { items: TodoItem[] }) {
  return (
    <ul className="restock-list">
      {items.map((item) => (
        <TodoRow key={item.key} item={item} />
      ))}
    </ul>
  );
}

function TodoRow({ item }: { item: TodoItem }) {
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
  return (
    <li className={`attention__row attention__row--${item.severity}`}>
      <span className="attention__severity">{t.todo.severity[item.severity]}</span>
      <span>
        <span className="restock-list__name">{item.title}</span>
        <span className="attention__detail">{item.detail}</span>
        {check.isError && (
          <span className="form-error" role="alert">
            {errorMessage(check.error)}
          </span>
        )}
      </span>
      <span className="attention__actions">
        {item.verb === 'markChecked' ? (
          <>
            <ButtonLink to={item.to} variant="ghost" size="sm" aria-label={`${t.todo.openDay}: ${item.title}`}>
              {t.todo.openDay}
            </ButtonLink>
            <Button size="sm" disabled={check.isPending} aria-label={`${t.todo.verbs.markChecked}: ${item.title}`} onClick={() => check.mutate()}>
              {t.todo.verbs.markChecked}
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

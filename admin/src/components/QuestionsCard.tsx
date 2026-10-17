import { ChatCircleText, PaperPlaneRight } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { canReadBooks } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { threadsApi } from '../services/api';
import type { ThreadSubject } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateTime } from '../utils/format';
import { ErrorNotice, Loading } from './Feedback';
import { Badge, Button, Field, Section } from './ui';

/**
 * The accountant's questions on a bill, an invoice or an entry. The accountant
 * asks; the people who run the shop see it in To do and answer here. Hidden
 * from everyone else, and from the shop until there is a question.
 */
export function QuestionsCard({ kind, id }: { kind: ThreadSubject; id: number }) {
  const { role } = useCurrentUser();
  if (!canReadBooks(role)) return null;
  return <QuestionsBody kind={kind} id={id} asking={role === 'accountant'} />;
}

function QuestionsBody({ kind, id, asking }: { kind: ThreadSubject; id: number; asking: boolean }) {
  const t = useT();
  const w = t.questions;
  const client = useQueryClient();
  const thread = useQuery({ queryKey: ['thread', kind, id], queryFn: () => threadsApi.get(kind, id) });
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () => threadsApi.post(kind, id, body.trim()),
    onSuccess: (saved) => {
      client.setQueryData(['thread', kind, id], saved);
      void client.invalidateQueries({ queryKey: ['attention'] });
      setBody('');
    },
  });
  if (thread.isPending) return <Loading />;
  if (thread.isError) return <ErrorNotice error={thread.error} onRetry={() => thread.refetch()} />;
  const data = thread.data;
  // Someone who runs the shop answers; with no question yet there is nothing to show them.
  if (!asking && data.notes.length === 0) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (body.trim() !== '') send.mutate();
  };
  const stamp =
    data.status === 'open' ? <Badge tone="warn">{w.open}</Badge> : data.status === 'answered' ? <Badge tone="ok">{w.answered}</Badge> : null;

  return (
    <Section title={w.title} description={w.description} actions={stamp}>
      {data.notes.length > 0 && (
        <ol className="thread">
          {data.notes.map((note) => (
            <li key={note.id} className={note.side === 'answer' ? 'thread__note thread__note--answer' : 'thread__note'}>
              <p className="thread__who">
                {note.side === 'answer' ? w.answer : w.question} · {note.author ?? '–'} · {formatDateTime(note.createdAt)}
              </p>
              <p className="thread__body">{note.body}</p>
            </li>
          ))}
        </ol>
      )}
      <form className="thread-form" onSubmit={submit}>
        <Field label={asking ? w.askLabel : w.replyLabel} hint={asking ? w.askHint : undefined}>
          <textarea name="note" rows={3} maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} />
        </Field>
        {send.isSuccess && body === '' && (
          <p className="visually-hidden" role="status">
            {asking ? w.asked : w.replied}
          </p>
        )}
        {send.isError && (
          <p className="form-error" role="alert">
            {errorMessage(send.error)}
          </p>
        )}
        <Button type="submit" icon={asking ? ChatCircleText : PaperPlaneRight} loading={send.isPending} disabled={body.trim() === ''}>
          {asking ? w.ask : w.reply}
        </Button>
      </form>
    </Section>
  );
}

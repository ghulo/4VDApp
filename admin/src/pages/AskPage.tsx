import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ErrorNotice, Loading } from '../components/Feedback';
import { assistantApi } from '../services/api';
import { errorMessage } from '../utils/errors';
import { Button, Card, PageHeader } from '../components/ui';
import { Sparkle } from '@phosphor-icons/react';
import { useT } from '../i18n/useT';


interface Exchange {
  id: number;
  question: string;
  answer: string;
}

let nextId = 1;

/** Questions about the shop in plain words, answered by the AI from the shop's own numbers. */
export function AskPage() {
  const t = useT();
  const status = useQuery({ queryKey: ['assistant', 'status'], queryFn: assistantApi.status });
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<Exchange[]>([]);

  const ask = useMutation({
    mutationFn: (text: string) => assistantApi.ask(text),
    onSuccess: ({ answer }, text) => {
      setHistory((current) => [{ id: nextId++, question: text, answer }, ...current]);
      setQuestion('');
    },
  });

  function submit(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3 || ask.isPending) return;
    ask.mutate(trimmed);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit(question);
  }

  return (
    <>
      <PageHeader
        title={t.ask.title}
        description={t.ask.description}
      />

      {status.isPending && <Loading />}
      {status.isError && <ErrorNotice error={status.error} onRetry={() => status.refetch()} />}
      {status.data && !status.data.enabled && (
        <div className="notice">
          <p>
            {t.ask.offBefore} <code>backend/.env</code> {t.ask.offAs} <code>GEMINI_API_KEY=…</code>
            {t.ask.offAfter}
          </p>
        </div>
      )}

      {status.data?.enabled && (
        <Card>
          <form className="ask-form" onSubmit={handleSubmit}>
            <label className="field">
              <span className="field__label">{t.ask.question}</span>
              <textarea
                rows={2}
                maxLength={500}
                placeholder={t.ask.placeholder}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  // Enter asks; Shift+Enter makes a new line.
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submit(question);
                  }
                }}
              />
            </label>
            <div className="ask-form__actions">
              <Button type="submit" variant="primary" icon={Sparkle} disabled={question.trim().length < 3 || ask.isPending}>
                {ask.isPending ? t.ask.thinking : t.ask.ask}
              </Button>
              <span className="field-hint">{t.ask.answeredBy(status.data.provider ?? 'AI')}</span>
            </div>
            <div className="ask-examples" aria-label={t.ask.examplesLabel}>
              {t.ask.examples.map((example) => (
                <button key={example} type="button" className="ask-example" disabled={ask.isPending} onClick={() => submit(example)}>
                  {example}
                </button>
              ))}
            </div>
            {ask.isError && (
              <p className="form-error" role="alert">
                {errorMessage(ask.error)}
              </p>
            )}
          </form>
        </Card>
      )}

      {history.length > 0 && (
        <section aria-label={t.ask.answers} aria-live="polite">
          <ol className="ask-history">
            {history.map((exchange) => (
              <li key={exchange.id} className="callout">
                <p className="ask-history__question">{exchange.question}</p>
                <p className="ask-history__answer">{exchange.answer}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

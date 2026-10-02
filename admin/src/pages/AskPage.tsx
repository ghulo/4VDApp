import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ErrorNotice, Loading } from '../components/Feedback';
import { assistantApi } from '../services/api';
import { errorMessage } from '../utils/errors';

const EXAMPLES = [
  'What sold best last month?',
  'Which products should I reorder this week?',
  'How does this month compare with last month?',
  'Who on the team is closest to their target?',
  'What is selling below cost or not at all?',
];

interface Exchange {
  id: number;
  question: string;
  answer: string;
}

let nextId = 1;

/** Questions about the shop in plain words, answered by the AI from the shop's own numbers. */
export function AskPage() {
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
      <header className="page-header">
        <h1 className="page-title">Ask</h1>
        <p className="page-intro">
          Ask about sales, stock, profit or the team in your own words. The answer comes from your shop's numbers. Staff names
          are replaced before anything is sent to the AI service.
        </p>
      </header>

      {status.isPending && <Loading />}
      {status.isError && <ErrorNotice error={status.error} onRetry={() => status.refetch()} />}
      {status.data && !status.data.enabled && (
        <div className="notice">
          <p>
            The AI helpers are switched off. Get a free key from Google AI Studio, add it to <code>backend/.env</code> as{' '}
            <code>GEMINI_API_KEY=…</code>, and restart the backend.
          </p>
        </div>
      )}

      {status.data?.enabled && (
        <section className="panel">
          <form className="ask-form" onSubmit={handleSubmit}>
            <label className="field">
              <span className="field__label">Your question</span>
              <textarea
                rows={2}
                maxLength={500}
                placeholder="e.g. What sold best last month?"
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
              <button type="submit" className="button button--primary" disabled={question.trim().length < 3 || ask.isPending}>
                {ask.isPending ? 'Thinking…' : 'Ask'}
              </button>
              <span className="field-hint">Answered by {status.data.provider}. It can make mistakes, so check anything important.</span>
            </div>
            <div className="ask-examples" aria-label="Example questions">
              {EXAMPLES.map((example) => (
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
        </section>
      )}

      {history.length > 0 && (
        <section className="panel" aria-label="Answers" aria-live="polite">
          <ol className="ask-history">
            {history.map((exchange) => (
              <li key={exchange.id}>
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

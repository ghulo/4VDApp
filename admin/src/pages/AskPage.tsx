import { ArrowUp, ChatsCircle, Plus, Sparkle, Trash } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AnswerChart, AnswerLinks, AnswerTable, AnswerText } from '../components/AnswerParts';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Button, PageHeader } from '../components/ui';
import { useT } from '../i18n/useT';
import { ApiError } from '../services/apiClient';
import { assistantApi } from '../services/api';
import type { AssistantMessage, AssistantThread } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate } from '../utils/format';

const CHATS_KEY = ['assistant', 'chats'] as const;
const chatKey = (id: number) => ['assistant', 'chat', id] as const;

/**
 * Questions about the shop in plain words, answered by the AI from the shop's
 * own numbers, in chats each person keeps: follow-ups remember the chat, and
 * answers can carry a table, a bar chart and links to what they mention.
 */
export function AskPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const chatId = Number(params.get('chat')) || undefined;
  const [question, setQuestion] = useState('');
  const [chatsOpen, setChatsOpen] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  const status = useQuery({ queryKey: ['assistant', 'status'], queryFn: assistantApi.status });
  const enabled = status.data?.enabled === true;
  const chats = useQuery({ queryKey: CHATS_KEY, queryFn: assistantApi.chats, enabled });
  const thread = useQuery({ queryKey: chatKey(chatId ?? 0), queryFn: () => assistantApi.chat(chatId!), enabled: enabled && chatId !== undefined });

  const ask = useMutation({
    mutationFn: (variables: { question: string; chatId?: number }) => assistantApi.ask(variables.question, variables.chatId),
    onSuccess: (data, variables) => {
      queryClient.setQueryData<AssistantThread>(chatKey(data.chat.id), (old) =>
        old ? { chat: data.chat, messages: [...old.messages, ...data.messages] } : data,
      );
      queryClient.invalidateQueries({ queryKey: CHATS_KEY });
      if (variables.chatId === undefined) setParams({ chat: String(data.chat.id) });
      setQuestion('');
    },
  });
  const remove = useMutation({
    mutationFn: assistantApi.deleteChat,
    onSuccess: (_, id) => {
      setConfirming(null);
      queryClient.removeQueries({ queryKey: chatKey(id) });
      queryClient.invalidateQueries({ queryKey: CHATS_KEY });
      if (id === chatId) setParams({});
    },
  });

  // The question being asked in this chat right now, shown before its answer arrives.
  const asking = ask.variables && ask.variables.chatId === chatId && !ask.isSuccess ? ask : null;
  const messages = chatId === undefined ? [] : (thread.data?.messages ?? []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, asking?.isPending, asking?.isError]);

  function open(id?: number) {
    ask.reset();
    setConfirming(null);
    setChatsOpen(false);
    setParams(id === undefined ? {} : { chat: String(id) });
    input.current?.focus();
  }

  function submit(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3 || ask.isPending) return;
    ask.mutate({ question: trimmed, chatId });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit(question);
  }

  const gone = thread.error instanceof ApiError && thread.error.status === 404;

  return (
    <>
      <PageHeader title={t.ask.title} />

      {status.isPending && <Loading />}
      {status.isError && <ErrorNotice error={status.error} onRetry={() => status.refetch()} />}
      {status.data && !enabled && (
        <div className="notice">
          <p>
            {t.ask.offBefore} <code>backend/.env</code> {t.ask.offAs} <code>GEMINI_API_KEY=…</code>
            {t.ask.offAfter}
          </p>
        </div>
      )}

      {enabled && (
        <div className="ask">
          <aside className="ask-rail" aria-label={t.ask.chats}>
            <div className="ask-rail__head">
              <Button variant="primary" icon={Plus} onClick={() => open()} disabled={chatId === undefined && !asking}>
                {t.ask.newChat}
              </Button>
              <Button
                className="ask-rail__toggle"
                variant="secondary"
                icon={ChatsCircle}
                aria-expanded={chatsOpen}
                aria-controls="ask-chats"
                onClick={() => setChatsOpen((value) => !value)}
              >
                {t.ask.showChats}
                {chats.data && chats.data.length > 0 && <span className="ask-rail__count">{chats.data.length}</span>}
              </Button>
            </div>
            <div id="ask-chats" className={`ask-rail__list${chatsOpen ? ' ask-rail__list--open' : ''}`}>
              {chats.isPending && <Loading />}
              {chats.isError && <ErrorNotice error={chats.error} onRetry={() => chats.refetch()} />}
              {chats.data?.length === 0 && <p className="ask-rail__empty">{t.ask.noChats}</p>}
              {chats.data && chats.data.length > 0 && (
                <ul className="ask-chats">
                  {chats.data.map((chat) => (
                    <li key={chat.id} className={`ask-chat${chat.id === chatId ? ' ask-chat--current' : ''}`}>
                      {confirming === chat.id ? (
                        <div className="ask-chat__confirm" role="group" aria-label={t.ask.deleteChat(chat.title)}>
                          <span className="ask-chat__title">{chat.title}</span>
                          <span className="ask-chat__confirm-actions">
                            <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(chat.id)}>
                              {t.ask.confirmDelete}
                            </Button>
                            <Button size="sm" variant="ghost" ref={(button) => button?.focus()} onClick={() => setConfirming(null)}>
                              {t.ask.keep}
                            </Button>
                          </span>
                          {remove.isError && (
                            <span className="form-error" role="alert">
                              {errorMessage(remove.error)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="ask-chat__open"
                            aria-current={chat.id === chatId ? 'true' : undefined}
                            onClick={() => open(chat.id)}
                          >
                            <span className="ask-chat__title">{chat.title}</span>
                            <span className="ask-chat__date">{formatDate(chat.updatedAt)}</span>
                          </button>
                          <Button
                            className="ask-chat__delete"
                            size="sm"
                            variant="ghost"
                            icon={Trash}
                            aria-label={t.ask.deleteChat(chat.title)}
                            onClick={() => {
                              remove.reset();
                              setConfirming(chat.id);
                            }}
                          />
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          <section className="ask-main" aria-label={thread.data?.chat.title ?? t.ask.newChat}>
            <div className="ask-thread" aria-live="polite" aria-busy={ask.isPending}>
              {chatId !== undefined && thread.isPending && <Loading />}
              {gone && <p className="notice">{t.ask.chatGone}</p>}
              {thread.isError && !gone && <ErrorNotice error={thread.error} onRetry={() => thread.refetch()} />}

              {chatId === undefined && !asking && (
                <div className="ask-welcome">
                  <span className="ask-welcome__mark" aria-hidden="true">
                    <Sparkle size={22} weight="fill" />
                  </span>
                  <h2 className="ask-welcome__title">{t.ask.greeting}</h2>
                  <p className="ask-welcome__detail">{t.ask.greetingDetail}</p>
                  <ul className="ask-starters" aria-label={t.ask.examplesLabel}>
                    {t.ask.examples.map((example) => (
                      <li key={example}>
                        <button type="button" className="ask-starter" onClick={() => submit(example)}>
                          {example}
                          <ArrowUp size={14} weight="bold" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {messages.length > 0 && (
                <ol className="ask-messages">
                  {messages.map((message) => (
                    <Message key={message.id} message={message} />
                  ))}
                </ol>
              )}

              {asking && (
                <ol className="ask-messages">
                  <li className="ask-message ask-message--user">
                    <span className="visually-hidden">{t.ask.you}: </span>
                    <p className="ask-bubble">{asking.variables!.question}</p>
                  </li>
                  <li className="ask-message ask-message--assistant">
                    <span className="ask-avatar" aria-hidden="true">
                      <Sparkle size={14} weight="fill" />
                    </span>
                    {asking.isPending ? (
                      <p className="ask-answer ask-thinking" role="status">
                        <span className="ask-thinking__dots" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </span>
                        {t.ask.thinking}
                      </p>
                    ) : (
                      <div className="ask-answer ask-answer--error">
                        <p className="form-error" role="alert">
                          {errorMessage(asking.error)}
                        </p>
                        <Button size="sm" onClick={() => ask.mutate(asking.variables!)}>
                          {t.common.tryAgain}
                        </Button>
                      </div>
                    )}
                  </li>
                </ol>
              )}
              <div ref={end} />
            </div>

            <form className="ask-composer" onSubmit={handleSubmit}>
              <label className="visually-hidden" htmlFor="ask-question">
                {t.ask.question}
              </label>
              <div className="ask-composer__box">
                <textarea
                  id="ask-question"
                  ref={input}
                  rows={2}
                  maxLength={500}
                  placeholder={t.ask.placeholder}
                  value={question}
                  disabled={gone}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter asks; Shift+Enter makes a new line.
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      submit(question);
                    }
                  }}
                />
                <Button
                  type="submit"
                  variant="primary"
                  icon={ArrowUp}
                  aria-label={t.ask.send}
                  disabled={question.trim().length < 3 || ask.isPending || gone}
                />
              </div>
              <p className="field-hint">{t.ask.answeredBy(status.data?.provider ?? 'AI')}</p>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

function Message({ message }: { message: AssistantMessage }) {
  const t = useT();
  if (message.role === 'user') {
    return (
      <li className="ask-message ask-message--user">
        <span className="visually-hidden">{t.ask.you}: </span>
        <p className="ask-bubble">{message.text}</p>
      </li>
    );
  }
  const extras = message.extras;
  return (
    <li className="ask-message ask-message--assistant">
      <span className="ask-avatar" aria-hidden="true">
        <Sparkle size={14} weight="fill" />
      </span>
      <div className="ask-answer">
        <span className="visually-hidden">{t.ask.assistant}: </span>
        <AnswerText text={message.text} />
        {extras?.charts.map((chart, index) => <AnswerChart key={`c${index}`} chart={chart} />)}
        {extras?.tables.map((table, index) => <AnswerTable key={`t${index}`} table={table} />)}
        {extras && extras.links.length > 0 && <AnswerLinks links={extras.links} />}
      </div>
    </li>
  );
}

import { Fingerprint } from '@phosphor-icons/react';
import { startRegistration } from '@simplewebauthn/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { passkeyCancelled, passkeyMessage } from '../auth/passkeys';
import { useT } from '../i18n/useT';
import { passkeyApi } from '../services/api';
import { ApiError } from '../services/apiClient';
import type { Passkey } from '../services/types';
import { formatDate } from '../utils/format';
import { ErrorNotice, Loading, SavedToast } from './Feedback';
import { Badge, Button, Card, Field, PasswordField, RemoveButton, SettingRow } from './ui';

const MAX_PASSKEYS = 10;
const KEY = ['me', 'passkeys'];

/**
 * Passkeys on one's own account: sign-in with the device's fingerprint, face
 * or PIN (Windows Hello, Touch ID, Face ID, Android). Adding one asks for the
 * two-step code or the password first, so a borrowed open session can't add
 * its own way in. Not shown on the Counter (see usePasskeysHere).
 */
export function PasskeyCard() {
  const t = useT();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: KEY, queryFn: passkeyApi.list });
  const [confirming, setConfirming] = useState(false);
  const [proof, setProof] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });

  const add = useMutation({
    mutationFn: async (confirmWith: 'code' | 'password' | null) => {
      const optionsJSON = await passkeyApi.addOptions(confirmWith === 'code' ? { code: proof.trim() } : confirmWith === 'password' ? { password: proof } : {});
      // Past the check: the field has done its job, and a retry needs it typed again.
      setProof('');
      return passkeyApi.add(await startRegistration({ optionsJSON }));
    },
    onSuccess: () => {
      setConfirming(false);
      setDone(t.passkeys.added);
      refresh();
      rootRef.current?.focus();
    },
  });

  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorNotice error={list.error} onRetry={() => list.refetch()} />;
  const { passkeys, confirmWith } = list.data;
  const full = passkeys.length >= MAX_PASSKEYS;
  // A closed device prompt is not an error worth a sentence.
  const addError = add.isError && !passkeyCancelled(add.error) ? passkeyMessage(add.error) : null;
  // A wrong password or code shows under its field; anything else in the card's foot.
  const proofWrong = add.error instanceof ApiError && ['WRONG_PASSWORD', 'WRONG_CODE'].includes(add.error.code ?? '');

  const start = () => {
    setDone(null);
    add.reset();
    if (confirmWith) setConfirming(true);
    else add.mutate(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate(confirmWith);
  };

  if (confirming && confirmWith) {
    return (
      <div ref={rootRef} tabIndex={-1} className="passkeys">
        <form onSubmit={submit}>
          <Card
            title={t.passkeys.title}
            description={confirmWith === 'code' ? t.passkeys.confirmCode : t.passkeys.confirmPassword}
            footer={
              <>
                {addError && !proofWrong ? (
                  <span className="form-error" role="alert">
                    {addError}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setConfirming(false);
                    setProof('');
                    add.reset();
                    // The field goes away: keep focus on the card.
                    requestAnimationFrame(() => rootRef.current?.focus());
                  }}
                >
                  {t.profile.cancel}
                </Button>
                <Button type="submit" variant="primary" icon={Fingerprint} loading={add.isPending}>
                  {add.isPending ? t.passkeys.waiting : t.passkeys.add}
                </Button>
              </>
            }
          >
            {confirmWith === 'code' ? (
              <Field label={t.auth.code} error={proofWrong ? addError ?? undefined : undefined}>
                <input
                  name="code"
                  className="code-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  spellCheck={false}
                  maxLength={20}
                  value={proof}
                  onChange={(event) => setProof(event.target.value)}
                  readOnly={add.isPending}
                  autoFocus
                />
              </Field>
            ) : (
              <PasswordField
                name="password"
                label={t.auth.password}
                autoComplete="current-password"
                value={proof}
                onChange={(event) => setProof(event.target.value)}
                readOnly={add.isPending}
                error={proofWrong ? addError ?? undefined : undefined}
                autoFocus
              />
            )}
          </Card>
        </form>
      </div>
    );
  }

  return (
    <div ref={rootRef} tabIndex={-1} className="passkeys">
      <Card
        title={t.passkeys.title}
        description={t.passkeys.intro}
        footer={
          <>
            {addError ? (
              <span className="form-error" role="alert">
                {addError}
              </span>
            ) : done ? (
              <SavedToast message={done} />
            ) : full ? (
              <span className="field-hint">{t.passkeys.full}</span>
            ) : null}
            <Button variant={passkeys.length ? 'secondary' : 'primary'} icon={Fingerprint} loading={add.isPending} disabled={full} onClick={start}>
              {add.isPending ? t.passkeys.waiting : t.passkeys.add}
            </Button>
          </>
        }
      >
        {passkeys.length === 0 ? (
          <p className="field-hint">{t.passkeys.none}</p>
        ) : (
          <ul className="passkeys__list" aria-label={t.passkeys.title}>
            {passkeys.map((passkey) => (
              <li key={passkey.id}>
                <PasskeyRow
                  passkey={passkey}
                  onChanged={(message) => {
                    setDone(message);
                    refresh();
                    // A removed row takes its keys with it: keep focus on the card.
                    if (message) rootRef.current?.focus();
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PasskeyRow({ passkey, onChanged }: { passkey: Passkey; onChanged: (message: string | null) => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(passkey.name);
  const renameKey = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    // Back on the Rename key once the field closes, so keyboard focus isn't lost.
    if (wasEditing.current && !editing) renameKey.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const rename = useMutation({
    mutationFn: () => passkeyApi.rename(passkey.id, name.trim()),
    onSuccess: () => {
      setEditing(false);
      onChanged(null);
    },
  });
  const remove = useMutation({ mutationFn: () => passkeyApi.remove(passkey.id), onSuccess: () => onChanged(t.passkeys.removed) });

  const meta = `${t.passkeys.addedOn(formatDate(passkey.createdAt))} · ${passkey.lastUsedAt ? t.passkeys.lastUsed(formatDate(passkey.lastUsedAt)) : t.passkeys.neverUsed}`;

  if (editing) {
    return (
      <form
        className="passkeys__rename"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) rename.mutate();
        }}
      >
        <Field label={t.passkeys.name} error={rename.isError ? passkeyMessage(rename.error) : undefined}>
          <input name="passkey-name" autoComplete="off" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} readOnly={rename.isPending} autoFocus />
        </Field>
        <div className="passkeys__rename-keys">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setName(passkey.name);
              setEditing(false);
              rename.reset();
            }}
          >
            {t.profile.cancel}
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={rename.isPending} disabled={!name.trim()}>
            {t.passkeys.save}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <SettingRow
      title={
        <span className="passkeys__name">
          <Fingerprint aria-hidden="true" className="passkeys__icon" />
          {passkey.name}
          {passkey.synced && <Badge tone="info">{t.passkeys.synced}</Badge>}
        </span>
      }
      description={
        <>
          {meta}
          {passkey.synced && <span className="passkeys__synced-hint"> {t.passkeys.syncedHint}</span>}
          {remove.isError && (
            <span className="form-error" role="alert">
              {' '}
              {passkeyMessage(remove.error)}
            </span>
          )}
        </>
      }
    >
      <Button ref={renameKey} variant="ghost" size="sm" aria-label={t.passkeys.renameLabel(passkey.name)} onClick={() => setEditing(true)}>
        {t.passkeys.rename}
      </Button>
      <RemoveButton confirm={t.passkeys.yesRemove} onConfirm={() => remove.mutate()} pending={remove.isPending} aria-label={t.passkeys.removeLabel(passkey.name)}>
        {t.passkeys.remove}
      </RemoveButton>
    </SettingRow>
  );
}

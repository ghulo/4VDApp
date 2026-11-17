import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/useT';
import { twoStepApi } from '../services/api';
import { errorMessage } from '../utils/errors';
import { ErrorNotice, Loading, SavedToast } from './Feedback';
import { Button, Card, Field } from './ui';

type Mode = { kind: 'idle' } | { kind: 'setup'; secret: string; url: string } | { kind: 'codes'; codes: string[] } | { kind: 'confirm'; action: 'off' | 'renew' };

/**
 * Two-step sign-in on one's own account: scan a QR code, confirm with the
 * first code, keep the backup codes. Turning it off or renewing the backup
 * codes asks for a code first, so a borrowed open session can't do it.
 */
export function TwoStepCard() {
  const t = useT();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['me', 'two-step'], queryFn: twoStepApi.status });
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [code, setCode] = useState('');
  const [done, setDone] = useState<string | null>(null);
  // The keys that opened a step disappear with it: keep keyboard and screen-reader focus on the card.
  const rootRef = useRef<HTMLDivElement>(null);
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false;
      return;
    }
    if (mode.kind === 'idle' || mode.kind === 'codes') rootRef.current?.focus();
  }, [mode.kind]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['me', 'two-step'] });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  };
  const reset = () => {
    setCode('');
    start.reset();
    confirm.reset();
    act.reset();
  };

  const start = useMutation({
    mutationFn: twoStepApi.start,
    onSuccess: (data) => {
      setDone(null);
      setMode({ kind: 'setup', ...data });
    },
  });
  const confirm = useMutation({
    mutationFn: () => twoStepApi.confirm(code.trim()),
    onSuccess: (data) => {
      setCode('');
      setMode({ kind: 'codes', codes: data.backupCodes });
      refresh();
    },
  });
  const act = useMutation({
    mutationFn: async (action: 'off' | 'renew') => (action === 'off' ? (await twoStepApi.turnOff(code.trim()), null) : twoStepApi.newBackupCodes(code.trim())),
    onSuccess: (data) => {
      setCode('');
      if (data) setMode({ kind: 'codes', codes: data.backupCodes });
      else {
        setMode({ kind: 'idle' });
        setDone(t.profile.twoStepIsOff);
      }
      refresh();
    },
  });

  if (status.isPending) return <Loading />;
  if (status.isError) return <ErrorNotice error={status.error} onRetry={() => status.refetch()} />;
  const { on, backupCodesLeft } = status.data;
  // Code mistakes show under the field; anything else in the card's foot.
  const codeError = confirm.error ?? act.error;
  const failure = start.error;
  const wrap = (content: ReactNode) => (
    <div ref={rootRef} tabIndex={-1} className="two-step">
      {content}
    </div>
  );

  const codeField = (id: string) => (
    <Field label={t.auth.code} hint={t.profile.twoStepCodeToConfirm} error={codeError ? errorMessage(codeError) : undefined}>
      <input
        id={id}
        className="code-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        spellCheck={false}
        maxLength={20}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        autoFocus
      />
    </Field>
  );

  if (mode.kind === 'setup') {
    const submit = (event: FormEvent) => {
      event.preventDefault();
      confirm.mutate();
    };
    return wrap(
      <form onSubmit={submit}>
        <Card
          title={t.profile.twoStep}
          description={t.profile.twoStepScan}
          footer={
            <>
              {failure ? <Failure error={failure} /> : null}
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  reset();
                  setMode({ kind: 'idle' });
                }}
              >
                {t.profile.cancel}
              </Button>
              <Button type="submit" variant="primary" loading={confirm.isPending}>
                {t.profile.twoStepConfirm}
              </Button>
            </>
          }
        >
          <div className="two-step__steps">
            <QrCode url={mode.url} label={t.profile.twoStepQrAlt} />
            <p className="field-hint">
              {t.profile.twoStepKey} <span className="two-step__key">{mode.secret.replace(/(.{4})/g, '$1 ').trim()}</span>
            </p>
            {codeField('two-step-setup-code')}
          </div>
        </Card>
      </form>,
    );
  }

  if (mode.kind === 'codes') {
    return wrap(
      <Card
        title={t.profile.twoStepCodesTitle}
        description={t.profile.twoStepCodesHint}
        footer={
          <>
            <CopyButton text={mode.codes.join('\n')} />
            <Button
              variant="primary"
              onClick={() => {
                setMode({ kind: 'idle' });
                setDone(t.profile.twoStepIsOn);
              }}
            >
              {t.profile.twoStepSaved}
            </Button>
          </>
        }
      >
        <ul className="two-step__codes" aria-label={t.profile.twoStepCodesTitle}>
          {mode.codes.map((backup) => (
            <li key={backup}>{backup}</li>
          ))}
        </ul>
      </Card>,
    );
  }

  if (mode.kind === 'confirm') {
    const submit = (event: FormEvent) => {
      event.preventDefault();
      act.mutate(mode.action);
    };
    return wrap(
      <form onSubmit={submit}>
        <Card
          title={t.profile.twoStep}
          description={t.profile.twoStepOn(backupCodesLeft)}
          footer={
            <>
              {failure ? <Failure error={failure} /> : null}
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  reset();
                  setMode({ kind: 'idle' });
                }}
              >
                {t.profile.cancel}
              </Button>
              <Button type="submit" variant={mode.action === 'off' ? 'danger' : 'primary'} loading={act.isPending}>
                {mode.action === 'off' ? t.profile.twoStepTurnOff : t.profile.twoStepNewCodes}
              </Button>
            </>
          }
        >
          {codeField('two-step-confirm-code')}
        </Card>
      </form>,
    );
  }

  return wrap(
    <Card
      title={t.profile.twoStep}
      description={on ? t.profile.twoStepOn(backupCodesLeft) : t.profile.twoStepOff}
      footer={
        <>
          {failure ? <Failure error={failure} /> : done ? <SavedToast message={done} /> : null}
          {on ? (
            <>
              <Button variant="danger-text" onClick={() => setMode({ kind: 'confirm', action: 'off' })}>
                {t.profile.twoStepTurnOff}
              </Button>
              <Button onClick={() => setMode({ kind: 'confirm', action: 'renew' })}>{t.profile.twoStepNewCodes}</Button>
            </>
          ) : (
            <Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>
              {t.profile.twoStepTurnOn}
            </Button>
          )}
        </>
      }
    />,
  );
}

function Failure({ error }: { error: unknown }) {
  return (
    <span className="form-error" role="alert">
      {errorMessage(error)}
    </span>
  );
}

/** The otpauth link as a QR code, black on white so phone cameras read it in dark mode too. */
export function QrCode({ url, label }: { url: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    QRCode.toDataURL(url, { margin: 1, width: 352, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then((data) => current && setSrc(data))
      .catch(() => current && setSrc(null));
    return () => {
      current = false;
    };
  }, [url]);
  return src ? <img className="two-step__qr" src={src} width={176} height={176} alt={label} /> : <div className="two-step__qr" aria-hidden="true" />;
}

export function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
    >
      <span aria-live="polite">{copied ? t.profile.twoStepCopied : t.profile.twoStepCopy}</span>
    </Button>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { useT } from '../i18n/useT';
import { billEmailsApi } from '../services/api';
import { mediaSrc } from '../services/apiClient';
import type { BillEmailSettings, OpenBillEmail } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateTime } from '../utils/format';
import { ErrorNotice, Loading, SavedToast } from './Feedback';
import { Button, buttonClass, Card, SettingRow, ShimmerText } from './ui';

/** Emailed files with no scan yet: over the day's reads, or not readable. Shown above the bills; hidden when there are none. */
export function EmailedBills() {
  const t = useT();
  const open = useQuery({ queryKey: ['bill-emails'], queryFn: billEmailsApi.open });
  const settings = useQuery({ queryKey: ['bill-emails', 'settings'], queryFn: billEmailsApi.settings, enabled: (open.data?.length ?? 0) > 0 });
  if (!open.data?.length) return null;
  return (
    <Card title={t.billEmail.openTitle} description={t.billEmail.openHint} className="scan-waiting">
      <ul className="scan-waiting__list">
        {open.data.map((mail) => (
          <EmailedRow key={mail.id} mail={mail} reads={settings.data?.dailyReads ?? null} />
        ))}
      </ul>
    </Card>
  );
}

function EmailedRow({ mail, reads }: { mail: OpenBillEmail; reads: number | null }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['bill-emails'] });
    void queryClient.invalidateQueries({ queryKey: ['bill-scans'] });
    void queryClient.invalidateQueries({ queryKey: ['attention'] });
  };
  const read = useMutation({
    mutationFn: () => billEmailsApi.readNow(mail.id),
    onSuccess: (result) => {
      refresh();
      if (result.scanId !== null) navigate(`/bills/scans/${result.scanId}`);
    },
  });
  const remove = useMutation({ mutationFn: () => billEmailsApi.remove(mail.id), onSuccess: refresh });
  const name = mail.fileName ?? t.billEmail.unnamed;
  const state =
    mail.status === 'failed' ? (mail.error ? `${t.billEmail.failed}: ${mail.error}` : t.billEmail.failed) : reads !== null ? t.billEmail.waiting(reads) : null;
  const error = read.error ?? remove.error;
  const busy = read.isPending || remove.isPending;

  return (
    <li className="scan-waiting__row bill-email__row">
      <span>
        <strong>{name}</strong>
        <span className="scan-waiting__meta">{[t.billEmail.from(mail.sender, formatDateTime(mail.receivedAt)), state].filter(Boolean).join(' · ')}</span>
        {read.isPending && (
          <span className="scan-waiting__meta" role="status">
            <ShimmerText>{t.scans.reading}</ShimmerText>
          </span>
        )}
        {error && (
          <span className="form-error" role="alert">
            {errorMessage(error)}
          </span>
        )}
      </span>
      <span className="bill-email__actions">
        {mail.fileUrl && (
          <a className={buttonClass({ variant: 'ghost', size: 'sm' })} href={mediaSrc(mail.fileUrl) ?? undefined} target="_blank" rel="noreferrer" aria-label={t.billEmail.fileLabel(name)}>
            {t.billEmail.file}
          </a>
        )}
        <Button size="sm" variant="ghost" onClick={() => remove.mutate()} disabled={busy} loading={remove.isPending} aria-label={t.billEmail.removeLabel(mail.sender)}>
          {t.billEmail.remove}
        </Button>
        <Button size="sm" variant="primary" onClick={() => read.mutate()} disabled={busy} loading={read.isPending} aria-label={t.billEmail.readNowLabel(mail.sender)}>
          {t.billEmail.readNow}
        </Button>
      </span>
    </li>
  );
}

/** Settings, Bills by email: the address to forward to, and who besides the team may send. */
export function BillEmailPanel() {
  const settings = useQuery({ queryKey: ['bill-emails', 'settings'], queryFn: billEmailsApi.settings });
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorNotice error={settings.error} onRetry={() => settings.refetch()} />;
  return <BillEmailForm initial={settings.data} />;
}

function BillEmailForm({ initial }: { initial: BillEmailSettings }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [text, setText] = useState(initial.senders.join('\n'));
  const [saved, setSaved] = useState(false);
  const senders = text
    .split(/[\n,;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const hasChanges = JSON.stringify(senders) !== JSON.stringify(initial.senders);
  const save = useMutation({
    mutationFn: () => billEmailsApi.saveSenders(senders),
    onSuccess: (updated) => {
      queryClient.setQueryData(['bill-emails', 'settings'], updated);
      setText(updated.senders.join('\n'));
      setSaved(true);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit}>
      <Card
        title={t.billEmail.title}
        description={t.billEmail.description}
        footer={
          <>
            {save.isError && (
              <span className="form-error" role="alert">
                {errorMessage(save.error)}
              </span>
            )}
            {saved && !save.isError && <SavedToast message={t.billEmail.saved} />}
            <Button type="submit" variant={hasChanges ? 'primary' : 'secondary'} disabled={!hasChanges || save.isPending} loading={save.isPending}>
              {t.settings.saveChanges}
            </Button>
          </>
        }
      >
        <SettingRow title={t.billEmail.address} description={t.billEmail.addressHint}>
          <strong className="bill-email__address">{initial.address}</strong>
        </SettingRow>
        <SettingRow title={t.billEmail.team} description={t.billEmail.teamHint(initial.dailyReads)}>
          {null}
        </SettingRow>
        <SettingRow title={t.billEmail.senders} description={t.billEmail.sendersHint}>
          <textarea
            aria-label={t.billEmail.senders}
            rows={4}
            spellCheck={false}
            autoCapitalize="off"
            placeholder="office@supplier.com&#10;@supplier.com"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setSaved(false);
            }}
          />
        </SettingRow>
      </Card>
    </form>
  );
}

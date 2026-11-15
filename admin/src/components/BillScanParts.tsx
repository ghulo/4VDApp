import { FilePdf, Image, X } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useT } from '../i18n/useT';
import { billScansApi } from '../services/api';
import { errorMessage } from '../utils/errors';
import { formatDateTime, formatMoney } from '../utils/format';
import { shrinkPhoto } from '../utils/shrinkPhoto';
import { Button, ButtonLink, Card, Field, SwapText } from './ui';

/** How long "Ready to check" shows before the check page opens. */
const READY_MS = 600;

/** Matches the server's MAX_SCAN_PAGES and per-page limit. */
const MAX_PAGES = 6;
const MAX_BYTES = 10 * 1024 * 1024;

/** A file as base64 without the data: prefix, the way the API takes it. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Photos shrink like any bill photo; a PDF goes up whole. */
export async function toPage(file: File) {
  if (file.type === 'application/pdf') return { mime: file.type, data: await toBase64(file) };
  const blob = await shrinkPhoto(file);
  return { mime: blob.type || file.type, data: await toBase64(blob) };
}

/** Pick the photos or PDF of a supplier bill and send them to be read; opens the check page after. */
/** `openCheck` goes on to the check page; the counter staff send it to the owner instead (it shows under their requests). */
export function ScanBillForm({ onDone, openCheck = true }: { onDone: () => void; openCheck?: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const readyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(readyTimer.current), []);
  const scan = useMutation({
    mutationFn: async () => billScansApi.scan(await Promise.all(files.map(toPage))),
    onSuccess: (receipt) => {
      for (const key of ['bill-scans', 'attention']) queryClient.invalidateQueries({ queryKey: [key] });
      // Counter staff send it on to the owner: nothing for them to check.
      if (!openCheck) return onDone();
      // "Reading the bill…" turns into "Ready to check" for a moment, then the check opens.
      setReady(true);
      readyTimer.current = window.setTimeout(() => {
        onDone();
        navigate(`/bills/scans/${receipt.id}`);
      }, READY_MS);
    },
  });

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])];
    event.target.value = '';
    const tooBig = picked.find((file) => file.size > MAX_BYTES && file.type === 'application/pdf');
    const next = [...files, ...picked.filter((file) => file !== tooBig)];
    setProblem(tooBig ? t.scans.tooBig(tooBig.name) : next.length > MAX_PAGES ? t.scans.tooMany : null);
    setFiles(next.slice(0, MAX_PAGES));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    scan.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <Field label={t.scans.pickFiles} hint={t.scans.pickHint}>
        <input
          type="file"
          accept="image/*,application/pdf"
          multiple
          disabled={scan.isPending || files.length >= MAX_PAGES}
          onChange={pick}
        />
      </Field>
      {files.length > 0 && (
        <ul className="scan-files">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              {file.type === 'application/pdf' ? <FilePdf aria-hidden="true" /> : <Image aria-hidden="true" />}
              <span className="scan-files__name">{file.name}</span>
              <Button
                size="sm"
                variant="ghost"
                icon={X}
                aria-label={t.scans.remove(file.name)}
                disabled={scan.isPending}
                onClick={() => setFiles((current) => current.filter((_, at) => at !== index))}
              />
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}
      {scan.isError && (
        <p className="form-error" role="alert">
          {errorMessage(scan.error)}
        </p>
      )}
      {(scan.isPending || ready) && (
        <p className="field-hint" role="status">
          <SwapText shimmer={!ready}>{ready ? t.scans.ready : t.scans.reading}</SwapText>
        </p>
      )}
      <div className="form-actions">
        <Button variant="ghost" onClick={onDone} disabled={ready}>
          {t.common.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={files.length === 0 || scan.isPending || ready}>
          {t.scans.read}
        </Button>
      </div>
    </form>
  );
}

/** Scans nobody has checked yet. Shown above the bills; hidden when there are none. */
export function WaitingScans() {
  const t = useT();
  const waiting = useQuery({ queryKey: ['bill-scans'], queryFn: billScansApi.waiting });
  if (!waiting.data?.length) return null;
  return (
    <Card title={t.scans.waitingTitle} description={t.scans.waitingHint} className="scan-waiting">
      <ul className="scan-waiting__list">
        {waiting.data.map((scan) => {
          const supplier = scan.supplierName ?? t.scans.unknownSupplier;
          return (
            <li key={scan.id} className="scan-waiting__row">
              <span>
                <strong>{supplier}</strong>
                <span className="scan-waiting__meta">
                  {[scan.number && t.bills.numbered(scan.number), t.scans.waitingRow({ by: scan.scannedBy, emailFrom: scan.emailFrom, when: formatDateTime(scan.scannedAt) })].filter(Boolean).join(' · ')}
                </span>
              </span>
              {scan.amount !== null && <span className="scan-waiting__amount">{formatMoney(scan.amount)}</span>}
              <ButtonLink to={`/bills/scans/${scan.id}`} size="sm" variant="primary" aria-label={t.scans.checkLabel(supplier)}>
                {t.scans.check}
              </ButtonLink>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

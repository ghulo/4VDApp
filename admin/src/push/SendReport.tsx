import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useT } from '../i18n/useT';
import { fullReportsApi } from '../services/api';
import type { ReportKind } from '../services/types';
import { errorMessage } from '../utils/errors';
import { type PushHere, turnOnHere } from './browserPush';

/** Sends a report to yourself now, turning alerts on in this browser first if they're off. */
export function useSendReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (kind: ReportKind): Promise<PushHere> => {
      // A failure here shouldn't stop the report: it still lands in the alerts list.
      const here = await turnOnHere().catch((): PushHere => 'declined');
      await fullReportsApi.sendTest(kind);
      return here;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['push-settings'] });
    },
  });
}

/** What happened after sending, including why this computer won't pop it up. Inline, so it fits in a sentence slot. */
export function SendReportResult({ send }: { send: ReturnType<typeof useSendReport> }) {
  const t = useT();
  if (send.isError) {
    return (
      <span className="form-error" role="alert">
        {errorMessage(send.error)}
      </span>
    );
  }
  if (!send.isSuccess) return null;
  const here = send.data;
  return (
    <>
      <span className="form-success" role="status">
        {here === 'on' ? t.fullReport.sent : t.fullReport.sentNotHere}
      </span>{' '}
      {here !== 'on' && (
        <span className="form-error" role="alert">
          {here === 'blocked' ? t.push.blocked : here === 'unsupported' ? t.push.unsupported : here === 'noKeys' ? t.push.noKeys : t.push.declined}
        </span>
      )}
    </>
  );
}

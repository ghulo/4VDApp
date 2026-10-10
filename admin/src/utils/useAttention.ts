import { useQuery } from '@tanstack/react-query';
import { attentionApi } from '../services/api';

export const ATTENTION_KEY = ['attention'] as const;

/**
 * The one list of what needs you (DESIGN.md 3.3), shared by the menu badge,
 * the Inbox and the Overview, so they always show the same number. Checked
 * again every minute: To do items clear themselves when their cause is gone.
 */
export function useAttention() {
  return useQuery({ queryKey: ATTENTION_KEY, queryFn: attentionApi.get, refetchInterval: 60_000 });
}

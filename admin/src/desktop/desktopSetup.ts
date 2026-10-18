import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/** The Windows app's bridge, when this page runs inside a version that keeps a setup (0.4.0 and later). */
export function desktopBridge() {
  const bridge = typeof window === 'undefined' ? undefined : window.fourvdDesktop;
  return bridge?.getSetup && bridge.saveSetup ? bridge : undefined;
}

const KEY = ['desktop-setup'];

/** What this computer is for (the counter or the back office) and whether 4VD starts with Windows. */
export function useDesktopSetup() {
  const bridge = desktopBridge();
  return useQuery({ queryKey: KEY, queryFn: () => bridge!.getSetup!(), enabled: Boolean(bridge), staleTime: Infinity });
}

export function useSaveDesktopSetup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: Partial<Pick<DesktopSetup, 'done' | 'role' | 'openAtLogin'>>) => desktopBridge()!.saveSetup!(change),
    onSuccess: (setup) => queryClient.setQueryData(KEY, setup),
  });
}

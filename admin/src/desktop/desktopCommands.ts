import { useEffect, useRef } from 'react';

/** What the Windows app's ☰ menu asks of the page (0.6.0 and later; desktop/src/preload.js). */
export type DesktopCommand = { type: 'go'; path: string } | { type: 'search' } | { type: 'signOut' };

const EVENT = '4vd:desktop-command';

/** A path inside this dashboard ("/counter"), not another site ("//evil.example") or an address. */
const ownPath = (path: unknown): path is string => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');

/**
 * Starts listening to the app's menu, once, beside the router. "Go" moves through the router, so a form with typed
 * work asks first; Search and Log out go to whichever screen is showing (useDesktopCommand).
 */
export function listenForDesktopCommands(navigate: (path: string) => void): void {
  const bridge = typeof window === 'undefined' ? undefined : window.fourvdDesktop;
  if (!bridge?.onCommand) return;
  bridge.onCommand((command) => {
    if (command?.type === 'go' && ownPath(command.path)) navigate(command.path);
    else if (command?.type === 'search' || command?.type === 'signOut') window.dispatchEvent(new CustomEvent(EVENT, { detail: command.type }));
  });
}

/** The showing screen's answer to the menu's Search or Log out. */
export function useDesktopCommand(type: 'search' | 'signOut', handler: () => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const onCommand = (event: Event) => {
      if ((event as CustomEvent<string>).detail === type) latest.current();
    };
    window.addEventListener(EVENT, onCommand);
    return () => window.removeEventListener(EVENT, onCommand);
  }, [type]);
}

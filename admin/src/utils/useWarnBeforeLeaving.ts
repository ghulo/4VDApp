import { useEffect } from 'react';

/** While `active`, reloading or closing the tab asks first, so typed work isn't lost. */
export function useWarnBeforeLeaving(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}

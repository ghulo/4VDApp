import { createContext, type ReactNode, useCallback, useContext, useLayoutEffect, useState } from 'react';

interface TabsSlot {
  tabs: ReactNode;
  /** The header showing the tabs, or null while none has taken them. */
  owner: string | null;
  claim: (id: string) => void;
  release: (id: string) => void;
}

/**
 * Section tabs (History · Invoices · Offers) belong under the page's title, not
 * above it. SectionTabs offers them here; the page's first PageHeader takes and
 * shows them. A page without a header keeps them at the top.
 */
export const TabsSlotContext = createContext<TabsSlot | null>(null);

/** For SectionTabs: the slot to offer, and whether a header has taken it. */
export function useTabsSlotOwner(tabs: ReactNode) {
  const [owner, setOwner] = useState<string | null>(null);
  const claim = useCallback((id: string) => setOwner((current) => current ?? id), []);
  const release = useCallback((id: string) => setOwner((current) => (current === id ? null : current)), []);
  return { tabs, owner, claim, release } satisfies TabsSlot;
}

/** For PageHeader: the tabs to show under the title, if this header took them. */
export function useSectionTabs(id: string): ReactNode {
  const slot = useContext(TabsSlotContext);
  const claim = slot?.claim;
  const release = slot?.release;
  // Before paint, so the tabs never flash at the top first.
  useLayoutEffect(() => {
    if (!claim || !release) return undefined;
    claim(id);
    return () => release(id);
  }, [id, claim, release]);
  return slot && slot.owner === id ? slot.tabs : null;
}

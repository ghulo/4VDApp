import { useEffect } from 'react';

/** 4VD's own name, for its own business and pages that belong to no business. */
export const HOUSE_TITLE = '4VD';

/**
 * The browser tab says whose dashboard this is: the business's name, or 4VD
 * for 4VD's own business and pages before anyone is known (index.html starts
 * with 4VD, so a business's tab shows its name as soon as it is known).
 */
export function useTabTitle(name: string | null | undefined): void {
  useEffect(() => {
    document.title = name || HOUSE_TITLE;
  }, [name]);
}

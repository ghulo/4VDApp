/**
 * The business picker switches every tab at once: the sign-in cookies are
 * shared, so a tab still showing the old business would send its next save
 * into the new one. The tab that switched writes here; every other tab hears
 * it and opens again from Home in the new business.
 */
const KEY = '4vd.business';

export function announceSwitch(businessId: number): void {
  try {
    localStorage.setItem(KEY, `${businessId}:${Date.now()}`);
  } catch {
    // Blocked storage: other tabs find out on their next reload.
  }
}

/** Reload this tab when another tab switches business. Returns the clean-up. */
export function followSwitches(): () => void {
  const heard = (event: StorageEvent) => {
    if (event.key === KEY && event.newValue) window.location.assign('/');
  };
  window.addEventListener('storage', heard);
  return () => window.removeEventListener('storage', heard);
}

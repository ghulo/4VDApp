import { Storefront } from '@phosphor-icons/react';
import type { MenuItem } from '../components/ui/MenuButton';
import { useToast } from '../components/ui/Toast';
import { useT } from '../i18n/useT';
import { localStore } from '../pages/counter/offlineQueue';
import { basketsWaiting } from '../pages/counter/useBaskets';
import { unprintedWaiting } from '../pages/counter/useFiscalPrinter';
import { authApi } from '../services/api';
import { errorMessage } from '../utils/errors';
import { useAuth, useCurrentUser } from './useAuth';
import { announceSwitch } from './businessSwitch';
import { forgetViewAs } from './viewAs';
import { switchSettled } from '../offline/savedCopy';

/**
 * The business picker, as items for the account menu: one per business the
 * person may open (4VD's developer: every business), the open one ticked.
 * Nothing when there is only one. Switching opens the whole app again from
 * Home in the other business: every list and cache belongs to one business.
 */
export function useBusinessPicker(): MenuItem[] {
  const user = useCurrentUser();
  const switchTo = useSwitchBusiness();
  const businesses = user.businesses ?? [];
  if (businesses.length < 2) return [];

  return businesses.map((business) => ({
    label: business.name,
    icon: Storefront,
    checked: business.id === user.businessId,
    onSelect: () => {
      if (business.id !== user.businessId) void switchTo(business.id);
    },
  }));
}

/** Opens the app again from Home in another business (the picker, and Add business's "Open it now"). */
export function useSwitchBusiness(): (businessId: number) => Promise<void> {
  const user = useCurrentUser();
  const { beginSwitch, switchFailed } = useAuth();
  const t = useT();
  const toast = useToast();
  return async (businessId: number) => {
    // The Counter's waiting work belongs to the business it was rung up in.
    if (localStore.read().length > 0 || unprintedWaiting() || basketsWaiting(user.id)) {
      toast({ title: t.nav.switchBlocked, detail: t.nav.switchBlockedDetail, tone: 'danger' });
      return;
    }
    // The saved sign-in names the business being left: an offline start right after the switch must not reopen it.
    const alreadyUnsettled = beginSwitch();
    try {
      await authApi.switchBusiness(businessId);
      // 4VD switched: settled (the page opens again and asks who is signed in).
      switchSettled();
      forgetViewAs();
      announceSwitch(businessId);
      window.location.assign('/');
    } catch (error) {
      // A clear no: still in the same business, saved again. No answer: it may have happened, so 4VD is asked.
      switchFailed(error, alreadyUnsettled);
      toast({ title: t.nav.switchFailed, detail: errorMessage(error), tone: 'danger' });
    }
  };
}

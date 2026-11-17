import { Storefront } from '@phosphor-icons/react';
import type { MenuItem } from '../components/ui/MenuButton';
import { useToast } from '../components/ui/Toast';
import { useT } from '../i18n/useT';
import { localStore } from '../pages/counter/offlineQueue';
import { basketsWaiting } from '../pages/counter/useBaskets';
import { unprintedWaiting } from '../pages/counter/useFiscalPrinter';
import { authApi } from '../services/api';
import { errorMessage } from '../utils/errors';
import { useCurrentUser } from './useAuth';
import { announceSwitch } from './businessSwitch';
import { forgetViewAs } from './viewAs';

/**
 * The business picker, as items for the account menu: one per business the
 * person may open (4VD's developer: every business), the open one ticked.
 * Nothing when there is only one. Switching opens the whole app again from
 * Home in the other business: every list and cache belongs to one business.
 */
export function useBusinessPicker(): MenuItem[] {
  const user = useCurrentUser();
  const t = useT();
  const toast = useToast();
  const businesses = user.businesses ?? [];
  if (businesses.length < 2) return [];

  const switchTo = async (businessId: number) => {
    // The Counter's waiting work belongs to the business it was rung up in.
    if (localStore.read().length > 0 || unprintedWaiting() || basketsWaiting(user.id)) {
      toast({ title: t.nav.switchBlocked, detail: t.nav.switchBlockedDetail, tone: 'danger' });
      return;
    }
    try {
      await authApi.switchBusiness(businessId);
      forgetViewAs();
      announceSwitch(businessId);
      window.location.assign('/');
    } catch (error) {
      toast({ title: t.nav.switchFailed, detail: errorMessage(error), tone: 'danger' });
    }
  };

  return businesses.map((business) => ({
    label: business.name,
    icon: Storefront,
    checked: business.id === user.businessId,
    onSelect: () => {
      if (business.id !== user.businessId) void switchTo(business.id);
    },
  }));
}

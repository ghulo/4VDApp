import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { pushApi } from '../services/api';
import { secureStorage } from '../services/secureStorage';

/**
 * Phones: Expo push. See devicePush.web.ts for the app opened in a browser.
 * The two files share these exports, and Metro picks the right one.
 */

const TOKEN_KEY = '4vd.pushToken';

// Show alerts as banners even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

/** Null when alerts can work here, otherwise why not, in words for the person. */
export function pushUnavailableReason(_webPushPublicKey: string | null): string | null {
  if (!Device.isDevice) return 'Alerts only work on a real phone, not a simulator.';
  if (!projectId) return 'Phone alerts work in the installed app (APK), not in Expo Go.';
  return null;
}

/** The token alerts on this phone go to, if they're on. */
export const currentPushToken = () => secureStorage.getItem(TOKEN_KEY);

export async function enablePush(_webPushPublicKey: string | null): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Alerts',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Notifications are blocked for 4VD. Allow them in the phone settings, then try again.');
  }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await pushApi.addDevice({ kind: 'expo', token });
  await secureStorage.setItem(TOKEN_KEY, token);
}

/** Stop alerts on this phone. Used when switching off and when logging out. */
export async function disablePush(): Promise<void> {
  const token = await secureStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await pushApi.removeDevice(token).catch(() => undefined);
  await secureStorage.removeItem(TOKEN_KEY);
}

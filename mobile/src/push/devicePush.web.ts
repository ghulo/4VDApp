import { pushApi } from '../services/api';

/**
 * The app opened in a browser (including an iPhone home-screen app): Web Push
 * through public/sw.js. Same exports as devicePush.ts.
 */

const isSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Null when alerts can work here, otherwise why not, in words for the person. */
export function pushUnavailableReason(webPushPublicKey: string | null): string | null {
  if (!isSupported()) {
    return 'This browser can’t show alerts. On an iPhone, add 4VD to the Home Screen from Safari’s Share menu and open it from there.';
  }
  if (!webPushPublicKey) return 'Browser alerts are switched off on the server.';
  return null;
}

async function existingRegistration() {
  return isSupported() ? navigator.serviceWorker.getRegistration('/') : undefined;
}

/** This browser's subscription endpoint, if alerts are on here. */
export async function currentPushToken(): Promise<string | null> {
  const subscription = await (await existingRegistration())?.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}

/** The server sends its key as base64url; the browser wants raw bytes. */
function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export async function enablePush(webPushPublicKey: string | null): Promise<void> {
  if (!webPushPublicKey) throw new Error('Browser alerts are switched off on the server.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('The browser is blocking notifications for 4VD. Allow them in the site settings, then try again.');
  }
  const worker = (await existingRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const subscription =
    (await worker.pushManager.getSubscription()) ??
    (await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(webPushPublicKey) }));
  const json = subscription.toJSON();
  await pushApi.addDevice({
    kind: 'web',
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! },
  });
}

/** Stop alerts in this browser. Used when switching off and when logging out. */
export async function disablePush(): Promise<void> {
  const subscription = await (await existingRegistration())?.pushManager.getSubscription();
  if (!subscription) return;
  await pushApi.removeDevice(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
}

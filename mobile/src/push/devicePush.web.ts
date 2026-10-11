import { pushApi } from '../services/api';
import { activeCatalogue } from '../i18n/useT';

/**
 * The app opened in a browser (including an iPhone home-screen app): Web Push
 * through public/sw.js. Same exports as devicePush.ts.
 */

const isSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Null when alerts can work here, otherwise why not, in words for the person. */
export function pushUnavailableReason(webPushPublicKey: string | null): string | null {
  if (!isSupported()) {
    return activeCatalogue().push.browserUnsupported;
  }
  if (!webPushPublicKey) return activeCatalogue().push.browserNoKeys;
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

const sameKey = (current: ArrayBuffer | null, wanted: Uint8Array) =>
  current !== null && current.byteLength === wanted.byteLength && new Uint8Array(current).every((byte, index) => byte === wanted[index]);

export async function enablePush(webPushPublicKey: string | null): Promise<void> {
  if (!webPushPublicKey) throw new Error(activeCatalogue().push.browserNoKeys);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(activeCatalogue().push.browserBlocked);
  }
  const worker = (await existingRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const key = keyBytes(webPushPublicKey);
  let subscription = await worker.pushManager.getSubscription();
  // Made with keys the server no longer has: alerts would be refused, so start over.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
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

/** In a browser, tapping an alert just brings the app forward (see public/sw.js). */
export function onPushTap(_open: (type: string | null) => void): () => void {
  return () => undefined;
}

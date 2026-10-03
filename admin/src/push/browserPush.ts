import { pushApi } from '../services/api';
import { activeCatalogue } from '../i18n/useT';

/** Browser support for alerts while the dashboard is closed. */
export const isPushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js');
}

/** This browser's current subscription, if alerts are on here. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const existing = await navigator.serviceWorker.getRegistration('/');
  return existing ? existing.pushManager.getSubscription() : null;
}

/** The server sends its key as base64url; the browser wants raw bytes. */
function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

/** Ask the browser for permission, subscribe, and tell the server where to send alerts. */
export async function enablePush(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(activeCatalogue().push.blocked);
  }
  const worker = await registration();
  await navigator.serviceWorker.ready;
  const subscription =
    (await worker.pushManager.getSubscription()) ??
    (await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const json = subscription.toJSON();
  await pushApi.addWebDevice({ endpoint: subscription.endpoint, keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! } });
}

/** Stop alerts on this browser. Used when switching off and when logging out. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await pushApi.removeDevice(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
}

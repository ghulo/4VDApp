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

const sameKey = (current: ArrayBuffer | null, wanted: Uint8Array) =>
  current !== null && current.byteLength === wanted.byteLength && new Uint8Array(current).every((byte, index) => byte === wanted[index]);

/** Ask the browser for permission, subscribe, and tell the server where to send alerts. */
export async function enablePush(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(activeCatalogue().push.blocked);
  }
  const worker = await registration();
  await navigator.serviceWorker.ready;
  const key = keyBytes(publicKey);
  let subscription = await worker.pushManager.getSubscription();
  // Made with keys the server no longer has: alerts would be refused, so start over.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
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

/** Where alerts stand in this browser after `turnOnHere`. */
export type PushHere = 'on' | 'declined' | 'blocked' | 'unsupported' | 'noKeys';

/**
 * Turns alerts on in this browser if they aren't yet, so sending something to
 * yourself is also how the browser first asks. Asks before anything else is
 * awaited: Safari only shows the question straight from the click.
 */
export async function turnOnHere(): Promise<PushHere> {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'declined';
  // Registers again even when it looks on: the server may have new keys or have forgotten this browser.
  const { webPushPublicKey } = await pushApi.settings();
  if (!webPushPublicKey) return 'noKeys';
  await enablePush(webPushPublicKey);
  return 'on';
}

/**
 * Tells the server again about this browser when alerts are already on here,
 * so it knows the alerts belong to the dashboard (and keeps the team app on
 * the same phone quiet). Runs once per sign-in; never asks for anything.
 */
export async function reregisterPush(): Promise<void> {
  if (!isPushSupported() || Notification.permission !== 'granted') return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  const json = subscription.toJSON();
  await pushApi.addWebDevice({ endpoint: subscription.endpoint, keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! } });
}

import webpush from 'web-push';
import { logger } from '../../utils/logger.js';

export interface PushMessage {
  token: string;
  /** Web Push encryption keys; only for web devices. */
  keys: { p256dh: string; auth: string } | null;
  title: string;
  body: string;
  /** Lets the app open the right screen when the alert is tapped. */
  data: { type: string | null; notificationId: number; link: string | null };
}

export interface PushSender {
  /** Sends what it can and returns the tokens of devices that no longer exist, so they can be forgotten. */
  send(messages: PushMessage[]): Promise<{ deadTokens: string[] }>;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
const EXPO_BATCH_SIZE = 100;
/** Alerts are about now; after a day they're noise. */
const TIME_TO_LIVE_SECONDS = 24 * 60 * 60;

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/** Android app (and an iPhone build later), through Expo's free push service. */
export class ExpoPushSender implements PushSender {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async send(messages: PushMessage[]): Promise<{ deadTokens: string[] }> {
    const deadTokens: string[] = [];
    for (let start = 0; start < messages.length; start += EXPO_BATCH_SIZE) {
      const batch = messages.slice(start, start + EXPO_BATCH_SIZE);
      try {
        const response = await this.fetchImpl(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(
            batch.map((message) => ({
              to: message.token,
              title: message.title,
              body: message.body,
              data: message.data,
              sound: 'default',
              ttl: TIME_TO_LIVE_SECONDS,
            })),
          ),
        });
        if (!response.ok) {
          logger.warn('Expo push request failed', { status: response.status });
          continue;
        }
        const { data: tickets } = (await response.json()) as { data: ExpoTicket[] };
        tickets.forEach((ticket, index) => {
          if (ticket.status !== 'error') return;
          if (ticket.details?.error === 'DeviceNotRegistered') deadTokens.push(batch[index]!.token);
          else logger.warn('Expo push was refused', { error: ticket.details?.error, message: ticket.message });
        });
      } catch (error) {
        logger.warn('Expo push could not be sent', { error: String(error) });
      }
    }
    return { deadTokens };
  }
}

/** PC browsers and the mobile app opened in a browser (including an iPhone home-screen app). */
export class WebPushSender implements PushSender {
  constructor(private readonly vapid: { publicKey: string; privateKey: string; subject: string }) {}

  async send(messages: PushMessage[]): Promise<{ deadTokens: string[] }> {
    const deadTokens: string[] = [];
    await Promise.all(
      messages.map(async (message) => {
        if (!message.keys) return;
        try {
          await webpush.sendNotification(
            { endpoint: message.token, keys: message.keys },
            JSON.stringify({ title: message.title, body: message.body, data: message.data }),
            {
              TTL: TIME_TO_LIVE_SECONDS,
              vapidDetails: { subject: this.vapid.subject, publicKey: this.vapid.publicKey, privateKey: this.vapid.privateKey },
            },
          );
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          // 404 and 410 mean the browser unsubscribed or the subscription expired.
          if (statusCode === 404 || statusCode === 410) deadTokens.push(message.token);
          else logger.warn('Web push could not be sent', { statusCode, error: String(error) });
        }
      }),
    );
    return { deadTokens };
  }
}

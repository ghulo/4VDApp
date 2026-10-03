import { NOTIFICATION_TYPES, PUSH_TOPICS, type PushTopic, pushTopicFor } from '../constants/notifications.js';
import type { UserRole } from '../database/types.js';
import type { NewDevice, PushRepository } from '../repositories/PushRepository.js';
import type { PushMessage, PushSender } from './push/senders.js';

/** Alerts not pushed within this long are dropped rather than sent late. */
const MAX_PUSH_DELAY_MS = 15 * 60 * 1000;
const CLAIM_BATCH_SIZE = 200;

/** Which alerts each role can get at all; the settings only show these. */
const TOPICS_BY_ROLE: Record<UserRole, PushTopic[]> = {
  developer: ['stock', 'approvals', 'summary'],
  admin: ['stock', 'approvals', 'summary'],
  owner: ['stock', 'approvals', 'summary'],
  employee: ['decisions'],
  family: [],
};

export type PushPreferences = Partial<Record<PushTopic, boolean>>;

export interface PushSettingsDto {
  /** The topics this person can get, each on or off. */
  topics: Array<{ topic: PushTopic; enabled: boolean }>;
  /** How many phones and browsers will get their alerts. */
  deviceCount: number;
  /** Null when the server has no Web Push keys, so browsers can't subscribe. */
  webPushPublicKey: string | null;
}

export interface PushSenders {
  expo: PushSender;
  web: PushSender | null;
}

export class PushService {
  constructor(
    private readonly pushRepository: PushRepository,
    private readonly senders: PushSenders,
    private readonly webPushPublicKey: string | null,
  ) {}

  async settings(userId: number, role: UserRole): Promise<PushSettingsDto> {
    const [preferences, deviceCount] = await Promise.all([
      this.pushRepository.preferences(userId),
      this.pushRepository.countDevices(userId),
    ]);
    return {
      topics: TOPICS_BY_ROLE[role].map((topic) => ({ topic, enabled: preferences[topic] !== false })),
      deviceCount,
      webPushPublicKey: this.webPushPublicKey,
    };
  }

  async updatePreferences(userId: number, role: UserRole, changes: PushPreferences): Promise<PushSettingsDto> {
    const current = await this.pushRepository.preferences(userId);
    const next = { ...current };
    for (const topic of PUSH_TOPICS) {
      if (changes[topic] !== undefined) next[topic] = changes[topic];
    }
    await this.pushRepository.savePreferences(userId, next);
    return this.settings(userId, role);
  }

  /** A test alert to every device of this person, sent with the next batch. */
  async sendTest(userId: number): Promise<void> {
    await this.pushRepository.createTestNotification(userId, {
      type: NOTIFICATION_TYPES.TEST,
      write: (t) => ({ title: t.testAlertTitle, message: t.testAlertMessage }),
    });
  }

  async addDevice(userId: number, device: NewDevice): Promise<void> {
    await this.pushRepository.saveDevice(userId, device);
  }

  async removeDevice(userId: number, token: string): Promise<void> {
    await this.pushRepository.removeDevice(userId, token);
  }

  /**
   * Push every notification created since the last run to its owner's
   * devices, unless they switched that topic off. Called every few seconds
   * by the server; safe to run on several servers at once.
   * Returns how many alerts were sent (one per device).
   */
  async sendPending(): Promise<number> {
    const claimed = await this.pushRepository.claimUnpushed(new Date(Date.now() - MAX_PUSH_DELAY_MS), CLAIM_BATCH_SIZE);
    const wanted = claimed.filter((notification) => {
      if (notification.type === NOTIFICATION_TYPES.TEST) return true;
      const topic = pushTopicFor(notification.type);
      return topic !== null && notification.push_preferences[topic] !== false;
    });
    if (wanted.length === 0) return 0;

    const devices = await this.pushRepository.devicesFor([...new Set(wanted.map((notification) => notification.user_id))]);
    const expoMessages: PushMessage[] = [];
    const webMessages: PushMessage[] = [];
    for (const notification of wanted) {
      for (const device of devices.filter((candidate) => candidate.user_id === notification.user_id)) {
        const message: PushMessage = {
          token: device.token,
          keys: device.keys,
          title: notification.title,
          body: notification.message,
          data: { type: notification.type, notificationId: notification.id },
        };
        (device.kind === 'expo' ? expoMessages : webMessages).push(message);
      }
    }

    const results = await Promise.all([
      expoMessages.length > 0 ? this.senders.expo.send(expoMessages) : { deadTokens: [] },
      webMessages.length > 0 && this.senders.web ? this.senders.web.send(webMessages) : { deadTokens: [] },
    ]);
    const deadTokens = results.flatMap((result) => result.deadTokens);
    const usedTokens = [...expoMessages, ...webMessages].map((message) => message.token).filter((token) => !deadTokens.includes(token));
    await Promise.all([
      this.pushRepository.removeDevicesByToken(deadTokens),
      this.pushRepository.markDevicesUsed([...new Set(usedTokens)]),
    ]);
    return expoMessages.length + (this.senders.web ? webMessages.length : 0);
  }
}

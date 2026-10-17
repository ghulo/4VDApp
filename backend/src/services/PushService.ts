import { ALWAYS_PUSHED, NOTIFICATION_TYPES, PUSH_TOPICS, type PushTopic, pushTopicFor } from '../constants/notifications.js';
import type { UserRole } from '../database/types.js';
import type { DeviceRecord, NewDevice, PushRepository } from '../repositories/PushRepository.js';
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
  accountant: [],
};

export type PushPreferences = Partial<Record<PushTopic, boolean>>;

export interface PushSettingsDto {
  /** The topics this person can get, each on or off. */
  topics: Array<{ topic: PushTopic; enabled: boolean }>;
  /** How many phones and browsers will get their alerts. */
  deviceCount: number;
  /** Alerts are on in the dashboard, so the team app stays quiet for this person. */
  dashboardOnly: boolean;
  /** Null when the server has no Web Push keys, so browsers can't subscribe. */
  webPushPublicKey: string | null;
}

/** How one device fared with the test alert. */
export interface TestDelivery {
  kind: 'expo' | 'web';
  /** Who carries alerts to it: Apple, Google, Microsoft, Mozilla or Expo. */
  service: string;
  delivered: boolean;
  /** What the push service said when it refused. */
  problem: string | null;
  /** The push service no longer knows it, so it was removed; turning alerts on there again fixes it. */
  removed: boolean;
}

/** The push service behind a device, from where its alerts are sent. */
function serviceOf(device: DeviceRecord): string {
  if (device.kind === 'expo') return 'Expo';
  const host = (() => {
    try {
      return new URL(device.token).hostname;
    } catch {
      return '';
    }
  })();
  if (host.endsWith('push.apple.com')) return 'Apple';
  if (host.endsWith('googleapis.com')) return 'Google';
  if (host.endsWith('notify.windows.com')) return 'Microsoft';
  if (host.endsWith('mozilla.com')) return 'Mozilla';
  return host || 'Unknown';
}

/**
 * The devices that get a person's alerts: only their dashboard ones when they
 * have any, so someone with both the dashboard and the team app on their
 * phone hears about each thing once. The test alert still tries every device.
 */
function alertedDevices(devices: DeviceRecord[]): DeviceRecord[] {
  const withDashboard = new Set(devices.filter((device) => device.app === 'dashboard').map((device) => device.user_id));
  return devices.filter((device) => device.app === 'dashboard' || !withDashboard.has(device.user_id));
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
    const [preferences, devices] = await Promise.all([
      this.pushRepository.preferences(userId),
      this.pushRepository.countDevices(userId),
    ]);
    const dashboardOnly = devices.dashboard > 0;
    return {
      topics: TOPICS_BY_ROLE[role].map((topic) => ({ topic, enabled: preferences[topic] !== false })),
      deviceCount: dashboardOnly ? devices.dashboard : devices.total,
      dashboardOnly,
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

  /**
   * A test alert to every device of this person, sent right now so the
   * answer says, device by device, whether it got through and if not why.
   */
  async sendTest(userId: number): Promise<TestDelivery[]> {
    const notification = await this.pushRepository.createPushedTestNotification(userId, {
      type: NOTIFICATION_TYPES.TEST,
      write: (t) => ({ title: t.testAlertTitle, message: t.testAlertMessage }),
    });
    if (!notification) return [];
    const devices = await this.pushRepository.devicesFor([userId]);
    const { failures, deadTokens } = await this.deliver([{ ...notification, user_id: userId }], devices);
    return devices.map((device) => {
      const failure = failures.find((candidate) => candidate.token === device.token);
      const noKeys = device.kind === 'web' && !this.senders.web;
      return {
        kind: device.kind,
        service: serviceOf(device),
        delivered: !failure && !noKeys,
        problem: noKeys ? 'The server has no Web Push keys' : (failure?.problem ?? null),
        removed: deadTokens.includes(device.token),
      };
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
      if (notification.type !== null && ALWAYS_PUSHED.has(notification.type)) return true;
      const topic = pushTopicFor(notification.type);
      return topic !== null && notification.push_preferences[topic] !== false;
    });
    if (wanted.length === 0) return 0;

    const devices = await this.pushRepository.devicesFor([...new Set(wanted.map((notification) => notification.user_id))]);
    const { sent } = await this.deliver(wanted, alertedDevices(devices));
    return sent;
  }

  /** Pushes each notification to its owner's devices, forgets devices that are gone, and says what failed. */
  private async deliver(
    notifications: Array<{ id: number; user_id: number; title: string; message: string; type: string | null; link: string | null }>,
    devices: DeviceRecord[],
  ): Promise<{ sent: number; deadTokens: string[]; failures: Array<{ token: string; problem: string }> }> {
    const expoMessages: PushMessage[] = [];
    const webMessages: PushMessage[] = [];
    for (const notification of notifications) {
      for (const device of devices.filter((candidate) => candidate.user_id === notification.user_id)) {
        const message: PushMessage = {
          token: device.token,
          keys: device.keys,
          title: notification.title,
          body: notification.message,
          data: { type: notification.type, notificationId: notification.id, link: notification.link },
        };
        (device.kind === 'expo' ? expoMessages : webMessages).push(message);
      }
    }

    const results = await Promise.all([
      expoMessages.length > 0 ? this.senders.expo.send(expoMessages) : { deadTokens: [] },
      webMessages.length > 0 && this.senders.web ? this.senders.web.send(webMessages) : { deadTokens: [] },
    ]);
    const deadTokens = results.flatMap((result) => result.deadTokens);
    const failures = results.flatMap((result) => ('failures' in result ? (result.failures ?? []) : []));
    const usedTokens = [...expoMessages, ...webMessages].map((message) => message.token).filter((token) => !deadTokens.includes(token));
    await Promise.all([
      this.pushRepository.removeDevicesByToken(deadTokens),
      this.pushRepository.markDevicesUsed([...new Set(usedTokens)]),
    ]);
    return { sent: expoMessages.length + (this.senders.web ? webMessages.length : 0), deadTokens, failures };
  }
}

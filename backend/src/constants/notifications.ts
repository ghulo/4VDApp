/** What a person can switch push alerts on or off for. */
export const PUSH_TOPICS = ['stock', 'approvals', 'decisions'] as const;
export type PushTopic = (typeof PUSH_TOPICS)[number];

export const NOTIFICATION_TYPES = {
  LOW_STOCK: 'low_stock',
  OUT_OF_STOCK: 'out_of_stock',
  /** Something is waiting in the owner's Approvals inbox. */
  APPROVAL: 'approval',
  /** The owner decided on someone's request. */
  APPROVAL_DECISION: 'approval_decision',
  /** Sent on request from the alert settings; always pushed. */
  TEST: 'test',
} as const;

const TOPIC_BY_TYPE: Record<string, PushTopic> = {
  [NOTIFICATION_TYPES.LOW_STOCK]: 'stock',
  [NOTIFICATION_TYPES.OUT_OF_STOCK]: 'stock',
  [NOTIFICATION_TYPES.APPROVAL]: 'approvals',
  [NOTIFICATION_TYPES.APPROVAL_DECISION]: 'decisions',
};

/** Null for notification types that are never pushed. */
export const pushTopicFor = (type: string | null): PushTopic | null => (type ? (TOPIC_BY_TYPE[type] ?? null) : null);

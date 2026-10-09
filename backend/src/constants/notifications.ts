/** What a person can switch push alerts on or off for. */
export const PUSH_TOPICS = ['stock', 'approvals', 'decisions', 'summary'] as const;
export type PushTopic = (typeof PUSH_TOPICS)[number];

export const NOTIFICATION_TYPES = {
  LOW_STOCK: 'low_stock',
  OUT_OF_STOCK: 'out_of_stock',
  /** Something is waiting in the owner's Approvals inbox. */
  APPROVAL: 'approval',
  /** The owner decided on someone's request. */
  APPROVAL_DECISION: 'approval_decision',
  /** The owner's end-of-day summary. */
  DAILY_SUMMARY: 'daily_summary',
  /** A drawer count didn't match what the app expected. */
  CASH_DIFFERENCE: 'cash_difference',
  /** Someone undid or restored one of this person's entries. */
  UNDONE: 'undone',
  /** Sent on request from the alert settings; always pushed. */
  TEST: 'test',
  /** Each person's daily and weekly report; their report settings decide if they come, so always pushed. */
  DAILY_REPORT: 'daily_report',
  WEEKLY_REPORT: 'weekly_report',
} as const;

/** Pushed whatever the topic switches say. */
export const ALWAYS_PUSHED: ReadonlySet<string> = new Set([NOTIFICATION_TYPES.TEST, NOTIFICATION_TYPES.DAILY_REPORT, NOTIFICATION_TYPES.WEEKLY_REPORT]);

const TOPIC_BY_TYPE: Record<string, PushTopic> = {
  [NOTIFICATION_TYPES.LOW_STOCK]: 'stock',
  [NOTIFICATION_TYPES.OUT_OF_STOCK]: 'stock',
  [NOTIFICATION_TYPES.APPROVAL]: 'approvals',
  [NOTIFICATION_TYPES.APPROVAL_DECISION]: 'decisions',
  [NOTIFICATION_TYPES.DAILY_SUMMARY]: 'summary',
  [NOTIFICATION_TYPES.CASH_DIFFERENCE]: 'summary',
  [NOTIFICATION_TYPES.UNDONE]: 'decisions',
};

/** Null for notification types that are never pushed. */
export const pushTopicFor = (type: string | null): PushTopic | null => (type ? (TOPIC_BY_TYPE[type] ?? null) : null);

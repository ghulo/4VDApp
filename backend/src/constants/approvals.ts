/** Status of anything an employee asks for and the owner decides on. */
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const RETURN_CONDITIONS = ['resellable', 'damaged'] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

export const WRITE_OFF_REASONS = ['damaged', 'lost', 'expired', 'other'] as const;
export type WriteOffReason = (typeof WRITE_OFF_REASONS)[number];

export const COUNT_STATUSES = ['open', 'submitted', 'closed', 'cancelled'] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];

/** Null until the count is submitted. */
export const COUNT_LINE_STATUSES = ['match', 'pending', 'approved', 'rejected'] as const;
export type CountLineStatus = (typeof COUNT_LINE_STATUSES)[number];

export const DEFAULT_SETTINGS = { refundApprovalLimit: 50, returnWindowDays: 14, minimumMarginPercent: 0, cashFloatShop: 50 } as const;

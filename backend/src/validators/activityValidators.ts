import { z } from 'zod';
import { ACTIVITY_ENTITY_TYPES } from '../constants/activity.js';
import { idSchema, paginationSchema } from './validate.js';

export const undoBodySchema = z.object({
  note: z.string().trim().max(500).optional(),
});

const actionList = z
  .string()
  .regex(/^[a-z_]+(\.[a-z_]+)?(,[a-z_]+(\.[a-z_]+)?)*$/, 'use action names like stock or stock.adjusted, separated by commas')
  .max(200)
  .transform((value) => value.split(','));

export const activityQuerySchema = paginationSchema.extend({
  userId: idSchema.optional(),
  entityType: z.enum(ACTIVITY_ENTITY_TYPES).optional(),
  entityId: idSchema.optional(),
  // Comma-separated exact actions or prefixes: "stock" or "product,pricing,category".
  action: actionList.optional(),
  // Same format, left out: "auth" hides logins so the log shows what changed.
  exclude: actionList.optional(),
  // Words to find in what changed: "vase", "Fresh Foods".
  search: z.string().trim().max(100).optional(),
});

/** The newest entry the developer was shown, so a restore never acts on a changed record. */
export const restorePointBodySchema = z.object({ latestEntryId: idSchema });

/** One record whose history to show. */
export const historyQuerySchema = z.object({
  entityType: z.enum(ACTIVITY_ENTITY_TYPES),
  entityId: idSchema,
});

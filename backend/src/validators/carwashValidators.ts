import { z } from 'zod';
import { money } from './catalogValidators.js';
import { calendarDaySchema } from './validate.js';

export const carwashDayParamsSchema = z.object({ day: calendarDaySchema });

export const carwashTakingsSchema = z.object({
  carwash: money,
  change: money,
});

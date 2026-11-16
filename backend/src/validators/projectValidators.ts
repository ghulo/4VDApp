import { z } from 'zod';
import { TAGGABLE } from '../services/ProjectService.js';

const name = z.string().trim().min(1, 'give the project a name').max(80);
const note = z.string().trim().max(500).nullable().transform((value) => (value === '' ? null : value));

export const newProjectSchema = z.object({ name, note: note.optional().default(null) });

export const updateProjectSchema = z
  .object({ name: name.optional(), note: note.optional(), closed: z.boolean().optional() })
  .refine((input) => input.name !== undefined || input.note !== undefined || input.closed !== undefined, { message: 'send name, note or closed' });

export const tagSchema = z.object({
  kind: z.enum(TAGGABLE),
  id: z.number().int().positive(),
  projectId: z.number().int().positive().nullable(),
});

/** An optional project on a new document. */
export const projectIdField = z.number().int().positive().nullable().optional();

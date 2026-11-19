import type { Request, Response } from 'express';
import { z } from 'zod';
import { ImportService, UNDO_KINDS } from '../services/import/ImportService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

const wantedSchema = z.object({ names: z.array(z.string().min(1).max(500)).min(1).max(5000) });
const createSchema = z.object({
  files: z
    .array(z.object({ name: z.string().min(1).max(300), data: z.string().min(1) }))
    .min(1)
    .max(30),
  notSent: z.array(z.object({ file: z.string().max(300), why: z.enum(['history', 'notNeeded', 'otherData']) })).max(200).default([]),
});
const mappingSchema = z.record(z.string(), z.number().int().min(-1).max(500));
const choicesSchema = z.object({
  problems: z.record(z.string(), z.string().max(40)).optional(),
  sheets: z.record(z.string(), z.object({ kind: z.enum(['products', 'suppliers', 'customers', 'skip']).optional(), mapping: mappingSchema.optional() })).optional(),
  fixes: z.record(z.string(), z.object({ price: z.number().min(0).max(1_000_000).optional(), cost: z.number().min(0).max(1_000_000).nullable().optional() })).optional(),
  stock: z.enum(['bring', 'none']).optional(),
});
const kindsSchema = z.object({ kinds: z.array(z.enum(UNDO_KINDS as [string, ...string[]])).min(1).default(UNDO_KINDS) });
const kindsQuerySchema = z.object({ kinds: z.string().optional() });

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendXlsx(res: Response, name: string, body: Buffer): void {
  res.setHeader('Content-Type', XLSX);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(body);
}

export function createImportController(service: ImportService) {
  return {
    async wanted(req: Request, res: Response): Promise<void> {
      sendSuccess(res, service.wanted(parseInput(wantedSchema, req.body).names));
    },
    async create(req: Request, res: Response): Promise<void> {
      const input = parseInput(createSchema, req.body);
      sendSuccess(res, await service.create(input.files, input.notSent, req.user!.id), { statusCode: 201, message: 'Files read' });
    },
    async list(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.list());
    },
    async get(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.get(id));
    },
    async setChoices(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.setChoices(id, parseInput(choicesSchema, req.body) as Parameters<ImportService['setChoices']>[1]));
    },
    async run(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.run(id, req.user!.id), { statusCode: 202, message: 'Import started' });
    },
    async discard(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await service.discard(id);
      sendSuccess(res, null, { message: 'Import thrown away' });
    },
    async undoPlan(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { kinds } = parseInput(kindsQuerySchema, req.query);
      const chosen = kinds ? parseInput(kindsSchema, { kinds: kinds.split(',') }).kinds : UNDO_KINDS;
      const { keep: _keep, ...plan } = await service.undoPlan(id, chosen as typeof UNDO_KINDS);
      sendSuccess(res, plan);
    },
    async undo(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { kinds } = parseInput(kindsSchema, req.body ?? {});
      sendSuccess(res, await service.undo(id, kinds as typeof UNDO_KINDS, req.user!.id), { message: 'Import undone' });
    },
    async spotCheck(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.spotCheck(id));
    },
    async markChecked(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await service.markChecked(id);
      sendSuccess(res, null, { message: 'Marked as checked' });
    },
    async problemRows(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendXlsx(res, `import-${id}-problems.xlsx`, await service.problemRows(id));
    },
    async template(_req: Request, res: Response): Promise<void> {
      sendXlsx(res, '4vd-import-template.xlsx', await ImportService.template());
    },
  };
}

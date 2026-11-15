import type { Request, Response } from 'express';
import { z } from 'zod';
import { registerSheet, scheduleSheet } from '../services/assets/assetsExport.js';
import type { FixedAssetService } from '../services/FixedAssetService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { sheetToXlsx, type Sheet } from '../utils/spreadsheet.js';
import { zonedDay } from '../utils/zonedDates.js';
import { assetChangesSchema, disposeSchema, newAssetSchema, openingQuerySchema, splitSchema, yearParamsSchema } from '../validators/assetValidators.js';
import { exportTimeZoneSchema } from '../validators/reportValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const exportSchema = z.object({ lang: z.enum(['sq', 'en']).default('sq') }).extend(exportTimeZoneSchema.shape);

// oxlint-disable-next-line typescript/no-explicit-any
async function sendXlsx(res: Response, file: { basename: string; sheet: Sheet<any> }, timeZone: string): Promise<void> {
  res.setHeader('Content-Disposition', `attachment; filename="${file.basename}.xlsx"`);
  res.setHeader('Content-Type', XLSX_TYPE);
  const madeAt = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone });
  res.send(await sheetToXlsx(file.sheet, madeAt));
}

export function createAssetController(service: FixedAssetService) {
  return {
    async list(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.list());
    },

    async get(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.get(id));
    },

    async opening(req: Request, res: Response): Promise<void> {
      const input = parseInput(openingQuerySchema, req.query);
      sendSuccess(res, { openingDepreciated: await service.suggestedOpening({ ...input, rate: input.rate ?? null }) });
    },

    async create(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.create(parseInput(newAssetSchema, req.body), req.user!.id), { statusCode: 201, message: 'Asset added' });
    },

    async update(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.update(id, parseInput(assetChangesSchema, req.body), req.user!.id), { message: 'Asset saved' });
    },

    async split(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { pieces } = parseInput(splitSchema, req.body);
      sendSuccess(res, await service.split(id, pieces, req.user!.id), { message: 'Asset split' });
    },

    async dispose(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.dispose(id, parseInput(disposeSchema, req.body), req.user!.id), { message: 'Asset taken off the books' });
    },

    async undoDisposal(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.undoDisposal(id, req.user!.id), { message: 'Asset back in use' });
    },

    async remove(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await service.remove(id, req.user!.id);
      sendSuccess(res, null, { message: 'Asset removed' });
    },

    async schedule(req: Request, res: Response): Promise<void> {
      const { year } = parseInput(yearParamsSchema, req.params);
      sendSuccess(res, await service.schedule(year));
    },

    async booksCheck(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.booksCheck());
    },

    async exportRegister(req: Request, res: Response): Promise<void> {
      const { lang, tz } = parseInput(exportSchema, req.query);
      await sendXlsx(res, registerSheet(await service.list(), zonedDay(new Date(), tz), lang), tz);
    },

    async exportSchedule(req: Request, res: Response): Promise<void> {
      const { year } = parseInput(yearParamsSchema, req.params);
      const { lang, tz } = parseInput(exportSchema, req.query);
      await sendXlsx(res, scheduleSheet(await service.schedule(year), year, lang), tz);
    },
  };
}

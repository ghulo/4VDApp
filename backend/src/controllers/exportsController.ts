import type { Request, Response } from 'express';
import type { CsvFile, ExportService } from '../services/ExportService.js';
import { exportTimeZoneSchema, reportRangeSchema } from '../validators/reportValidators.js';
import { parseInput } from '../validators/validate.js';

function sendCsv(res: Response, file: CsvFile): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.content);
}

export function createExportsController(exportService: ExportService) {
  return {
    async sales(req: Request, res: Response): Promise<void> {
      const { tz } = parseInput(exportTimeZoneSchema, req.query);
      sendCsv(res, await exportService.sales(parseInput(reportRangeSchema, req.query), tz));
    },

    async stock(req: Request, res: Response): Promise<void> {
      const { tz } = parseInput(exportTimeZoneSchema, req.query);
      sendCsv(res, await exportService.stock(tz));
    },

    async money(req: Request, res: Response): Promise<void> {
      const { tz } = parseInput(exportTimeZoneSchema, req.query);
      sendCsv(res, await exportService.money(parseInput(reportRangeSchema, req.query), tz));
    },

    async expenses(req: Request, res: Response): Promise<void> {
      const { tz } = parseInput(exportTimeZoneSchema, req.query);
      sendCsv(res, await exportService.expenses(parseInput(reportRangeSchema, req.query), tz));
    },

    async team(req: Request, res: Response): Promise<void> {
      const { tz } = parseInput(exportTimeZoneSchema, req.query);
      sendCsv(res, await exportService.team(parseInput(reportRangeSchema, req.query), tz));
    },
  };
}

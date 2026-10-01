import type { Request, Response } from 'express';
import type { CsvFile, ExportService } from '../services/ExportService.js';
import { reportRangeSchema } from '../validators/reportValidators.js';
import { parseInput } from '../validators/validate.js';

function sendCsv(res: Response, file: CsvFile): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.content);
}

export function createExportsController(exportService: ExportService) {
  return {
    async sales(req: Request, res: Response): Promise<void> {
      sendCsv(res, await exportService.sales(parseInput(reportRangeSchema, req.query)));
    },

    async stock(_req: Request, res: Response): Promise<void> {
      sendCsv(res, await exportService.stock());
    },

    async team(req: Request, res: Response): Promise<void> {
      sendCsv(res, await exportService.team(parseInput(reportRangeSchema, req.query)));
    },
  };
}

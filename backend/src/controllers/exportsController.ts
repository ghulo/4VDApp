import type { Request, Response } from 'express';
import type { ExportFile, ExportService } from '../services/ExportService.js';
import { sheetToCsv, sheetToXlsx } from '../utils/spreadsheet.js';
import { exportTimeZoneSchema, reportRangeSchema } from '../validators/reportValidators.js';
import { parseInput } from '../validators/validate.js';

export type ExportFormat = 'csv' | 'xlsx';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function send(res: Response, file: ExportFile, format: ExportFormat, timeZone: string): Promise<void> {
  res.setHeader('Content-Disposition', `attachment; filename="${file.basename}.${format}"`);
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(sheetToCsv(file.sheet));
    return;
  }
  res.setHeader('Content-Type', XLSX_TYPE);
  const madeAt = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone });
  res.send(await sheetToXlsx(file.sheet, madeAt));
}

export function createExportsController(exportService: ExportService) {
  const handle = (make: (req: Request, timeZone: string) => Promise<ExportFile>, format: ExportFormat) => async (req: Request, res: Response) => {
    const { tz } = parseInput(exportTimeZoneSchema, req.query);
    await send(res, await make(req, tz), format, tz);
  };
  const range = (req: Request) => parseInput(reportRangeSchema, req.query);
  const exports = {
    sales: (req: Request, tz: string) => exportService.sales(range(req), tz),
    stock: (_req: Request, tz: string) => exportService.stock(tz),
    money: (req: Request, tz: string) => exportService.money(range(req), tz),
    expenses: (req: Request, tz: string) => exportService.expenses(range(req), tz),
    team: (req: Request, tz: string) => exportService.team(range(req), tz),
  };
  return { exports, handle };
}

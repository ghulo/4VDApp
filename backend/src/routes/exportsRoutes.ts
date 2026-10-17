import { Router } from 'express';
import type { Container } from '../container.js';
import { createExportsController, type ExportFormat } from '../controllers/exportsController.js';

export function createExportsRoutes({ exportService, guards }: Container): Router {
  const { exports, handle } = createExportsController(exportService);
  const router = Router();

  router.use(...guards.books);
  // Each export as a styled Excel workbook, or as plain CSV for other software.
  for (const [name, make] of Object.entries(exports)) {
    for (const format of ['csv', 'xlsx'] as ExportFormat[]) router.get(`/${name}.${format}`, handle(make, format));
  }

  return router;
}

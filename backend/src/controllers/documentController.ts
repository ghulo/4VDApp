import type { Request, Response } from 'express';
import type { DocumentService } from '../services/DocumentService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { documentPrintQuerySchema, documentQuerySchema, fiscalReceiptSchema } from '../validators/documentValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createDocumentController(documentService: DocumentService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const { items, meta } = await documentService.list(parseInput(documentQuerySchema, req.query));
      sendSuccess(res, items, { meta });
    },

    async get(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await documentService.get(id, req.user!));
    },

    /** The A4 page as HTML, for the browser's print dialog or the phone's PDF maker. */
    async print(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { language } = parseInput(documentPrintQuerySchema, req.query);
      const html = await documentService.html(id, req.user!, language ?? req.user!.language);
      res.type('html').set('Cache-Control', 'no-store').send(html);
    },

    async setFiscalReceipt(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { fiscalReceiptNo } = parseInput(fiscalReceiptSchema, req.body);
      sendSuccess(res, await documentService.setFiscalReceipt(id, fiscalReceiptNo, req.user!));
    },
  };
}

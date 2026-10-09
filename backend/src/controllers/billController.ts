import type { Request, Response } from 'express';
import type { SupplierBillService } from '../services/SupplierBillService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { billQuerySchema, billSchema, newBillSchema, paymentParamsSchema, paymentSchema, voidBillSchema } from '../validators/orderValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';
import { uploadedImage } from './profileController.js';

export function createBillController(billService: SupplierBillService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await billService.list(parseInput(billQuerySchema, req.query)));
    },

    async summary(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await billService.summary());
    },

    async get(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await billService.get(id));
    },

    async create(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await billService.create(parseInput(newBillSchema, req.body), req.user!.id), { statusCode: 201, message: 'Bill added' });
    },

    async update(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await billService.update(id, parseInput(billSchema, req.body), req.user!.id), { message: 'Bill saved' });
    },

    async pay(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await billService.pay(id, parseInput(paymentSchema, req.body), req.user!.id), { statusCode: 201, message: 'Payment saved' });
    },

    async voidPayment(req: Request, res: Response): Promise<void> {
      const { id, paymentId } = parseInput(paymentParamsSchema, req.params);
      sendSuccess(res, await billService.voidPayment(id, paymentId, req.user!.id), { message: 'Payment removed' });
    },

    async void(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { note } = parseInput(voidBillSchema, req.body);
      sendSuccess(res, await billService.void(id, note, req.user!.id), { message: 'Bill voided' });
    },

    async setPhoto(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await billService.setPhoto(id, uploadedImage(req), req.user!.id), { message: 'Photo saved' });
    },

    async removePhoto(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await billService.setPhoto(id, null, req.user!.id), { message: 'Photo removed' });
    },
  };
}

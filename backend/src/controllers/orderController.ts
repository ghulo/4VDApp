import type { Request, Response } from 'express';
import type { PurchaseOrderService } from '../services/PurchaseOrderService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { canManage, canOversee } from '../utils/roles.js';
import { newOrderSchema, receiveOrderSchema, supplierSchema } from '../validators/orderValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createOrderController(orderService: PurchaseOrderService) {
  return {
    async suppliers(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await orderService.suppliers());
    },

    async addSupplier(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await orderService.addSupplier(parseInput(supplierSchema, req.body), req.user!.id), { statusCode: 201 });
    },

    async updateSupplier(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await orderService.updateSupplier(id, parseInput(supplierSchema, req.body), req.user!.id));
    },

    async removeSupplier(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await orderService.removeSupplier(id, req.user!.id);
      sendSuccess(res, null, { message: 'Supplier removed' });
    },

    async list(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await orderService.list());
    },

    async get(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await orderService.get(id));
    },

    async usualSuppliers(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await orderService.usualSuppliers());
    },

    async create(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await orderService.create(parseInput(newOrderSchema, req.body), req.user!.id), { statusCode: 201, message: 'Order created' });
    },

    async deliveries(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await orderService.deliveries());
    },

    async receive(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const actor = { id: req.user!.id, canSetCosts: canManage(req.user!.role) };
      const order = await orderService.receive(id, parseInput(receiveOrderSchema, req.body), actor);
      // The counter gets a plain answer; costs stay with the people who run the shop.
      sendSuccess(res, canOversee(req.user!.role) ? order : { id: order.id, status: order.status }, { message: 'Delivery received' });
    },

    async cancel(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await orderService.cancel(id, req.user!.id), { message: 'Order cancelled' });
    },
  };
}

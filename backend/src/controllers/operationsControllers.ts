import type { Request, Response } from 'express';
import type { AnalyticsService } from '../services/AnalyticsService.js';
import type { FavoriteService } from '../services/FavoriteService.js';
import type { NotificationService } from '../services/NotificationService.js';
import type { PushService } from '../services/PushService.js';
import type { SalesService } from '../services/SalesService.js';
import type { UserService } from '../services/UserService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  createUserSchema,
  dashboardQuerySchema,
  notificationQuerySchema,
  pushDeviceSchema,
  pushPreferencesSchema,
  recordSaleSchema,
  removePushDeviceSchema,
  revenueQuerySchema,
  saleQuerySchema,
  updateUserSchema,
  userQuerySchema,
} from '../validators/operationsValidators.js';
import { idParamsSchema, parseInput, productIdParamsSchema } from '../validators/validate.js';

export function createSalesController(salesService: SalesService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const query = parseInput(saleQuerySchema, req.query);
      const { items, meta, revenue } = await salesService.list(query);
      // totalRevenue covers every sale matching the filters, not just this page.
      sendSuccess(res, { sales: items, totalRevenue: revenue }, { meta });
    },

    async record(req: Request, res: Response): Promise<void> {
      const input = parseInput(recordSaleSchema, req.body);
      const sale = await salesService.record(input, req.user!.id);
      sendSuccess(res, sale, { statusCode: 201, message: 'Sale recorded' });
    },
  };
}

export function createAnalyticsController(analyticsService: AnalyticsService) {
  return {
    async dashboard(req: Request, res: Response): Promise<void> {
      const { days } = parseInput(dashboardQuerySchema, req.query);
      sendSuccess(res, await analyticsService.dashboard(days));
    },

    async revenue(req: Request, res: Response): Promise<void> {
      const query = parseInput(revenueQuerySchema, req.query);
      sendSuccess(res, await analyticsService.revenue(query.period, query.startDate, query.endDate, query.productId));
    },

    async product(req: Request, res: Response): Promise<void> {
      const { productId } = parseInput(productIdParamsSchema, req.params);
      sendSuccess(res, await analyticsService.product(productId));
    },
  };
}

export function createUserController(userService: UserService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const query = parseInput(userQuerySchema, req.query);
      const { items, meta } = await userService.list(query);
      sendSuccess(res, items, { meta });
    },

    async create(req: Request, res: Response): Promise<void> {
      const input = parseInput(createUserSchema, req.body);
      sendSuccess(res, await userService.create(input, req.user!.id), { statusCode: 201, message: 'Account created' });
    },

    async update(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const input = parseInput(updateUserSchema, req.body);
      sendSuccess(res, await userService.update(id, input, req.user!.id), { message: 'Account updated' });
    },

    async remove(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await userService.delete(id, req.user!.id);
      sendSuccess(res, null, { message: 'Account removed' });
    },
  };
}

export function createNotificationController(notificationService: NotificationService, pushService: PushService) {
  return {
    async pushSettings(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await pushService.settings(req.user!.id, req.user!.role));
    },

    async updatePushPreferences(req: Request, res: Response): Promise<void> {
      const changes = parseInput(pushPreferencesSchema, req.body);
      sendSuccess(res, await pushService.updatePreferences(req.user!.id, req.user!.role, changes), { message: 'Saved' });
    },

    async addPushDevice(req: Request, res: Response): Promise<void> {
      const device = parseInput(pushDeviceSchema, req.body);
      await pushService.addDevice(
        req.user!.id,
        device.kind === 'expo'
          ? { kind: 'expo', token: device.token, keys: null }
          : { kind: 'web', token: device.endpoint, keys: device.keys },
      );
      sendSuccess(res, await pushService.settings(req.user!.id, req.user!.role), { statusCode: 201, message: 'Alerts switched on' });
    },

    async sendTestPush(req: Request, res: Response): Promise<void> {
      await pushService.sendTest(req.user!.id);
      sendSuccess(res, null, { statusCode: 202, message: 'Test alert on its way' });
    },

    async removePushDevice(req: Request, res: Response): Promise<void> {
      const { token } = parseInput(removePushDeviceSchema, req.body);
      await pushService.removeDevice(req.user!.id, token);
      sendSuccess(res, await pushService.settings(req.user!.id, req.user!.role), { message: 'Alerts switched off' });
    },

    async list(req: Request, res: Response): Promise<void> {
      const query = parseInput(notificationQuerySchema, req.query);
      const { items, meta, unreadCount } = await notificationService.list(req.user!.id, query);
      sendSuccess(res, { notifications: items, unreadCount }, { meta });
    },

    async markRead(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await notificationService.markRead(req.user!.id, id);
      sendSuccess(res, null, { message: 'Marked as read' });
    },

    async markAllRead(req: Request, res: Response): Promise<void> {
      await notificationService.markAllRead(req.user!.id);
      sendSuccess(res, null, { message: 'All marked as read' });
    },
  };
}

export function createFavoriteController(favoriteService: FavoriteService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await favoriteService.list(req.user!.id, req.user!.role));
    },

    async listIds(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await favoriteService.listIds(req.user!.id));
    },

    async add(req: Request, res: Response): Promise<void> {
      const { productId } = parseInput(productIdParamsSchema, req.params);
      await favoriteService.add(req.user!.id, productId);
      sendSuccess(res, null, { message: 'Added to favorites' });
    },

    async remove(req: Request, res: Response): Promise<void> {
      const { productId } = parseInput(productIdParamsSchema, req.params);
      await favoriteService.remove(req.user!.id, productId);
      sendSuccess(res, null, { message: 'Removed from favorites' });
    },
  };
}

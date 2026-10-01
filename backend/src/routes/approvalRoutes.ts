import { Router } from 'express';
import type { Container } from '../container.js';
import { createSettingsController } from '../controllers/settingsController.js';

export function createSettingsRoutes({ settingsService, guards }: Container): Router {
  const controller = createSettingsController(settingsService);
  const router = Router();

  // Employees read the limits so the phone can say when something needs approval.
  router.get('/', ...guards.staff, controller.get);
  router.put('/', ...guards.admin, controller.update);

  return router;
}

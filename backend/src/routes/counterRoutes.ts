import { Router } from 'express';
import type { Container } from '../container.js';
import { createCounterController } from '../controllers/counterController.js';

/** The counter: everyone who sells reads its settings and records what happened; the people who run the shop set it up and read the report. */
export function createCounterRoutes({ counterService, guards }: Container): Router {
  const controller = createCounterController(counterService);
  const router = Router();

  router.get('/settings', ...guards.staff, controller.settings);
  router.put('/settings', ...guards.manage, controller.updateSettings);
  router.post('/events', ...guards.staff, controller.record);
  router.get('/today', ...guards.staff, controller.today);
  router.get('/people', ...guards.oversee, controller.people);
  router.get('/events', ...guards.oversee, controller.events);

  return router;
}

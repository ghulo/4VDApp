import { Router } from 'express';
import type { Container } from '../container.js';
import { createCounterController } from '../controllers/counterController.js';
import { createCounterPinController } from '../controllers/counterPinController.js';

/** The counter: everyone who sells reads its settings and records what happened; the people who run the shop set it up and read the report. */
export function createCounterRoutes({ counterService, counterPinService, productService, cashCountService, guards, config }: Container): Router {
  const controller = createCounterController(counterService, productService, cashCountService);
  const pins = createCounterPinController(counterPinService, config.refreshTokenTtlDays);
  const router = Router();

  router.get('/settings', ...guards.staff, controller.settings);
  router.put('/settings', ...guards.manage, controller.updateSettings);
  // The tiles on an empty basket; the till reads them on its shelf.
  router.put('/quick-keys', ...guards.manage, controller.setQuickKeys);
  router.post('/events', ...guards.staff, controller.record);
  // The whole shelf in one answer, so the till starts at once.
  router.get('/shelf', ...guards.staff, controller.shelf);
  // The till's own: the shelf, and which of the sales it keeps off it 4VD already counts.
  router.post('/shelf', ...guards.staff, controller.shelfCounting);
  router.get('/today', ...guards.staff, controller.today);
  // Anyone at the counter finds a receipt to give something back, whoever sold it.
  router.get('/receipts', ...guards.staff, controller.receipts);
  router.get('/people', ...guards.oversee, controller.people);
  router.get('/events', ...guards.oversee, controller.events);
  // A PIN works only from a session already signed in at the Counter.
  router.get('/pin-people', ...guards.staff, pins.people);
  router.post('/switch', ...guards.staff, pins.switchTo);
  router.post('/rabat-approvals', ...guards.staff, pins.allowRabat);
  router.post('/pay-later-approvals', ...guards.staff, pins.allowPayLater);

  return router;
}

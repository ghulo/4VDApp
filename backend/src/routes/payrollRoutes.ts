import { Router } from 'express';
import type { Container } from '../container.js';
import { createPayrollController } from '../controllers/payrollController.js';

/** Employees and payroll: the owner and the accountant (the payroll power); each person reads their own payslips and leave. */
export function createPayrollRoutes({ payrollService, guards, config }: Container): Router {
  const controller = createPayrollController(payrollService, config.shopTimeZone);
  const router = Router();

  router.get('/me', guards.authenticated, controller.mine);
  router.get('/months/:id/payslips/:employeeId', guards.authenticated, controller.payslip);

  router.get('/employees', ...guards.payroll, controller.list);
  router.post('/employees', ...guards.payroll, controller.create);
  router.get('/employees/:id', ...guards.payroll, controller.get);
  router.put('/employees/:id', ...guards.payroll, controller.update);
  router.post('/employees/:id/leave', ...guards.payroll, controller.addLeave);
  router.delete('/leave/:id', ...guards.payroll, controller.removeLeave);

  router.get('/months', ...guards.payroll, controller.months);
  router.post('/run/:month/preview', ...guards.payroll, controller.preview);
  router.post('/run/:month', ...guards.payroll, controller.confirm);
  router.get('/months/:id', ...guards.payroll, controller.month);
  router.post('/months/:id/undo', ...guards.payroll, controller.undo);
  router.post('/months/:id/pay-wages', ...guards.payroll, controller.payWages);
  router.post('/months/:id/pay-atk', ...guards.payroll, controller.payAtk);
  router.get('/months/:id/declaration', ...guards.payroll, controller.declaration);
  router.post('/payments/:id/undo', ...guards.payroll, controller.undoPayment);

  return router;
}

import type { Request, Response } from 'express';
import { ForbiddenError } from '../errors/httpErrors.js';
import { declarationSheet, payslipHtml } from '../services/payroll/payrollExport.js';
import type { PayrollService } from '../services/payroll/PayrollService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { hasPower } from '../utils/roles.js';
import { sheetToCsv, sheetToXlsx } from '../utils/spreadsheet.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';
import {
  changesSchema,
  declarationQuery,
  employeeSchema,
  langQuery,
  leaveSchema,
  monthParams,
  payAtkSchema,
  payslipParams,
  payWagesSchema,
} from '../validators/payrollValidators.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const attachment = (name: string) => `attachment; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export function createPayrollController(service: PayrollService, timeZone: string) {
  return {
    async list(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.list());
    },
    async team(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.team());
    },
    async get(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.get(id));
    },
    async create(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.create(parseInput(employeeSchema, req.body), req.user!.id), { statusCode: 201, message: 'Added to the payroll' });
    },
    async update(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.update(id, parseInput(employeeSchema, req.body), req.user!.id), { message: 'Saved' });
    },
    async addLeave(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.addLeave(id, parseInput(leaveSchema, req.body), req.user!.id), { statusCode: 201, message: 'Leave saved' });
    },
    async removeLeave(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.removeLeave(id, req.user!.id), { message: 'Leave removed' });
    },
    async months(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.months());
    },
    async preview(req: Request, res: Response): Promise<void> {
      const { month } = parseInput(monthParams, req.params);
      const { changes } = parseInput(changesSchema, req.body);
      sendSuccess(res, await service.preview(`${month}-01`, changes));
    },
    async confirm(req: Request, res: Response): Promise<void> {
      const { month } = parseInput(monthParams, req.params);
      const { changes } = parseInput(changesSchema, req.body);
      sendSuccess(res, await service.confirm(`${month}-01`, changes, req.user!.id), { statusCode: 201, message: 'Payroll confirmed' });
    },
    async month(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.month(id));
    },
    async undo(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await service.undo(id, req.user!.id);
      sendSuccess(res, null, { message: 'Payroll taken back' });
    },
    async payWages(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.payWages(id, parseInput(payWagesSchema, req.body), req.user!.id), { statusCode: 201, message: 'Wages paid' });
    },
    async payAtk(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.payAtk(id, parseInput(payAtkSchema, req.body), req.user!.id), { statusCode: 201, message: 'ATK paid' });
    },
    async undoPayment(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.undoPayment(id, req.user!.id), { message: 'Payment taken back' });
    },
    async declaration(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { lang, format } = parseInput(declarationQuery, req.query);
      const file = declarationSheet(await service.month(id), lang);
      if (format === 'csv') {
        res.setHeader('Content-Disposition', attachment(`${file.basename}.csv`));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.send(sheetToCsv(file.sheet));
        return;
      }
      res.setHeader('Content-Disposition', attachment(`${file.basename}.xlsx`));
      res.setHeader('Content-Type', XLSX_TYPE);
      const madeAt = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone });
      res.send(await sheetToXlsx(file.sheet, madeAt));
    },
    /** A payslip: anyone with the payroll power, or the person it belongs to. */
    async payslip(req: Request, res: Response): Promise<void> {
      const { id, employeeId } = parseInput(payslipParams, req.params);
      const { lang } = parseInput(langQuery, req.query);
      if (!hasPower(req.user!.role, 'payroll') && (await service.idForUser(req.user!.id)) !== employeeId) throw new ForbiddenError('You can open only your own payslips');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(payslipHtml(await service.payslip(id, employeeId), lang));
    },
    /** Your own payslips and leave (null when you are not on the payroll). */
    async mine(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.mine(req.user!.id));
    },
  };
}

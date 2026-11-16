import { apiDownload, apiRequest, saveDownload } from './apiClient';

/** What the API sends for Payroll (backend/src/services/payroll/PayrollService.ts). */

export type Contract = 'open' | 'fixed' | 'part_time';
export type StaffPlace = 'shop' | 'carwash';
export type PayrollPaymentKind = 'wages' | 'tax' | 'pension';

export interface EmployeeInput {
  userId: number | null;
  name: string;
  personalNumber: string | null;
  jobTitle: string | null;
  contract: Contract;
  startedOn: string;
  contractEndsOn: string | null;
  leftOn: string | null;
  payBasis: 'gross' | 'net';
  payAmount: number;
  secondary: boolean;
  nonResident: boolean;
  extraPensionEmployee: number;
  extraPensionEmployer: number;
  bankAccount: string | null;
  bankName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  birthDate: string | null;
  place: StaffPlace;
  leaveDays: number;
  note: string | null;
}

/** A team account that can be linked to someone on the payroll. */
export interface PayrollTeamMember {
  id: number;
  name: string;
  role: string;
  email: string;
  phone: string | null;
}

export interface LeaveBalance {
  yearly: number;
  earned: number;
  taken: number;
  adjusted: number;
  balance: number;
}

export interface Employee extends EmployeeInput {
  id: number;
  userName: string | null;
  monthlyGross: number | null;
  leave: LeaveBalance;
  gone: boolean;
}

export interface LeaveEntry {
  id: number;
  kind: 'taken' | 'adjust';
  from: string;
  to: string;
  days: number;
  note: string | null;
}

export interface PayslipRef {
  monthId: number;
  month: string;
  gross: number;
  net: number;
}

export interface EmployeeDetail extends Employee {
  leaveEntries: LeaveEntry[];
  payslips: PayslipRef[];
}

export type LineWarning =
  | { key: 'belowMinimum'; minimum: number }
  | { key: 'partMonth'; startedOn: string | null; leftOn: string | null }
  | { key: 'leaveOwed'; days: number }
  | { key: 'noPersonalNumber' };

export interface TaxPart {
  base: number;
  rate: number;
  tax: number;
}

export interface PayLine {
  employeeId: number;
  name: string;
  personalNumber: string | null;
  place: StaffPlace;
  secondary: boolean;
  nonResident: boolean;
  gross: number;
  employeeRate: number;
  employerRate: number;
  employeePension: number;
  employerPension: number;
  taxable: number;
  taxParts: TaxPart[];
  tax: number;
  net: number;
  cost: number;
  contractGross: number;
  payBasis: 'gross' | 'net';
  changedReason: string | null;
  warnings: LineWarning[];
}

export interface PayrollTotals {
  people: number;
  gross: number;
  employeePension: number;
  employerPension: number;
  tax: number;
  net: number;
  cost: number;
  toAtk: number;
  carwashGross: number;
}

export interface PayrollPreview {
  month: string;
  dueOn: string;
  lines: PayLine[];
  totals: PayrollTotals;
  confirmedId: number | null;
}

export interface PayrollPayment {
  id: number;
  kind: PayrollPaymentKind;
  placeId: number;
  placeName: string | null;
  placeKind: string;
  paidOn: string;
  amount: number;
  carwashAmount: number;
  employeeIds: number[];
  note: string | null;
}

export interface PayrollMonth {
  id: number;
  month: string;
  dueOn: string;
  confirmedAt: string;
  confirmedBy: string | null;
  totals: PayrollTotals;
  wagesLeft: number;
  taxLeft: number;
  pensionLeft: number;
}

export interface PayrollMonthDetail extends PayrollMonth {
  lines: PayLine[];
  payments: PayrollPayment[];
  unpaid: Array<{ employeeId: number; amount: number }>;
}

export interface LineChange {
  employeeId: number;
  gross: number;
  reason: string;
}

export interface MyPay {
  employeeId: number;
  leave: LeaveBalance;
  leaveEntries: LeaveEntry[];
  payslips: PayslipRef[];
}

/** "2026-10" from "2026-10-01". */
const monthKey = (month: string) => month.slice(0, 7);

export const PAYROLL_KEY = ['payroll'];

export const payrollApi = {
  employees: async () => (await apiRequest<Employee[]>('/payroll/employees')).data,
  team: async () => (await apiRequest<PayrollTeamMember[]>('/payroll/team')).data,
  employee: async (id: number) => (await apiRequest<EmployeeDetail>(`/payroll/employees/${id}`)).data,
  create: async (input: EmployeeInput) => (await apiRequest<EmployeeDetail>('/payroll/employees', { method: 'POST', body: input })).data,
  update: async (id: number, input: EmployeeInput) => (await apiRequest<EmployeeDetail>(`/payroll/employees/${id}`, { method: 'PUT', body: input })).data,
  addLeave: async (id: number, input: { kind: 'taken' | 'adjust'; from: string; to: string; days: number | null; note: string | null }) =>
    (await apiRequest<EmployeeDetail>(`/payroll/employees/${id}/leave`, { method: 'POST', body: input })).data,
  removeLeave: async (leaveId: number) => (await apiRequest<EmployeeDetail>(`/payroll/leave/${leaveId}`, { method: 'DELETE' })).data,
  months: async () => (await apiRequest<PayrollMonth[]>('/payroll/months')).data,
  month: async (id: number) => (await apiRequest<PayrollMonthDetail>(`/payroll/months/${id}`)).data,
  preview: async (month: string, changes: LineChange[]) => (await apiRequest<PayrollPreview>(`/payroll/run/${monthKey(month)}/preview`, { method: 'POST', body: { changes } })).data,
  confirm: async (month: string, changes: LineChange[]) => (await apiRequest<PayrollMonthDetail>(`/payroll/run/${monthKey(month)}`, { method: 'POST', body: { changes } })).data,
  undo: async (id: number) => {
    await apiRequest<null>(`/payroll/months/${id}/undo`, { method: 'POST' });
  },
  payWages: async (id: number, input: { placeId: number; paidOn: string; employeeIds: number[] | null; note: string | null }) =>
    (await apiRequest<PayrollMonthDetail>(`/payroll/months/${id}/pay-wages`, { method: 'POST', body: input })).data,
  payAtk: async (id: number, input: { placeId: number; paidOn: string; note: string | null }) =>
    (await apiRequest<PayrollMonthDetail>(`/payroll/months/${id}/pay-atk`, { method: 'POST', body: input })).data,
  undoPayment: async (paymentId: number) => (await apiRequest<PayrollMonthDetail>(`/payroll/payments/${paymentId}/undo`, { method: 'POST' })).data,
  async declaration(id: number, format: 'xlsx' | 'csv', lang: 'sq' | 'en'): Promise<void> {
    const { blob, filename } = await apiDownload(`/payroll/months/${id}/declaration`, { format, lang });
    saveDownload(blob, filename ?? `payroll.${format}`);
  },
  /** The payslip as a page to print or save as PDF. */
  payslipHtml: async (monthId: number, employeeId: number, lang: 'sq' | 'en') => (await apiDownload(`/payroll/months/${monthId}/payslips/${employeeId}`, { lang })).blob.text(),
  mine: async () => (await apiRequest<MyPay | null>('/payroll/me')).data,
};

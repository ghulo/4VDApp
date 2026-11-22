import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import type { Container } from '../container.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { idParamsSchema, idSchema, parseInput } from '../validators/validate.js';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

const lookupSchema = z.object({ nui: z.string().trim().max(30).optional(), q: z.string().trim().max(100).optional() });

const readSchema = z
  .object({
    side: z.enum(['customer', 'supplier']),
    text: z.string().max(20_000).optional(),
    pages: z
      .array(z.object({ mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']), data: z.string().min(1) }))
      .max(4, 'at most 4 pages')
      .optional(),
  })
  .refine((input) => (input.pages?.length ?? 0) > 0 || (input.text ?? '').trim().length > 0, { path: ['text'], message: 'add a photo, or paste the text' });

const addressSchema = z.object({
  label: z.string().trim().min(1, 'give it a name, like Warehouse').max(60),
  address: z.string().trim().min(1, 'type the address').max(300),
  city: text(100),
  note: text(300),
});

const ownerSchema = z.object({ side: z.enum(['customers', 'suppliers']), id: idSchema });
const linkSchema = z
  .object({ customerId: idSchema.optional(), supplierId: idSchema.optional() })
  .refine((input) => (input.customerId === undefined) !== (input.supplierId === undefined), { message: 'give a customerId or a supplierId' });
const offsetSchema = z.object({ amount: z.number().positive().max(10_000_000).multipleOf(0.01).nullish(), note: text(300) });
const bonusParamsSchema = z.object({ id: idSchema, year: z.coerce.number().int().min(2000).max(2100) });

/**
 * Partners: filling a new firm in (look-up, reading a photo or pasted text),
 * extra addresses, a firm on both lists (offset), and a customer's yearly bonus.
 */
export function createPartnerRoutes({ partnerService, guards }: Container): Router {
  const router = Router();
  const ownerOf = (params: unknown) => {
    const { side, id } = parseInput(ownerSchema, params);
    return side === 'customers' ? { customerId: id } : { supplierId: id };
  };

  // Anyone who adds a customer (the counter too) can look a firm up or have it read.
  router.get('/lookup', ...guards.staff, async (req: Request, res: Response) => {
    sendSuccess(res, await partnerService.lookup(parseInput(lookupSchema, req.query)));
  });
  router.post('/read', ...guards.staff, async (req: Request, res: Response) => {
    sendSuccess(res, await partnerService.read(parseInput(readSchema, req.body)));
  });

  router.get('/link', ...guards.books, async (req: Request, res: Response) => {
    sendSuccess(res, await partnerService.link(parseInput(linkSchema, req.query)));
  });
  router.post('/customers/:id/offset', ...guards.manage, async (req: Request, res: Response) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess(res, await partnerService.offset(id, parseInput(offsetSchema, req.body), req.user!), { message: 'Set off' });
  });

  router.get('/customers/:id/bonus', ...guards.books, async (req: Request, res: Response) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess(res, await partnerService.bonus(id));
  });
  router.post('/customers/:id/bonus/:year/pay', ...guards.manage, async (req: Request, res: Response) => {
    const { id, year } = parseInput(bonusParamsSchema, req.params);
    sendSuccess(res, await partnerService.payBonus(id, year, req.user!), { message: 'Bonus paid' });
  });

  // Addresses: the counter reads a customer's and adds one when delivering; managers change them.
  router.get('/:side/:id/addresses', ...guards.customers, async (req: Request, res: Response) => {
    sendSuccess(res, await partnerService.addresses(ownerOf(req.params)));
  });
  router.post('/:side/:id/addresses', ...guards.staff, async (req: Request, res: Response) => {
    sendSuccess(res, await partnerService.addAddress(ownerOf(req.params), parseInput(addressSchema, req.body), req.user!.id), { statusCode: 201, message: 'Address added' });
  });
  router.put('/addresses/:id', ...guards.manage, async (req: Request, res: Response) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess(res, await partnerService.updateAddress(id, parseInput(addressSchema, req.body), req.user!.id), { message: 'Address saved' });
  });
  router.delete('/addresses/:id', ...guards.manage, async (req: Request, res: Response) => {
    const { id } = parseInput(idParamsSchema, req.params);
    await partnerService.removeAddress(id, req.user!.id);
    sendSuccess(res, null, { message: 'Address removed' });
  });

  return router;
}

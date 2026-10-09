import { SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { OrderLineRecord, OrderRecord, OrderStatus, PurchaseOrderRepository, SupplierFields, SupplierRecord } from '../repositories/PurchaseOrderRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { roundMoney } from '../utils/money.js';
import { applyStockChange } from './InventoryService.js';

/** Received and cancelled orders kept on the page for reference. */
const CLOSED_SHOWN = 20;

export type SupplierDto = SupplierRecord;

export interface OrderLineDto {
  id: number;
  productId: number;
  productName: string;
  sku: string | null;
  quantity: number;
  /** What one unit costs from this supplier, when known. */
  unitCost: number | null;
  /** Set once the delivery is ticked off. */
  receivedQuantity: number | null;
}

export interface OrderDto {
  id: number;
  supplier: { id: number; name: string; phone: string | null; email: string | null };
  status: OrderStatus;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  closedAt: string | null;
  lines: OrderLineDto[];
  /** Sum of quantity × cost over lines with a known cost. */
  total: number;
}

export interface NewOrderInput {
  supplierId: number;
  note: string | null;
  lines: Array<{ productId: number; quantity: number; unitCost: number | null }>;
}

export interface ReceiveInput {
  /** `unitCost` left out keeps the ordered cost. */
  lines: Array<{ lineId: number; receivedQuantity: number; unitCost?: number | null; expiresOn?: string | null }>;
  /** Copy the delivered prices onto the products' cost prices. */
  updateCostPrices: boolean;
}

/** An open order for the team app, which ticks deliveries off at the counter and never sees costs. */
export interface DeliveryDto {
  id: number;
  supplierName: string;
  note: string | null;
  createdAt: string;
  lines: Array<Pick<OrderLineDto, 'id' | 'productId' | 'productName' | 'sku' | 'quantity'>>;
}

const toLineDto = (line: OrderLineRecord): OrderLineDto => ({
  id: line.id,
  productId: line.product_id,
  productName: line.product_name,
  sku: line.sku,
  quantity: line.quantity,
  unitCost: line.unit_cost === null ? null : Number(line.unit_cost),
  receivedQuantity: line.received_quantity,
});

function toOrderDto(order: OrderRecord, lines: OrderLineRecord[]): OrderDto {
  const dtoLines = lines.filter((line) => line.order_id === order.id).map(toLineDto);
  return {
    id: order.id,
    supplier: { id: order.supplier_id, name: order.supplier_name, phone: order.supplier_phone, email: order.supplier_email },
    status: order.status,
    note: order.note,
    createdBy: order.created_by_name,
    createdAt: order.created_at.toISOString(),
    closedAt: order.closed_at?.toISOString() ?? null,
    lines: dtoLines,
    total: roundMoney(
      dtoLines.reduce((sum, line) => sum + (line.unitCost === null ? 0 : line.unitCost * (line.receivedQuantity ?? line.quantity)), 0),
    ),
  };
}

/**
 * Ordering from suppliers: an order lists what to buy; ticking off its
 * delivery puts the stock in, optionally updating cost prices.
 */
export class PurchaseOrderService {
  constructor(
    private readonly orderRepository: PurchaseOrderRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async suppliers(): Promise<SupplierDto[]> {
    return this.orderRepository.findSuppliers();
  }

  async addSupplier(input: SupplierFields, actorId: number): Promise<SupplierDto> {
    const id = await this.transactions.run(async (repos) => {
      const supplierId = await repos.orders.createSupplier(input);
      await repos.activityLog.create({
        userId: actorId,
        action: 'supplier.created',
        entityType: 'supplier',
        entityId: supplierId,
        summary: `Added the supplier ${input.name}`,
        details: { ...input },
      });
      return supplierId;
    });
    return (await this.orderRepository.findSupplier(id))!;
  }

  async updateSupplier(id: number, input: SupplierFields, actorId: number): Promise<SupplierDto> {
    const before = await this.orderRepository.findSupplier(id);
    if (!before) throw new NotFoundError(`Supplier ${id} does not exist`);
    await this.transactions.run(async (repos) => {
      await repos.orders.updateSupplier(id, input);
      await repos.activityLog.create({
        userId: actorId,
        action: 'supplier.updated',
        entityType: 'supplier',
        entityId: id,
        summary: `Changed the supplier ${before.name}'s details`,
        details: { before, after: input },
      });
    });
    return (await this.orderRepository.findSupplier(id))!;
  }

  async removeSupplier(id: number, actorId: number, now = new Date()): Promise<void> {
    const supplier = await this.orderRepository.findSupplier(id);
    if (!supplier) throw new NotFoundError(`Supplier ${id} does not exist`);
    await this.transactions.run(async (repos) => {
      await repos.orders.archiveSupplier(id, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'supplier.removed',
        entityType: 'supplier',
        entityId: id,
        summary: `Removed the supplier ${supplier.name}`,
        details: null,
      });
    });
  }

  async list(): Promise<OrderDto[]> {
    const orders = await this.orderRepository.findOrders(CLOSED_SHOWN);
    const lines = await this.orderRepository.findLines(orders.map((order) => order.id));
    return orders.map((order) => toOrderDto(order, lines));
  }

  async get(id: number): Promise<OrderDto> {
    const order = await this.orderRepository.findOrder(id);
    if (!order) throw new NotFoundError(`Order ${id} does not exist`);
    return toOrderDto(order, await this.orderRepository.findLines([id]));
  }

  /** Open orders as the counter sees them: what is coming, without what it costs. */
  async deliveries(): Promise<DeliveryDto[]> {
    return (await this.list())
      .filter((order) => order.status === 'open')
      .map((order) => ({
        id: order.id,
        supplierName: order.supplier.name,
        note: order.note,
        createdAt: order.createdAt,
        lines: order.lines.map(({ id, productId, productName, sku, quantity }) => ({ id, productId, productName, sku, quantity })),
      }));
  }

  /** Product id → the supplier it was last ordered from. */
  async usualSuppliers(): Promise<Record<number, number>> {
    return Object.fromEntries(await this.orderRepository.lastSupplierByProduct());
  }

  async create(input: NewOrderInput, actorId: number): Promise<OrderDto> {
    const productIds = input.lines.map((line) => line.productId);
    if (new Set(productIds).size !== productIds.length) throw new ValidationError('Each product can only be on an order once');
    const supplier = await this.orderRepository.findSupplier(input.supplierId);
    if (!supplier) throw new NotFoundError(`Supplier ${input.supplierId} does not exist`);

    const id = await this.transactions.run(async (repos) => {
      const products = await repos.products.findByIds(productIds, true);
      if (products.length !== productIds.length) throw new NotFoundError('One of the products does not exist');
      const orderId = await repos.orders.createOrder({ ...input, createdBy: actorId });
      await repos.activityLog.create({
        userId: actorId,
        action: 'order.created',
        entityType: 'order',
        entityId: orderId,
        summary: `Ordered ${input.lines.length} ${input.lines.length === 1 ? 'product' : 'products'} from ${supplier.name}`,
        details: { supplierId: supplier.id, lines: input.lines },
      });
      return orderId;
    });
    return this.get(id);
  }

  /**
   * Ticks off the delivery: what came goes into stock, and the order closes.
   * Anyone at the counter can; only managers can change what things cost, so
   * for everyone else the ordered costs stand and cost prices stay as they are.
   */
  async receive(id: number, input: ReceiveInput, actor: { id: number; canSetCosts: boolean }, now = new Date()): Promise<OrderDto> {
    const actorId = actor.id;
    if (!actor.canSetCosts) {
      input = { lines: input.lines.map((line) => ({ ...line, unitCost: undefined })), updateCostPrices: false };
    }
    await this.transactions.run(async (repos) => {
      const order = await repos.orders.findOrder(id);
      if (!order) throw new NotFoundError(`Order ${id} does not exist`);
      if (order.status !== 'open') throw new ConflictError('This order is already closed');
      const lines = await repos.orders.findLines([id]);
      const received = new Map(input.lines.map((line) => [line.lineId, line]));
      if ([...received.keys()].some((lineId) => !lines.some((line) => line.id === lineId))) {
        throw new ValidationError('One of the lines is not on this order');
      }

      let units = 0;
      for (const line of lines) {
        const delivered = received.get(line.id);
        const quantity = delivered?.receivedQuantity ?? 0;
        const ordered = line.unit_cost === null ? null : Number(line.unit_cost);
        const unitCost = delivered?.unitCost === undefined ? ordered : delivered.unitCost;
        await repos.orders.setReceived(line.id, quantity, unitCost);
        if (quantity === 0) continue;
        const product = (await repos.products.findById(line.product_id, true))!;
        await applyStockChange(repos, {
          productId: product.id,
          productName: product.name,
          delta: quantity,
          reason: SYSTEM_STOCK_REASONS.DELIVERY,
          notes: `Order #${id} from ${order.supplier_name}`,
          adjustedBy: actorId,
          reorderLevel: product.reorder_level ?? 0,
        });
        if (delivered?.expiresOn) {
          await repos.expiry.add({
            productId: product.id,
            quantity,
            expiresOn: delivered.expiresOn,
            note: `Order #${id} from ${order.supplier_name}`,
            orderLineId: line.id,
            createdBy: actorId,
          });
        }
        if (input.updateCostPrices && unitCost !== null && unitCost !== (product.cost_price === null ? null : Number(product.cost_price))) {
          await repos.orders.setCostPrice(product.id, unitCost);
        }
        units += quantity;
      }
      await repos.orders.close(id, 'received', actorId, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'order.received',
        entityType: 'order',
        entityId: id,
        summary: `Received order #${id} from ${order.supplier_name}: ${units} ${units === 1 ? 'unit' : 'units'} into stock`,
        details: { ...input },
      });
    });
    return this.get(id);
  }

  async cancel(id: number, actorId: number, now = new Date()): Promise<OrderDto> {
    const order = await this.orderRepository.findOrder(id);
    if (!order) throw new NotFoundError(`Order ${id} does not exist`);
    if (order.status !== 'open') throw new ConflictError('This order is already closed');
    await this.transactions.run(async (repos) => {
      await repos.orders.close(id, 'cancelled', actorId, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'order.cancelled',
        entityType: 'order',
        entityId: id,
        summary: `Cancelled order #${id} from ${order.supplier_name}`,
        details: null,
      });
    });
    return this.get(id);
  }
}

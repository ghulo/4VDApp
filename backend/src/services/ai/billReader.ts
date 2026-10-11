import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { AiUnavailableError } from '../../errors/httpErrors.js';
import { logger } from '../../utils/logger.js';
import { toUnavailable } from './claudeProvider.js';

/** What the AI reads off a supplier's bill. Anything it can't read is null, never guessed. */
export const billReadingSchema = z.object({
  supplier: z.object({
    name: z.string().nullable(),
    /** The supplier's NUI (Kosovo business number), digits only. */
    nui: z.string().nullable(),
  }),
  number: z.string().nullable(),
  /** YYYY-MM-DD. */
  issuedOn: z.string().nullable(),
  dueOn: z.string().nullable(),
  /** Whether the unit prices printed on the lines already include VAT (TVSH). */
  pricesIncludeVat: z.boolean(),
  lines: z.array(
    z.object({
      /** The supplier's own article code (shifra), if printed. */
      code: z.string().nullable(),
      barcode: z.string().nullable(),
      name: z.string(),
      quantity: z.number(),
      /** As printed: copë, pako, kg, box… */
      unit: z.string().nullable(),
      /** Pieces in one unit when the bill says so (a box of 12 → 12). */
      unitsPerPack: z.number().nullable(),
      unitPrice: z.number().nullable(),
      /** Rabat on the line, in percent. */
      discountPercent: z.number().nullable(),
      vatRate: z.number().nullable(),
      lineTotal: z.number().nullable(),
    }),
  ),
  totals: z.object({ net: z.number().nullable(), vat: z.number().nullable(), gross: z.number().nullable() }),
  /** Anything the reader was unsure of, in a sentence. */
  remarks: z.string().nullable(),
});
export type BillReading = z.infer<typeof billReadingSchema>;

/**
 * What Claude actually fills in. Structured outputs allow only a few nullable
 * (union) fields per schema, so text it can't find comes back as "", a missing
 * rabat as 0 and an unstated box size as 1; only numbers where 0 would be a
 * real value stay nullable. toReading turns the blanks back into nulls.
 */
export const wireSchema = z.object({
  supplier: z.object({ name: z.string(), nui: z.string() }),
  number: z.string(),
  issuedOn: z.string(),
  dueOn: z.string(),
  pricesIncludeVat: z.boolean(),
  lines: z.array(
    z.object({
      code: z.string(),
      barcode: z.string(),
      name: z.string(),
      quantity: z.number(),
      unit: z.string(),
      unitsPerPack: z.number(),
      unitPrice: z.number().nullable(),
      discountPercent: z.number(),
      vatRate: z.number().nullable(),
      lineTotal: z.number().nullable(),
    }),
  ),
  totals: z.object({ net: z.number().nullable(), vat: z.number().nullable(), gross: z.number().nullable() }),
  remarks: z.string(),
});
type WireReading = z.infer<typeof wireSchema>;

const text = (value: string) => value.trim() || null;

/** The reply with blanks turned back into nulls: the shape the rest of 4VD works with. */
export function toReading(wire: WireReading): BillReading {
  return {
    supplier: { name: text(wire.supplier.name), nui: text(wire.supplier.nui) },
    number: text(wire.number),
    issuedOn: text(wire.issuedOn),
    dueOn: text(wire.dueOn),
    pricesIncludeVat: wire.pricesIncludeVat,
    lines: wire.lines.map((line) => ({
      code: text(line.code),
      barcode: text(line.barcode),
      name: line.name,
      quantity: line.quantity,
      unit: text(line.unit),
      unitsPerPack: line.unitsPerPack > 1 ? line.unitsPerPack : null,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent > 0 ? line.discountPercent : null,
      vatRate: line.vatRate,
      lineTotal: line.lineTotal,
    })),
    totals: wire.totals,
    remarks: text(wire.remarks),
  };
}

export interface BillPage {
  mime: string;
  bytes: Buffer;
}

/** Reads a photographed or PDF supplier bill into fields. */
export interface BillReader {
  read(pages: BillPage[]): Promise<BillReading>;
}

/**
 * Opus at medium effort: invoices are dense and a misread price costs more
 * than the few cents a scan takes. Kept apart from the Ask model, which
 * answers short questions and can be cheaper.
 */
const MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 16_000;
const TIMEOUT_MS = 120_000;

const INSTRUCTIONS = `You read supplier invoices (fatura) for a shop in Kosovo. They are usually in Albanian, sometimes English or Serbian.
Copy what is printed; never invent or correct values. For anything missing or unreadable: text fields are "" (empty), unitPrice, vatRate, lineTotal and totals are null.
- supplier: the seller (shitësi/furnitori), not the buyer. NUI is the seller's business number; digits only.
- number: the invoice number. Dates as YYYY-MM-DD; the due date only if printed (afati i pagesës).
- One entry per product line, in order. quantity and unitPrice exactly as printed for that line, in the line's own unit.
- unitsPerPack: how many pieces a unit holds when the line states it (e.g. "pako 12 copë" is 12), else 1.
- discountPercent is the line's rabat, 0 if none. vatRate is the line's TVSH percent (18, 8 or 0).
- pricesIncludeVat: true only if the unit prices already include TVSH.
- totals: net (pa TVSH), vat (TVSH) and gross (gjithsej për pagesë) as printed.
- remarks: one short sentence on anything unclear (a smudged line, a handwritten change), else "".`;

export class ClaudeBillReader implements BillReader {
  private readonly client: Anthropic;

  constructor(apiKey: string, options: { workspaceId?: string; client?: Anthropic } = {}) {
    this.client =
      options.client ??
      new Anthropic({
        apiKey,
        timeout: TIMEOUT_MS,
        ...(options.workspaceId && { defaultHeaders: { 'anthropic-workspace-id': options.workspaceId } }),
      });
  }

  async read(pages: BillPage[]): Promise<BillReading> {
    const content: Anthropic.ContentBlockParam[] = pages.map((page) =>
      page.mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: page.bytes.toString('base64') } }
        : { type: 'image', source: { type: 'base64', media_type: page.mime as 'image/webp', data: page.bytes.toString('base64') } },
    );
    content.push({ type: 'text', text: pages.length > 1 ? `Read this ${pages.length}-page invoice.` : 'Read this invoice.' });

    let response;
    try {
      response = await this.client.messages.parse({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: INSTRUCTIONS,
        messages: [{ role: 'user', content }],
        output_config: { format: zodOutputFormat(wireSchema), effort: 'medium' },
      });
    } catch (error) {
      throw toUnavailable(error);
    }
    // Each scan's cost: input is mostly the pictures, output the lines read.
    logger.info('Claude read a supplier bill', {
      model: response.model,
      pages: pages.length,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    });
    if (response.stop_reason === 'refusal' || response.parsed_output == null) {
      throw new AiUnavailableError("The bill couldn't be read. Try a sharper photo, or add the bill by hand.");
    }
    return toReading(response.parsed_output);
  }
}

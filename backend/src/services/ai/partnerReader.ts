import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { AiUnavailableError } from '../../errors/httpErrors.js';
import { logger } from '../../utils/logger.js';
import { toUnavailable } from './claudeProvider.js';

/** A firm's details read off a photo or pasted text. Anything not printed is "" (empty), never guessed. */
export const partnerWireSchema = z.object({
  name: z.string(),
  kind: z.enum(['person', 'business']),
  nui: z.string(),
  fiscalNo: z.string(),
  vatNo: z.string(),
  businessNo: z.string(),
  address: z.string(),
  city: z.string(),
  phone: z.string(),
  mobile: z.string(),
  email: z.string(),
  iban: z.string(),
  contactPerson: z.string(),
});
export type PartnerReading = z.infer<typeof partnerWireSchema>;

export interface PartnerSource {
  /** Photos or a PDF: a business certificate, an invoice, a business card. */
  pages?: Array<{ mime: string; bytes: Buffer }>;
  /** Text copied from the business register's page, an email signature, anything. */
  text?: string;
  /** Whose details to take off an invoice: a customer is its buyer, a supplier its seller. */
  side: 'customer' | 'supplier';
}

export interface PartnerReader {
  read(source: PartnerSource): Promise<PartnerReading>;
}

/** Short documents with a dozen fields: Sonnet is plenty, and cheap. */
const MODEL = 'claude-sonnet-5-5';
const MAX_TOKENS = 2_000;
const TIMEOUT_MS = 60_000;

const instructions = (side: PartnerSource['side']) => `You copy a business's details into a shop's address book in Kosovo. Sources are in Albanian, English or Serbian: a business registration certificate (ARBK, "Certifikata e regjistrimit të biznesit"), text copied from the ARBK register page, an invoice (faturë), a business card or an email signature.
Copy what is written; never invent, translate or correct. Anything not given is "" (empty).
- On an invoice, take the ${side === 'customer' ? 'buyer (blerësi)' : 'seller (shitësi/furnitori)'}, not the other party.
- name: the business name as registered (emri i biznesit / emri tregtar), or the person's name for an individual.
- kind: "business" for a company or registered trader (sh.p.k., sh.a., B.I. with a NUI), "person" for a private individual.
- nui: the unique identification number (NUI / Numri unik identifikues), digits only. businessNo: the registration number (Nr. i biznesit / NRB). fiscalNo: Numri fiskal. vatNo: Numri i TVSH-së. Digits only for all four.
- address: street and number only; city: the municipality or town (komuna).
- phone and mobile as printed; iban without spaces; contactPerson: the authorised person or owner (personi i autorizuar / pronari) when given.`;

export class ClaudePartnerReader implements PartnerReader {
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

  async read(source: PartnerSource): Promise<PartnerReading> {
    const content: Anthropic.ContentBlockParam[] = (source.pages ?? []).map((page) =>
      page.mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: page.bytes.toString('base64') } }
        : { type: 'image', source: { type: 'base64', media_type: page.mime as 'image/webp', data: page.bytes.toString('base64') } },
    );
    content.push({ type: 'text', text: source.text ? `Read this:\n\n${source.text}` : 'Read this.' });

    let response;
    try {
      response = await this.client.messages.parse({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: instructions(source.side),
        messages: [{ role: 'user', content }],
        output_config: { format: zodOutputFormat(partnerWireSchema), effort: 'low' },
      });
    } catch (error) {
      throw toUnavailable(error);
    }
    logger.info('Claude read a firm', { model: response.model, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens });
    if (response.stop_reason === 'refusal' || response.parsed_output == null) {
      throw new AiUnavailableError("The details couldn't be read. Try a sharper photo, or type them in.");
    }
    return response.parsed_output;
  }
}

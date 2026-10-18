import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { AiUnavailableError } from '../../errors/httpErrors.js';
import { logger } from '../../utils/logger.js';
import type { StatementLine } from '../money/statementFile.js';
import { toUnavailable } from './claudeProvider.js';

/** Reads a bank statement PDF into its lines, the way bill photos are read. */
export interface StatementReader {
  read(pdf: Buffer): Promise<StatementLine[]>;
}

const wireSchema = z.object({
  lines: z.array(
    z.object({
      /** YYYY-MM-DD. */
      day: z.string(),
      text: z.string(),
      moneyIn: z.number().nullable(),
      moneyOut: z.number().nullable(),
      balance: z.number().nullable(),
    }),
  ),
});

const MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 32_000;
const TIMEOUT_MS = 180_000;

const INSTRUCTIONS = `You read bank account statements (ekstrakt bankar) from banks in Kosovo. They are usually in Albanian, sometimes English.
Copy what is printed; never invent, merge or correct lines. One entry per transaction line, in the order printed.
- day: the booking date (data) as YYYY-MM-DD; statements print dates as dd.mm.yyyy.
- text: the description (përshkrimi) and, when printed, the other party's name, joined with " · ".
- moneyIn: the credit (kredi) amount, moneyOut: the debit (debi) amount; one of them is null. Amounts as plain numbers: 1.234,56 is 1234.56.
- balance: the balance (bilanci/saldo) after the line, null if not printed.
- Leave out opening balance, closing balance and totals rows.`;

export class ClaudeStatementReader implements StatementReader {
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

  async read(pdf: Buffer): Promise<StatementLine[]> {
    let response;
    try {
      response = await this.client.messages.parse({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: INSTRUCTIONS,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
              { type: 'text', text: 'Read this bank statement.' },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(wireSchema), effort: 'medium' },
      });
    } catch (error) {
      throw toUnavailable(error);
    }
    logger.info('Claude read a bank statement', { model: response.model, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens });
    if (response.stop_reason === 'refusal' || response.parsed_output == null) {
      throw new AiUnavailableError("The statement couldn't be read. Download it from the bank as Excel or CSV instead.");
    }
    return response.parsed_output.lines
      .filter((line) => /^\d{4}-\d{2}-\d{2}$/.test(line.day))
      .map((line) => ({
        day: line.day,
        text: line.text.replace(/\s+/g, ' ').trim().slice(0, 500) || '—',
        amount: Math.round((Math.abs(line.moneyIn ?? 0) - Math.abs(line.moneyOut ?? 0)) * 100) / 100,
        balance: line.balance,
      }))
      .filter((line) => line.amount !== 0);
  }
}

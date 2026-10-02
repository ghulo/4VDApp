import type { z } from 'zod';
import { AiUnavailableError } from '../../errors/httpErrors.js';
import { logger } from '../../utils/logger.js';

/**
 * The one thing the app needs from an AI service: instructions plus a
 * request in, text out. Switching from Gemini to another provider means
 * writing one more class like GeminiProvider; nothing else changes.
 */
export interface AiProvider {
  readonly name: string;
  generate(input: { instructions: string; request: string }): Promise<string>;
  /** The same, but the answer must match `schema`; used when the app needs fields, not prose. */
  generateJson<T>(input: { instructions: string; request: string }, schema: z.ZodType<T>): Promise<T>;
}

/** Shared by providers that can only promise "some JSON": check it really has the right shape. */
export function parseAiJson<T>(text: string, schema: z.ZodType<T>): T {
  // Some models wrap JSON in a ```json fence despite being asked not to.
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    throw new AiUnavailableError('The AI service gave an answer the app could not read. Try again.');
  }
  const result = schema.safeParse(data);
  if (!result.success) throw new AiUnavailableError('The AI service gave an incomplete answer. Try again.');
  return result.data;
}

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Long enough for a busy free tier, short enough that nobody stares at a spinner forever. */
const TIMEOUT_MS = 30_000;

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

/** Google Gemini through its REST API (free tier available from Google AI Studio). */
export class GeminiProvider implements AiProvider {
  readonly name: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.name = `Google ${model}`;
  }

  async generate(input: { instructions: string; request: string }): Promise<string> {
    return this.call(input, false);
  }

  async generateJson<T>(input: { instructions: string; request: string }, schema: z.ZodType<T>): Promise<T> {
    return parseAiJson(await this.call(input, true), schema);
  }

  private async call({ instructions, request }: { instructions: string; request: string }, json: boolean): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${GEMINI_URL}/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        // The key goes in a header, never in the URL, so it can't end up in logs.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instructions }] },
          contents: [{ role: 'user', parts: [{ text: request }] }],
          generationConfig: { temperature: 0.2, ...(json && { responseMimeType: 'application/json' }) },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      logger.warn('Gemini could not be reached', { error: String(error) });
      throw new AiUnavailableError('The AI service did not answer. Try again in a minute.');
    }

    if (response.status === 429) {
      throw new AiUnavailableError("The AI service's free limit is used up for now. Try again later.");
    }
    if (!response.ok) {
      const body = await response.text();
      logger.warn('Gemini refused the request', { status: response.status, body: body.slice(0, 500) });
      if (response.status !== 400 && response.status !== 403) {
        throw new AiUnavailableError('The AI service had a problem. Try again in a minute.');
      }
      // Google's own reason is the useful part, e.g. "free tier is not available in your country".
      let reason: string | undefined;
      try {
        reason = (JSON.parse(body) as { error?: { message?: string } }).error?.message;
      } catch {
        // Not JSON; fall back to the general message.
      }
      throw new AiUnavailableError(
        reason ? `The AI service refused the request: ${reason}` : 'The AI service refused the request. Check GEMINI_API_KEY and GEMINI_MODEL in the server settings.',
      );
    }

    const body = (await response.json()) as GeminiResponse;
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!text) {
      logger.warn('Gemini gave no answer', { blockReason: body.promptFeedback?.blockReason, finishReason: body.candidates?.[0]?.finishReason });
      throw new AiUnavailableError("The AI service couldn't answer that. Try asking another way.");
    }
    return text;
  }
}

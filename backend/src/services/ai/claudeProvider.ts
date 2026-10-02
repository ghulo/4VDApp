import Anthropic from '@anthropic-ai/sdk';
import { AiUnavailableError } from '../../errors/httpErrors.js';
import { logger } from '../../utils/logger.js';
import type { AiProvider } from './aiProvider.js';

/** Plenty for a short answer; the shop data is the big part and that's input. */
const MAX_ANSWER_TOKENS = 16_000;
const TIMEOUT_MS = 60_000;

/** Claude through Anthropic's official SDK. */
export class ClaudeProvider implements AiProvider {
  readonly name: string;
  private readonly client: Anthropic;
  private readonly isHaiku: boolean;

  constructor(
    apiKey: string,
    private readonly model: string,
    options: { workspaceId?: string; client?: Anthropic } = {},
  ) {
    this.name = `Anthropic ${model}`;
    this.isHaiku = model.startsWith('claude-haiku');
    this.client =
      options.client ??
      new Anthropic({
        apiKey,
        timeout: TIMEOUT_MS,
        // Keys made outside a workspace must say which workspace each request belongs to.
        ...(options.workspaceId && { defaultHeaders: { 'anthropic-workspace-id': options.workspaceId } }),
      });
  }

  async generate({ instructions, request }: { instructions: string; request: string }): Promise<string> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: MAX_ANSWER_TOKENS,
        // Haiku 4.5 accepts neither setting, so it gets a plain request.
        ...(!this.isHaiku && {
          // If a safety check declines, the API retries on a suitable model instead of failing.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default' as const,
          // Short answers from data in front of it: low effort is plenty and keeps the cost down.
          output_config: { effort: 'low' as const },
        }),
        system: instructions,
        messages: [{ role: 'user', content: request }],
      });
    } catch (error) {
      throw toUnavailable(error);
    }

    // For keeping an eye on cost: input tokens are the shop data, output the answer.
    logger.info('Claude answered', {
      model: response.model,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    });
    if (response.stop_reason === 'refusal') {
      logger.warn('Claude declined the question', { category: response.stop_details?.category });
      throw new AiUnavailableError("The AI service couldn't answer that. Try asking another way.");
    }
    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
    if (!text) throw new AiUnavailableError("The AI service couldn't answer that. Try asking another way.");
    return text;
  }
}

/** Most specific first: what went wrong decides what the owner should do about it. */
function toUnavailable(error: unknown): AiUnavailableError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new AiUnavailableError('The AI service rejected the key. Check ANTHROPIC_API_KEY in the server settings.');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiUnavailableError('Too many questions at once for the AI service. Try again in a minute.');
  }
  if (error instanceof Anthropic.APIConnectionError) {
    logger.warn('Claude could not be reached', { error: String(error) });
    return new AiUnavailableError('The AI service did not answer. Try again in a minute.');
  }
  if (error instanceof Anthropic.APIError) {
    logger.warn('Claude refused the request', { status: error.status, error: error.message.slice(0, 500) });
    // 400s carry a useful reason, e.g. "Your credit balance is too low".
    const reason = (error.error as { error?: { message?: string } } | undefined)?.error?.message ?? error.message;
    return new AiUnavailableError(
      error.status === 400 || error.status === 403 || error.status === 404
        ? `The AI service refused the request: ${reason}`
        : 'The AI service had a problem. Try again in a minute.',
    );
  }
  logger.error('Unexpected error asking Claude', { error: String(error) });
  return new AiUnavailableError('The AI service had a problem. Try again in a minute.');
}

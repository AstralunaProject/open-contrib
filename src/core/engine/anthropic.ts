import Anthropic from '@anthropic-ai/sdk';
import { EngineError, type CompletionRequest, type EngineClient } from './types.js';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5';

const DEFAULT_MAX_TOKENS = 4096;

export interface AnthropicClientOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class AnthropicClient implements EngineClient {
  readonly provider = 'anthropic';
  readonly model: string;
  readonly #sdk: Anthropic;

  constructor({ apiKey, model = ANTHROPIC_DEFAULT_MODEL, baseUrl, timeoutMs }: AnthropicClientOptions) {
    this.model = model;
    this.#sdk = new Anthropic({ apiKey, baseURL: baseUrl, timeout: timeoutMs, maxRetries: 2 });
  }

  async complete({ system, prompt, maxTokens = DEFAULT_MAX_TOKENS, signal }: CompletionRequest): Promise<string> {
    let message: Anthropic.Message;
    try {
      message = await this.#sdk.messages.create(
        {
          model: this.model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal },
      );
    } catch (error) {
      if (error instanceof Anthropic.APIUserAbortError) throw error;
      if (error instanceof Anthropic.APIError) {
        throw new EngineError('anthropic', `Anthropic API request failed: ${error.message}`, {
          status: error.status,
          cause: error,
        });
      }
      throw error;
    }

    if (message.stop_reason === 'refusal') {
      throw new EngineError('anthropic', `Model ${this.model} declined to analyze this issue`);
    }

    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
    if (text === '') {
      throw new EngineError('anthropic', `Model ${this.model} returned no text`);
    }
    return text;
  }
}

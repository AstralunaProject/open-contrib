import { EngineError, type CompletionRequest, type EngineClient } from './types.js';

export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';
export const OLLAMA_DEFAULT_MODEL = 'qwen2.5-coder:7b';

// Local models on CPU can take minutes to produce a long roadmap.
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_TOKENS = 4096;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

export interface OllamaClientOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export class OllamaClient implements EngineClient {
  readonly provider = 'ollama';
  readonly model: string;
  readonly baseUrl: string;
  readonly #timeoutMs: number;

  constructor({ baseUrl = OLLAMA_DEFAULT_BASE_URL, model = OLLAMA_DEFAULT_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS }: OllamaClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
    this.#timeoutMs = timeoutMs;
  }

  async complete({ system, prompt, maxTokens = DEFAULT_MAX_TOKENS, signal }: CompletionRequest): Promise<string> {
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const url = `${this.baseUrl}/chat/completions`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (timeout.aborted) {
        throw new EngineError('ollama', `Ollama did not answer within ${this.#timeoutMs / 1000}s`, { cause: error });
      }
      throw new EngineError('ollama', `Could not reach Ollama at ${this.baseUrl}. Is \`ollama serve\` running?`, {
        cause: error,
      });
    }

    if (!response.ok) {
      const detail = (await response.text()).trim().slice(0, 500);
      const hint = response.status === 404 ? ` (try \`ollama pull ${this.model}\`)` : '';
      throw new EngineError('ollama', `Ollama returned ${response.status}${hint}: ${detail}`, {
        status: response.status,
      });
    }

    const body = (await response.json()) as ChatCompletionResponse;
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new EngineError('ollama', `Ollama returned no content for model ${this.model}`);
    }
    return content;
  }
}

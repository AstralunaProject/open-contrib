export const PROVIDERS = ['anthropic', 'ollama'] as const;

export type ProviderName = (typeof PROVIDERS)[number];

export interface CompletionRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface EngineClient {
  readonly provider: ProviderName;
  readonly model: string;
  complete(request: CompletionRequest): Promise<string>;
}

export class EngineError extends Error {
  override readonly name = 'EngineError';
  readonly provider: ProviderName;
  readonly status: number | undefined;

  constructor(provider: ProviderName, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.provider = provider;
    this.status = options.status;
  }
}

export function isProvider(value: string): value is ProviderName {
  return (PROVIDERS as readonly string[]).includes(value);
}

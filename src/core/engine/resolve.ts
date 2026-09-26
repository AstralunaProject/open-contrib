import { ANTHROPIC_DEFAULT_MODEL, AnthropicClient } from './anthropic.js';
import { DryRunClient } from './dry-run.js';
import { OLLAMA_DEFAULT_BASE_URL, OLLAMA_DEFAULT_MODEL, OllamaClient } from './ollama.js';
import { EngineError, PROVIDERS, isProvider, type EngineClient, type ProviderName } from './types.js';

export type EngineEnv = Readonly<Record<string, string | undefined>>;

export interface ResolveEngineOptions {
  provider?: ProviderName;
  model?: string;
  dryRun?: boolean;
  env?: EngineEnv;
}

export type EngineSettings =
  | { provider: 'anthropic'; model: string; apiKey: string | undefined; baseUrl: string | undefined }
  | { provider: 'ollama'; model: string; baseUrl: string };

// CI runners export unset secrets as empty strings, so blank must mean absent.
function read(env: EngineEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value === '' ? undefined : value;
}

export function parseProvider(value: string): ProviderName {
  const normalized = value.trim().toLowerCase();
  if (!isProvider(normalized)) {
    throw new Error(`Unknown provider "${value}". Expected one of: ${PROVIDERS.join(', ')}`);
  }
  return normalized;
}

export function resolveSettings({ provider, model, env = process.env }: ResolveEngineOptions = {}): EngineSettings {
  const fromEnv = read(env, 'OPEN_CONTRIB_PROVIDER');
  const apiKey = read(env, 'ANTHROPIC_API_KEY');
  const selected = provider ?? (fromEnv ? parseProvider(fromEnv) : apiKey ? 'anthropic' : 'ollama');
  const selectedModel = model ?? read(env, 'OPEN_CONTRIB_MODEL');

  if (selected === 'anthropic') {
    return {
      provider: 'anthropic',
      model: selectedModel ?? ANTHROPIC_DEFAULT_MODEL,
      apiKey,
      baseUrl: read(env, 'ANTHROPIC_BASE_URL'),
    };
  }
  return {
    provider: 'ollama',
    model: selectedModel ?? OLLAMA_DEFAULT_MODEL,
    baseUrl: read(env, 'OLLAMA_BASE_URL') ?? OLLAMA_DEFAULT_BASE_URL,
  };
}

export function resolveEngine(options: ResolveEngineOptions = {}): EngineClient {
  const settings = resolveSettings(options);
  if (options.dryRun) return new DryRunClient(settings.provider, settings.model);

  if (settings.provider === 'ollama') {
    return new OllamaClient({ baseUrl: settings.baseUrl, model: settings.model });
  }
  if (!settings.apiKey) {
    throw new EngineError('anthropic', 'ANTHROPIC_API_KEY is not set. Export it or run with --provider ollama.');
  }
  return new AnthropicClient({ apiKey: settings.apiKey, model: settings.model, baseUrl: settings.baseUrl });
}

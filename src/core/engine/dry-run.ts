import type { CompletionRequest, EngineClient, ProviderName } from './types.js';

export class DryRunClient implements EngineClient {
  readonly provider: ProviderName;
  readonly model: string;

  constructor(provider: ProviderName, model: string) {
    this.provider = provider;
    this.model = model;
  }

  async complete({ system, prompt }: CompletionRequest): Promise<string> {
    return [
      `[dry-run] ${this.provider}/${this.model}: no request sent`,
      '',
      '--- system ---',
      system,
      '',
      '--- prompt ---',
      prompt,
    ].join('\n');
  }
}

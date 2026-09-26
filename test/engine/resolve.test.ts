import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANTHROPIC_DEFAULT_MODEL,
  AnthropicClient,
  DryRunClient,
  EngineError,
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_MODEL,
  OllamaClient,
  resolveEngine,
  resolveSettings,
} from '../../src/core/engine/index.js';

describe('resolveSettings', () => {
  it('falls back to local Ollama when no cloud key is present', () => {
    assert.deepEqual(resolveSettings({ env: {} }), {
      provider: 'ollama',
      model: OLLAMA_DEFAULT_MODEL,
      baseUrl: OLLAMA_DEFAULT_BASE_URL,
    });
  });

  it('prefers Anthropic when ANTHROPIC_API_KEY is set', () => {
    const settings = resolveSettings({ env: { ANTHROPIC_API_KEY: 'sk-test' } });
    assert.equal(settings.provider, 'anthropic');
    assert.equal(settings.model, ANTHROPIC_DEFAULT_MODEL);
  });

  it('treats blank variables as unset', () => {
    const settings = resolveSettings({
      env: { ANTHROPIC_API_KEY: '', OPEN_CONTRIB_PROVIDER: '  ', OPEN_CONTRIB_MODEL: '' },
    });
    assert.equal(settings.provider, 'ollama');
    assert.equal(settings.model, OLLAMA_DEFAULT_MODEL);
  });

  it('lets OPEN_CONTRIB_PROVIDER override key detection', () => {
    const settings = resolveSettings({ env: { ANTHROPIC_API_KEY: 'sk-test', OPEN_CONTRIB_PROVIDER: 'Ollama' } });
    assert.equal(settings.provider, 'ollama');
  });

  it('gives explicit options precedence over the environment', () => {
    const settings = resolveSettings({
      provider: 'ollama',
      model: 'llama3.1:8b',
      env: { OPEN_CONTRIB_PROVIDER: 'anthropic', OPEN_CONTRIB_MODEL: 'ignored' },
    });
    assert.equal(settings.provider, 'ollama');
    assert.equal(settings.model, 'llama3.1:8b');
  });

  it('reads the Ollama endpoint from OLLAMA_BASE_URL', () => {
    const settings = resolveSettings({ env: { OLLAMA_BASE_URL: 'http://gpu-box:11434/v1' } });
    assert.equal(settings.provider === 'ollama' && settings.baseUrl, 'http://gpu-box:11434/v1');
  });

  it('rejects unknown providers instead of guessing', () => {
    assert.throws(() => resolveSettings({ env: { OPEN_CONTRIB_PROVIDER: 'gemini' } }), /Unknown provider "gemini"/);
  });
});

describe('resolveEngine', () => {
  it('builds an Ollama client by default', () => {
    const engine = resolveEngine({ env: {} });
    assert.ok(engine instanceof OllamaClient);
  });

  it('builds an Anthropic client when a key is available', () => {
    const engine = resolveEngine({ env: { ANTHROPIC_API_KEY: 'sk-test' } });
    assert.ok(engine instanceof AnthropicClient);
  });

  it('fails fast when Anthropic is forced without a key', () => {
    assert.throws(() => resolveEngine({ provider: 'anthropic', env: {} }), EngineError);
  });

  it('never requires credentials in dry-run mode', () => {
    const engine = resolveEngine({ provider: 'anthropic', dryRun: true, env: {} });
    assert.ok(engine instanceof DryRunClient);
    assert.equal(engine.provider, 'anthropic');
    assert.equal(engine.model, ANTHROPIC_DEFAULT_MODEL);
  });
});

describe('DryRunClient', () => {
  it('echoes the request without touching the network', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch');
    const output = await new DryRunClient('ollama', 'tiny').complete({ system: 'SYS', prompt: 'PROMPT' });

    assert.equal(fetchMock.mock.callCount(), 0);
    assert.match(output, /^\[dry-run\] ollama\/tiny/);
    assert.match(output, /SYS[\s\S]*PROMPT/);
  });
});

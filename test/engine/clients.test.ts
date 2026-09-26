import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnthropicClient, EngineError, OllamaClient } from '../../src/core/engine/index.js';

const request = { system: 'You map codebases.', prompt: 'Issue #1: fix the parser' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('OllamaClient', () => {
  it('posts an OpenAI-compatible chat completion and returns the content', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
      json({ choices: [{ message: { content: 'roadmap' } }] }),
    );

    const client = new OllamaClient({ baseUrl: 'http://localhost:11434/v1/', model: 'tiny' });
    assert.equal(await client.complete(request), 'roadmap');

    const [url, init] = fetchMock.mock.calls[0]?.arguments ?? [];
    assert.equal(url, 'http://localhost:11434/v1/chat/completions');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: 'tiny',
      stream: false,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
    });
  });

  it('explains how to recover when the server is not running', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('fetch failed');
    });

    await assert.rejects(new OllamaClient().complete(request), (error: unknown) => {
      assert.ok(error instanceof EngineError);
      assert.match(error.message, /ollama serve/);
      return true;
    });
  });

  it('suggests pulling the model on 404', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => json({ error: { message: 'model not found' } }, 404));

    await assert.rejects(new OllamaClient({ model: 'tiny' }).complete(request), (error: unknown) => {
      assert.ok(error instanceof EngineError);
      assert.equal(error.status, 404);
      assert.match(error.message, /ollama pull tiny/);
      return true;
    });
  });

  it('rejects empty completions', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => json({ choices: [{ message: { content: '  ' } }] }));
    await assert.rejects(new OllamaClient().complete(request), EngineError);
  });

  it('propagates caller cancellation untouched', async (t) => {
    t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      init.signal?.throwIfAborted();
      return json({});
    });

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(new OllamaClient().complete({ ...request, signal: controller.signal }), {
      name: 'AbortError',
    });
  });
});

describe('AnthropicClient', () => {
  const message = (content: unknown[], stopReason = 'end_turn') => ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  });

  it('joins text blocks from the Messages API response', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
      json(message([{ type: 'text', text: 'step 1\n' }, { type: 'text', text: 'step 2' }])),
    );

    const client = new AnthropicClient({ apiKey: 'sk-test', baseUrl: 'http://anthropic.test' });
    assert.equal(await client.complete(request), 'step 1\nstep 2');

    const [url, init] = fetchMock.mock.calls[0]?.arguments ?? [];
    assert.equal(String(url), 'http://anthropic.test/v1/messages');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.system, request.system);
    assert.deepEqual(body.messages, [{ role: 'user', content: request.prompt }]);
  });

  it('surfaces API failures as EngineError with the HTTP status', async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
      json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401),
    );

    const client = new AnthropicClient({ apiKey: 'sk-bad', baseUrl: 'http://anthropic.test' });
    await assert.rejects(client.complete(request), (error: unknown) => {
      assert.ok(error instanceof EngineError);
      assert.equal(error.status, 401);
      return true;
    });
  });

  it('treats a refusal as an error rather than an empty roadmap', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => json(message([], 'refusal')));

    const client = new AnthropicClient({ apiKey: 'sk-test', baseUrl: 'http://anthropic.test' });
    await assert.rejects(client.complete(request), /declined/);
  });
});

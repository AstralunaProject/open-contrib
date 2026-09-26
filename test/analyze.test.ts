import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { analyze, type AnalyzeOptions } from '../src/commands/analyze.js';
import { buildPrompt } from '../src/core/prompt.js';
import { UsageError } from '../src/errors.js';
import { main } from '../src/main.js';
import { fixture, json } from './helpers.js';

const repository = {
  'README.md': '# Widgets\nRun `npm test`.',
  'package.json': '{"name":"widgets"}',
  'src/tokenizer.ts': 'export function tokenize() {}',
  'src/render.ts': 'export function render() {}',
  '.env': 'SECRET=hunter2',
  'issue.md': '# Tokenizer splits emoji\n\nThe tokenizer breaks surrogate pairs.',
};

function options(root: string, overrides: Partial<AnalyzeOptions> = {}): AnalyzeOptions {
  return {
    issue: path.join(root, 'issue.md'),
    root,
    provider: undefined,
    model: undefined,
    labels: undefined,
    comment: false,
    dryRun: true,
    env: {},
    log: () => {},
    ...overrides,
  };
}

describe('analyze', () => {
  it('builds the full prompt offline in dry-run mode', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch');
    const root = await fixture(t, repository);

    const result = await analyze(options(root));
    assert.equal(result.status, 'done');
    assert.ok(result.status === 'done');
    assert.match(result.roadmap, /^\[dry-run\] ollama\//);
    assert.match(result.roadmap, /# Issue: Tokenizer splits emoji/);
    assert.match(result.roadmap, /## src\/tokenizer\.ts\n```\nexport function tokenize/);
    assert.doesNotMatch(result.roadmap, /hunter2/);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('skips issues without a qualifying label', async (t) => {
    const root = await fixture(t, repository);
    t.mock.method(globalThis, 'fetch', async (url: string) =>
      url.endsWith('/comments?per_page=100&page=1')
        ? json([])
        : json({ title: 'x', body: '', html_url: 'u', labels: [{ name: 'enhancement' }] }),
    );

    const result = await analyze(
      options(root, { issue: 'acme/widgets#7', dryRun: false, labels: ['Good First Issue'], env: { ANTHROPIC_API_KEY: 'k' } }),
    );
    assert.deepEqual(result, { status: 'skipped', reason: 'issue has none of the labels: Good First Issue' });
  });

  it('refuses --comment without a token or for local files', async (t) => {
    const root = await fixture(t, repository);
    await assert.rejects(analyze(options(root, { comment: true, dryRun: false })), /GITHUB_TOKEN/);
    await assert.rejects(analyze(options(root, { comment: true, env: { GITHUB_TOKEN: 't' } })), /GitHub issue URL/);
  });

  it('rejects a missing repository root', async (t) => {
    const root = await fixture(t, repository);
    await assert.rejects(analyze(options(root, { root: path.join(root, 'nope') })), UsageError);
  });
});

describe('buildPrompt', () => {
  it('fences file contents that themselves contain backticks', () => {
    const prompt = buildPrompt(
      { title: 't', body: '', labels: undefined, comments: [], ref: undefined, url: undefined },
      { tree: 'README.md', files: [{ path: 'README.md', content: '```sh\nnpm test\n```', truncated: false }] },
    );
    assert.match(prompt, /````\n```sh\nnpm test\n```\n````/);
  });
});

describe('main', () => {
  function capture(t: TestContext) {
    const out: string[] = [];
    const err: string[] = [];
    t.mock.method(process.stdout, 'write', (chunk: string) => out.push(chunk) > 0);
    t.mock.method(process.stderr, 'write', (chunk: string) => err.push(chunk) > 0);
    return { out, err };
  }

  it('returns 2 for usage errors and reports them on stderr', async (t) => {
    const { out, err } = capture(t);
    assert.equal(await main(['analyze']), 2);
    assert.equal(await main(['analyze', '--issue', 'x.md', '--provider', 'gpt']), 2);
    assert.equal(await main(['deploy']), 2);
    assert.equal(await main(['analyze', '--bogus']), 2);
    assert.deepEqual(out, []);
    assert.match(err.join(''), /Missing --issue[\s\S]*Unknown provider "gpt"[\s\S]*Unknown command "deploy"/);
  });

  it('prints help on stdout with exit 0', async (t) => {
    const { out } = capture(t);
    assert.equal(await main(['--help']), 0);
    assert.match(out.join(''), /^Usage: open-contrib analyze/);
  });

  it('writes the roadmap to stdout and progress to stderr', async (t) => {
    const root = await fixture(t, repository);
    const { out, err } = capture(t);

    const code = await main(['analyze', '--issue', path.join(root, 'issue.md'), '--root', root, '--dry-run']);
    assert.equal(code, 0);
    assert.match(out.join(''), /^\[dry-run\]/);
    assert.match(err.join(''), /open-contrib: scanned \d+ files/);
  });
});

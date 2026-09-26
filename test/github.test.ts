import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COMMENT_MARKER, GitHubClient, GitHubError, parseIssueRef } from '../src/core/github.js';
import { json } from './helpers.js';

const ref = { apiUrl: 'https://api.github.com', owner: 'acme', repo: 'widgets', number: 7 };

describe('parseIssueRef', () => {
  it('accepts issue and pull request URLs', () => {
    assert.deepEqual(parseIssueRef('https://github.com/acme/widgets/issues/7', {}), ref);
    assert.deepEqual(parseIssueRef('https://github.com/acme/widgets/pull/7/', {}), ref);
  });

  it('accepts owner/repo#number shorthand', () => {
    assert.deepEqual(parseIssueRef('acme/widgets#7', {}), ref);
  });

  it('targets the Enterprise API for other hosts', () => {
    assert.equal(parseIssueRef('https://git.acme.dev/acme/widgets/issues/7', {})?.apiUrl, 'https://git.acme.dev/api/v3');
    const env = { GITHUB_SERVER_URL: 'https://git.acme.dev', GITHUB_API_URL: 'https://api.git.acme.dev/' };
    assert.equal(parseIssueRef('https://git.acme.dev/acme/widgets/issues/7', env)?.apiUrl, 'https://api.git.acme.dev');
  });

  it('returns undefined for anything else', () => {
    for (const input of ['./issue.md', 'https://github.com/acme/widgets', 'ftp://github.com/a/b/issues/1']) {
      assert.equal(parseIssueRef(input, {}), undefined, input);
    }
  });
});

describe('GitHubClient', () => {
  it('fetches the issue with labels and discussion, minus previous roadmaps', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string) =>
      url.endsWith('/issues/7')
        ? json({ title: 'Fix it', body: null, html_url: 'https://github.com/acme/widgets/issues/7', labels: ['bug', { name: 'good first issue' }] })
        : json([
            { id: 1, body: 'Repro attached', user: { login: 'ana' } },
            { id: 2, body: `${COMMENT_MARKER}\nold roadmap`, user: { login: 'github-actions[bot]' } },
          ]),
    );

    const issue = await new GitHubClient('tok').fetchIssue(ref);
    assert.deepEqual(issue, {
      title: 'Fix it',
      body: '',
      url: 'https://github.com/acme/widgets/issues/7',
      labels: ['bug', 'good first issue'],
      comments: [{ id: 1, author: 'ana', body: 'Repro attached' }],
    });

    const init = fetchMock.mock.calls[0]?.arguments[1];
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer tok');
  });

  it('creates a comment when no roadmap exists yet', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) =>
      init.method === 'POST' ? json({ html_url: 'https://github.com/c/1' }, 201) : json([]),
    );

    assert.equal(await new GitHubClient('tok').upsertComment(ref, 'plan'), 'https://github.com/c/1');
    const [url, init] = fetchMock.mock.calls[1]?.arguments ?? [];
    assert.equal(url, 'https://api.github.com/repos/acme/widgets/issues/7/comments');
    assert.deepEqual(JSON.parse(String(init?.body)), { body: `${COMMENT_MARKER}\nplan` });
  });

  it('edits the previous roadmap instead of posting a duplicate', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) =>
      init.method === 'PATCH'
        ? json({ html_url: 'https://github.com/c/99' })
        : json([{ id: 99, body: `${COMMENT_MARKER}\nold`, user: { login: 'bot' } }]),
    );

    assert.equal(await new GitHubClient('tok').upsertComment(ref, 'new'), 'https://github.com/c/99');
    const [url, init] = fetchMock.mock.calls[1]?.arguments ?? [];
    assert.equal(url, 'https://api.github.com/repos/acme/widgets/issues/comments/99');
    assert.equal(init?.method, 'PATCH');
  });

  it('hints at GITHUB_TOKEN when an anonymous request is rejected', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => json({ message: 'Not Found' }, 404));

    await assert.rejects(new GitHubClient(undefined).fetchIssue(ref), (error: unknown) => {
      assert.ok(error instanceof GitHubError);
      assert.equal(error.status, 404);
      assert.match(error.message, /GITHUB_TOKEN/);
      return true;
    });
  });
});

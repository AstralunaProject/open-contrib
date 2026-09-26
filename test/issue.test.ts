import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { GitHubClient } from '../src/core/github.js';
import { loadIssue, parseIssueText } from '../src/core/issue.js';
import { UsageError } from '../src/errors.js';
import { fixture } from './helpers.js';

const github = new GitHubClient(undefined);

describe('parseIssueText', () => {
  it('takes the first heading as the title', () => {
    assert.deepEqual(parseIssueText('\n# Crash on save\r\n\nSteps:\n1. save', 'fallback'), {
      title: 'Crash on save',
      body: 'Steps:\n1. save',
    });
  });

  it('falls back to the file name when there is no heading', () => {
    assert.deepEqual(parseIssueText('Just a body', 'crash-on-save'), { title: 'crash-on-save', body: 'Just a body' });
  });
});

describe('loadIssue', () => {
  it('reads local files without touching the network', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch');
    const root = await fixture(t, { 'issue.md': '# Title\nBody' });

    const issue = await loadIssue(path.join(root, 'issue.md'), { github, dryRun: false });
    assert.equal(issue.title, 'Title');
    assert.equal(issue.labels, undefined);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('does not call GitHub in dry-run mode', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch');
    const issue = await loadIssue('https://github.com/acme/widgets/issues/7', { github, dryRun: true });

    assert.equal(issue.title, 'acme/widgets#7');
    assert.equal(issue.ref?.number, 7);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('reports missing files and foreign URLs as usage errors', async () => {
    await assert.rejects(loadIssue('does-not-exist.md', { github, dryRun: true }), UsageError);
    await assert.rejects(loadIssue('https://gitlab.com/acme/widgets/-/issues', { github, dryRun: true }), UsageError);
  });
});

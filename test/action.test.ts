import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planRun } from '../src/action.js';

const base = {
  GITHUB_EVENT_NAME: 'issues',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'acme/app',
  GITHUB_WORKSPACE: '/work',
  INPUT_LABELS: 'good first issue, help wanted',
  'INPUT_GITHUB-TOKEN': 'token',
  'INPUT_DRY-RUN': 'false',
};

describe('planRun', () => {
  it('comments on the issue from an issues event, filtering by labels', () => {
    const plan = planRun(base, { action: 'opened', issue: { number: 7 } });
    assert.equal(plan.kind, 'run');
    if (plan.kind !== 'run') return;
    assert.deepEqual(plan.argv, [
      'analyze',
      '--issue',
      'https://github.com/acme/app/issues/7',
      '--root',
      '/work',
      '--labels',
      'good first issue, help wanted',
      '--comment',
    ]);
    assert.equal(plan.env.GITHUB_TOKEN, 'token');
  });

  it('skips a labeled event whose added label is not configured', () => {
    const plan = planRun(base, { action: 'labeled', issue: { number: 7 }, label: { name: 'bug' } });
    assert.equal(plan.kind, 'skip');
  });

  it('matches the added label ignoring case and spaces', () => {
    const plan = planRun(base, { action: 'labeled', issue: { number: 7 }, label: { name: 'Help Wanted' } });
    assert.equal(plan.kind, 'run');
  });

  it('analyzes any issue on a manual run, without label filtering', () => {
    const plan = planRun({ ...base, GITHUB_EVENT_NAME: 'workflow_dispatch', 'INPUT_ISSUE-NUMBER': '12', 'INPUT_DRY-RUN': 'true' }, {});
    assert.equal(plan.kind, 'run');
    if (plan.kind !== 'run') return;
    assert.ok(plan.argv.includes('https://github.com/acme/app/issues/12'));
    assert.ok(!plan.argv.includes('--labels'));
    assert.equal(plan.argv.at(-1), '--dry-run');
  });

  it('fails without an issue number', () => {
    assert.equal(planRun({ ...base, GITHUB_EVENT_NAME: 'workflow_dispatch' }, {}).kind, 'error');
  });
});

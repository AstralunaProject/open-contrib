import { readFileSync } from 'node:fs';
import { main } from './main.js';

type Env = Readonly<Record<string, string | undefined>>;

export interface IssuesEvent {
  action?: string;
  issue?: { number?: number };
  label?: { name?: string };
}

export type Plan =
  | { kind: 'run'; argv: string[]; env: Record<string, string | undefined> }
  | { kind: 'skip'; reason: string }
  | { kind: 'error'; message: string };

function input(env: Env, name: string): string {
  return env[`INPUT_${name.toUpperCase()}`]?.trim() ?? '';
}

function splitLabels(value: string): string[] {
  return value
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);
}

export function planRun(env: Env, event: IssuesEvent): Plan {
  const eventName = env.GITHUB_EVENT_NAME ?? '';
  const issue = input(env, 'issue-number') || String(event.issue?.number ?? '');
  if (!issue) {
    return { kind: 'error', message: 'No issue number: set the issue-number input or trigger on an issues event.' };
  }

  const labels = input(env, 'labels');
  const added = event.label?.name ?? '';
  if (eventName === 'issues' && event.action === 'labeled' && labels) {
    const wanted = splitLabels(labels).map((label) => label.toLowerCase());
    if (!wanted.includes(added.toLowerCase())) {
      return { kind: 'skip', reason: `label "${added}" is not one of: ${labels}` };
    }
  }

  const argv = ['analyze', '--issue', `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/issues/${issue}`];
  argv.push('--root', env.GITHUB_WORKSPACE ?? process.cwd());
  if (eventName === 'issues' && labels) argv.push('--labels', labels);
  argv.push(input(env, 'dry-run') === 'true' ? '--dry-run' : '--comment');

  return {
    kind: 'run',
    argv,
    env: {
      ...env,
      GITHUB_TOKEN: input(env, 'github-token'),
      ANTHROPIC_API_KEY: input(env, 'anthropic-api-key'),
      OPEN_CONTRIB_PROVIDER: input(env, 'provider'),
      OPEN_CONTRIB_MODEL: input(env, 'model'),
      OLLAMA_BASE_URL: input(env, 'ollama-base-url'),
    },
  };
}

function readEvent(file: string | undefined): IssuesEvent {
  if (!file) return {};
  return JSON.parse(readFileSync(file, 'utf8')) as IssuesEvent;
}

export async function runAction(): Promise<number> {
  const plan = planRun(process.env, readEvent(process.env.GITHUB_EVENT_PATH));
  if (plan.kind === 'error') {
    process.stderr.write(`::error::${plan.message}\n`);
    return 1;
  }
  if (plan.kind === 'skip') {
    process.stdout.write(`open-contrib: skipped, ${plan.reason}\n`);
    return 0;
  }
  Object.assign(process.env, plan.env);
  return main(plan.argv);
}

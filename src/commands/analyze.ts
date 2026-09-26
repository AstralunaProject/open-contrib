import { stat } from 'node:fs/promises';
import { UsageError } from '../errors.js';
import { buildContext } from '../core/context.js';
import { readEnv, resolveEngine, type EngineEnv, type ProviderName } from '../core/engine/index.js';
import { GitHubClient } from '../core/github.js';
import { loadIssue } from '../core/issue.js';
import { SYSTEM_PROMPT, buildPrompt } from '../core/prompt.js';
import { scanRepository } from '../core/scan.js';

export interface AnalyzeOptions {
  issue: string;
  root: string;
  provider: ProviderName | undefined;
  model: string | undefined;
  labels: string[] | undefined;
  comment: boolean;
  dryRun: boolean;
  env: EngineEnv;
  log: (message: string) => void;
}

export type AnalyzeResult =
  | { status: 'skipped'; reason: string }
  | { status: 'done'; roadmap: string; commentUrl: string | undefined };

// Characters, not tokens. Ollama serves a small context window unless the model is configured otherwise.
const CONTEXT_BUDGET: Record<ProviderName, number> = { ollama: 24_000, anthropic: 120_000 };

async function assertDirectory(dir: string): Promise<void> {
  const stats = await stat(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new UsageError(`Repository root not found: ${dir}`);
    throw error;
  });
  if (!stats.isDirectory()) throw new UsageError(`Repository root is not a directory: ${dir}`);
}

export async function analyze(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const { root, dryRun, env, log } = options;
  await assertDirectory(root);

  const token = readEnv(env, 'GITHUB_TOKEN') ?? readEnv(env, 'GH_TOKEN');
  const postComment = options.comment && !dryRun;
  if (postComment && !token) throw new UsageError('--comment needs GITHUB_TOKEN with issues: write');

  const engine = resolveEngine({ provider: options.provider, model: options.model, dryRun, env });
  const github = new GitHubClient(token);
  const issue = await loadIssue(options.issue, { github, dryRun });

  if (options.comment && !issue.ref) throw new UsageError('--comment requires a GitHub issue URL');
  if (dryRun && issue.ref) log('--dry-run: issue body and labels are not fetched from GitHub');
  if (options.comment && dryRun) log('--dry-run: the roadmap is printed instead of commented');

  if (options.labels?.length) {
    if (issue.labels) {
      const wanted = new Set(options.labels.map((label) => label.toLowerCase()));
      if (!issue.labels.some((label) => wanted.has(label.toLowerCase()))) {
        return { status: 'skipped', reason: `issue has none of the labels: ${options.labels.join(', ')}` };
      }
    } else {
      log('--labels ignored: labels are unknown for this issue source');
    }
  }

  log(`issue: ${issue.title}`);
  const scan = await scanRepository(root);
  log(`scanned ${scan.files.length} files${scan.truncated ? ' (limit reached)' : ''}`);

  const query = [issue.title, issue.body, ...issue.comments.map((comment) => comment.body)].join('\n');
  const context = await buildContext({ root, files: scan.files, query, budget: CONTEXT_BUDGET[engine.provider] });
  log(`context: ${context.files.map((file) => file.path).join(', ') || 'tree only'}`);

  if (!dryRun) log(`waiting on ${engine.provider}/${engine.model}`);
  const roadmap = await engine.complete({ system: SYSTEM_PROMPT, prompt: buildPrompt(issue, context) });

  let commentUrl: string | undefined;
  if (postComment && issue.ref) {
    commentUrl = await github.upsertComment(issue.ref, roadmap);
    log(`commented: ${commentUrl}`);
  }
  return { status: 'done', roadmap, commentUrl };
}

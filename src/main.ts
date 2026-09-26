import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyze } from './commands/analyze.js';
import { EngineError, parseProvider, type ProviderName } from './core/engine/index.js';
import { GitHubError } from './core/github.js';
import { UsageError } from './errors.js';

const HELP = `Usage: open-contrib analyze --issue <url|path> [options]

Turn a GitHub issue into an onboarding roadmap for the repository at --root.

Options:
  --issue <url|path>   GitHub issue URL, owner/repo#123, or a local Markdown file
  --root <dir>         Repository to inspect (default: current directory)
  --provider <name>    anthropic | ollama (default: anthropic if ANTHROPIC_API_KEY is set)
  --model <name>       Override the provider's default model
  --labels <list>      Comma-separated labels; skip issues that have none of them
  --comment            Post the roadmap as a comment on the issue (needs GITHUB_TOKEN)
  --dry-run            Print the prompt instead of calling a provider or GitHub
  -h, --help           Show this help
  -v, --version        Show the version
`;

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

function version(): string {
  const manifest = new URL('../package.json', import.meta.url);
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}

function parse(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        issue: { type: 'string' },
        root: { type: 'string' },
        provider: { type: 'string' },
        model: { type: 'string' },
        labels: { type: 'string' },
        comment: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (error) {
    if (error instanceof TypeError) throw new UsageError(error.message);
    throw error;
  }
}

async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv);

  if (values.version) {
    process.stdout.write(`${version()}\n`);
    return EXIT_OK;
  }
  const [command, ...rest] = positionals;
  if (values.help) {
    process.stdout.write(HELP);
    return EXIT_OK;
  }
  if (command === undefined) {
    process.stderr.write(HELP);
    return EXIT_USAGE;
  }
  if (command !== 'analyze') throw new UsageError(`Unknown command "${command}"`);
  if (rest.length > 0) throw new UsageError(`Unexpected argument "${rest[0]}"`);
  if (!values.issue) throw new UsageError('Missing --issue <url|path>');

  let provider: ProviderName | undefined;
  if (values.provider !== undefined) {
    try {
      provider = parseProvider(values.provider);
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
  }

  const labels = values.labels
    ?.split(',')
    .map((label) => label.trim())
    .filter(Boolean);

  const result = await analyze({
    issue: values.issue,
    root: path.resolve(values.root ?? '.'),
    provider,
    model: values.model,
    labels,
    comment: values.comment,
    dryRun: values['dry-run'],
    env: process.env,
    log: (message) => process.stderr.write(`open-contrib: ${message}\n`),
  });

  if (result.status === 'skipped') {
    process.stderr.write(`open-contrib: skipped, ${result.reason}\n`);
    return EXIT_OK;
  }
  process.stdout.write(result.roadmap.endsWith('\n') ? result.roadmap : `${result.roadmap}\n`);
  return EXIT_OK;
}

export async function main(argv: string[]): Promise<number> {
  try {
    return await run(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`open-contrib: ${error.message}\nRun "open-contrib --help" for usage.\n`);
      return EXIT_USAGE;
    }
    if (error instanceof EngineError || error instanceof GitHubError || !process.env.OPEN_CONTRIB_DEBUG) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`open-contrib: ${message}\n`);
      return EXIT_FAILURE;
    }
    throw error;
  }
}

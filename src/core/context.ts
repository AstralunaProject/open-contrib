import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

export interface ContextFile {
  path: string;
  content: string;
  truncated: boolean;
}

export interface RepositoryContext {
  tree: string;
  files: ContextFile[];
}

export interface BuildContextOptions {
  root: string;
  files: string[];
  query: string;
  budget: number;
}

const ORIENTATION_FILES = [
  'README.md',
  'README',
  'CONTRIBUTING.md',
  '.github/CONTRIBUTING.md',
  'package.json',
  'pyproject.toml',
  'setup.py',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'composer.json',
  'Makefile',
  'justfile',
];

const LOCKFILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
  'Gemfile.lock',
  'composer.lock',
  'go.sum',
]);

const STOPWORDS = new Set(
  (
    'the and for with this that from when then than into onto should would could does doesn not are was were ' +
    'have has had but use used using can will just some like make made get got want need there their they them ' +
    'what where which while also only more most other such about after before being been its you your our ' +
    'issue bug error problem feature please thanks thank http https www github com'
  ).split(' '),
);

const MAX_FILE_CHARS = 12_000;
const MAX_ORIENTATION_CHARS = 4_000;
const MIN_SCORE = 3;

function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

// Paths quoted in the issue ("see src/parser/lexer.ts") are the strongest signal we get,
// so they outrank any amount of keyword overlap.
function mentionedPaths(query: string): Set<string> {
  const matches = query.match(/[\w.-]+(?:\/[\w.-]+)*\.[a-z0-9]{1,6}\b/gi) ?? [];
  return new Set(matches.map((match) => match.replace(/^\.?\//, '').toLowerCase()));
}

function pathTokens(file: string): { stem: Set<string>; dirs: Set<string> } {
  return {
    stem: new Set(tokenize(path.posix.parse(file).name)),
    dirs: new Set(tokenize(path.posix.dirname(file))),
  };
}

// Tokens shared by most paths ("src", "core") say nothing about relevance, so each match is
// weighted by how rare the token is across the repository.
export function rankFiles(files: string[], query: string): string[] {
  const queryTokens = new Set(tokenize(query));
  const mentions = [...mentionedPaths(query)];
  const tokens = files.map(pathTokens);

  const frequency = new Map<string, number>();
  for (const { stem, dirs } of tokens) {
    for (const token of new Set([...stem, ...dirs])) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  const weight = (token: string) => Math.log((files.length + 1) / (frequency.get(token) ?? 1));

  const scored = files.map((file, index) => {
    const lower = file.toLowerCase();
    const base = path.posix.basename(lower);
    let score = 0;

    if (mentions.includes(lower)) score += 100;
    else if (mentions.some((mention) => lower.endsWith(`/${mention}`) || path.posix.basename(mention) === base)) {
      score += 40;
    }

    const { stem, dirs } = tokens[index] ?? pathTokens(file);
    for (const token of stem) if (queryTokens.has(token)) score += 6 * weight(token);
    for (const token of dirs) if (queryTokens.has(token)) score += weight(token);

    return { file, score };
  });

  return scored
    .filter(({ score }) => score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.file.length - b.file.length || a.file.localeCompare(b.file))
    .map(({ file }) => file);
}

export function renderTree(files: string[], maxChars: number): string {
  const flat = files.join('\n');
  if (flat.length <= maxChars) return flat;

  const counts = new Map<string, number>();
  for (const file of files) {
    const segments = file.split('/');
    const dir = segments.length === 1 ? '.' : segments.slice(0, Math.min(2, segments.length - 1)).join('/');
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }

  const header = `${files.length} files, grouped by directory:`;
  const lines = [header];
  let length = header.length;
  for (const [dir, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    const line = `${dir}/ (${count} files)`;
    if (length + line.length + 1 > maxChars) {
      lines.push('...');
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join('\n');
}

async function statIfExists(file: string) {
  try {
    return await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readText(root: string, file: string, limit: number): Promise<ContextFile | undefined> {
  const absolute = path.join(root, file);
  const stats = await statIfExists(absolute);
  if (!stats?.isFile()) return undefined;

  const handle = await open(absolute, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(stats.size, limit * 4));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0)) return undefined;

    const text = bytes.toString('utf8');
    const truncated = text.length > limit || stats.size > bytesRead;
    return { path: file, content: truncated ? text.slice(0, limit) : text, truncated };
  } finally {
    await handle.close();
  }
}

export async function buildContext({ root, files, query, budget }: BuildContextOptions): Promise<RepositoryContext> {
  const tree = renderTree(files, Math.floor(budget / 4));
  let remaining = budget - tree.length;
  const selected: ContextFile[] = [];
  const available = new Set(files);

  const candidates = [
    ...ORIENTATION_FILES.filter((file) => available.has(file)).map((file) => ({ file, cap: MAX_ORIENTATION_CHARS })),
    ...rankFiles(files, query)
      .filter((file) => !LOCKFILES.has(path.posix.basename(file)) && !ORIENTATION_FILES.includes(file))
      .map((file) => ({ file, cap: MAX_FILE_CHARS })),
  ];

  for (const { file, cap } of candidates) {
    if (remaining < 500) break;
    const entry = await readText(root, file, Math.min(cap, remaining));
    if (!entry || entry.content.trim() === '') continue;
    selected.push(entry);
    remaining -= entry.content.length + file.length + 20;
  }

  return { tree, files: selected };
}

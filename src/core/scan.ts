import { execFile } from 'node:child_process';
import { opendir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'vendor',
  'venv',
  '.venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  'target',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.gradle',
  '.terraform',
  '.idea',
  '.vscode',
]);

const SECRET_DIRS = new Set(['.ssh', '.aws', '.kube']);

const SECRET_NAMES = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.envrc',
  '.git-credentials',
  'credentials',
  'credentials.json',
  'kubeconfig',
]);

const SECRET_PATTERNS = [
  /^id_(rsa|dsa|ecdsa|ed25519)/,
  /^gha-creds-.*\.json$/,
  /^service-account.*\.json$/,
  /\.tfstate(\..+)?$/,
  /\.tfvars$/,
];

const SECRET_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.ppk', '.jks', '.keystore', '.kdbx', '.gpg', '.asc']);

const BINARY_EXTENSIONS = new Set(
  [
    '.png .jpg .jpeg .gif .bmp .ico .webp .avif .tif .tiff .psd .svg .heic',
    '.woff .woff2 .ttf .otf .eot',
    '.mp3 .mp4 .m4a .wav .ogg .flac .webm .mov .avi .mkv',
    '.zip .tar .gz .tgz .bz2 .xz .7z .rar .jar .war .whl .egg',
    '.exe .dll .so .dylib .bin .o .a .lib .class .pyc .pyo .wasm .node',
    '.pdf .doc .docx .xls .xlsx .ppt .pptx .sqlite .sqlite3 .db',
  ].flatMap((group) => group.split(' ')),
);

const MAX_FILES = 20_000;

export interface ScanResult {
  files: string[];
  truncated: boolean;
}

export function isSafePath(relativePath: string): boolean {
  const segments = relativePath.toLowerCase().split('/');
  const name = segments.at(-1);
  if (!name) return false;
  const dirs = segments.slice(0, -1);
  if (dirs.some((segment) => IGNORED_DIRS.has(segment) || SECRET_DIRS.has(segment))) return false;
  if (dirs.at(-1) === '.docker' && name === 'config.json') return false;
  if (name === '.env' || name.startsWith('.env.')) return false;
  if (SECRET_NAMES.has(name) || SECRET_PATTERNS.some((pattern) => pattern.test(name))) return false;

  const extension = path.extname(name);
  if (SECRET_EXTENSIONS.has(extension) || BINARY_EXTENSIONS.has(extension)) return false;
  return !name.endsWith('.min.js') && !name.endsWith('.map');
}

async function gitFiles(root: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--cached'], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
  });
  return stdout.split('\0').filter(Boolean);
}

async function walkFiles(root: string, limit: number): Promise<string[]> {
  const files: string[] = [];
  const pending = [''];

  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    for await (const entry of await opendir(path.join(root, dir))) {
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) pending.push(relative);
      } else if (entry.isFile() && isSafePath(relative)) {
        files.push(relative);
        if (files.length > limit) return files;
      }
    }
  }
  return files;
}

function isMissingGit(error: NodeJS.ErrnoException & { stderr?: string }): boolean {
  return error.code === 'ENOENT' || /not a git repository/i.test(error.stderr ?? '');
}

// Tracked files only: untracked ones in a CI workspace are often credentials written by earlier steps.
// Outside a work tree (or without git installed) a plain walk with the fixed rules is the best we have.
// Any other git failure must not silently widen the scan past .gitignore.
async function listFiles(root: string, limit: number): Promise<string[]> {
  try {
    return await gitFiles(root);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if (isMissingGit(failure)) return walkFiles(root, limit);
    const detail = failure.stderr?.trim() || failure.message;
    throw new Error(`git ls-files failed in ${root}: ${detail}`, { cause: error });
  }
}

export async function scanRepository(root: string, limit = MAX_FILES): Promise<ScanResult> {
  const files = (await listFiles(root, limit)).filter(isSafePath).sort();
  return { files: files.slice(0, limit), truncated: files.length > limit };
}

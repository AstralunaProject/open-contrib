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

const SECRET_NAMES = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  'credentials.json',
]);

const SECRET_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.kdbx', '.gpg', '.asc']);

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
  const segments = relativePath.split('/');
  const name = segments.at(-1);
  if (!name) return false;
  if (segments.slice(0, -1).some((segment) => IGNORED_DIRS.has(segment))) return false;
  if (name === '.env' || name.startsWith('.env.')) return false;
  if (SECRET_NAMES.has(name) || /^id_(rsa|dsa|ecdsa|ed25519)/.test(name)) return false;

  const extension = path.extname(name).toLowerCase();
  if (SECRET_EXTENSIONS.has(extension) || BINARY_EXTENSIONS.has(extension)) return false;
  return !name.endsWith('.min.js') && !name.endsWith('.map');
}

async function gitFiles(root: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
  });
  return stdout.split('\0').filter(Boolean);
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [''];

  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    for await (const entry of await opendir(path.join(root, dir))) {
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) pending.push(relative);
      } else if (entry.isFile()) {
        files.push(relative);
        if (files.length > MAX_FILES) return files;
      }
    }
  }
  return files;
}

// `git ls-files` honors .gitignore, which keeps generated and local-only files out.
// Outside a work tree (or without git installed) a plain walk with the fixed rules is the best we have.
async function listFiles(root: string): Promise<string[]> {
  try {
    return await gitFiles(root);
  } catch {
    return walkFiles(root);
  }
}

export async function scanRepository(root: string): Promise<ScanResult> {
  const files = (await listFiles(root)).filter(isSafePath).sort();
  return { files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES };
}

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { formatRef, parseIssueRef, type GitHubClient, type IssueComment, type IssueRef } from './github.js';

export interface Issue {
  title: string;
  body: string;
  labels: string[] | undefined;
  comments: IssueComment[];
  ref: IssueRef | undefined;
  url: string | undefined;
}

const MAX_ISSUE_BYTES = 256 * 1024;

export function parseIssueText(text: string, fallbackTitle: string): Pick<Issue, 'title' | 'body'> {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() !== '');
  const heading = /^#\s+(.+)$/.exec(lines[headingIndex]?.trim() ?? '');
  if (!heading?.[1]) return { title: fallbackTitle, body: text.trim() };
  return { title: heading[1].trim(), body: lines.slice(headingIndex + 1).join('\n').trim() };
}

async function loadFile(file: string): Promise<Issue> {
  const stats = await stat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new UsageError(`Issue file not found: ${file}`);
    throw error;
  });
  if (!stats.isFile()) throw new UsageError(`Not a file: ${file}`);
  if (stats.size > MAX_ISSUE_BYTES) throw new UsageError(`Issue file is larger than ${MAX_ISSUE_BYTES / 1024} KiB: ${file}`);

  const { title, body } = parseIssueText(await readFile(file, 'utf8'), path.basename(file, path.extname(file)));
  return { title, body, labels: undefined, comments: [], ref: undefined, url: undefined };
}

export async function loadIssue(input: string, { github, dryRun }: { github: GitHubClient; dryRun: boolean }): Promise<Issue> {
  const ref = parseIssueRef(input);
  if (!ref) {
    if (/^https?:\/\//i.test(input)) throw new UsageError(`Not a GitHub issue URL: ${input}`);
    return loadFile(path.resolve(input));
  }

  if (dryRun) {
    return {
      title: formatRef(ref),
      body: '',
      labels: undefined,
      comments: [],
      ref,
      url: input,
    };
  }

  const issue = await github.fetchIssue(ref);
  return { ...issue, ref };
}

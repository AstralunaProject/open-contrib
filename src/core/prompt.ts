import type { RepositoryContext } from './context.js';
import type { Issue } from './issue.js';

const MAX_COMMENTS_CHARS = 8_000;

export const SYSTEM_PROMPT = `You are a senior maintainer of this repository onboarding a contributor who is about to work on the issue below.
Write a practical roadmap in GitHub-flavored Markdown with exactly these sections:

## Summary
Two or three sentences: what is broken or missing, and what "done" looks like.

## Where to look
A bulleted list of the files that matter, each with one line on why. Most relevant first.

## How the code fits together
The call path or data flow the change touches, in a few short steps.

## Suggested plan
Numbered, concrete steps from first edit to opening the pull request.

## Run and test
The exact commands to install, run, and test, taken from the manifests and docs provided.

## Open questions
Ambiguities worth confirming with maintainers before coding. Omit the section if there are none.

Rules:
- Only reference files that appear in the repository tree. Never invent paths, functions, or commands.
- When the provided context is not enough to be sure, say so and point to where the answer probably lives.
- Be direct and specific. No greetings, no motivational filler, no restating these instructions.`;

function fence(content: string): string {
  const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(longest + 1);
}

function renderComments(issue: Issue): string {
  const blocks: string[] = [];
  let used = 0;
  for (const comment of issue.comments) {
    const block = `@${comment.author}:\n${comment.body.trim()}`;
    if (used + block.length > MAX_COMMENTS_CHARS) {
      blocks.push(`(${issue.comments.length - blocks.length} more comments omitted)`);
      break;
    }
    blocks.push(block);
    used += block.length;
  }
  return blocks.join('\n\n');
}

export function buildPrompt(issue: Issue, context: RepositoryContext): string {
  const sections = [`# Issue: ${issue.title}`];
  if (issue.url) sections.push(`URL: ${issue.url}`);
  if (issue.labels?.length) sections.push(`Labels: ${issue.labels.join(', ')}`);
  sections.push(issue.body.trim() || '(no description)');

  if (issue.comments.length > 0) sections.push('## Discussion', renderComments(issue));

  sections.push('# Repository tree', context.tree || '(empty)');

  if (context.files.length > 0) {
    sections.push('# Selected files');
    for (const file of context.files) {
      const marker = fence(file.content);
      const note = file.truncated ? ' (truncated)' : '';
      sections.push(`## ${file.path}${note}\n${marker}\n${file.content}\n${marker}`);
    }
  }

  return sections.join('\n\n');
}

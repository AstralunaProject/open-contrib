import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

export async function fixture(t: TestContext, files: Record<string, string | Buffer>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'open-contrib-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(root, file);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  return root;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

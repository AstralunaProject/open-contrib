import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isSafePath, scanRepository } from '../src/core/scan.js';
import { fixture } from './helpers.js';

describe('isSafePath', () => {
  it('keeps ordinary source, config and docs', () => {
    for (const file of ['src/index.ts', 'README.md', '.github/workflows/ci.yml', 'pkg/env/config.go', '.env-loader.js']) {
      assert.ok(isSafePath(file), file);
    }
  });

  it('rejects secrets, binaries and dependency folders', () => {
    for (const file of [
      '.env',
      'apps/api/.env.production',
      'certs/server.pem',
      'deploy/tls.KEY',
      'home/.ssh/id_ed25519',
      '.npmrc',
      'assets/logo.png',
      'public/icon.svg',
      'fonts/Inter.woff2',
      'node_modules/lodash/index.js',
      'venv/lib/site.py',
      'target/release/app',
      'dist/index.js',
      'static/app.min.js',
      'static/app.js.map',
    ]) {
      assert.equal(isSafePath(file), false, file);
    }
  });
});

describe('scanRepository', () => {
  it('walks plain directories with the fixed rules', async (t) => {
    const root = await fixture(t, {
      'src/app.ts': 'export {}',
      'src/.env.local': 'TOKEN=1',
      'node_modules/dep/index.js': '',
      'logo.png': Buffer.from([0x89, 0x50]),
      'README.md': '# app',
    });
    await symlink(path.join(root, 'README.md'), path.join(root, 'link.md'));

    const { files, truncated } = await scanRepository(root);
    assert.deepEqual(files, ['README.md', 'src/app.ts']);
    assert.equal(truncated, false);
  });

  it('honors .gitignore inside a git work tree', async (t) => {
    const root = await fixture(t, {
      '.gitignore': 'generated/\n',
      'generated/schema.ts': 'export {}',
      'src/app.ts': 'export {}',
      '.env': 'TOKEN=1',
    });
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
    } catch {
      t.skip('git is not installed');
      return;
    }

    const { files } = await scanRepository(root);
    assert.deepEqual(files, ['.gitignore', 'src/app.ts']);
  });
});

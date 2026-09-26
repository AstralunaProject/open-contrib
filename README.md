# open-contrib

Turns a GitHub issue into a concrete onboarding roadmap for whoever is about to work on it: which files matter, how the relevant code flows, how to run and test it, and where the change most likely lands.

It reads the issue, walks the local checkout, and asks a language model to connect the two. It runs as a CLI on your machine or as a GitHub Action that comments the roadmap on issues labeled `good first issue` or `help wanted`.

> **Status:** pre-release. The provider layer (`src/core/engine`) is in place; the `analyze` pipeline is being wired up.

## Quickstart

```sh
# Local model, no keys required
ollama pull qwen2.5-coder:7b
npx open-contrib analyze --issue https://github.com/owner/repo/issues/42

# Hosted model
export ANTHROPIC_API_KEY=sk-ant-...
npx open-contrib analyze --issue ./issue.md

# See exactly what would be sent, with no network access
npx open-contrib analyze --issue ./issue.md --dry-run
```

Run it from the root of the repository the issue belongs to, or point `--root` at it.

## CLI

```
open-contrib analyze --issue <url|path> [options]
```

| Flag | Description |
| --- | --- |
| `--issue <url\|path>` | GitHub issue URL or a local Markdown/text file with the issue body. Required. |
| `--root <dir>` | Repository to inspect. Defaults to the current directory. |
| `--provider <name>` | `anthropic` or `ollama`. Auto-detected when omitted. |
| `--model <name>` | Model to use instead of the provider default. |
| `--labels <list>` | Comma-separated labels; exits quietly if the issue has none of them. |
| `--comment` | Post the roadmap as a comment on the issue. Requires `GITHUB_TOKEN`. |
| `--dry-run` | Parse the issue and codebase, print the prompt, and skip every network call. |
| `-h, --help` | Show usage. |
| `-v, --version` | Show the installed version. |

Exit codes: `0` success or skipped by `--labels`, `1` runtime failure (unreachable provider, API error, issue not found), `2` invalid usage.

The roadmap goes to `stdout`; progress and errors go to `stderr`, so `open-contrib analyze ... > ROADMAP.md` works as expected.

### Providers

Selection order:

1. `--provider`
2. `OPEN_CONTRIB_PROVIDER`
3. `anthropic` if `ANTHROPIC_API_KEY` is set
4. `ollama` otherwise

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | | Enables the hosted provider. |
| `ANTHROPIC_BASE_URL` | SDK default | Route through a proxy or gateway. |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Any OpenAI-compatible endpoint served by Ollama. |
| `OPEN_CONTRIB_PROVIDER` | | Force `anthropic` or `ollama`. |
| `OPEN_CONTRIB_MODEL` | `claude-sonnet-5` / `qwen2.5-coder:7b` | Override the model. |
| `GITHUB_TOKEN` | | Read private issues and post comments. |

Empty variables are treated as unset, so an unconfigured CI secret falls back to Ollama instead of failing authentication.

### What gets read

The file walker never reads or sends:

- `.git/`
- `.env`, `.env.*`
- private keys and certificates: `*.pem`, `*.key`
- binaries, archives, images, fonts, and media
- dependency and build output: `node_modules/`, `venv/`, `.venv/`, `target/`, `dist/`

With a local Ollama endpoint, no source code leaves your machine.

## GitHub Action

```yaml
# .github/workflows/onboarding.yml
name: onboarding

on:
  issues:
    types: [opened, labeled]
  workflow_dispatch:
    inputs:
      issue:
        description: Issue number
        required: true

permissions:
  contents: read
  issues: write

jobs:
  roadmap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: AstralunaProject/open-contrib@main
        with:
          issue-number: ${{ inputs.issue }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

On `issues` events the action only runs for issues carrying one of `labels` (default `good first issue,help wanted`). A manual `workflow_dispatch` run analyzes any issue.

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Reads the issue and posts the comment. |
| `issue-number` | triggering issue | Issue to analyze. |
| `labels` | `good first issue,help wanted` | Qualifying labels for `issues` events. |
| `provider` | auto | `anthropic` or `ollama`. |
| `model` | provider default | Model override. |
| `anthropic-api-key` | | Hosted provider key. |
| `ollama-base-url` | `http://localhost:11434/v1` | Ollama endpoint reachable from the runner. |
| `dry-run` | `false` | Print the prompt to the job log instead of calling a provider or commenting. |

Hosted runners have no GPU, so Ollama in CI is only practical on self-hosted runners or with an Ollama server on your network.

## Development

Requires Node.js 22+ for the test runner; the published CLI runs on Node.js 20.3+.

```sh
npm install
npm run typecheck
npm test
npm run build
```

## License

[MIT](LICENSE)

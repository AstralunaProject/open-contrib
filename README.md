# open-contrib

Turns a GitHub issue into a concrete onboarding roadmap for whoever is about to work on it: which files matter, how the relevant code flows, how to run and test it, and where the change most likely lands.

It reads the issue, walks the local checkout, and asks a language model to connect the two. It runs as a CLI on your machine or as a GitHub Action that comments the roadmap on issues labeled `good first issue` or `help wanted`.

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
| `--issue <url\|path>` | GitHub issue URL, `owner/repo#123`, or a local Markdown file whose first `# heading` is the title. Required. |
| `--root <dir>` | Repository to inspect. Defaults to the current directory. |
| `--provider <name>` | `anthropic` or `ollama`. Auto-detected when omitted. |
| `--model <name>` | Model to use instead of the provider default. |
| `--labels <list>` | Comma-separated labels, case-insensitive; exits `0` without output if the issue has none of them. |
| `--comment` | Post the roadmap as a comment on the issue, or update the one posted by a previous run. Requires `GITHUB_TOKEN`. |
| `--dry-run` | Scan the repository and print the exact prompt instead of calling a provider or GitHub. With an issue URL the body is not fetched, so pass a local file to preview the full prompt. |
| `-h, --help` | Show usage. |
| `-v, --version` | Show the installed version. |

Exit codes: `0` success or skipped by `--labels`, `1` runtime failure (unreachable provider, GitHub or model API error), `2` invalid usage (bad flags, missing issue file or root). Set `OPEN_CONTRIB_DEBUG=1` to get stack traces for unexpected errors.

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
| `GITHUB_TOKEN` / `GH_TOKEN` | | Read private issues, avoid anonymous rate limits, post comments. |

Empty variables are treated as unset, so an unconfigured CI secret falls back to Ollama instead of failing authentication.

### What gets read

Inside a git work tree, files come from `git ls-files`, so `.gitignore` applies. Everywhere else the directory is walked without following symlinks. Either way, these are never read or sent:

- VCS metadata: `.git/`, `.hg/`, `.svn/`
- environment files: `.env`, `.env.*`
- keys and credentials: `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `id_rsa*`, `id_ed25519*`, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `credentials.json`
- binaries, archives, images (including SVG), fonts, media, office documents, databases, minified bundles and source maps
- anything containing a NUL byte
- dependencies and build output: `node_modules/`, `vendor/`, `venv/`, `.venv/`, `__pycache__/`, `target/`, `dist/`, `build/`, `out/`, `coverage/`, `.next/`, `.gradle/`, `.terraform/`

The prompt carries the repository tree, the root README and manifests, and the files whose paths best match the issue text. A path quoted in the issue always wins. The context budget is about 24k characters for Ollama and 120k for Anthropic.

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

On `issues` events the action only runs for issues carrying one of `labels` (default `good first issue,help wanted`). A manual `workflow_dispatch` run analyzes any issue. Re-runs, such as an issue receiving both labels, edit the existing roadmap comment instead of adding another.

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

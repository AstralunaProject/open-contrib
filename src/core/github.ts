export interface IssueRef {
  apiUrl: string;
  owner: string;
  repo: string;
  number: number;
}

export interface IssueComment {
  id: number;
  author: string;
  body: string;
}

export interface GitHubIssue {
  title: string;
  body: string;
  labels: string[];
  url: string;
  comments: IssueComment[];
}

interface RawIssue {
  title: string;
  body: string | null;
  html_url: string;
  labels: Array<string | { name?: string }>;
}

interface RawComment {
  id: number;
  body?: string;
  user: { login: string; type?: string } | null;
}

export const COMMENT_MARKER = '<!-- open-contrib:roadmap -->';

const MAX_COMMENT_PAGES = 10;

export class GitHubError extends Error {
  override readonly name = 'GitHubError';
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

function apiUrlFor(origin: string, env: Env): string {
  if (origin === 'https://github.com') return 'https://api.github.com';
  if (env.GITHUB_API_URL && env.GITHUB_SERVER_URL?.replace(/\/+$/, '') === origin) {
    return env.GITHUB_API_URL.replace(/\/+$/, '');
  }
  return `${origin}/api/v3`;
}

function originOf(value: string | undefined): string | undefined {
  if (!value || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === 'https:' ? url.origin : undefined;
}

// The token belongs to github.com or the configured Enterprise server; never hand it to arbitrary hosts.
function trustedOrigins(env: Env): Set<string> {
  const origins = ['https://api.github.com', originOf(env.GITHUB_API_URL), originOf(env.GITHUB_SERVER_URL)];
  return new Set(origins.filter((origin): origin is string => origin !== undefined));
}

function failureHint(status: number, authenticated: boolean, withheld: boolean): string {
  if (withheld) return ' GITHUB_TOKEN is only sent to api.github.com or the host in GITHUB_API_URL / GITHUB_SERVER_URL.';
  if ((status === 401 || status === 404) && !authenticated) return ' Set GITHUB_TOKEN if the repository is private.';
  if (status === 403 && !authenticated) return ' Unauthenticated requests are heavily rate limited; set GITHUB_TOKEN.';
  if (status === 403) return ' Check the token permissions (issues: write) and rate limits.';
  return '';
}

export function parseIssueRef(input: string, env: Env = process.env): IssueRef | undefined {
  const shorthand = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(input.trim());
  if (shorthand) {
    const [, owner = '', repo = '', number = ''] = shorthand;
    return { apiUrl: apiUrlFor('https://github.com', env), owner, repo, number: Number(number) };
  }

  if (!URL.canParse(input)) return undefined;
  const url = new URL(input);
  if (url.protocol !== 'https:') return undefined;

  const match = /^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)\/?$/.exec(url.pathname);
  if (!match) return undefined;
  const [, owner = '', repo = '', number = ''] = match;
  return { apiUrl: apiUrlFor(url.origin, env), owner, repo, number: Number(number) };
}

export function formatRef({ owner, repo, number }: IssueRef): string {
  return `${owner}/${repo}#${number}`;
}

export class GitHubClient {
  readonly #token: string | undefined;
  readonly #trusted: Set<string>;

  constructor(token: string | undefined, env: Env = process.env) {
    this.#token = token;
    this.#trusted = trustedOrigins(env);
  }

  async #request<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'open-contrib',
    };
    const authenticated = this.#token !== undefined && this.#trusted.has(new URL(url).origin);
    if (authenticated) headers.authorization = `Bearer ${this.#token}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new GitHubError(`Could not reach ${new URL(url).origin}: ${(error as Error).message}`);
    }

    if (!response.ok) {
      const detail = (await response.text()).trim().slice(0, 300);
      const hint = failureHint(response.status, authenticated, this.#token !== undefined && !authenticated);
      throw new GitHubError(`GitHub API ${response.status} for ${url}.${hint} ${detail}`.trim(), response.status);
    }
    return (await response.json()) as T;
  }

  async #comments(ref: IssueRef): Promise<RawComment[]> {
    const all: RawComment[] = [];
    for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
      const batch = await this.#request<RawComment[]>(
        `${ref.apiUrl}/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments?per_page=100&page=${page}`,
      );
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  }

  async fetchIssue(ref: IssueRef): Promise<GitHubIssue> {
    const [issue, comments] = await Promise.all([
      this.#request<RawIssue>(`${ref.apiUrl}/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`),
      this.#comments(ref),
    ]);

    return {
      title: issue.title,
      body: issue.body ?? '',
      url: issue.html_url,
      labels: issue.labels.flatMap((label) => {
        const name = typeof label === 'string' ? label : label.name;
        return name ? [name] : [];
      }),
      comments: comments
        .filter((comment) => comment.body && !comment.body.includes(COMMENT_MARKER))
        .map((comment) => ({ id: comment.id, author: comment.user?.login ?? 'ghost', body: comment.body ?? '' })),
    };
  }

  // Label events fire once per label, so re-runs edit the previous roadmap instead of stacking new ones.
  // Anyone can paste the marker, so only a bot-authored roadmap is ever edited.
  async upsertComment(ref: IssueRef, markdown: string): Promise<string> {
    const body = `${COMMENT_MARKER}\n${markdown}`;
    const existing = (await this.#comments(ref)).find(
      (comment) => comment.user?.type === 'Bot' && comment.body?.startsWith(COMMENT_MARKER),
    );
    const base = `${ref.apiUrl}/repos/${ref.owner}/${ref.repo}/issues`;

    const saved = existing
      ? await this.#request<{ html_url: string }>(`${base}/comments/${existing.id}`, { method: 'PATCH', body: { body } })
      : await this.#request<{ html_url: string }>(`${base}/${ref.number}/comments`, { method: 'POST', body: { body } });
    return saved.html_url;
  }
}

/**
 * Thin HTTP client for the Bitbucket Cloud REST API 2.0.
 *
 * This is the single place where authentication lives: HTTP Basic with
 * the Atlassian account email and an API token.
 */

import { config } from "./config.js";

const BASE_URL = "https://api.bitbucket.org/2.0";

type HttpMethod = "GET" | "POST";

const authHeader =
  "Basic " +
  Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");

/**
 * Perform a request and return the raw Response, throwing a descriptive
 * Error on any non-2xx status.
 */
async function bbFetch(
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = { Authorization: authHeader };

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(await describeError(res));
  }
  return res;
}

/** Build a human-readable error message from a failed response. */
async function describeError(res: Response): Promise<string> {
  let detail = "";
  const text = await res.text().catch(() => "");
  if (text) {
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      detail = parsed.error?.message ?? text;
    } catch {
      detail = text;
    }
  }

  const hints: Record<number, string> = {
    401: "Invalid credentials — check BITBUCKET_EMAIL and BITBUCKET_API_TOKEN.",
    403: "Access denied — the token lacks permission on this workspace/repository.",
    404: "Not found — check the workspace, repository slug and PR id.",
    429: "Rate limit exceeded — wait before retrying.",
  };
  const hint = hints[res.status];

  return (
    `Bitbucket API error: HTTP ${res.status} ${res.statusText}` +
    (hint ? ` — ${hint}` : "") +
    (detail ? ` (${detail})` : "")
  );
}

/** Request returning parsed JSON. */
export async function bbRequest<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await bbFetch(method, path, body);
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** GET request returning the body as plain text (diffs, file contents). */
export async function bbRequestText(path: string): Promise<string> {
  const res = await bbFetch("GET", path);
  return res.text();
}

/**
 * Build a query string from a set of optional parameters, skipping any that
 * are undefined. Returns an empty string when nothing is provided.
 */
export function toQuery(
  params: Record<string, string | number | undefined>,
): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "";
  const search = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
  return `?${search.toString()}`;
}

/**
 * Resolve the workspace to use: the explicit parameter wins, otherwise the
 * BITBUCKET_WORKSPACE default. Throws when neither is available.
 */
export function resolveWorkspace(workspace?: string): string {
  const ws = workspace ?? config.defaultWorkspace;
  if (!ws) {
    throw new Error(
      "No workspace provided. Pass the `workspace` parameter or set the " +
        "BITBUCKET_WORKSPACE environment variable.",
    );
  }
  return ws;
}

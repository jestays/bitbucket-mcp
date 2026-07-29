/**
 * MCP server definition.
 *
 * Exposes tools for code review of Bitbucket Cloud pull requests: list PRs,
 * read metadata / diffs / file contents / comments, and post review comments
 * (general, inline, or replies).
 *
 * Transport: stdio (all MCP protocol traffic over stdin/stdout).
 * Logging: console.error only — stdout is reserved for the MCP protocol.
 */

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  bbRequest,
  bbRequestText,
  resolveWorkspace,
  toQuery,
} from "./client.js";
import { config } from "./config.js";

/** Wrap a tool body with uniform JSON serialization and error handling. */
async function toolResult(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(data ?? null, null, 2) },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[bitbucket-mcp] Tool error:", message);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Error: ${message}` }],
    };
  }
}

/** Like toolResult, but for tools whose payload is already plain text. */
async function textResult(fn: () => Promise<string>) {
  try {
    const text = await fn();
    return { content: [{ type: "text" as const, text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[bitbucket-mcp] Tool error:", message);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Error: ${message}` }],
    };
  }
}

/** Input fields shared by every tool that targets a repository. */
const repoShape = {
  repo: z
    .string()
    .describe('Repository slug, e.g. "my-service" (not the full URL).'),
  workspace: z
    .string()
    .optional()
    .describe(
      "Workspace id. Optional when the BITBUCKET_WORKSPACE env var is set.",
    ),
};

const pageShape = {
  page: z.number().int().min(1).optional().describe("Page number (1-based)."),
  pagelen: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Results per page (max 50, default 10)."),
};

/** Minimal shapes of the Bitbucket API responses we consume. */
interface BbUser {
  display_name?: string;
}
interface BbBranchEnd {
  branch?: { name?: string };
  commit?: { hash?: string };
}
interface BbPullRequest {
  id: number;
  title?: string;
  description?: string;
  state?: string;
  author?: BbUser;
  source?: BbBranchEnd;
  destination?: BbBranchEnd;
  reviewers?: BbUser[];
  participants?: { user?: BbUser; role?: string; approved?: boolean }[];
  comment_count?: number;
  created_on?: string;
  updated_on?: string;
  links?: { html?: { href?: string } };
}
interface BbPaginated<T> {
  values?: T[];
  page?: number;
  size?: number;
  next?: string;
}
interface BbComment {
  id: number;
  user?: BbUser;
  content?: { raw?: string };
  inline?: { path?: string; from?: number | null; to?: number | null };
  parent?: { id?: number };
  deleted?: boolean;
  resolution?: unknown;
  created_on?: string;
  links?: { html?: { href?: string } };
}

function summarizePr(pr: BbPullRequest) {
  return {
    id: pr.id,
    title: pr.title,
    state: pr.state,
    author: pr.author?.display_name,
    source_branch: pr.source?.branch?.name,
    destination_branch: pr.destination?.branch?.name,
    comment_count: pr.comment_count,
    updated_on: pr.updated_on,
    url: pr.links?.html?.href,
  };
}

// Single source of truth for the version: package.json (works from src/ via
// tsx and from dist/ in the published package — both sit one level below root).
const { version } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

// Usage guidance sent to MCP clients. By default it gates
// create_pull_request_comment behind explicit user approval;
// BITBUCKET_YOLO=true drops the gate for automation/CI.
const approvalWarning =
  "Posts publicly visible content to Bitbucket — do NOT call this tool " +
  "unless the user has explicitly approved the exact comment text. ";

const instructions = [
  "Tools for code review of Bitbucket Cloud pull requests.",
  "",
  "The read-only tools (list_pull_requests, get_pull_request, " +
    "get_pull_request_diff, get_file_content, list_pull_request_comments) " +
    "may be used freely.",
  "",
  "Recommended review workflow:",
  "1. Read the PR metadata and diff, plus any file content needed for context.",
  "2. Analyze the changes and consolidate ALL findings first.",
  ...(config.yolo
    ? ["3. Post the comments that follow from your findings."]
    : [
        "3. Present the complete set of findings to the user so they decide " +
          "which ones become comments and with what wording.",
        "4. Call create_pull_request_comment only for comments the user " +
          "explicitly approved, one call per comment. Never post comments " +
          "on your own initiative.",
      ]),
].join("\n");

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "bitbucket-mcp",
      version,
    },
    { instructions },
  );

  // --- List pull requests ---------------------------------------------------
  server.registerTool(
    "list_pull_requests",
    {
      description:
        "List pull requests of a repository, filtered by state (default OPEN). " +
        "Returns a summary per PR: id, title, author, branches, state, " +
        "comment count and last update. Paginated; `next_page` is set when " +
        "more results exist.",
      inputSchema: {
        ...repoShape,
        state: z
          .enum(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"])
          .optional()
          .describe("PR state to filter by (default OPEN)."),
        ...pageShape,
      },
    },
    async ({ repo, workspace, state, page, pagelen }) =>
      toolResult(async () => {
        const ws = resolveWorkspace(workspace);
        const query = toQuery({ state: state ?? "OPEN", page, pagelen });
        const data = await bbRequest<BbPaginated<BbPullRequest>>(
          "GET",
          `/repositories/${encodeURIComponent(ws)}/${encodeURIComponent(repo)}/pullrequests${query}`,
        );
        return {
          pull_requests: (data.values ?? []).map(summarizePr),
          page: data.page,
          next_page: data.next ? (data.page ?? 1) + 1 : undefined,
        };
      }),
  );

  // --- Get a single pull request --------------------------------------------
  server.registerTool(
    "get_pull_request",
    {
      description:
        "Get full metadata of a pull request: title, description, author, " +
        "branches with commit hashes, state, and reviewers with their " +
        "approval status.",
      inputSchema: {
        ...repoShape,
        pr_id: z.number().int().describe("Pull request id, e.g. 42."),
      },
    },
    async ({ repo, workspace, pr_id }) =>
      toolResult(async () => {
        const ws = resolveWorkspace(workspace);
        const pr = await bbRequest<BbPullRequest>(
          "GET",
          `/repositories/${encodeURIComponent(ws)}/${encodeURIComponent(repo)}/pullrequests/${pr_id}`,
        );
        return {
          ...summarizePr(pr),
          description: pr.description,
          source_commit: pr.source?.commit?.hash,
          destination_commit: pr.destination?.commit?.hash,
          created_on: pr.created_on,
          participants: (pr.participants ?? []).map((p) => ({
            name: p.user?.display_name,
            role: p.role,
            approved: p.approved,
          })),
        };
      }),
  );

  // --- Get the diff of a pull request ----------------------------------------
  server.registerTool(
    "get_pull_request_diff",
    {
      description:
        "Get the unified diff of a pull request as plain text. This is the " +
        "primary input for a code review.",
      inputSchema: {
        ...repoShape,
        pr_id: z.number().int().describe("Pull request id, e.g. 42."),
      },
    },
    async ({ repo, workspace, pr_id }) =>
      textResult(async () => {
        const ws = resolveWorkspace(workspace);
        return bbRequestText(
          `/repositories/${encodeURIComponent(ws)}/${encodeURIComponent(repo)}/pullrequests/${pr_id}/diff`,
        );
      }),
  );

  // --- Get file content -------------------------------------------------------
  server.registerTool(
    "get_file_content",
    {
      description:
        "Get the raw content of a file at a given ref (branch name, tag or " +
        "commit hash). Useful to see full context beyond the diff hunks " +
        "during a review.",
      inputSchema: {
        ...repoShape,
        path: z
          .string()
          .describe('File path inside the repo, e.g. "src/app/main.ts".'),
        ref: z
          .string()
          .describe(
            "Branch name, tag or commit hash (e.g. the PR source branch " +
              "or source_commit from get_pull_request). Branch names " +
              "containing slashes (e.g. \"bugfix/foo\") are supported and " +
              "resolved to a commit hash automatically.",
          ),
      },
    },
    async ({ repo, workspace, path, ref }) =>
      textResult(async () => {
        const ws = resolveWorkspace(workspace);
        const encodedPath = path
          .replace(/^\/+/, "")
          .split("/")
          .map(encodeURIComponent)
          .join("/");
        let resolvedRef = ref;
        if (ref.includes("/")) {
          // Branch names with "/" cannot appear percent-encoded in the /src
          // URL; resolve them to a commit hash via the refs endpoint first.
          const branch = await bbRequest<{ target?: { hash?: string } }>(
            "GET",
            `/repositories/${encodeURIComponent(ws)}/${encodeURIComponent(repo)}/refs/branches/${encodeURIComponent(ref)}`,
          ).catch(() => undefined);
          if (branch?.target?.hash) resolvedRef = branch.target.hash;
        }
        return bbRequestText(
          `/repositories/${encodeURIComponent(ws)}/${encodeURIComponent(repo)}/src/${encodeURIComponent(resolvedRef)}/${encodedPath}`,
        );
      }),
  );

  // --- List PR comments -------------------------------------------------------
  server.registerTool(
    "list_pull_request_comments",
    {
      description:
        "List the comments of a pull request (general and inline). Use it " +
        "before posting review comments to avoid repeating observations " +
        "already made. Paginated; `next_page` is set when more results exist.",
      inputSchema: {
        ...repoShape,
        pr_id: z.number().int().describe("Pull request id, e.g. 42."),
        ...pageShape,
      },
    },
    async ({ repo, workspace, pr_id, page, pagelen }) =>
      toolResult(async () => {
        const ws = resolveWorkspace(workspace);
        const query = toQuery({ page, pagelen });
        const data = await bbRequest<BbPaginated<BbComment>>(
          "GET",
          `/repositories/${encodeURIComponent(ws)}/${encodeURIComponent(repo)}/pullrequests/${pr_id}/comments${query}`,
        );
        return {
          comments: (data.values ?? []).map((c) => ({
            id: c.id,
            author: c.user?.display_name,
            content: c.content?.raw,
            inline: c.inline
              ? { path: c.inline.path, from: c.inline.from, to: c.inline.to }
              : undefined,
            reply_to: c.parent?.id,
            deleted: c.deleted || undefined,
            resolved: c.resolution ? true : undefined,
            created_on: c.created_on,
          })),
          page: data.page,
          next_page: data.next ? (data.page ?? 1) + 1 : undefined,
        };
      }),
  );

  // --- Create a PR comment ------------------------------------------------------
  server.registerTool(
    "create_pull_request_comment",
    {
      description:
        (config.yolo ? "" : approvalWarning) +
        "Post a comment on a pull request. Three modes: general (only " +
        "`content`), inline on a specific line (`file_path` + `line`, with " +
        "`line_type` indicating whether the line is added or removed in the " +
        "diff), or a reply to an existing comment (`parent_id`).",
      inputSchema: {
        ...repoShape,
        pr_id: z.number().int().describe("Pull request id, e.g. 42."),
        content: z
          .string()
          .min(1)
          .describe("Comment body (Markdown supported)."),
        file_path: z
          .string()
          .optional()
          .describe(
            "For inline comments: file path exactly as it appears in the diff.",
          ),
        line: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "For inline comments: 1-based line number the comment anchors to.",
          ),
        line_type: z
          .enum(["added", "removed"])
          .optional()
          .describe(
            'Whether `line` refers to a line added ("+", numbered in the new ' +
              'file) or removed ("-", numbered in the old file) in the diff. ' +
              "Default: added.",
          ),
        parent_id: z
          .number()
          .int()
          .optional()
          .describe("Id of an existing comment to reply to."),
      },
    },
    async ({
      repo,
      workspace,
      pr_id,
      content,
      file_path,
      line,
      line_type,
      parent_id,
    }) =>
      toolResult(async () => {
        const ws = resolveWorkspace(workspace);
        if ((file_path === undefined) !== (line === undefined)) {
          throw new Error(
            "Inline comments require BOTH file_path and line (or neither).",
          );
        }

        const body: {
          content: { raw: string };
          inline?: { path: string; to?: number; from?: number };
          parent?: { id: number };
        } = { content: { raw: content } };

        if (file_path !== undefined && line !== undefined) {
          body.inline =
            line_type === "removed"
              ? { path: file_path, from: line }
              : { path: file_path, to: line };
        }
        if (parent_id !== undefined) {
          body.parent = { id: parent_id };
        }

        const created = await bbRequest<BbComment>(
          "POST",
          `/repositories/${encodeURIComponent(ws)}/${encodeURIComponent(repo)}/pullrequests/${pr_id}/comments`,
          body,
        );
        return {
          id: created.id,
          url: created.links?.html?.href,
          inline: created.inline
            ? { path: created.inline.path, from: created.inline.from, to: created.inline.to }
            : undefined,
        };
      }),
  );

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Some MCP clients disconnect by closing stdin instead of sending a signal.
  server.server.onclose = () => {
    console.error("[bitbucket-mcp] Transport closed, shutting down...");
    process.exit(0);
  };

  console.error("[bitbucket-mcp] MCP server started on stdio.");
}

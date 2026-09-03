# @jestay/bitbucket-mcp

MCP server for code review of Bitbucket Cloud pull requests: list PRs, read
diffs, file contents and comments, post review comments (general, inline on
specific lines, or replies), resolve comment threads and update the PR
title/description.

## Tools

| Tool | Description |
| --- | --- |
| `list_pull_requests` | List PRs of a repo, filtered by state (default OPEN) |
| `get_pull_request` | Full PR metadata: branches, commits, reviewers, approval status |
| `get_pull_request_diff` | Unified diff of the PR (plain text) |
| `get_file_content` | Raw file content at a branch/tag/commit |
| `list_pull_request_comments` | Existing PR comments (general and inline), with resolution status |
| `create_pull_request_comment` | Post a comment: general, inline (`file_path` + `line`) or reply (`parent_id`) |
| `resolve_pull_request_comment` | Resolve (or reopen with `action: "reopen"`) a top-level comment thread |
| `update_pull_request` | Update the `title` and/or `description` of an open PR |

Bitbucket Cloud allows resolving any top-level comment, general or inline;
replies cannot be resolved, so pass the id of the comment that opens the
thread. Liking a comment is not exposed by the public REST API 2.0, so it is
not available here.

Bitbucket's `PUT /pullrequests/{id}` is a full replace: any field omitted from
the body is dropped (reviewers included). `update_pull_request` therefore reads
the PR first and sends reviewers, `close_source_branch` and `draft` back
unchanged, so only the title/description you pass actually change.

## Review workflow

By default the server ships MCP instructions telling the connected agent to
review first and comment later: read the diff, consolidate all findings,
present them to the user, and post only the comments the user explicitly
approved. `create_pull_request_comment` carries the same warning in its
description, and the other mutating tools (`resolve_pull_request_comment`,
`update_pull_request`) ask the agent to act only on an explicit user request.

For unattended use (automation/CI), set `BITBUCKET_YOLO=true` to remove the
approval gate and let the agent comment autonomously.

## Requirements

- Node.js 20.6+
- An Atlassian API token (see below)

## Creating the API token

Create an **API token with scopes** at
https://id.atlassian.com/manage-profile/security/api-tokens, select
**Bitbucket** as the app, and grant these scopes:

| Scope | Used for |
| --- | --- |
| `read:user:bitbucket` | Authentication / identifying the token's user |
| `read:workspace:bitbucket` | Resolving the workspace in API routes |
| `read:repository:bitbucket` | Reading repository file contents (`get_file_content`) |
| `read:pullrequest:bitbucket` | Listing and reading PRs, diffs and comments |
| `write:pullrequest:bitbucket` | Posting review comments, resolving threads, updating the PR |

No other scopes are needed — in particular, `write:repository:bitbucket` is
NOT required (this server never pushes code).

> Note: Atlassian App Passwords are deprecated — use API tokens.

## Usage (npx)

No installation needed — any machine with Node 20.6+ can run it via `npx`.

`.mcp.json` (Claude Code) or `claude_desktop_config.json` (Claude Desktop):

```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "npx",
      "args": ["-y", "@jestay/bitbucket-mcp"],
      "env": {
        "BITBUCKET_EMAIL": "you@company.com",
        "BITBUCKET_API_TOKEN": "your_token_here",
        "BITBUCKET_WORKSPACE": "your-workspace"
      }
    }
  }
}
```

Or with the Claude Code CLI:

```bash
claude mcp add bitbucket \
  -e BITBUCKET_EMAIL=you@company.com \
  -e BITBUCKET_API_TOKEN=your_token_here \
  -e BITBUCKET_WORKSPACE=your-workspace \
  -- npx -y @jestay/bitbucket-mcp
```

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `BITBUCKET_EMAIL` | Yes | Atlassian account email |
| `BITBUCKET_API_TOKEN` | Yes | Atlassian API token (scopes above) |
| `BITBUCKET_WORKSPACE` | No | Default workspace so tools don't need it per call |
| `BITBUCKET_YOLO` | No | Set to `true`/`1` to disable the ask-before-commenting guidance (automation/CI) |

## Local development

```bash
pnpm install
pnpm build
cp .env.example .env   # then fill in the values
pnpm dev               # run from source (tsx)
pnpm start             # run the compiled build
```

`pnpm dev` and `pnpm start` load environment variables from a `.env` file in
the project root. When registering the server in an MCP client, environment
variables come from the client's own config instead and no `.env` file is
needed. To register a local build, use
`node /absolute/path/to/bitbucket-mcp/dist/index.js` as the command.

## Project layout

```
src/
├── index.ts     # entry point
├── config.ts    # env-var configuration
├── client.ts    # HTTP client for the Bitbucket Cloud API 2.0 (auth lives here)
└── server.ts    # McpServer + tool registration
```

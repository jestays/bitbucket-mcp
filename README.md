# bitbucket-mcp

MCP server for code review of Bitbucket Cloud pull requests: list PRs, read
diffs, file contents and comments, and post review comments (general, inline
on specific lines, or replies).

## Tools

| Tool | Description |
| --- | --- |
| `list_pull_requests` | List PRs of a repo, filtered by state (default OPEN) |
| `get_pull_request` | Full PR metadata: branches, commits, reviewers, approval status |
| `get_pull_request_diff` | Unified diff of the PR (plain text) |
| `get_file_content` | Raw file content at a branch/tag/commit |
| `list_pull_request_comments` | Existing PR comments (general and inline) |
| `create_pull_request_comment` | Post a comment: general, inline (`file_path` + `line`) or reply (`parent_id`) |

## Setup

```bash
pnpm install
pnpm build
cp .env.example .env   # then fill in the values
```

Environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `BITBUCKET_EMAIL` | Yes | Atlassian account email |
| `BITBUCKET_API_TOKEN` | Yes | API token from https://id.atlassian.com/manage-profile/security/api-tokens |
| `BITBUCKET_WORKSPACE` | No | Default workspace so tools don't need it per call |

> Note: Atlassian App Passwords are deprecated — use API tokens.

## Running

```bash
pnpm dev     # run from source (tsx)
pnpm start   # run the compiled build
```

`pnpm dev` and `pnpm start` load environment variables from a `.env` file in
the project root (created in Setup above). When registering the server in an
MCP client instead, environment variables come from the client's own config
(see below) and no `.env` file is needed.

## Register in an MCP client

`.mcp.json` (Claude Code) or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "node",
      "args": ["/absolute/path/to/bitbucket-mcp/dist/index.js"],
      "env": {
        "BITBUCKET_EMAIL": "you@company.com",
        "BITBUCKET_API_TOKEN": "your_token_here",
        "BITBUCKET_WORKSPACE": "your-workspace"
      }
    }
  }
}
```

Or with Claude Code CLI:

```bash
claude mcp add bitbucket \
  -e BITBUCKET_EMAIL=you@company.com \
  -e BITBUCKET_API_TOKEN=your_token_here \
  -e BITBUCKET_WORKSPACE=your-workspace \
  -- node /absolute/path/to/bitbucket-mcp/dist/index.js
```

Once published to npm, machines only need Node 20.6+:

```json
{
  "command": "npx",
  "args": ["-y", "@jestay/bitbucket-mcp"]
}
```

Note: the `@jestay` scope must match the npm account that publishes the
package — update it if you publish under a different account.

## Project layout

```
src/
├── index.ts     # entry point
├── config.ts    # env-var configuration
├── client.ts    # HTTP client for the Bitbucket Cloud API 2.0 (auth lives here)
└── server.ts    # McpServer + tool registration
```

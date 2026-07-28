/**
 * Centralized configuration.
 *
 * All values are read from environment variables so they can be adjusted
 * without code changes. Copy .env.example to .env and fill in the values.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill in the value.`,
    );
  }
  return value;
}

export const config = {
  /** Atlassian account email used for HTTP Basic auth. REQUIRED. */
  email: required("BITBUCKET_EMAIL"),

  /** Atlassian API token (not an App Password). REQUIRED. */
  apiToken: required("BITBUCKET_API_TOKEN"),

  /** Optional default workspace; tools fall back to this when the
   *  `workspace` parameter is omitted. */
  defaultWorkspace: process.env.BITBUCKET_WORKSPACE || undefined,
} as const;

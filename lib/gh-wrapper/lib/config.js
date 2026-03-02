'use strict';

/**
 * gh-wrapper configuration.
 *
 * Environment variables:
 *   GH_WRAPPER_BACKEND  - 'github' (default, passthrough) or 'gitea'
 *   GITEA_URL           - Base URL of your Gitea instance (required for gitea backend)
 *   GITEA_TOKEN         - Gitea API token (falls back to GH_TOKEN)
 *
 * Example:
 *   GH_WRAPPER_BACKEND=gitea GITEA_URL=https://gitea.example.com GITEA_TOKEN=my_token gh secret set FOO
 */
module.exports = {
  backend: process.env.GH_WRAPPER_BACKEND || 'github',
  giteaUrl: (process.env.GITEA_URL || '').replace(/\/$/, ''),
  // GITEA_TOKEN takes priority; fall back to GH_TOKEN which is standard in workflow contexts
  token: process.env.GITEA_TOKEN || process.env.GH_TOKEN || '',
};

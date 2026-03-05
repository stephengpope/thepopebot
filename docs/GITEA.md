# Gitea Integration

thepopebot ships a `gh`-compatible shim (`lib/gh-wrapper`) that lets the Docker agent use the same `gh` CLI commands whether your repos are on GitHub or a self-hosted Gitea instance. The calling code never knows which backend it is talking to.

## How it works

The shim is installed at a path that shadows the real `gh` binary inside the Docker container. At runtime it checks `GH_WRAPPER_BACKEND`:

- `github` (default) — passes all arguments directly to the real `gh` binary.
- `gitea` — translates the command to a Gitea REST API call and prints GitHub-compatible output.

## Setup

Set these environment variables in your GitHub Actions secrets / Gitea repository secrets:

| Variable | Required | Description |
|---|---|---|
| `GH_WRAPPER_BACKEND` | Yes | Set to `gitea` to enable the Gitea backend |
| `GITEA_URL` | Yes | Base URL of your Gitea instance, e.g. `https://gitea.example.com` |
| `GITEA_TOKEN` | Yes | Gitea personal access token with `repo` and `issue` scopes |
| `GH_TOKEN` | Fallback | Used if `GITEA_TOKEN` is not set |

### Gitea token scopes

Generate a token at **Settings → Applications → Access Tokens**. Required scopes:

- `repository` (read + write) — PR and release operations
- `issue` (read + write) — if you use issue-related workflows
- `organization` (read) — if creating repos under an org

## Supported commands

| Command | Notes |
|---|---|
| `gh auth status` | Validates token against `/api/v1/user` |
| `gh auth login --with-token` | Reads token from stdin, validates |
| `gh auth setup-git` | Writes token to `~/.git-credentials` |
| `gh secret set NAME --repo owner/repo` | Value via stdin |
| `gh secret list --repo owner/repo` | |
| `gh variable set NAME --repo owner/repo` | Value via stdin |
| `gh api <endpoint> [-q expr]` | Raw Gitea API call |
| `gh pr view <number>` | |
| `gh pr list [--head branch] [--state open\|closed\|all]` | |
| `gh pr diff <number> [--name-only]` | |
| `gh pr create --title ... --body ... --base main` | |
| `gh pr merge <number\|branch> [--squash] [--delete-branch]` | |
| `gh release list` | |
| `gh release create TAG [--title ...] [--notes ...]` | |
| `gh repo create NAME [--private]` | |

All commands support `--json fields` and `--jq expr` / `-q expr` for output filtering, matching real `gh` behaviour.

### `--jq` / `-q` limitations (jq-lite)

The shim uses a built-in `jq-lite` implementation rather than the real `jq` binary. Most common expressions work, but two limitations apply:

**No comparison operators** — `==`, `!=`, `<`, `>` are not implemented. `select()` only works with truthy field checks:

```sh
# Works — passes items where .merged is truthy
gh pr list --json merged,number --jq '.[] | select(.merged) | .number'

# Does NOT work — equality check silently passes everything through
gh pr list --json state,number --jq '.[] | select(.state == "open") | .number'
```

**`to_entries`, `from_entries`, `fromjson` require empty parens** — unlike real jq where these are bare words, jq-lite only dispatches them when called with `()`:

```sh
# Works
gh api repos/owner/repo --jq 'to_entries() | .[] | .key'

# Does NOT work — silently returns input unchanged
gh api repos/owner/repo --jq 'to_entries | .[] | .key'
```

## Known issues

### Underscore parameters in Gitea 1.25 (current)

Gitea 1.25 has a bug where certain API endpoints reject or silently ignore body fields whose names contain underscores (e.g. `delete_branch_after_merge`, `target_commitish`). This affects:

- `gh pr merge --delete-branch` — the branch may not be deleted after merge even if the flag is passed.
- `gh release create` with an explicit `--target` / `--target-commitish` — the target commit may be ignored and the release will be created from the default branch instead.

**Workaround**: After merging, delete the branch manually with `git push origin --delete <branch>`. For releases, ensure the tag points to the correct commit before running `gh release create`.

This is tracked upstream: https://github.com/go-gitea/gitea/issues — watch for a fix in 1.25.x patch releases or 1.26.

### `gh pr merge --auto`

Gitea does not support auto-merge in the same way GitHub does. The `--auto` flag is accepted but the merge is performed immediately rather than being queued for when checks pass.

### Interactive commands

`gh auth login` (without `--with-token`) is not supported. Use `--with-token` and pipe the token via stdin, or set `GITEA_TOKEN` directly.

## Troubleshooting

**`GITEA_URL is not set`** — The `GH_WRAPPER_BACKEND=gitea` env var is set but `GITEA_URL` is missing. Add it to your workflow secrets.

**`No Gitea token found`** — Neither `GITEA_TOKEN` nor `GH_TOKEN` is set. Add `GITEA_TOKEN` to your repository secrets.

**`404` on secret/variable endpoints** — Gitea Actions API requires Gitea ≥ 1.19. Older instances do not expose these endpoints.

**SSH remote not detected** — `repoFromGit()` parses standard SSH remotes (`git@host:owner/repo.git`). Non-standard SSH configs (custom ports, ProxyJump, etc.) may not be detected — pass `--repo owner/repo` explicitly.

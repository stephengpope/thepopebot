#!/bin/bash
set -e

# Extract job ID from branch name (job/uuid -> uuid), fallback to random UUID
if [[ "$BRANCH" == job/* ]]; then
    JOB_ID="${BRANCH#job/}"
else
    JOB_ID=$(cat /proc/sys/kernel/random/uuid)
fi
echo "Job ID: ${JOB_ID}"

# Export SECRETS (JSON) as flat env vars (GH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, etc.)
if [ -n "$SECRETS" ]; then
    eval $(echo "$SECRETS" | jq -r 'to_entries | .[] | "export \(.key)=\(.value | @sh)"')
fi

# Export LLM_SECRETS (JSON) as flat env vars
if [ -n "$LLM_SECRETS" ]; then
    eval $(echo "$LLM_SECRETS" | jq -r 'to_entries | .[] | "export \(.key)=\(.value | @sh)"')
fi

# Unset ANTHROPIC_API_KEY so Claude Code uses the OAuth token.
# If both are set, Claude Code prioritizes API key (billing to API credits)
# which defeats the purpose. The API key is for the event handler, not here.
unset ANTHROPIC_API_KEY

# Git setup - derive identity from GitHub token
gh auth setup-git
GH_USER_JSON=$(gh api user -q '{name: .name, login: .login, email: .email, id: .id}')
GH_USER_NAME=$(echo "$GH_USER_JSON" | jq -r '.name // .login')
GH_USER_EMAIL=$(echo "$GH_USER_JSON" | jq -r '.email // "\(.id)+\(.login)@users.noreply.github.com"')
git config --global user.name "$GH_USER_NAME"
git config --global user.email "$GH_USER_EMAIL"

# Clone branch
if [ -n "$REPO_URL" ]; then
    git clone --single-branch --branch "$BRANCH" --depth 1 "$REPO_URL" /job
else
    echo "No REPO_URL provided"
fi

cd /job

# ── Repair skills directory structure ────────────────────────────────────────
# On Windows hosts, git stores symlinks as plain text files containing the
# target path (e.g. ".pi/skills" contains "../skills/active" as text).
# This causes the agent to crash when it tries to use skills discovered via
# .claude/skills. Detect and repair these artifacts so skills are always
# discoverable regardless of the host OS that committed them.
repair_dir_symlink() {
    local link_path="$1"
    local expected_target="$2"
    if [ -f "$link_path" ] && [ ! -L "$link_path" ]; then
        # Text file containing the symlink target — Windows git artifact
        local stored
        stored=$(cat "$link_path")
        if [ "$stored" = "$expected_target" ]; then
            rm "$link_path"
            ln -sf "$expected_target" "$link_path"
            echo "  Repaired symlink (was text file): $link_path → $expected_target"
        fi
    elif [ ! -e "$link_path" ] && [ ! -L "$link_path" ]; then
        # Symlink is missing entirely — create it
        mkdir -p "$(dirname "$link_path")"
        ln -sf "$expected_target" "$link_path"
        echo "  Created missing symlink: $link_path → $expected_target"
    fi
    # If it's already a valid symlink, leave it untouched
}

mkdir -p /job/skills/active
repair_dir_symlink /job/.pi/skills     ../skills/active
repair_dir_symlink /job/.claude/skills ../skills/active
for skill in browser-tools llm-secrets modify-self; do
    [ -d "/job/skills/$skill" ] && repair_dir_symlink "/job/skills/active/$skill" "../$skill"
done

# Auto-activate brave-search when BRAVE_API_KEY is present but the skill symlink
# is missing. BRAVE_API_KEY reaches the container via the AGENT_BRAVE_API_KEY
# GitHub secret (stripped to BRAVE_API_KEY by the SECRETS eval loop above).
if [ -n "$BRAVE_API_KEY" ] && [ -d "/job/skills/brave-search" ] && [ ! -e "/job/skills/active/brave-search" ]; then
    ln -sf ../brave-search /job/skills/active/brave-search
    echo "  Auto-activated brave-search skill (BRAVE_API_KEY is set)"
fi
# ─────────────────────────────────────────────────────────────────────────────

# Install npm deps for active skills (native deps need correct Linux arch)
for skill_dir in /job/skills/active/*/; do
    if [ -f "${skill_dir}package.json" ]; then
        echo "Installing skill deps: $(basename "$skill_dir")"
        (cd "$skill_dir" && npm install --omit=dev --no-package-lock)
    fi
done

# Start Chrome if puppeteer installed it (needed by browser-tools skill)
CHROME_PID=""
CHROME_BIN=$(find /home/agent/.cache/puppeteer -name "chrome" -type f 2>/dev/null | head -1)
if [ -n "$CHROME_BIN" ]; then
    $CHROME_BIN --headless --no-sandbox --disable-gpu --remote-debugging-port=9222 2>/dev/null &
    CHROME_PID=$!
    sleep 2
fi

# Setup logs
LOG_DIR="/job/logs/${JOB_ID}"
mkdir -p "${LOG_DIR}"

# Build system prompt from config MD files
SYSTEM_PROMPT_FILE="${LOG_DIR}/system-prompt.md"
SYSTEM_FILES=("SOUL.md" "JOB_AGENT.md")
> "$SYSTEM_PROMPT_FILE"
for i in "${!SYSTEM_FILES[@]}"; do
    cat "/job/config/${SYSTEM_FILES[$i]}" >> "$SYSTEM_PROMPT_FILE"
    if [ "$i" -lt $((${#SYSTEM_FILES[@]} - 1)) ]; then
        echo -e "\n\n" >> "$SYSTEM_PROMPT_FILE"
    fi
done

# Resolve {{datetime}} variable in system prompt
sed -i "s/{{datetime}}/$(date -u +"%Y-%m-%dT%H:%M:%SZ")/g" "$SYSTEM_PROMPT_FILE"

# Read job metadata from job.config.json
JOB_CONFIG="/job/logs/${JOB_ID}/job.config.json"
TITLE=$(jq -r '.title // empty' "$JOB_CONFIG")
JOB_DESCRIPTION=$(jq -r '.job // empty' "$JOB_CONFIG")

PROMPT="

# Your Job

${JOB_DESCRIPTION}"

# Build --model flag if LLM_MODEL is set
MODEL_FLAG=""
if [ -n "$LLM_MODEL" ]; then
    MODEL_FLAG="--model $LLM_MODEL"
fi

# Run Claude Code — capture exit code instead of letting set -e kill the script
# stream-json gives the full conversation trace (thinking, tool calls, results)
# similar to Pi's .jsonl session logs
set +e
claude -p "$PROMPT" \
    $MODEL_FLAG \
    --append-system-prompt-file "$SYSTEM_PROMPT_FILE" \
    --dangerously-skip-permissions \
    --verbose \
    --output-format stream-json \
    > "${LOG_DIR}/claude-session.jsonl" 2>"${LOG_DIR}/claude-stderr.log"
AGENT_EXIT=$?

# Commit based on outcome
if [ $AGENT_EXIT -ne 0 ]; then
    # Claude Code failed — only commit session logs, not partial code changes
    git reset || true
    git add -f "${LOG_DIR}"
    git commit -m "🤖 Agent Job: ${TITLE} (failed)" || true
else
    # Claude Code succeeded — commit everything
    git add -A
    git add -f "${LOG_DIR}"
    git commit -m "🤖 Agent Job: ${TITLE}" || true
fi

git push origin

# Capture log commit SHA, then remove logs so they don't merge into main
LOG_SHA=$(git rev-parse HEAD)
git rm -rf "${LOG_DIR}"
git commit -m "done." || true
git push origin
set -e

# Cleanup Chrome
if [ -n "$CHROME_PID" ]; then
    kill $CHROME_PID 2>/dev/null || true
fi

# Create PR with log permalink (auto-merge handled by GitHub Actions workflow)
REPO_SLUG=$(gh repo view --json nameWithOwner -q .nameWithOwner)
LOG_URL="https://github.com/${REPO_SLUG}/tree/${LOG_SHA}/logs/${JOB_ID}"
gh pr create --title "🤖 Agent Job: ${TITLE}" \
  --body "📋 [View Job Logs](${LOG_URL})"$'\n\n---\n\n'"${JOB_DESCRIPTION}" \
  --base main || true

# Re-raise failure so the workflow reports it
if [ $AGENT_EXIT -ne 0 ]; then
    echo "Claude Code exited with code ${AGENT_EXIT}"
    exit $AGENT_EXIT
fi

echo "Done. Job ID: ${JOB_ID}"

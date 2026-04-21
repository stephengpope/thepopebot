#!/bin/bash
# Run Pi headlessly with the given PROMPT
# Sets AGENT_EXIT for downstream scripts (commit, push, etc.)
# CONTINUE_SESSION: 1 = continue most recent session (-c)

PI_ARGS=(-p "$PROMPT" --mode json)

if [ -n "$LLM_MODEL" ]; then
    PI_ARGS+=(--model "$LLM_MODEL")
fi

if [ -n "$CUSTOM_OPENAI_BASE_URL" ]; then
    PI_ARGS+=(--provider custom)
fi

if [ "$CONTINUE_SESSION" = "1" ]; then
    PI_ARGS+=(--session-dir /home/coding-agent/.pi-ttyd-sessions/7681 -c)
fi

set +e
pi "${PI_ARGS[@]}"
AGENT_EXIT=$?
set -e

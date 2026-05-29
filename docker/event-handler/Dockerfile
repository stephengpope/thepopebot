# Global ARG — must be declared before the first FROM to be usable in
# Stage 3's FROM ${BASE_IMAGE}. ARGs declared between stages don't apply.
ARG BASE_IMAGE=thepopebot-base

# ── Stage 1: builder ──────────────────────────────────────────────
# node:22-bookworm-slim is fine here — this stage is throwaway, just compiles
# native modules. Stage 3 (runtime) extends thepopebot-base for cross-distro
# parity with coding-agent containers.
FROM node:22-bookworm-slim AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
# Rename package to avoid npm treating "thepopebot" as a self-install
RUN TPB_VERSION=$(node -p "require('./package.json').version") && \
    echo "{\"private\":true}" > package.json && \
    npm install --no-save "thepopebot@${TPB_VERSION}" tailwindcss @tailwindcss/postcss

# ── Stage 2: Next.js build ───────────────────────────────────────
FROM node:22-bookworm-slim AS nextjs
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
# Use a minimal package.json to avoid self-referencing exports
# (the repo package.json has name "thepopebot", which makes Node resolve
# imports like 'thepopebot/config' to ./config/ instead of node_modules)
RUN echo '{"private":true}' > package.json
COPY web/ ./
RUN ./node_modules/.bin/next build

# ── Stage 3: runtime ─────────────────────────────────────────────
# Extends thepopebot-base — Ubuntu 24.04 + Node 22 + locale + jq + Chromium
# stack + playwright-cli + coding-agent user, all shared with coding-agent
# containers so the in-process SDK has the same toolchain.
FROM ${BASE_IMAGE}

# Event-handler-specific: process manager and privilege-drop helper.
RUN apt-get update && \
    apt-get install -y --no-install-recommends gosu && \
    rm -rf /var/lib/apt/lists/*
RUN npm install -g pm2

WORKDIR /app
# Chown the /app dir itself so coding-agent can create files inside it (e.g.,
# data/db on first boot). This is just the directory's metadata, not its
# contents — no layer duplication.
RUN chown coding-agent:coding-agent /app

# Set ownership at copy time. Docker layers are immutable, so a post-copy
# `chown -R /app` would rewrite every file into a new layer (~1.7GB duplicate).
# `--chown=` avoids the duplicate by setting ownership during the COPY itself.
COPY --chown=coding-agent:coding-agent --from=builder /app/node_modules ./node_modules
RUN echo '{"private":true}' > package.json && chown coding-agent:coding-agent package.json
COPY --chown=coding-agent:coding-agent --from=nextjs /app/.next ./.next
COPY --chown=coding-agent:coding-agent web/server.js web/next.config.mjs web/instrumentation.js web/middleware.js web/postcss.config.mjs ./

COPY docker/event-handler/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
CMD ["pm2-runtime", "--kill-timeout", "120000", "server.js"]

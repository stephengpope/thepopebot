# Skill Creation Guide

## What is a skill?

Skills are lightweight wrappers that extend Pi's abilities. They live in `pi-skills/<skill-name>/` and are activated by symlinking to `.pi/skills/`.

## Skill structure

- **`SKILL.md`** (required) — YAML frontmatter + markdown documentation
- **Scripts** (optional) — prefer bash (.sh). Pi works primarily in bash.
- **`package.json`** (optional) — only if Node.js dependencies are truly needed

## SKILL.md format

The `description` from frontmatter appears in the event handler's system prompt under "Active skills."
The `{baseDir}` placeholder is replaced at runtime with the skill's actual directory path.

```
---
name: skill-name-in-kebab-case
description: One sentence describing what the skill does and when to use it.
---

# Skill Name

## Usage

```bash
{baseDir}/script.sh <args>
```
```

## Example: Simple bash skill (most common pattern)

The built-in `transcribe` skill — a SKILL.md and a single bash script:

**pi-skills/transcribe/SKILL.md:**
```
---
name: transcribe
description: Speech-to-text transcription using Groq Whisper API. Supports m4a, mp3, wav, ogg, flac, webm.
---

# Transcribe

Speech-to-text using Groq Whisper API.

## Setup
Requires GROQ_API_KEY environment variable.

## Usage
```bash
{baseDir}/transcribe.sh <audio-file>
```
```

**pi-skills/transcribe/transcribe.sh:**
```bash
#!/bin/bash
if [ -z "$1" ]; then echo "Usage: transcribe.sh <audio-file>"; exit 1; fi
if [ -z "$GROQ_API_KEY" ]; then echo "Error: GROQ_API_KEY not set"; exit 1; fi
curl -s -X POST "https://api.groq.com/openai/v1/audio/transcriptions" \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -F "file=@${1}" \
  -F "model=whisper-large-v3-turbo" \
  -F "response_format=text"
```

## Example: Skill with Node.js dependencies

The built-in `brave-search` skill uses Node.js for HTML parsing (jsdom, readability, turndown). It has a `package.json` and `.js` scripts. Pi runs `npm install` in the skill directory automatically. Use this pattern only when bash + curl isn't sufficient.

## Activation

After creating skill files, symlink to activate:
```bash
ln -s ../../pi-skills/skill-name .pi/skills/skill-name
```

## Always build AND test in the same job

Tell Pi to test the skill with real input after creating it and fix any issues before committing. Don't create untested skills.

## Credential setup

If a skill needs an API key, the user should set it up BEFORE the job runs:
- `npx thepopebot set-agent-llm-secret <KEY_NAME> <value>` — creates a GitHub secret with `AGENT_LLM_` prefix, exposed as an env var in the Docker container
- The value is stored exactly as provided, no transformation needed
- Also add to `.env` for local development
- Keys can be rotated later with the same command

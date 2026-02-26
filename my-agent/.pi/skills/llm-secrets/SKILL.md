---
name: llm-secrets
description: List available LLM-accessible credentials. Use when you need API keys, passwords, or other secrets that have been made available to you.
---

# List Available Secrets

```bash
/job/.pi/skills/llm-secrets/llm-secrets.js
```

Shows the names of available secret keys (not values). Output example:

```
Available secrets:
  - BROWSER_PASSWORD
  - SOME_API_KEY

To get a value: echo $KEY_NAME
```

## Get a Secret Value

```bash
echo $KEY_NAME
```

Replace `KEY_NAME` with one of the available secret names.

## When to Use

- When a skill or tool needs authentication credentials
- When logging into a website via browser tools
- When calling an external API that requires a key

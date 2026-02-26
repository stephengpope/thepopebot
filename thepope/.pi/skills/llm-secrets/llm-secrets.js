#!/usr/bin/env node

/**
 * llm-secrets.js - List available LLM-accessible secret keys
 *
 * Usage: llm-secrets.js
 *
 * Lists the key names from LLM_SECRETS (not the values).
 * To get a value, use: echo $KEY_NAME
 */

const secretsJson = process.env.LLM_SECRETS;

if (!secretsJson) {
  console.log('No LLM_SECRETS configured.');
  process.exit(0);
}

try {
  const parsed = JSON.parse(secretsJson);
  const keys = Object.keys(parsed);

  if (keys.length === 0) {
    console.log('LLM_SECRETS is empty.');
  } else {
    console.log('Available secrets:');
    keys.forEach(key => console.log(`  - ${key}`));
    console.log('\nTo get a value: echo $KEY_NAME');
  }
} catch (e) {
  console.error('Error parsing LLM_SECRETS:', e.message);
  process.exit(1);
}

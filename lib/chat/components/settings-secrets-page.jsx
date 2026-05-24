'use client';

import { useState, useEffect } from 'react';
import { KeyIcon, CopyIcon, CheckIcon, TrashIcon, PlusIcon } from './icons.js';
import { SecretRow, EmptyState, formatDate, timeAgo } from './settings-shared.js';
import {
  createNewApiKey,
  getApiKeys,
  deleteApiKey,
  getApiKeySettings,
  updateApiKeySetting,
  regenerateWebhookSecret,
  getTelegramStatus,
  validateTelegramToken,
  registerTelegramWebhook,
  getSlackStatus,
  validateSlackToken,
  getTeamsStatus,
  validateTeamsCredentials,
} from '../actions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Keys sub-tab — Multiple named API keys
// ─────────────────────────────────────────────────────────────────────────────

export function ApiKeysListPage() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKey, setNewKey] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState(null);

  const loadKeys = async () => {
    try {
      const result = await getApiKeys();
      setKeys(Array.isArray(result) ? result : result ? [result] : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const handleCreate = async () => {
    if (creating || !newKeyName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createNewApiKey(newKeyName.trim());
      if (result.error) {
        setError(result.error);
      } else {
        setNewKey(result.key);
        setNewKeyName('');
        setShowCreateForm(false);
        await loadKeys();
      }
    } catch {
      setError('Failed to create API key');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      setTimeout(() => setConfirmDelete(null), 3000);
      return;
    }
    try {
      await deleteApiKey(id);
      setKeys((prev) => prev.filter((k) => k.id !== id));
      setConfirmDelete(null);
      if (newKey) setNewKey(null);
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-16 animate-pulse rounded-md bg-border/50" />
        <div className="h-16 animate-pulse rounded-md bg-border/50" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-base font-medium">API Keys</h2>
          <p className="text-sm text-muted-foreground">Authenticate external requests to /api endpoints via the x-api-key header.</p>
        </div>
        {!showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-foreground text-background hover:bg-foreground/90 shrink-0 transition-colors"
          >
            <PlusIcon size={14} />
            Create key
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive mb-4">{error}</p>
      )}

      {/* Create form */}
      {showCreateForm && (
        <div className="rounded-lg border border-dashed bg-card p-4 mb-4">
          <label className="text-xs font-medium mb-1.5 block">Key name</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. n8n, production, staging..."
              autoFocus
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <button
              onClick={handleCreate}
              disabled={!newKeyName.trim() || creating}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => { setShowCreateForm(false); setNewKeyName(''); }}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* New key banner */}
      {newKey && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 mb-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <p className="text-sm font-medium text-green-500">
              API key created — copy it now. You won't be able to see it again.
            </p>
            <button
              onClick={() => setNewKey(null)}
              className="text-xs text-muted-foreground hover:text-foreground shrink-0 transition-colors"
            >
              Dismiss
            </button>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all select-all">
              {newKey}
            </code>
            <CopyButton text={newKey} />
          </div>
        </div>
      )}

      {/* Key list */}
      {keys.length > 0 ? (
        <div className="rounded-lg border bg-card">
          <div className="divide-y divide-border">
            {keys.map((k) => (
              <div key={k.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-4">
                <div className="flex items-center gap-2">
                  <KeyIcon size={14} className="text-muted-foreground shrink-0" />
                  <div>
                  <div className="text-sm font-medium">{k.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {k.keyPrefix}...
                    <span className="font-sans ml-2">
                      Created {formatDate(k.createdAt)}
                      <span> · {k.lastUsedAt ? `Last used ${timeAgo(k.lastUsedAt)}` : 'Never used'}</span>
                    </span>
                  </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(k.id)}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium border shrink-0 self-start sm:self-auto transition-colors ${
                    confirmDelete === k.id
                      ? 'border-destructive text-destructive hover:bg-destructive/10'
                      : 'border-border text-muted-foreground hover:text-destructive hover:border-destructive/50'
                  }`}
                >
                  <TrashIcon size={12} />
                  {confirmDelete === k.id ? 'Confirm' : 'Delete'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : !showCreateForm && (
        <EmptyState
          message="No API keys configured"
          actionLabel="Create API key"
          onAction={() => setShowCreateForm(true)}
        />
      )}
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice sub-tab — AssemblyAI API Key
// ─────────────────────────────────────────────────────────────────────────────

export function ApiKeysVoicePage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = async () => {
    try {
      const result = await getApiKeySettings();
      setSettings(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const getStatus = (key) => settings?.secrets?.find((s) => s.key === key)?.isSet || false;

  const handleSave = async (key, value) => {
    setSaving(true);
    await updateApiKeySetting(key, value);
    await loadSettings();
    setSaving(false);
  };

  if (loading) {
    return <div className="h-24 animate-pulse rounded-md bg-border/50" />;
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-medium">Voice</h2>
        <p className="text-sm text-muted-foreground">Required for voice input in chat.</p>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <SecretRow
          label="AssemblyAI API Key"
          isSet={getStatus('ASSEMBLYAI_API_KEY')}
          saving={saving}
          onSave={(val) => handleSave('ASSEMBLYAI_API_KEY', val)}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Telegram sub-tab — Guided setup (bot token → webhook → chat verification)
// ─────────────────────────────────────────────────────────────────────────────

function StepIndicator({ n, state }) {
  // state: 'done' | 'active' | 'pending'
  const cls =
    state === 'done'
      ? 'bg-green-500 text-white border-green-500'
      : state === 'active'
        ? 'border-foreground text-foreground'
        : 'border-border text-muted-foreground';
  return (
    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${cls}`}>
      {state === 'done' ? <CheckIcon className="h-3 w-3" /> : n}
    </div>
  );
}

export function ApiKeysTelegramPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  // Step 1 — bot token
  const [tokenInput, setTokenInput] = useState('');
  const [tokenEditing, setTokenEditing] = useState(false);
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenError, setTokenError] = useState(null);

  // Step 2 — webhook
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookError, setWebhookError] = useState(null);
  const [webhookEditing, setWebhookEditing] = useState(false);
  const [webhookUrlInput, setWebhookUrlInput] = useState('');

  const loadStatus = async () => {
    try {
      const result = await getTelegramStatus();
      setStatus(result);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  // Keep the webhook URL input in sync with the saved/effective URL when not
  // actively editing — covers the "unregistered" case where the field needs
  // to be prefilled with the default so the user can just hit Register.
  useEffect(() => {
    if (!status || webhookEditing) return;
    setWebhookUrlInput(
      status.webhookUrlOverride || status.webhookInfo?.url || status.defaultWebhookUrl || ''
    );
  }, [status, webhookEditing]);

  if (loading) {
    return <div className="h-48 animate-pulse rounded-md bg-border/50" />;
  }

  const step1Done = !!status.botInfo;
  const step2Done = step1Done && status.webhookInfo?.url;

  // Step 1 handlers
  const handleSaveToken = async () => {
    setTokenSaving(true);
    setTokenError(null);
    const validation = await validateTelegramToken(tokenInput.trim());
    if (!validation.valid) {
      setTokenError(validation.error || 'Invalid token');
      setTokenSaving(false);
      return;
    }
    const saveResult = await updateApiKeySetting('TELEGRAM_BOT_TOKEN', tokenInput.trim());
    if (saveResult?.error) {
      setTokenError(saveResult.error);
      setTokenSaving(false);
      return;
    }
    setTokenInput('');
    setTokenEditing(false);
    await loadStatus();
    setTokenSaving(false);
  };

  const handleClearToken = async () => {
    setTokenSaving(true);
    await updateApiKeySetting('TELEGRAM_BOT_TOKEN', '');
    await loadStatus();
    setTokenSaving(false);
  };

  // Step 2 handlers
  const handleRegisterWebhook = async () => {
    setWebhookSaving(true);
    setWebhookError(null);
    const url = webhookEditing ? webhookUrlInput.trim() : undefined;
    const result = await registerTelegramWebhook(url);
    if (result?.error) {
      setWebhookError(result.error);
      setWebhookSaving(false);
      return;
    }
    setWebhookEditing(false);
    setWebhookUrlInput('');
    await loadStatus();
    setWebhookSaving(false);
  };

  const startWebhookEdit = () => {
    setWebhookError(null);
    setWebhookUrlInput(
      status.webhookUrlOverride || status.webhookInfo?.url || status.defaultWebhookUrl || ''
    );
    setWebhookEditing(true);
  };

  const cancelWebhookEdit = () => {
    setWebhookEditing(false);
    setWebhookUrlInput('');
    setWebhookError(null);
  };

  const resetWebhookToDefault = () => {
    setWebhookUrlInput(status.defaultWebhookUrl || '');
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-medium">Telegram</h2>
        <p className="text-sm text-muted-foreground">
          Connect a Telegram bot to receive and send messages through your agent.
        </p>
      </div>

      <div className="space-y-3">
        {/* ─── Step 1: Bot Token ─── */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start gap-3">
            <StepIndicator n={1} state={step1Done ? 'done' : 'active'} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">Bot Token</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Create a bot with{' '}
                    <a
                      href="https://t.me/BotFather"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      @BotFather
                    </a>{' '}
                    and paste the token below.
                  </p>
                </div>
                {step1Done && !tokenEditing && (
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium">@{status.botInfo.username}</div>
                    <button
                      onClick={() => setTokenEditing(true)}
                      className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>

              {(!step1Done || tokenEditing) && (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    type="password"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                    onKeyDown={(e) => e.key === 'Enter' && tokenInput.trim() && handleSaveToken()}
                  />
                  {tokenError && <div className="text-xs text-destructive">{tokenError}</div>}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveToken}
                      disabled={tokenSaving || !tokenInput.trim()}
                      className="rounded-md bg-foreground text-background px-2.5 py-1.5 text-xs font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
                    >
                      {tokenSaving ? 'Validating...' : 'Validate & Save'}
                    </button>
                    {tokenEditing && (
                      <button
                        onClick={() => {
                          setTokenEditing(false);
                          setTokenInput('');
                          setTokenError(null);
                        }}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                    {step1Done && tokenEditing && (
                      <button
                        onClick={handleClearToken}
                        className="ml-auto rounded-md border border-destructive text-destructive px-2.5 py-1.5 text-xs font-medium hover:bg-destructive/10 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─── Step 2: Webhook ─── */}
        <div className={`rounded-lg border bg-card p-4 ${!step1Done ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-start gap-3">
            <StepIndicator n={2} state={step2Done ? 'done' : step1Done ? 'active' : 'pending'} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">Webhook</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Register a public URL with Telegram so it can deliver messages to your bot.
                  </p>
                  {step2Done && !webhookEditing && (
                    <div className="mt-2 text-xs text-muted-foreground truncate">
                      <span className="font-mono">{status.webhookInfo.url}</span>
                      {status.webhookInfo.pendingUpdates > 0 && (
                        <span className="ml-2 text-yellow-500">
                          ({status.webhookInfo.pendingUpdates} pending)
                        </span>
                      )}
                      {status.webhookInfo.lastErrorMessage && (
                        <div className="mt-1 text-destructive">
                          Last error: {status.webhookInfo.lastErrorMessage}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {step2Done && !webhookEditing && (
                  <button
                    onClick={startWebhookEdit}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                  >
                    Change
                  </button>
                )}
              </div>

              {(!step2Done || webhookEditing) && (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    type="text"
                    value={webhookUrlInput}
                    onChange={(e) => {
                      if (!webhookEditing) setWebhookEditing(true);
                      setWebhookUrlInput(e.target.value);
                    }}
                    placeholder="https://example.com/api/telegram/webhook"
                    spellCheck={false}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground"
                  />
                  {webhookError && <div className="text-xs text-destructive">{webhookError}</div>}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRegisterWebhook}
                      disabled={!step1Done || webhookSaving || !webhookUrlInput.trim()}
                      className="rounded-md bg-foreground text-background px-2.5 py-1.5 text-xs font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
                    >
                      {webhookSaving
                        ? 'Registering...'
                        : step2Done
                          ? 'Re-register Webhook'
                          : 'Register Webhook'}
                    </button>
                    {webhookEditing && step2Done && (
                      <button
                        onClick={cancelWebhookEdit}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                    {status.defaultWebhookUrl &&
                      webhookUrlInput.trim() !== status.defaultWebhookUrl && (
                        <button
                          onClick={resetWebhookToDefault}
                          className="ml-auto text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                        >
                          Reset to default
                        </button>
                      )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Slack sub-tab — Bot token + signing secret (webhook URL registered externally)
// ─────────────────────────────────────────────────────────────────────────────

export function ApiKeysSlackPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  // Step 1 — bot token
  const [tokenInput, setTokenInput] = useState('');
  const [tokenEditing, setTokenEditing] = useState(false);
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenError, setTokenError] = useState(null);

  // Step 2 — signing secret
  const [secretInput, setSecretInput] = useState('');
  const [secretEditing, setSecretEditing] = useState(false);
  const [secretSaving, setSecretSaving] = useState(false);
  const [secretError, setSecretError] = useState(null);

  const [copied, setCopied] = useState(false);

  const loadStatus = async () => {
    try {
      const result = await getSlackStatus();
      setStatus(result);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  if (loading) {
    return <div className="h-48 animate-pulse rounded-md bg-border/50" />;
  }

  const step1Done = !!status.botInfo;
  const step2Done = step1Done && status.signingSecretSet;

  const handleSaveToken = async () => {
    setTokenSaving(true);
    setTokenError(null);
    const validation = await validateSlackToken(tokenInput.trim());
    if (!validation.valid) {
      setTokenError(validation.error || 'Invalid token');
      setTokenSaving(false);
      return;
    }
    const result = await updateApiKeySetting('SLACK_BOT_TOKEN', tokenInput.trim());
    if (result?.error) {
      setTokenError(result.error);
      setTokenSaving(false);
      return;
    }
    setTokenInput('');
    setTokenEditing(false);
    await loadStatus();
    setTokenSaving(false);
  };

  const handleSaveSecret = async () => {
    setSecretSaving(true);
    setSecretError(null);
    const result = await updateApiKeySetting('SLACK_SIGNING_SECRET', secretInput.trim());
    if (result?.error) {
      setSecretError(result.error);
      setSecretSaving(false);
      return;
    }
    setSecretInput('');
    setSecretEditing(false);
    await loadStatus();
    setSecretSaving(false);
  };

  const handleCopyEventsUrl = async () => {
    if (!status.eventsUrl) return;
    try {
      await navigator.clipboard.writeText(status.eventsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-medium">Slack</h2>
        <p className="text-sm text-muted-foreground">
          Connect a Slack bot to receive and send messages through your agent.
          See <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">api.slack.com/apps</a> to create the app.
        </p>
      </div>

      <div className="space-y-3">
        {/* Step 1: Bot Token */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start gap-3">
            <StepIndicator n={1} state={step1Done ? 'done' : 'active'} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">Bot User OAuth Token</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    From <strong>OAuth &amp; Permissions</strong> in your Slack app. Starts with <code className="text-foreground">xoxb-</code>.
                  </p>
                </div>
                {step1Done && !tokenEditing && (
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium">@{status.botInfo.username}</div>
                    <div className="text-xs text-muted-foreground">{status.botInfo.team}</div>
                    <button
                      onClick={() => setTokenEditing(true)}
                      className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>

              {(!step1Done || tokenEditing) && (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    type="password"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="xoxb-..."
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                    onKeyDown={(e) => e.key === 'Enter' && tokenInput.trim() && handleSaveToken()}
                  />
                  {tokenError && <div className="text-xs text-destructive">{tokenError}</div>}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveToken}
                      disabled={tokenSaving || !tokenInput.trim()}
                      className="rounded-md bg-foreground text-background px-2.5 py-1.5 text-xs font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
                    >
                      {tokenSaving ? 'Validating...' : 'Validate & Save'}
                    </button>
                    {tokenEditing && (
                      <button
                        onClick={() => { setTokenEditing(false); setTokenInput(''); setTokenError(null); }}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Step 2: Signing Secret */}
        <div className={`rounded-lg border bg-card p-4 ${!step1Done ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-start gap-3">
            <StepIndicator n={2} state={step2Done ? 'done' : step1Done ? 'active' : 'pending'} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">Signing Secret</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    From <strong>Basic Information</strong> in your Slack app. Used to verify webhook signatures.
                  </p>
                </div>
                {step2Done && !secretEditing && (
                  <button
                    onClick={() => setSecretEditing(true)}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                  >
                    Change
                  </button>
                )}
              </div>

              {(!step2Done || secretEditing) && (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    type="password"
                    value={secretInput}
                    onChange={(e) => setSecretInput(e.target.value)}
                    placeholder="32-character hex string"
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                    onKeyDown={(e) => e.key === 'Enter' && secretInput.trim() && handleSaveSecret()}
                  />
                  {secretError && <div className="text-xs text-destructive">{secretError}</div>}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveSecret}
                      disabled={!step1Done || secretSaving || !secretInput.trim()}
                      className="rounded-md bg-foreground text-background px-2.5 py-1.5 text-xs font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
                    >
                      {secretSaving ? 'Saving...' : 'Save'}
                    </button>
                    {secretEditing && (
                      <button
                        onClick={() => { setSecretEditing(false); setSecretInput(''); setSecretError(null); }}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Step 3: Events URL (display + copy) */}
        <div className={`rounded-lg border bg-card p-4 ${!step2Done ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-start gap-3">
            <StepIndicator n={3} state={step2Done ? 'active' : 'pending'} />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium">Events Request URL</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                In Slack: <strong>Event Subscriptions</strong> → enable events → paste this URL → subscribe to bot events
                {' '}<code className="text-foreground">app_mention</code>,{' '}<code className="text-foreground">message.im</code>.
                Slack will hit it once with a verification challenge.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs text-foreground font-mono truncate">
                  {status.eventsUrl || '(set APP_URL to generate)'}
                </code>
                <button
                  onClick={handleCopyEventsUrl}
                  disabled={!status.eventsUrl}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors"
                >
                  {copied ? <><CheckIcon size={12} /> Copied</> : <><CopyIcon size={12} /> Copy</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Microsoft Teams sub-tab — App ID + Password (messaging endpoint registered externally)
// ─────────────────────────────────────────────────────────────────────────────

export function ApiKeysTeamsPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const [appIdInput, setAppIdInput] = useState('');
  const [appIdEditing, setAppIdEditing] = useState(false);
  const [appIdSaving, setAppIdSaving] = useState(false);

  const [passwordInput, setPasswordInput] = useState('');
  const [passwordEditing, setPasswordEditing] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);

  const [validating, setValidating] = useState(false);
  const [validationMessage, setValidationMessage] = useState(null);

  const [copied, setCopied] = useState(false);

  const loadStatus = async () => {
    try {
      const result = await getTeamsStatus();
      setStatus(result);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  if (loading) {
    return <div className="h-48 animate-pulse rounded-md bg-border/50" />;
  }

  const step1Done = status.appIdSet;
  const step2Done = step1Done && status.appPasswordSet;
  const credentialsValid = status.credentialsValid;

  const handleSaveAppId = async () => {
    setAppIdSaving(true);
    const result = await updateApiKeySetting('TEAMS_APP_ID', appIdInput.trim());
    setAppIdSaving(false);
    if (result?.error) return;
    setAppIdInput('');
    setAppIdEditing(false);
    await loadStatus();
  };

  const handleSavePassword = async () => {
    setPasswordSaving(true);
    const result = await updateApiKeySetting('TEAMS_APP_PASSWORD', passwordInput.trim());
    setPasswordSaving(false);
    if (result?.error) return;
    setPasswordInput('');
    setPasswordEditing(false);
    await loadStatus();
  };

  const handleValidate = async () => {
    setValidating(true);
    setValidationMessage(null);
    const id = appIdEditing ? appIdInput.trim() : status.appId;
    const pw = passwordEditing ? passwordInput.trim() : null;
    if (!id || !pw) {
      setValidationMessage({ type: 'error', text: 'Both App ID and a freshly-entered Password are required to validate.' });
      setValidating(false);
      return;
    }
    const result = await validateTeamsCredentials(id, pw);
    setValidationMessage(
      result.valid
        ? { type: 'success', text: 'Credentials are valid — Microsoft accepted the token request.' }
        : { type: 'error', text: result.error || 'Validation failed' }
    );
    setValidating(false);
  };

  const handleCopyEndpoint = async () => {
    if (!status.messagingEndpoint) return;
    try {
      await navigator.clipboard.writeText(status.messagingEndpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-medium">Microsoft Teams</h2>
        <p className="text-sm text-muted-foreground">
          Connect a Teams bot via Azure Bot registration.
          See <a href="https://portal.azure.com/" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">portal.azure.com</a> → create an Azure Bot resource.
        </p>
      </div>

      <div className="space-y-3">
        {/* Step 1: App ID */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start gap-3">
            <StepIndicator n={1} state={step1Done ? 'done' : 'active'} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">Microsoft App ID</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Found in the Azure Bot resource → <strong>Configuration</strong>.
                  </p>
                </div>
                {step1Done && !appIdEditing && (
                  <button
                    onClick={() => setAppIdEditing(true)}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                  >
                    Change
                  </button>
                )}
              </div>
              {(!step1Done || appIdEditing) && (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    type="text"
                    value={appIdInput}
                    onChange={(e) => setAppIdInput(e.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveAppId}
                      disabled={appIdSaving || !appIdInput.trim()}
                      className="rounded-md bg-foreground text-background px-2.5 py-1.5 text-xs font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
                    >
                      {appIdSaving ? 'Saving...' : 'Save'}
                    </button>
                    {appIdEditing && (
                      <button
                        onClick={() => { setAppIdEditing(false); setAppIdInput(''); }}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
              {step1Done && !appIdEditing && status.appId && (
                <div className="mt-2 text-xs font-mono text-muted-foreground truncate">
                  {status.appId}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Step 2: App Password */}
        <div className={`rounded-lg border bg-card p-4 ${!step1Done ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-start gap-3">
            <StepIndicator n={2} state={step2Done ? 'done' : step1Done ? 'active' : 'pending'} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">App Password (client secret)</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Generated from the Azure Bot → <strong>Manage</strong> → <strong>Certificates &amp; secrets</strong>.
                    Microsoft shows it once — paste it before navigating away.
                  </p>
                </div>
                {step2Done && !passwordEditing && (
                  <button
                    onClick={() => setPasswordEditing(true)}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                  >
                    Change
                  </button>
                )}
              </div>
              {(!step2Done || passwordEditing) && (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="client secret value"
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSavePassword}
                      disabled={!step1Done || passwordSaving || !passwordInput.trim()}
                      className="rounded-md bg-foreground text-background px-2.5 py-1.5 text-xs font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
                    >
                      {passwordSaving ? 'Saving...' : 'Save'}
                    </button>
                    {passwordEditing && (
                      <button
                        onClick={() => { setPasswordEditing(false); setPasswordInput(''); }}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Step 3: Messaging endpoint (display + copy) + validate */}
        <div className={`rounded-lg border bg-card p-4 ${!step2Done ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-start gap-3">
            <StepIndicator n={3} state={step2Done && credentialsValid ? 'done' : step2Done ? 'active' : 'pending'} />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium">Messaging Endpoint</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                In the Azure Bot resource → <strong>Configuration</strong>, set the messaging endpoint to this URL.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs text-foreground font-mono truncate">
                  {status.messagingEndpoint || '(set APP_URL to generate)'}
                </code>
                <button
                  onClick={handleCopyEndpoint}
                  disabled={!status.messagingEndpoint}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors"
                >
                  {copied ? <><CheckIcon size={12} /> Copied</> : <><CopyIcon size={12} /> Copy</>}
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={handleValidate}
                  disabled={validating || !passwordEditing}
                  className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors"
                >
                  {validating ? 'Validating...' : 'Test credentials'}
                </button>
                {!passwordEditing && (
                  <span className="text-xs text-muted-foreground">Enter App Password above to test.</span>
                )}
              </div>
              {validationMessage && (
                <div className={`mt-2 text-xs ${validationMessage.type === 'error' ? 'text-destructive' : 'text-green-500'}`}>
                  {validationMessage.text}
                </div>
              )}
              {credentialsValid && (
                <div className="mt-2 text-xs text-green-500">
                  Credentials valid — Microsoft is issuing access tokens.
                </div>
              )}
              {status.validationError && !credentialsValid && (
                <div className="mt-2 text-xs text-destructive">
                  Last validation error: {status.validationError}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Backwards compat export
export function SettingsSecretsPage() {
  return <ApiKeysListPage />;
}

// ApiKeysGitHubPage removed — GitHub credentials now live on the GitHub > Tokens tab

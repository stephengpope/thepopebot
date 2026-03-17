'use client';

import { useState, useEffect, useRef } from 'react';
import { PlusIcon } from './icons.js';
import { SecretRow, VariableRow, StatusBadge, Dialog } from './settings-shared.js';
import {
  getGitHubConfig,
  updateGitHubSecret,
  updateGitHubVariable,
  deleteGitHubSecretAction,
  deleteGitHubVariableAction,
  getApiKeySettings,
  updateApiKeySetting,
  regenerateWebhookSecret,
} from '../actions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Secret grouping & help text
// ─────────────────────────────────────────────────────────────────────────────

const SECRET_HELP = {
  GH_WEBHOOK_SECRET: 'Authenticates webhook callbacks from GitHub Actions workflows back to the event handler.',
  AGENT_GH_TOKEN: 'GitHub token for creating branches and pull requests during agent jobs.',
  AGENT_ANTHROPIC_API_KEY: 'Anthropic API key for running LLM calls during agent jobs.',
  AGENT_OPENAI_API_KEY: 'OpenAI API key for running LLM calls during agent jobs.',
  AGENT_GOOGLE_API_KEY: 'Google AI API key for running LLM calls during agent jobs.',
  AGENT_NOVITA_API_KEY: 'Novita API key for running OpenAI-compatible LLM calls during agent jobs.',
  AGENT_CUSTOM_API_KEY: 'API key for custom/self-hosted LLM providers during agent jobs.',
  AGENT_CLAUDE_CODE_OAUTH_TOKEN: 'OAuth token for the Claude Code agent backend.',
  AGENT_LLM_BRAVE_API_KEY: 'Brave Search API key — enables web search during agent jobs.',
};

function getSecretHelp(name) {
  if (SECRET_HELP[name]) return SECRET_HELP[name];
  if (name.startsWith('AGENT_LLM_')) return 'Made available to the LLM as a tool credential during agent jobs.';
  if (name.startsWith('AGENT_')) return 'Passed to the agent container as an environment variable during jobs.';
  return 'Used by GitHub Actions workflows running on the repository.';
}

function getSecretGroup(name) {
  if (name.startsWith('AGENT_LLM_')) return 'llm';
  if (name.startsWith('AGENT_')) return 'agent';
  return 'non-agent';
}

const GROUP_META = {
  'non-agent': {
    title: 'Non-Agent Secrets',
    description: 'Used by GitHub Actions workflows. Not passed to agent containers.',
  },
  agent: {
    title: 'Agent Secrets',
    description: 'Passed to the agent container as environment variables during jobs.',
  },
  llm: {
    title: 'Agent LLM Secrets',
    description: 'Made available to the LLM as tool credentials during agent jobs.',
  },
};

const GROUP_ORDER = ['non-agent', 'agent', 'llm'];

// ─────────────────────────────────────────────────────────────────────────────
// Add item dialogs
// ─────────────────────────────────────────────────────────────────────────────

const SECRET_TYPES = [
  { value: 'non-agent', label: 'Non-Agent Secret', prefix: '', description: 'Used by GitHub Actions workflows. Not passed to agent containers.' },
  { value: 'agent', label: 'Agent Secret', prefix: 'AGENT_', description: 'Passed to the agent container as an environment variable during jobs.' },
  { value: 'llm', label: 'Agent LLM Secret', prefix: 'AGENT_LLM_', description: 'Made available to the LLM as a tool credential during agent jobs.' },
];

function AddSecretDialog({ open, onAdd, onCancel }) {
  const [secretType, setSecretType] = useState('non-agent');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const nameRef = useRef(null);

  const typeInfo = SECRET_TYPES.find((t) => t.value === secretType);

  useEffect(() => {
    if (open) {
      setSecretType('non-agent');
      setName('');
      setValue('');
      setError(null);
      setSaving(false);
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  const fullName = typeInfo.prefix + name.trim().toUpperCase();

  const handleSave = async () => {
    if (!name.trim() || !value) return;
    setSaving(true);
    setError(null);
    const result = await onAdd(fullName, value);
    setSaving(false);
    if (result?.success) {
      onCancel();
    } else {
      setError(result?.error || 'Failed to add secret');
    }
  };

  return (
    <Dialog open={open} onClose={onCancel} title="Add Secret">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium mb-1 block">Type</label>
          <select
            value={secretType}
            onChange={(e) => setSecretType(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
          >
            {SECRET_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">{typeInfo.description}</p>
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Name</label>
          <div className="flex items-center gap-0">
            {typeInfo.prefix && (
              <span className="rounded-l-md border border-r-0 border-border bg-muted px-2.5 py-1.5 text-sm font-mono text-muted-foreground">
                {typeInfo.prefix}
              </span>
            )}
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
              placeholder="MY_SECRET"
              className={`flex-1 border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground ${
                typeInfo.prefix ? 'rounded-r-md' : 'rounded-md'
              }`}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>
          {name.trim() && (
            <p className="text-xs text-muted-foreground mt-1 font-mono">{fullName}</p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Value</label>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Enter value..."
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
        <button onClick={handleSave} disabled={!name.trim() || !value || saving}
          className="rounded-md px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Dialog>
  );
}

function AddVariableDialog({ open, onAdd, onCancel }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const nameRef = useRef(null);

  useEffect(() => {
    if (open) {
      setName('');
      setValue('');
      setError(null);
      setSaving(false);
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSave = async () => {
    const trimmedName = name.trim().toUpperCase();
    if (!trimmedName) return;
    setSaving(true);
    setError(null);
    const result = await onAdd(trimmedName, value);
    setSaving(false);
    if (result?.success) {
      onCancel();
    } else {
      setError(result?.error || 'Failed to add variable');
    }
  };

  return (
    <Dialog open={open} onClose={onCancel} title="Add Variable">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium mb-1 block">Name</label>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
            placeholder="e.g. MY_VARIABLE"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground"
          />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Value</label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Enter value..."
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
        <button onClick={handleSave} disabled={!name.trim() || saving}
          className="rounded-md px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared hook for loading GitHub config
// ─────────────────────────────────────────────────────────────────────────────

function useGitHubConfig() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const result = await getGitHubConfig();
        setData(result);
      } catch {
        setData({ error: 'Failed to load GitHub configuration' });
      } finally {
        setLoading(false);
      }
    })();
  }, [key]);

  const reload = () => setKey((k) => k + 1);

  return { data, loading, reload };
}

function NotConfigured() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <h3 className="text-sm font-medium mb-2">GitHub not configured</h3>
      <p className="text-xs text-muted-foreground">
        Set a GitHub token on the Tokens tab to enable secret and variable management.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokens sub-tab — GH_TOKEN + GH_WEBHOOK_SECRET
// ─────────────────────────────────────────────────────────────────────────────

export function GitHubTokensPage() {
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

  const handleRegenerate = async (key) => {
    setSaving(true);
    await regenerateWebhookSecret(key);
    await loadSettings();
    setSaving(false);
  };

  if (loading) {
    return <div className="h-24 animate-pulse rounded-md bg-border/50" />;
  }

  return (
    <div className="space-y-6">
      {/* Personal Access Token */}
      <div>
        <div className="mb-4">
          <h2 className="text-base font-medium">Personal Access Token</h2>
          <p className="text-sm text-muted-foreground">GitHub PAT used by the event handler for repository operations (branches, PRs).</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <SecretRow
            label="Personal Access Token"
            isSet={getStatus('GH_TOKEN')}
            saving={saving}
            onSave={(val) => handleSave('GH_TOKEN', val)}
          />
        </div>
      </div>

      {/* Webhook Secret */}
      <div>
        <div className="mb-4">
          <h2 className="text-base font-medium">Webhook Secret</h2>
          <p className="text-sm text-muted-foreground">Used to verify incoming GitHub webhook signatures.</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <SecretRow
            label="Webhook Secret"
            isSet={getStatus('GH_WEBHOOK_SECRET')}
            saving={saving}
            onSave={(val) => handleSave('GH_WEBHOOK_SECRET', val)}
            onRegenerate={() => handleRegenerate('GH_WEBHOOK_SECRET')}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Secrets sub-tab — grouped by type
// ─────────────────────────────────────────────────────────────────────────────

export function GitHubSecretsPage() {
  const { data, loading, reload } = useGitHubConfig();
  const [showAdd, setShowAdd] = useState(false);

  if (loading) {
    return <div className="h-48 animate-pulse rounded-md bg-border/50" />;
  }

  if (data?.error) return <NotConfigured />;

  const handleUpdate = async (name, value) => {
    const result = await updateGitHubSecret(name, value);
    if (result?.success) reload();
    return result;
  };

  const handleDelete = async (name) => {
    const result = await deleteGitHubSecretAction(name);
    if (result?.success) reload();
    return result;
  };

  // Group secrets by type
  const groups = {};
  for (const s of data.secrets) {
    const group = getSecretGroup(s.name);
    if (!groups[group]) groups[group] = [];
    groups[group].push(s);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-medium">Secrets</h2>
          <p className="text-sm text-muted-foreground">Encrypted values stored on GitHub for agent jobs. Values cannot be read back after setting.</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-foreground text-background hover:bg-foreground/90 shrink-0 transition-colors"
        >
          <PlusIcon size={14} />
          Add secret
        </button>
      </div>
      <AddSecretDialog
        open={showAdd}
        onAdd={handleUpdate}
        onCancel={() => setShowAdd(false)}
      />
      <div className="space-y-6">
        {GROUP_ORDER.filter((g) => groups[g]?.length).map((groupKey) => {
          const meta = GROUP_META[groupKey];
          const secrets = groups[groupKey];
          return (
            <div key={groupKey}>
              <div className="mb-2">
                <h3 className="text-sm font-medium">{meta.title}</h3>
                <p className="text-xs text-muted-foreground">{meta.description}</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="divide-y divide-border">
                  {secrets.map((s) => (
                    <SecretRow
                      key={s.name}
                      label={s.name}
                      mono
                      isSet={s.isSet}
                      helpText={getSecretHelp(s.name)}
                      onSave={(val) => handleUpdate(s.name, val)}
                      onDelete={() => handleDelete(s.name)}
                      icon={false}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Variables sub-tab
// ─────────────────────────────────────────────────────────────────────────────

export function GitHubVariablesPage() {
  const { data, loading, reload } = useGitHubConfig();
  const [showAdd, setShowAdd] = useState(false);

  if (loading) {
    return <div className="h-48 animate-pulse rounded-md bg-border/50" />;
  }

  if (data?.error) return <NotConfigured />;

  const handleUpdate = async (name, value) => {
    const result = await updateGitHubVariable(name, value);
    if (result?.success) reload();
    return result;
  };

  const handleDelete = async (name) => {
    const result = await deleteGitHubVariableAction(name);
    if (result?.success) reload();
    return result;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-medium">Variables</h2>
          <p className="text-sm text-muted-foreground">Configuration values for agent jobs.</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-foreground text-background hover:bg-foreground/90 shrink-0 transition-colors"
        >
          <PlusIcon size={14} />
          Add variable
        </button>
      </div>
      <AddVariableDialog
        open={showAdd}
        onAdd={handleUpdate}
        onCancel={() => setShowAdd(false)}
      />
      <div className="rounded-lg border bg-card p-4">
        <div className="divide-y divide-border">
          {data.variables.map((v) => (
            <VariableRow key={v.name} name={v.name} isSet={v.isSet} currentValue={v.value} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Backwards compat
export function SettingsGitHubPage() {
  return <GitHubSecretsPage />;
}

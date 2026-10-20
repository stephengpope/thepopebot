'use client';

import { useState, useEffect } from 'react';
import { CheckIcon } from './icons.js';
import { GIT_COMMANDS, getCommandLabel } from './code-mode-toggle.js';
import {
  getCodingAgentSettings,
  updateCodingAgentConfig,
  setCodingAgentDefault,
  setModeDefault,
} from '../actions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Coding Agents settings page
// ─────────────────────────────────────────────────────────────────────────────

export function CodingAgentsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadSettings = async () => {
    try {
      const result = await getCodingAgentSettings();
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

  if (loading) {
    return <div className="h-48 animate-pulse rounded-md bg-border/50" />;
  }

  if (settings?.error) {
    return <p className="text-sm text-destructive">{settings.error}</p>;
  }

  return (
    <div className="space-y-6">
      <DefaultAgentSection settings={settings} onReload={loadSettings} />
      <AgentCards settings={settings} onReload={loadSettings} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Agent section
// ─────────────────────────────────────────────────────────────────────────────

function DefaultAgentSection({ settings, onReload }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Build list of agents that are enabled AND have valid credentials
  const available = [];
  if (settings.claudeCode?.enabled && isClaudeCodeReady(settings)) {
    available.push({ value: 'claude-code', label: 'Claude Code' });
  }
  if (settings.pi?.enabled && isPiReady(settings)) {
    available.push({ value: 'pi-coding-agent', label: 'Pi Coding Agent' });
  }
  if (settings.geminiCli?.enabled && isGeminiCliReady(settings)) {
    available.push({ value: 'gemini-cli', label: 'Gemini CLI' });
  }
  if (settings.codexCli?.enabled && isCodexCliReady(settings)) {
    available.push({ value: 'codex-cli', label: 'Codex CLI' });
  }
  if (settings.openCode?.enabled && isOpenCodeReady(settings)) {
    available.push({ value: 'opencode', label: 'OpenCode' });
  }
  if (settings.kimiCli?.enabled && isKimiCliReady(settings)) {
    available.push({ value: 'kimi-cli', label: 'Kimi CLI' });
  }

  const handleChange = async (e) => {
    setSaving(true);
    const result = await setCodingAgentDefault(e.target.value);
    setSaving(false);
    if (result?.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await onReload();
    }
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-medium">Coding Agent</h2>
        <p className="text-sm text-muted-foreground">Select which coding agent runs headless tasks and code workspaces.</p>
      </div>
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium shrink-0">Default Coding Agent</label>
          <div className="flex items-center gap-3">
            {saving && <span className="text-xs text-muted-foreground">Saving...</span>}
            {saved && <span className="text-xs text-green-500 inline-flex items-center gap-1"><CheckIcon size={12} /> Saved</span>}
            <select
              value={settings.defaultAgent || 'claude-code'}
              onChange={handleChange}
              className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            >
              {available.length > 0 ? (
                available.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))
              ) : (
                <option value="" disabled>No agents ready</option>
              )}
            </select>
          </div>
        </div>
        <div className="border-t border-border pt-3 space-y-3">
          <p className="text-sm font-semibold">Agent Mode</p>
          <ModeDefaultRow
            label="Branch"
            mode="agent"
            field="branch"
            value={settings.modeDefaults?.agent?.branch || 'default'}
            options={BRANCH_OPTIONS}
            onSaved={onReload}
          />
          <ModeDefaultRow
            label="Git action"
            mode="agent"
            field="gitAction"
            value={settings.modeDefaults?.agent?.gitAction || 'push'}
            options={GIT_ACTION_OPTIONS}
            onSaved={onReload}
          />
          <ModeAutoRunRow
            mode="agent"
            value={!!settings.modeDefaults?.agent?.autoRun}
            onSaved={onReload}
          />
        </div>
        <div className="border-t border-border pt-3 space-y-3">
          <p className="text-sm font-semibold">Code Mode</p>
          <ModeDefaultRow
            label="Branch"
            mode="code"
            field="branch"
            value={settings.modeDefaults?.code?.branch || 'dynamic'}
            options={BRANCH_OPTIONS}
            onSaved={onReload}
          />
          <ModeDefaultRow
            label="Git action"
            mode="code"
            field="gitAction"
            value={settings.modeDefaults?.code?.gitAction || 'create-pr'}
            options={GIT_ACTION_OPTIONS}
            onSaved={onReload}
          />
          <ModeAutoRunRow
            mode="code"
            value={!!settings.modeDefaults?.code?.autoRun}
            onSaved={onReload}
          />
        </div>
      </div>
    </div>
  );
}

function ModeAutoRunRow({ mode, value, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleToggle = async () => {
    setSaving(true);
    const result = await setModeDefault(mode, 'autoRun', !value);
    setSaving(false);
    if (result?.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await onSaved();
    }
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <label className="text-sm font-medium">Auto-run</label>
        <p className="text-xs text-muted-foreground">Run the git action automatically when the agent finishes.</p>
      </div>
      <div className="flex items-center gap-3">
        {saving && <span className="text-xs text-muted-foreground">Saving...</span>}
        {saved && <span className="text-xs text-green-500 inline-flex items-center gap-1"><CheckIcon size={12} /> Saved</span>}
        <ToggleSwitch checked={value} onChange={handleToggle} />
      </div>
    </div>
  );
}

const BRANCH_OPTIONS = [
  { value: 'default', label: 'Default branch' },
  { value: 'dynamic', label: 'Feature branch' },
];

const GIT_ACTION_OPTIONS = GIT_COMMANDS.map(value => ({ value, label: getCommandLabel(value) }));

function ModeDefaultRow({ label, mode, field, value, options, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleChange = async (e) => {
    setSaving(true);
    const result = await setModeDefault(mode, field, e.target.value);
    setSaving(false);
    if (result?.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await onSaved();
    }
  };

  return (
    <div className="flex items-center justify-between">
      <label className="text-sm font-medium shrink-0">{label}</label>
      <div className="flex items-center gap-3">
        {saving && <span className="text-xs text-muted-foreground">Saving...</span>}
        {saved && <span className="text-xs text-green-500 inline-flex items-center gap-1"><CheckIcon size={12} /> Saved</span>}
        <select
          value={value}
          onChange={handleChange}
          className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Cards
// ─────────────────────────────────────────────────────────────────────────────

function AgentCards({ settings, onReload }) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-medium">Agents</h2>
        <p className="text-sm text-muted-foreground">Enable and configure individual coding agents.</p>
      </div>
      <div className="space-y-4">
        <ClaudeCodeCard settings={settings} onReload={onReload} />
        <PiCard settings={settings} onReload={onReload} />
        <GeminiCliCard settings={settings} onReload={onReload} />
        <CodexCliCard settings={settings} onReload={onReload} />
        <OpenCodeCard settings={settings} onReload={onReload} />
        <KimiCliCard settings={settings} onReload={onReload} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude Code card
// ─────────────────────────────────────────────────────────────────────────────

function ClaudeCodeCard({ settings, onReload }) {
  const config = settings.claudeCode;
  const ready = isClaudeCodeReady(settings);
  const backend = config.backend || 'anthropic';
  const [saving, setSaving] = useState(false);
  const [modelText, setModelText] = useState(config.model || '');

  // Build backend options: Anthropic + providers with anthropicEndpoint AND a configured key
  const backendOptions = [{ slug: 'anthropic', name: 'Anthropic' }];
  if (settings?.builtinProviders && settings?.credentialStatuses) {
    const statusMap = new Map(settings.credentialStatuses.map((s) => [s.key, s.isSet]));
    for (const [slug, prov] of Object.entries(settings.builtinProviders)) {
      if (slug === 'anthropic') continue;
      if (!prov.anthropicEndpoint && !prov.litellmProxy) continue;
      const hasKey = prov.credentials.some((c) => statusMap.get(c.key));
      if (hasKey) {
        backendOptions.push({ slug, name: prov.name });
      }
    }
  }
  // Custom providers → route through LiteLLM
  if (settings?.customProviders) {
    for (const cp of settings.customProviders) {
      backendOptions.push({ slug: cp.key, name: cp.name });
    }
  }

  // Models for selected backend — builtin models or custom provider models
  const builtinBackendModels = getAgentModels(settings, backend);
  const customBackend = settings?.customProviders?.find((cp) => cp.key === backend);
  const backendModels = builtinBackendModels.length > 0
    ? builtinBackendModels
    : (customBackend?.models || []).map((m) => ({ id: m, name: m }));

  const handleToggle = async () => {
    await updateCodingAgentConfig('claude-code', { enabled: !config.enabled });
    await onReload();
  };

  const handleBackendChange = async (e) => {
    const newBackend = e.target.value;
    let newModel = '';
    if (newBackend !== 'anthropic') {
      // Non-Anthropic backends require an explicit model
      const models = getAgentModels(settings, newBackend);
      if (models.length > 0) {
        newModel = models[0].id;
      } else {
        // Custom provider — use its first configured model
        const cp = settings?.customProviders?.find((p) => p.key === newBackend);
        newModel = cp?.models?.[0] || '';
      }
    }
    setModelText(newModel);
    setSaving(true);
    await updateCodingAgentConfig('claude-code', { backend: newBackend, model: newModel });
    setSaving(false);
    await onReload();
    showSaved();
  };

  const handleAuthChange = async (auth) => {
    await updateCodingAgentConfig('claude-code', { auth });
    await onReload();
  };

  const [searchError, setSearchError] = useState('');
  const handleSearchChange = async (e) => {
    setSaving(true);
    setSearchError('');
    try {
      const result = await updateCodingAgentConfig('claude-code', { search: e.target.value });
      if (result?.error) {
        setSearchError(result.error);
      } else {
        await onReload();
        showSaved();
      }
    } catch {
      setSearchError('Could not save chat search provider');
    } finally {
      setSaving(false);
    }
  };

  const [saved, setSaved] = useState(false);

  const showSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleModelChange = async (e) => {
    await updateCodingAgentConfig('claude-code', { model: e.target.value });
    await onReload();
    showSaved();
  };

  const handleModelTextSave = async () => {
    setSaving(true);
    await updateCodingAgentConfig('claude-code', { model: modelText });
    setSaving(false);
    await onReload();
    showSaved();
  };

  // Credential hint for third-party backends
  const backendProvider = settings?.builtinProviders?.[backend];
  const backendKeySet = backend !== 'anthropic' && backendProvider
    ? settings.credentialStatuses?.find(s => s.key === backendProvider.credentials[0]?.key)?.isSet || false
    : false;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Claude Code</span>
          <StatusDot ready={ready} />
        </div>
        <div className="flex items-center gap-3">
          {saving && <span className="text-xs text-muted-foreground">Saving...</span>}
          {!saving && saved && <span className="text-xs text-green-500 inline-flex items-center gap-1"><CheckIcon size={12} /> Saved</span>}
          <ToggleSwitch checked={config.enabled} onChange={handleToggle} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">Anthropic's official coding agent. Supports plan and code permission modes.</p>

      {config.enabled && (
        <div className="border-t border-border pt-3 space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="claude-chat-search" className="text-sm font-medium">Chat web search</label>
              <select
                id="claude-chat-search"
                value={config.search || 'parallel'}
                onChange={handleSearchChange}
                disabled={saving}
                className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
              >
                <option value="parallel">Parallel (no API key)</option>
                <option value="native">Claude native tools</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
            <p className="text-xs text-muted-foreground">Built-in search and page fetching in live chats. Custom MCP servers, skills and Docker agents keep their configuration.</p>
            {searchError && <p role="alert" className="text-xs text-destructive">{searchError}</p>}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Backend API</label>
              <select
                value={backend}
                onChange={handleBackendChange}
                className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
              >
                {backendOptions.map((b) => (
                  <option key={b.slug} value={b.slug}>{b.name}</option>
                ))}
              </select>
            </div>
            {backendOptions.length <= 1 && (
              <p className="text-xs text-muted-foreground">
                Claude Code also works with Anthropic-compatible APIs like DeepSeek and MiniMax.{' '}
                <a href="/admin/event-handler/llms" className="underline hover:text-foreground transition-colors">
                  Add a provider key
                </a>{' '}
                to unlock more backends.
              </p>
            )}
          </div>

          <div className="border-t border-border pt-3 space-y-3">
          {backend === 'anthropic' ? (
            <>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Auth Mode</label>
                <div className="flex rounded-md border border-border overflow-hidden">
                  <button
                    onClick={() => handleAuthChange('oauth')}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      config.auth === 'oauth'
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    }`}
                  >
                    OAuth Token
                  </button>
                  <button
                    onClick={() => handleAuthChange('api-key')}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      config.auth === 'api-key'
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    }`}
                  >
                    API Key
                  </button>
                </div>
              </div>

              {config.auth === 'oauth' ? (
                <CredentialHint
                  ready={config.oauthTokenCount > 0}
                  readyText={`${config.oauthTokenCount} OAuth token${config.oauthTokenCount !== 1 ? 's' : ''} configured`}
                  missingText="Add an OAuth token on the LLMs page under Anthropic → OAuth Tokens"
                />
              ) : (
                <CredentialHint
                  ready={config.anthropicKeySet}
                  readyText="Anthropic API Key is set"
                  missingText="Set your Anthropic API Key on the LLMs page"
                />
              )}
            </>
          ) : (
            <CredentialHint
              ready={backendKeySet}
              readyText={`${backendProvider?.name || backend} API Key is set`}
              missingText={`Set your ${backendProvider?.name || backend} API Key on the LLMs page`}
            />
          )}
          </div>

          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Model</label>
              {backendModels.length > 0 || backend === 'anthropic' ? (
                <select
                  value={config.model || ''}
                  onChange={handleModelChange}
                  className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                >
                  {backend === 'anthropic' && <option value="">Default</option>}
                  {backendModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={modelText}
                  onChange={(e) => setModelText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleModelTextSave()}
                  placeholder="Model name"
                  className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                />
              )}
            </div>
          </div>
          {backendModels.length === 0 && backend !== 'anthropic' && (
            <div className="flex justify-end mt-4">
              <button onClick={handleModelTextSave} disabled={modelText === (config.model || '')}
                className="rounded-md px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors">
                Save
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pi Coding Agent card
// ─────────────────────────────────────────────────────────────────────────────

function PiCard({ settings, onReload }) {
  const config = settings.pi;
  const [modelText, setModelText] = useState(config.model || '');
  const [saved, setSaved] = useState(false);

  const showSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleToggle = async () => {
    await updateCodingAgentConfig('pi-coding-agent', { enabled: !config.enabled });
    await onReload();
  };

  const handleProviderChange = async (e) => {
    const newProvider = e.target.value;
    // Auto-select first model for custom providers
    const cp = settings?.customProviders?.find((p) => p.key === newProvider);
    const newModel = cp?.models?.[0] || '';
    setModelText(newModel);
    await updateCodingAgentConfig('pi-coding-agent', { provider: newProvider, model: newModel });
    await onReload();
    showSaved();
  };

  const handleModelChange = async (e) => {
    await updateCodingAgentConfig('pi-coding-agent', { model: e.target.value });
    await onReload();
    showSaved();
  };

  const handleModelTextSave = async () => {
    await updateCodingAgentConfig('pi-coding-agent', { model: modelText });
    await onReload();
    showSaved();
  };

  // Build available providers list (builtin with keys set + custom providers)
  const availableProviders = [];
  if (settings?.builtinProviders && settings?.credentialStatuses) {
    const statusMap = new Map(settings.credentialStatuses.map((s) => [s.key, s.isSet]));
    for (const [slug, prov] of Object.entries(settings.builtinProviders)) {
      const hasKey = prov.credentials.some((c) => statusMap.get(c.key));
      if (hasKey) {
        availableProviders.push({ slug, name: prov.name });
      }
    }
  }
  if (settings?.customProviders) {
    for (const cp of settings.customProviders) {
      availableProviders.push({ slug: cp.key, name: cp.name });
    }
  }

  const ready = isPiReady(settings);
  const selectedProviderReady = availableProviders.some(p => p.slug === config.provider);

  // Get models for selected provider — builtin models or custom provider models
  const builtinModels = config.provider ? getAgentModels(settings, config.provider) : [];
  const customProvider = settings?.customProviders?.find((p) => p.key === config.provider);
  const providerModels = builtinModels.length > 0 ? builtinModels : (customProvider?.models || []).map((m) => ({ id: m, name: m }));

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Pi Coding Agent</span>
          {config.enabled && <StatusDot ready={ready} />}
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-green-500 inline-flex items-center gap-1"><CheckIcon size={12} /> Saved</span>}
          <ToggleSwitch checked={config.enabled} onChange={handleToggle} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">Third-party agent by Mario Zechner. Works with 20+ LLM providers.</p>

      {config.enabled && (
        <div className="border-t border-border pt-3 space-y-3">
          {availableProviders.length > 0 ? (
            <>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Provider</label>
                <select
                  value={config.provider || ''}
                  onChange={handleProviderChange}
                  className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                >
                  <option value="">Select provider...</option>
                  {availableProviders.map((p) => (
                    <option key={p.slug} value={p.slug}>{p.name}</option>
                  ))}
                </select>
              </div>

              {config.provider && (
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Model</label>
                  {providerModels.length > 0 ? (
                    <select
                      value={config.model || ''}
                      onChange={handleModelChange}
                      className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                    >
                      {!customProvider && <option value="">Default</option>}
                      {providerModels.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={modelText}
                      onChange={(e) => setModelText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleModelTextSave()}
                      placeholder="Model name"
                      className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                    />
                  )}
                </div>
              )}

              {config.provider && !selectedProviderReady && (
                <CredentialHint
                  ready={false}
                  missingText={`${config.provider} API Key is not set. Configure it on the LLMs page.`}
                />
              )}

              {config.provider && providerModels.length === 0 && (
                <div className="flex justify-end mt-1">
                  <button onClick={handleModelTextSave} disabled={modelText === (config.model || '')}
                    className="rounded-md px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors">
                    Save
                  </button>
                </div>
              )}
            </>
          ) : (
            <CredentialHint
              ready={false}
              missingText="Configure at least one LLM provider on the LLMs page to use Pi"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini CLI card
// ─────────────────────────────────────────────────────────────────────────────

function GeminiCliCard({ settings, onReload }) {
  const config = settings.geminiCli;
  const ready = isGeminiCliReady(settings);

  const googleModels = getAgentModels(settings, 'google');

  const handleToggle = async () => {
    await updateCodingAgentConfig('gemini-cli', { enabled: !config.enabled });
    await onReload();
  };

  const handleModelChange = async (e) => {
    await updateCodingAgentConfig('gemini-cli', { model: e.target.value });
    await onReload();
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Gemini CLI</span>
          {config.enabled && <StatusDot ready={ready} />}
        </div>
        <ToggleSwitch checked={config.enabled} onChange={handleToggle} />
      </div>
      <p className="text-xs text-muted-foreground mb-3">Google's official coding agent. Uses your Google API Key.</p>

      {config.enabled && (
        <div className="border-t border-border pt-3 space-y-3">
          <CredentialHint
            ready={config.googleKeySet}
            readyText="Google API Key is set"
            missingText="Set your Google API Key on the LLMs page"
          />

          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Model</label>
              <select
                value={config.model || ''}
                onChange={handleModelChange}
                className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
              >
                <option value="">Default</option>
                {googleModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Codex CLI card
// ─────────────────────────────────────────────────────────────────────────────

function CodexCliCard({ settings, onReload }) {
  const config = settings.codexCli;
  const ready = isCodexCliReady(settings);

  const openaiModels = getAgentModels(settings, 'openai');

  const handleToggle = async () => {
    await updateCodingAgentConfig('codex-cli', { enabled: !config.enabled });
    await onReload();
  };

  const handleAuthChange = async (auth) => {
    await updateCodingAgentConfig('codex-cli', { auth });
    await onReload();
  };

  const handleModelChange = async (e) => {
    await updateCodingAgentConfig('codex-cli', { model: e.target.value });
    await onReload();
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Codex CLI</span>
          {config.enabled && <StatusDot ready={ready} />}
        </div>
        <ToggleSwitch checked={config.enabled} onChange={handleToggle} />
      </div>
      <p className="text-xs text-muted-foreground mb-3">OpenAI's official coding agent. Supports API key and ChatGPT OAuth billing.</p>

      {config.enabled && (
        <div className="border-t border-border pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Auth Mode</label>
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => handleAuthChange('api-key')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  config.auth === 'api-key'
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                API Key
              </button>
              <button
                onClick={() => handleAuthChange('oauth')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  config.auth === 'oauth'
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                ChatGPT OAuth
              </button>
            </div>
          </div>

          {config.auth === 'oauth' ? (
            <CredentialHint
              ready={config.oauthTokenCount > 0}
              readyText={`${config.oauthTokenCount} OAuth token${config.oauthTokenCount !== 1 ? 's' : ''} configured`}
              missingText="Add a Codex OAuth token on the LLMs page under OpenAI → OAuth Tokens"
            />
          ) : (
            <CredentialHint
              ready={config.codexKeySet}
              readyText="OpenAI API Key is set"
              missingText="Set your OpenAI API Key on the LLMs page"
            />
          )}

          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Model</label>
              <select
                value={config.model || ''}
                onChange={handleModelChange}
                className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
              >
                <option value="">Default</option>
                {openaiModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenCode card
// ─────────────────────────────────────────────────────────────────────────────

function OpenCodeCard({ settings, onReload }) {
  const config = settings.openCode;
  const [modelText, setModelText] = useState(config.model || '');
  const [saved, setSaved] = useState(false);

  const showSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleToggle = async () => {
    await updateCodingAgentConfig('opencode', { enabled: !config.enabled });
    await onReload();
  };

  const handleProviderChange = async (e) => {
    const newProvider = e.target.value;
    const cp = settings?.customProviders?.find((p) => p.key === newProvider);
    const newModel = cp?.models?.[0] || '';
    setModelText(newModel);
    await updateCodingAgentConfig('opencode', { provider: newProvider, model: newModel });
    await onReload();
    showSaved();
  };

  const handleModelChange = async (e) => {
    await updateCodingAgentConfig('opencode', { model: e.target.value });
    await onReload();
    showSaved();
  };

  const handleModelTextSave = async () => {
    await updateCodingAgentConfig('opencode', { model: modelText });
    await onReload();
    showSaved();
  };

  // Build available providers list (same pattern as PiCard)
  const availableProviders = [];
  if (settings?.builtinProviders && settings?.credentialStatuses) {
    const statusMap = new Map(settings.credentialStatuses.map((s) => [s.key, s.isSet]));
    for (const [slug, prov] of Object.entries(settings.builtinProviders)) {
      const hasKey = prov.credentials.some((c) => statusMap.get(c.key));
      if (hasKey) {
        availableProviders.push({ slug, name: prov.name });
      }
    }
  }
  if (settings?.customProviders) {
    for (const cp of settings.customProviders) {
      availableProviders.push({ slug: cp.key, name: cp.name });
    }
  }

  const ready = isOpenCodeReady(settings);
  const selectedProviderReady = availableProviders.some(p => p.slug === config.provider);

  // Get models for selected provider — builtin models or custom provider models
  const builtinModels = config.provider ? getAgentModels(settings, config.provider) : [];
  const customProvider = settings?.customProviders?.find((p) => p.key === config.provider);
  const providerModels = builtinModels.length > 0 ? builtinModels : (customProvider?.models || []).map((m) => ({ id: m, name: m }));

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">OpenCode</span>
          {config.enabled && <StatusDot ready={ready} />}
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-green-500 inline-flex items-center gap-1"><CheckIcon size={12} /> Saved</span>}
          <ToggleSwitch checked={config.enabled} onChange={handleToggle} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">Open-source coding agent with multi-provider support.</p>

      {config.enabled && (
        <div className="border-t border-border pt-3 space-y-3">
          {availableProviders.length > 0 ? (
            <>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Provider</label>
                <select
                  value={config.provider || ''}
                  onChange={handleProviderChange}
                  className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                >
                  <option value="">Select provider...</option>
                  {availableProviders.map((p) => (
                    <option key={p.slug} value={p.slug}>{p.name}</option>
                  ))}
                </select>
              </div>

              {config.provider && (
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Model</label>
                  {providerModels.length > 0 ? (
                    <select
                      value={config.model || ''}
                      onChange={handleModelChange}
                      className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                    >
                      {!customProvider && <option value="">Default</option>}
                      {providerModels.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={modelText}
                      onChange={(e) => setModelText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleModelTextSave()}
                      placeholder="Model name"
                      className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                    />
                  )}
                </div>
              )}

              {config.provider && !selectedProviderReady && (
                <CredentialHint
                  ready={false}
                  missingText={`${config.provider} API Key is not set. Configure it on the LLMs page.`}
                />
              )}

              {config.provider && providerModels.length === 0 && (
                <div className="flex justify-end mt-1">
                  <button onClick={handleModelTextSave} disabled={modelText === (config.model || '')}
                    className="rounded-md px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors">
                    Save
                  </button>
                </div>
              )}
            </>
          ) : (
            <CredentialHint
              ready={false}
              missingText="Configure at least one LLM provider on the LLMs page to use OpenCode"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Kimi CLI card
// ─────────────────────────────────────────────────────────────────────────────

function KimiCliCard({ settings, onReload }) {
  const config = settings.kimiCli;
  const [modelText, setModelText] = useState(config.model || '');
  const [saved, setSaved] = useState(false);

  const showSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleToggle = async () => {
    await updateCodingAgentConfig('kimi-cli', { enabled: !config.enabled });
    await onReload();
  };

  const handleProviderChange = async (e) => {
    const newProvider = e.target.value;
    const cp = settings?.customProviders?.find((p) => p.key === newProvider);
    const models = getAgentModels(settings, newProvider);
    const newModel = models.length > 0 ? models[0].id : (cp?.models?.[0] || '');
    setModelText(newModel);
    await updateCodingAgentConfig('kimi-cli', { provider: newProvider, model: newModel });
    await onReload();
    showSaved();
  };

  const handleModelChange = async (e) => {
    await updateCodingAgentConfig('kimi-cli', { model: e.target.value });
    await onReload();
    showSaved();
  };

  const handleModelTextSave = async () => {
    await updateCodingAgentConfig('kimi-cli', { model: modelText });
    await onReload();
    showSaved();
  };

  const availableProviders = [];
  if (settings?.builtinProviders && settings?.credentialStatuses) {
    const statusMap = new Map(settings.credentialStatuses.map((s) => [s.key, s.isSet]));
    for (const [slug, prov] of Object.entries(settings.builtinProviders)) {
      const hasKey = prov.credentials.some((c) => statusMap.get(c.key));
      if (hasKey) {
        availableProviders.push({ slug, name: prov.name });
      }
    }
  }
  if (settings?.customProviders) {
    for (const cp of settings.customProviders) {
      availableProviders.push({ slug: cp.key, name: cp.name });
    }
  }

  const ready = isKimiCliReady(settings);
  const selectedProviderReady = availableProviders.some(p => p.slug === config.provider);

  const builtinModels = config.provider ? getAgentModels(settings, config.provider) : [];
  const customProvider = settings?.customProviders?.find((p) => p.key === config.provider);
  const providerModels = builtinModels.length > 0 ? builtinModels : (customProvider?.models || []).map((m) => ({ id: m, name: m }));

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Kimi CLI</span>
          {config.enabled && <StatusDot ready={ready} />}
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-green-500 inline-flex items-center gap-1"><CheckIcon size={12} /> Saved</span>}
          <ToggleSwitch checked={config.enabled} onChange={handleToggle} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">Coding agent by MoonshotAI with multi-provider support.</p>

      {config.enabled && (
        <div className="border-t border-border pt-3 space-y-3">
          {availableProviders.length > 0 ? (
            <>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Provider</label>
                <select
                  value={config.provider || ''}
                  onChange={handleProviderChange}
                  className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                >
                  <option value="">Select provider...</option>
                  {availableProviders.map((p) => (
                    <option key={p.slug} value={p.slug}>{p.name}</option>
                  ))}
                </select>
              </div>

              {config.provider && (
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Model</label>
                  {providerModels.length > 0 ? (
                    <select
                      value={config.model || ''}
                      onChange={handleModelChange}
                      className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                    >
                      {providerModels.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={modelText}
                      onChange={(e) => setModelText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleModelTextSave()}
                      placeholder="Model name"
                      className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                    />
                  )}
                </div>
              )}

              {config.provider && !selectedProviderReady && (
                <CredentialHint
                  ready={false}
                  missingText={`${config.provider} API Key is not set. Configure it on the LLMs page.`}
                />
              )}

              {config.provider && providerModels.length === 0 && (
                <div className="flex justify-end mt-1">
                  <button onClick={handleModelTextSave} disabled={modelText === (config.model || '')}
                    className="rounded-md px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors">
                    Save
                  </button>
                </div>
              )}
            </>
          ) : (
            <CredentialHint
              ready={false}
              missingText="Configure at least one LLM provider on the LLMs page to use Kimi CLI"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get models for a provider that are coding-agent capable.
 * Models without a codingAgent flag default to true.
 */
function getAgentModels(settings, providerSlug) {
  const provider = settings?.builtinProviders?.[providerSlug];
  if (!provider?.models) return [];
  return provider.models.filter((m) => m.codingAgent !== false);
}

function isClaudeCodeReady(settings) {
  const { claudeCode } = settings;
  if (!claudeCode?.enabled) return false;
  const backend = claudeCode.backend || 'anthropic';
  if (backend === 'anthropic') {
    if (claudeCode.auth === 'oauth') return claudeCode.oauthTokenCount > 0;
    return claudeCode.anthropicKeySet;
  }
  return isProviderReady(settings, backend);
}

function isPiReady(settings) {
  if (!settings.pi?.enabled || !settings.pi?.provider) return false;
  return isProviderReady(settings, settings.pi.provider);
}

function isGeminiCliReady(settings) {
  if (!settings.geminiCli?.enabled) return false;
  return settings.geminiCli.googleKeySet;
}

function isCodexCliReady(settings) {
  const { codexCli } = settings;
  if (!codexCli?.enabled) return false;
  if (codexCli.auth === 'oauth') return codexCli.oauthTokenCount > 0;
  return codexCli.codexKeySet;
}

function isOpenCodeReady(settings) {
  if (!settings.openCode?.enabled || !settings.openCode?.provider) return false;
  return isProviderReady(settings, settings.openCode.provider);
}

function isKimiCliReady(settings) {
  if (!settings.kimiCli?.enabled || !settings.kimiCli?.provider) return false;
  return isProviderReady(settings, settings.kimiCli.provider);
}

function isProviderReady(settings, provider) {
  // Check if selected provider has credentials
  const statusMap = new Map((settings.credentialStatuses || []).map(s => [s.key, s.isSet]));
  const builtin = settings.builtinProviders?.[provider];
  if (builtin) {
    return builtin.credentials.some(c => statusMap.get(c.key));
  }
  // Custom provider — always considered ready if it exists
  return (settings.customProviders || []).some(cp => cp.key === provider);
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-foreground' : 'bg-border'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function StatusDot({ ready }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-full ${ready ? 'bg-green-500' : 'bg-border'}`} />
      <span className={`text-xs ${ready ? 'text-green-500' : 'text-muted-foreground'}`}>
        {ready ? 'Ready' : 'Missing credentials'}
      </span>
    </span>
  );
}

function CredentialHint({ ready, readyText, missingText }) {
  if (ready) {
    return (
      <p className="text-xs text-green-500 flex items-center gap-1">
        <CheckIcon size={12} />
        {readyText}
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      {missingText}{' '}
      <a href="/admin/event-handler/llms" className="underline hover:text-foreground transition-colors">
        Go to LLMs settings
      </a>
    </p>
  );
}
